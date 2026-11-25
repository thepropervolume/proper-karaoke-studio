const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLyricStyle } = require('../domain/lyric-style.ts');
const { normalizeTitleCard } = require('../domain/video-presentation.ts');
const { FONT_EXTENSIONS, fontFile, fontLimit } = require('./lyric-fonts.cjs');
const { writeOutput } = require('./studio-operations.cjs');

const portableSchema = 'com.thepropervolume.karaoke-studio.appearance-preset';
const normalizers = { lyrics: normalizeLyricStyle, title: normalizeTitleCard };
const maxRegistryBytes = 512 * 1024;
const maxPresetBytes = Math.ceil(fontLimit / 3) * 4 + 16 * 1024;
const maxPresets = 100;
const maxName = 80;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nameKey = name => name.toLowerCase();

function normalizeKind(kind) {
  if (!Object.hasOwn(normalizers, kind)) throw new Error('Choose lyric or title appearance.');
  return kind;
}

function presetName(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!name || name.length > maxName || /[\x00-\x1f\x7f]/u.test(name)) throw new Error('Enter a preset name of up to 80 characters.');
  return name;
}

function readStyle(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The appearance settings are invalid.');
  return normalizers[kind](value);
}

async function readBoundedJson(file, limit) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.size > limit) throw new Error('Choose a JSON preset file within the supported size limit.');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== info.size || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new Error('The preset file changed while Studio was reading it.');
    }
    // Reading only the inspected size keeps the bound in force if the file grows.
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error('The preset file changed while Studio was reading it.');
    return JSON.parse(bytes.subarray(0, offset).toString('utf8').replace(/^\uFEFF/, ''));
  } finally { await handle.close(); }
}

