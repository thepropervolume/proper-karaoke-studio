import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { normalizeLyricStyle } from './lyric-style.ts';
import { normalizeWordTimingDrafts } from './manual-timing.ts';
import { savedLyricTimingText } from './lyric-timing-text.ts';
import { normalizeVideoPresentation } from './video-presentation.ts';

export const projectSchema = 'com.thepropervolume.karaoke-studio';
export const stemRoles = ['instrumental', 'lead', 'backing', 'other'];

const revisions = new WeakMap();
const digest = contents => createHash('sha256').update(contents).digest('hex');

export function projectRevision(project) {
  return revisions.get(project);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function string(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? 'text' : 'non-empty text'}.`);
  }
  return value;
}

function time(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite, nonnegative number.`);
  }
  return value;
}

function cue(value, label) {
  object(value, label);
  const text = string(value.text, `${label} text`, true);
  const startSeconds = time(value.startSeconds, `${label} start`);
  const endSeconds = time(value.endSeconds, `${label} end`);
  if (endSeconds < startSeconds) throw new Error(`${label} ends before it starts.`);
  return { text, startSeconds, endSeconds };
}

function distinctIds(items, label) {
  if (new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error(`${label} must have distinct IDs.`);
  }
  return items;
}

export function validateProject(input, projectPath) {
  const value = object(input, 'Project');
  if (value.schema !== projectSchema || value.version !== 1) {
    throw new Error('This is not a supported Studio project.');
  }
  if (!Array.isArray(value.stems) || !Array.isArray(value.lyrics)) {
    throw new Error('A Studio project must contain stems and lyrics arrays.');
  }
  const folder = dirname(resolve(projectPath));
  const mediaPath = (entry, label) => resolve(folder, string(entry, label));
  const stems = value.stems.map((stem, index) => {
    const label = `Stem ${index + 1}`;
    object(stem, label);
    if (!stemRoles.includes(stem.role)) throw new Error(`${label} has an invalid role.`);
    if (!Number.isFinite(stem.volume) || stem.volume < 0 || stem.volume > 1) {
      throw new Error(`${label} volume must be between 0 and 1.`);
    }
    return {
      id: string(stem.id, `${label} ID`),
      name: string(stem.name, `${label} name`),
      role: stem.role,
      voice: string(stem.voice, `${label} voice`, true),
      path: mediaPath(stem.path, `${label} path`),
      durationSeconds: time(stem.durationSeconds, `${label} duration`),
      volume: stem.volume,
    };
  });
  const lyrics = value.lyrics.map((line, index) => {
    const label = `Lyric line ${index + 1}`;
    const fields = cue(line, label);
    const timingText = savedLyricTimingText(fields.text, line.timingText);
    if (!Array.isArray(line.words)) throw new Error(`${label} is missing its word timings array.`);
    return {
      id: string(line.id, `${label} ID`),
      ...fields,
      ...(timingText === undefined ? {} : { timingText }),
      words: line.words.map((word, wordIndex) => cue(word, `${label}, word ${wordIndex + 1}`)),
    };
  });
  const wordTimingDrafts = normalizeWordTimingDrafts(value.wordTimingDrafts, lyrics);
  const lyricStyle = normalizeLyricStyle(value.lyricStyle);
  if (lyricStyle.customFont) lyricStyle.customFont.path = mediaPath(lyricStyle.customFont.path, 'Lyric font');
  const videoPresentation = normalizeVideoPresentation(value.videoPresentation);
  for (const kind of ['logo', 'openingAnimation', 'closingAnimation']) {
    const asset = videoPresentation[kind];
    if (asset.path) asset.path = mediaPath(asset.path, 'Presentation media');
  }
  return {
    schema: projectSchema,
    version: 1,
    title: string(value.title, 'Song title', true),
    artist: string(value.artist, 'Artist', true),
    durationSeconds: time(value.durationSeconds, 'Project duration'),
    stems: distinctIds(stems, 'Stems'),
    lyrics: distinctIds(lyrics, 'Lyric lines'),
    importedCdg: value.importedCdg == null ? null : mediaPath(value.importedCdg, 'CD+G source'),
    backgroundPath: value.backgroundPath == null ? null : mediaPath(value.backgroundPath, 'Backdrop'),
    backgroundLoop: value.backgroundLoop !== false,
    lyricStyle,
    videoPresentation,
    ...(Object.keys(wordTimingDrafts).length ? { wordTimingDrafts } : {}),
  };
}

export async function loadProject(file) {
  const projectPath = resolve(file);
  let contents;
  try {
    contents = await readFile(projectPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const missing = new Error(`Project file not found: ${projectPath}`, { cause: error });
    missing.code = 'ENOENT';
    throw missing;
  }
  let value;
  try {
    value = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Invalid JSON in project file: ${projectPath}`, { cause: error });
  }
  const project = validateProject(value, projectPath);
  revisions.set(project, digest(contents));
  return project;
}

export async function saveProject(file, input, { createOnly = false, expectedRevision } = {}) {
  const projectPath = resolve(file);
  const project = validateProject(input, projectPath);
  const contents = JSON.stringify(project, null, 2) + '\n';
  const lockPath = projectPath + '.lock';
  const draft = resolve(dirname(projectPath), `.${basename(projectPath)}.${randomUUID()}.tmp`);

  // All Studio writers use this lock while committing changes. Long-running
  // tasks carry their original revision so a stale result cannot replace edits.
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`Project is locked. Retry after the other write finishes: ${projectPath}`, { cause: error });
  }
  try {
    if (expectedRevision !== undefined) {
      const current = await readFile(projectPath, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (current === null || digest(current) !== expectedRevision) {
        throw new Error('The project changed on disk. Reload it and repeat the operation.');
      }
    }
    const handle = await open(draft, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (createOnly) {
      // A link publishes the completed file only if its target does not exist.
      await link(draft, projectPath).catch(error => {
        if (error.code !== 'EEXIST') throw error;
        throw new Error(`Project already exists: ${projectPath}`, { cause: error });
      });
    } else {
      await rename(draft, projectPath);
    }
    revisions.set(project, digest(contents));
    return project;
  } finally {
    await lock.close().finally(() => rm(lockPath, { force: true }));
    await rm(draft, { force: true });
  }
}
