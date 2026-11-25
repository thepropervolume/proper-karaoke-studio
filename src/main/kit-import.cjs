const { createWriteStream } = require('node:fs');
const { lstat, mkdtemp, rm, rmdir, stat } = require('node:fs/promises');
const path = require('node:path');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { saveProject, validateProject } = require('../domain/project-file.mjs');
const { AUDIO_EXTENSIONS, BACKGROUND_EXTENSIONS, localFile } = require('./studio-operations.cjs');
const { FONT_EXTENSIONS, describeLyricFont, fontLimit } = require('./lyric-fonts.cjs');
const { VIDEO_ANIMATION_EXTENSIONS, VIDEO_LOGO_EXTENSIONS } = require('../domain/video-presentation.ts');

const MIB = 1024 * 1024;
const entryLimit = 128;
const contentLimit = 2048 * MIB;
const fileLimit = 512 * MIB;
const manifestLimit = 2 * MIB;
const cdgExtensions = new Set(['.cdg']);
const zipOptions = { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true };
const openZip = promisify(yauzl.open);

function archiveName(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\\:\x00-\x1f]/.test(value)) throw new Error('The kit contains an invalid archive path.');
  const name = value.endsWith('/') ? value.slice(0, -1) : value;
  if (name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The kit contains an invalid archive path.');
  return name.normalize('NFC').toLowerCase();
}

function indexEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = new Map();
    let bytes = 0;
    zip.once('error', reject);
    zip.once('end', () => resolve(entries));
    zip.on('entry', entry => {
      try {
        const name = archiveName(entry.fileName);
        if (entries.has(name)) throw new Error('The kit contains duplicate archive paths.');
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (![0, 0x8000, 0x4000].includes(kind)) throw new Error('The kit contains a link or special file.');
        if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new Error('The kit uses unsupported ZIP compression or encryption.');
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > fileLimit) throw new Error('The kit contains an oversized file.');
        bytes += entry.uncompressedSize;
        if (bytes > contentLimit) throw new Error('The kit is too large to import.');
        entries.set(name, entry);
        zip.readEntry();
      } catch (error) { reject(error); }
    });
    zip.readEntry();
  });
}

async function readEntry(zip, entry, destination) {
  const input = await promisify(zip.openReadStream.bind(zip))(entry);
  let actualBytes = 0;
  let checksum = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      actualBytes += chunk.length;
      if (actualBytes > entry.uncompressedSize) return callback(new Error('A kit file expanded beyond its recorded size.'));
      checksum = crc32(chunk, checksum);
      callback(null, chunk);
    },
    flush(callback) {
      if (actualBytes !== entry.uncompressedSize || checksum !== (entry.crc32 >>> 0)) return callback(new Error('A kit file failed its ZIP integrity check.'));
      callback();
    },
  });
  await pipeline(input, verify, destination);
}

async function readManifest(zip, entry, destination) {
  if (!entry || entry.fileName.endsWith('/') || !entry.uncompressedSize || entry.uncompressedSize > manifestLimit) {
    throw new Error('The kit does not contain a valid manifest.json.');
  }
  const chunks = [];
  await readEntry(zip, entry, new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } }));
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error('The kit manifest is not valid JSON.', { cause: error }); }
  const project = validateProject(data, destination);
  if (project.stems.length > 24) throw new Error('The kit contains too many stems.');
  return { data, project };
}