function createAppearancePresets(directory, fonts) {
  const file = path.join(directory, 'appearance-presets.json');
  const lockPath = file + '.lock';
  const empty = kind => ({ defaultStyle: normalizers[kind](), presets: [] });

  async function load(kind) {
    try {
      const value = await readBoundedJson(file, maxRegistryBytes);
      if (value?.version !== 1) throw new Error();
      const library = value[kind];
      if (library == null) return empty(kind);
      if (!Array.isArray(library.presets) || library.presets.length > maxPresets) throw new Error();
      const ids = new Set(), names = new Set();
      const presets = library.presets.map(item => {
        const name = presetName(item.name);
        if (typeof item.id !== 'string' || !uuid.test(item.id) || ids.has(item.id) || names.has(nameKey(name))) throw new Error();
        ids.add(item.id);
        names.add(nameKey(name));
        return { id: item.id, name, style: readStyle(kind, item.style) };
      });
      return { defaultStyle: readStyle(kind, library.defaultStyle), presets };
    } catch (error) {
      if (error.code === 'ENOENT') return empty(kind);
      throw new Error('Studio could not read the saved appearance presets. Restore the preset library from a backup before editing it.', { cause: error });
    }
  }

  async function mutate(kind, action) {
    normalizeKind(kind);
    await fs.mkdir(directory, { recursive: true });
    const lock = await fs.open(lockPath, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw new Error('Appearance presets are being edited in another Studio window. Try again.');
      throw error;
    });
    try {
      const [lyrics, title] = await Promise.all([load('lyrics'), load('title')]);
      const libraries = { lyrics, title };
      const result = await action(libraries[kind]);
      await writeOutput(file, true, target => fs.writeFile(target, JSON.stringify({ version: 1, ...libraries }, null, 2) + '\n', { mode: 0o600 }));
      return result;
    } finally {
      await lock.close().finally(() => fs.rm(lockPath, { force: true }));
    }
  }

  async function pinStyle(kind, value) {
    const style = readStyle(kind, value);
    if (kind === 'lyrics' && style.customFont) {
      // Keep the selected font in the user's Studio library if the source
      // project or its extracted kit media is later moved or removed.
      if (style.font === 'custom') style.customFont = await fonts.add(style.customFont.path);
      else delete style.customFont;
    }
    return style;
  }

  function add(library, name, style) {
    if (library.presets.length >= maxPresets) throw new Error('The appearance preset library is full.');
    const preset = { id: randomUUID(), name, style };
    library.presets.push(preset);
    return preset;
  }

  function selected(library, id) {
    const item = library.presets.find(preset => preset.id === id);
    if (!item) throw new Error('Choose a saved appearance preset.');
    return item;
  }

  return {
    list(kind) { return load(normalizeKind(kind)); },
    saveDefault({ kind, style }) {
      return mutate(kind, async library => {
        library.defaultStyle = await pinStyle(kind, style);
        return library;
      });
    },
    save({ kind, id, name: rawName, style }) {
      return mutate(kind, async library => {
        const name = presetName(rawName);
        if (library.presets.some(preset => preset.id !== id && nameKey(preset.name) === nameKey(name))) {
          throw new Error('A preset with that name already exists. Select it to update it or enter a different name.');
        }
        const normalized = await pinStyle(kind, style);
        const preset = id ? Object.assign(selected(library, id), { name, style: normalized }) : add(library, name, normalized);
        return { library, preset };
      });
    },
    async export(kind, id, destination, includeFont) {
      const preset = selected(await load(normalizeKind(kind)), id);
      const { customFont, ...style } = preset.style;
      const portable = { schema: portableSchema, version: 1, kind, name: preset.name, style };
      if (kind === 'lyrics' && style.font === 'custom' && customFont) {
        const { bytes } = await fontFile(customFont.path);
        portable.font = {
          extension: path.extname(customFont.path).toLowerCase(), sha256: hash(bytes),
          ...(includeFont === false ? {} : { data: bytes.toString('base64') }),
        };
      }
      return writeOutput(destination, true, target => fs.writeFile(target, JSON.stringify(portable, null, 2) + '\n', { mode: 0o600 }));
    },
    async import(kind, source) {
      normalizeKind(kind);
      let value;
      try { value = await readBoundedJson(source, maxPresetBytes); }
      catch (error) { throw new Error('Choose a valid Studio appearance preset JSON file.', { cause: error }); }
      if (value?.schema !== portableSchema || value.version !== 1 || value.kind !== kind) {
        throw new Error('Choose a preset exported from this Studio appearance panel.');
      }
      const name = presetName(value.name);
      const style = readStyle(kind, value.style);
      if (kind === 'lyrics') {
        delete style.customFont;
        if (style.font === 'custom') style.font = 'sans';
      }
      const requestedFont = kind === 'lyrics' && value.style.font === 'custom';
      return mutate(kind, async library => {
        let fontMissing = requestedFont;
        if (requestedFont && value.font) {
          const { extension, sha256, data } = value.font;
          if (!FONT_EXTENSIONS.has(extension) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
            throw new Error('The preset font reference is invalid.');
          }
          let customFont;
          if (data === undefined) customFont = await fonts.findByHash(sha256, extension);
          else {
            if (typeof data !== 'string') throw new Error('The preset font data is invalid.');
            const bytes = Buffer.from(data, 'base64');
            if (bytes.length > fontLimit || bytes.toString('base64') !== data || hash(bytes) !== sha256) throw new Error('The preset font failed its integrity check.');
            customFont = await fonts.importBytes(bytes, extension);
          }
          if (customFont) {
            style.font = 'custom';
            style.customFont = customFont;
            fontMissing = false;
          }
        }
        let importedName = name;
        for (let index = 2; library.presets.some(item => nameKey(item.name) === nameKey(importedName)); index++) {
          const suffix = ' (' + index + ')';
          importedName = name.slice(0, maxName - suffix.length) + suffix;
        }
        const preset = add(library, importedName, style);
        return { library, preset, fontMissing };
      });
    },
  };
}

module.exports = { createAppearancePresets };
