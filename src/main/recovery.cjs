const { randomUUID } = require('node:crypto');
const { mkdir, open, readdir, readFile, rename, rm, stat } = require('node:fs/promises');
const { isAbsolute, join } = require('node:path');
const { validateProject } = require('../domain/project-file.mjs');

const validId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const maxBytes = 16 * 1024 * 1024;

function normalize(value, file) {
  const { origin, lyricsDraft } = value;
  if (origin != null && (typeof origin.file !== 'string' || !isAbsolute(origin.file) ||
      typeof origin.revision !== 'string' || !/^[a-f0-9]{64}$/.test(origin.revision))) {
    throw new Error('Invalid project origin for recovery.');
  }
  if (lyricsDraft != null && (typeof lyricsDraft !== 'string' || lyricsDraft.length > 2 * 1024 * 1024)) {
    throw new Error('The lyric draft is too large to recover.');
  }
  return {
    project: validateProject(value.project, origin?.file || file),
    origin: origin ? { file: origin.file, revision: origin.revision } : null,
    lyricsDraft: lyricsDraft ?? null,
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function createRecoveryStore(directory) {
  const id = randomUUID();
  const file = join(directory, id + '.json');
  let queued;
  let timer;
  let committed = Promise.resolve();

  async function write(contents) {
    if (contents === null) return rm(file, { force: true });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = file + '.tmp';
    try {
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  // Coalesce rapid input while keeping writes ordered and flushable at close.
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const item = queued;
    queued = undefined;
    if (item) {
      committed = committed.catch(() => {}).then(() => write(item.contents));
      committed.then(
        () => item.waiters.forEach(({ resolve }) => resolve()),
        error => item.waiters.forEach(({ reject }) => reject(error)),
      );
    }
    return committed;
  }

  function update(value) {
    const contents = value === null ? null : JSON.stringify({
      version: 1,
      pid: process.pid,
      savedAt: Date.now(),
      ...normalize(value, file),
    });
    if (contents && Buffer.byteLength(contents) > maxBytes) throw new Error('This project is too large for recovery.');
    return new Promise((resolve, reject) => {
      if (queued) {
        queued.contents = contents;
        queued.waiters.push({ resolve, reject });
      } else queued = { contents, waiters: [{ resolve, reject }] };
      timer ??= setTimeout(() => void flush().catch(() => {}), 350);
    });
  }

  async function get(draftId) {
    if (typeof draftId !== 'string' || !validId.test(draftId) || draftId === id) return null;
    const draftFile = join(directory, draftId + '.json');
    try {
      if ((await stat(draftFile)).size > maxBytes) return null;
      const value = JSON.parse(await readFile(draftFile, 'utf8'));
      if (value.version !== 1 || !Number.isFinite(value.savedAt) || !Number.isSafeInteger(value.pid) || value.pid <= 0) return null;
      if (value.pid !== process.pid && processExists(value.pid)) return null;
      return { id: draftId, savedAt: value.savedAt, ...normalize(value, draftFile) };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || !error.code) return null;
      throw error;
    }
  }

  async function list() {
    const names = await readdir(directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const entries = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => get(name.slice(0, -5))));
    return entries.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt).map(({ id, savedAt, project, origin }) => ({
      id, savedAt, title: project.title, artist: project.artist, sourceFile: origin?.file ?? null,
    }));
  }

  async function discard(draftId) {
    if (await get(draftId)) await rm(join(directory, draftId + '.json'), { force: true });
  }

  return { update, flush, list, get, discard };
}

module.exports = { createRecoveryStore };