function buildAssetPlan(entries, data) {
  const used = new Set();
  const plan = [];
  function add(reference, directory, targetName, extensions) {
    const name = archiveName(reference);
    const entry = entries.get(name);
    const extension = path.posix.extname(name);
    if (!name.startsWith(directory + '/') || !extensions.has(extension) || !entry ||
        entry.fileName.endsWith('/') || !entry.uncompressedSize || used.has(name)) {
      throw new Error('The kit manifest contains a missing, duplicate, or unsupported media reference.');
    }
    used.add(name);
    const asset = { entry, filename: targetName + extension };
    plan.push(asset);
    return asset.filename;
  }
  const stems = data.stems.map((stem, index) => add(stem.path, 'stems', 'stem-' + (index + 1), AUDIO_EXTENSIONS));
  const cdg = data.importedCdg == null ? null : add(data.importedCdg, 'source', 'source', cdgExtensions);
  const background = data.backgroundPath == null ? null : add(data.backgroundPath, 'background', 'background', BACKGROUND_EXTENSIONS);
  const storedFont = data.lyricStyle?.customFont?.path;
  const font = storedFont == null ? null : add(storedFont, 'fonts', 'lyric-font', FONT_EXTENSIONS);
  if (font && plan.at(-1).entry.uncompressedSize > fontLimit) throw new Error('The kit contains an oversized lyric font.');
  const presentationAssets = {};
  for (const [kind, name, extensions] of [
    ['logo', 'logo', VIDEO_LOGO_EXTENSIONS], ['openingAnimation', 'opening', VIDEO_ANIMATION_EXTENSIONS],
    ['closingAnimation', 'closing', VIDEO_ANIMATION_EXTENSIONS],
  ]) {
    const reference = data.videoPresentation?.[kind]?.path;
    presentationAssets[kind] = reference == null ? null : add(reference, 'presentation', name, new Set(extensions));
  }
  return { plan, stems, cdg, background, font, presentationAssets };
}

/** Reopen a portable kit into a new project and a sibling directory of its local media. */
async function importKit(kitPath, destination) {
  const source = await localFile(path.resolve(kitPath), new Set(['.tpvkit']));
  const file = path.resolve(destination);
  if (await lstat(file).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) throw new Error('Choose a new project file for the imported kit.');
  if ((await stat(source)).size > contentLimit + MIB) throw new Error('The kit is too large to import.');
  const zip = await openZip(source, zipOptions);
  let mediaDirectory = null;
  const created = [];
  try {
    if (zip.entryCount > entryLimit) throw new Error('The kit contains too many archive entries.');
    const entries = await indexEntries(zip);
    const { data, project } = await readManifest(zip, entries.get('manifest.json'), file);
    const { plan, stems, cdg, background, font, presentationAssets } = buildAssetPlan(entries, data);
    if (plan.length) {
      const prefix = path.basename(file).replace(/(?:\.tpv)?\.json$/i, '').slice(0, 50) || 'Studio';
      mediaDirectory = await mkdtemp(path.join(path.dirname(file), prefix + '.media-'));
    }
    for (const asset of plan) {
      const extracted = path.join(mediaDirectory, asset.filename);
      created.push(extracted);
      await readEntry(zip, asset.entry, createWriteStream(extracted, { flags: 'wx', mode: 0o600 }));
    }
    const assetPath = name => name === null ? null : path.join(mediaDirectory, name);
    const lyricStyle = font ? { ...project.lyricStyle, customFont: await describeLyricFont(assetPath(font)) } : project.lyricStyle;
    const videoPresentation = { ...project.videoPresentation };
    for (const [kind, filename] of Object.entries(presentationAssets)) {
      videoPresentation[kind] = { ...videoPresentation[kind], path: assetPath(filename) };
    }
    const saved = await saveProject(file, {
      ...project,
      stems: project.stems.map((stem, index) => ({ ...stem, path: assetPath(stems[index]) })),
      importedCdg: assetPath(cdg),
      backgroundPath: assetPath(background),
      lyricStyle,
      videoPresentation,
    }, { createOnly: true });
    return { file, project: saved, mediaDirectory };
  } catch (error) {
    await Promise.allSettled(created.map(file => rm(file, { force: true })));
    if (mediaDirectory) await rmdir(mediaDirectory).catch(() => {});
    throw error;
  } finally {
    zip.close();
  }
}

module.exports = { importKit };
