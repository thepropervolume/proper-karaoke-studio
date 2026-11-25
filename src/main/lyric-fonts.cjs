/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, open, readdir, rename, rm, writeFile } = require('node:fs/promises');
const { extname, isAbsolute, join } = require('node:path');
const { safeFontFamily } = require('../domain/lyric-style.ts');

const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);
const fontLimit = 32 * 1024 * 1024;
const supportedHeaders = new Set([0x00010000, 0x4f54544f, 0x74727565]);

function readFontNames(data) {
  const bad = () => new Error('Choose a supported TrueType (.ttf) or OpenType (.otf) font face.');
  if (data.length < 12 || !supportedHeaders.has(data.readUInt32BE(0))) throw bad();
  const tableCount = data.readUInt16BE(4);
  const tablesEnd = 12 + tableCount * 16;
  if (tablesEnd > data.length) throw bad();
  let table;
  for (let offset = 12; offset < tablesEnd; offset += 16) {
    if (data.toString('ascii', offset, offset + 4) !== 'name') continue;
    const start = data.readUInt32BE(offset + 8), length = data.readUInt32BE(offset + 12);
    if (length < 6 || start + length > data.length) throw bad();
    table = data.subarray(start, start + length);
    break;
  }
  if (!table) throw bad();
  const count = table.readUInt16BE(2), strings = table.readUInt16BE(4);
  if (6 + count * 12 > strings || strings > table.length) throw bad();
  const names = new Map();
  for (let offset = 6; offset < 6 + count * 12; offset += 12) {
    const platform = table.readUInt16BE(offset), encoding = table.readUInt16BE(offset + 2);
    const language = table.readUInt16BE(offset + 4), id = table.readUInt16BE(offset + 6);
    if (![1, 4, 6, 16].includes(id)) continue;
    if (!(platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding)) || (platform === 1 && encoding === 0))) continue;
    const length = table.readUInt16BE(offset + 8), index = strings + table.readUInt16BE(offset + 10);
    if (!length || index + length > table.length || (platform !== 1 && length % 2)) continue;
    const buffer = table.subarray(index, index + length);
    const label = safeFontFamily(platform === 1 ? buffer.toString('latin1') : Buffer.from(buffer).swap16().toString('utf16le'));
    const score = platform === 3 && language === 0x409 ? 3 : platform === 0 ? 2 : 1;
    if (label && score > (names.get(id)?.score ?? 0)) names.set(id, { label, score });
  }
  const family = names.get(4)?.label ?? names.get(16)?.label ?? names.get(1)?.label;
  if (!family) throw new Error('The font file does not contain a valid family name.');
  return { family, exportName: names.get(6)?.label ?? family };
}

async function fontFile(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || !FONT_EXTENSIONS.has(extname(file).toLowerCase())) {
    throw new Error('Choose a local TrueType or OpenType font file.');
  }
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > fontLimit) throw new Error('The font must be a local file no larger than 32 MB.');
    const bytes = await handle.readFile();
    if (bytes.length !== info.size) throw new Error('The font changed while Studio was reading it.');
    return { bytes, ...readFontNames(bytes) };
  } finally { await handle.close(); }
}

async function describeLyricFont(file) {
  const { family, exportName } = await fontFile(file);
  return { path: file, family, exportName };
}

function createFontLibrary(root) {
  async function install(bytes, extension, { family, exportName }) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = join(root, digest + extension);
    await mkdir(root, { recursive: true });
    const staged = join(root, randomUUID() + '.tmp');
    try {
      await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
      await rename(staged, path);
    } finally { await rm(staged, { force: true }); }
    return { path, family, exportName };
  }

  return {
    async list() {
      const entries = await readdir(root, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      const fonts = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.(ttf|otf)$/.test(entry.name)) continue;
        const font = await describeLyricFont(join(root, entry.name)).catch(() => null);
        if (font) fonts.push(font);
      }
      return fonts.sort((a, b) => a.family.localeCompare(b.family));
    },
    async add(file) {
      const { bytes, ...names } = await fontFile(file);
      return install(bytes, extname(file).toLowerCase(), names);
    },
    async importBytes(bytes, extension) {
      if (!Buffer.isBuffer(bytes) || bytes.length > fontLimit || !FONT_EXTENSIONS.has(extension)) {
        throw new Error('The preset font must be a TrueType or OpenType file no larger than 32 MB.');
      }
      return install(bytes, extension, readFontNames(bytes));
    },
    async findByHash(digest, extension) {
      if (!/^[0-9a-f]{64}$/.test(digest) || !FONT_EXTENSIONS.has(extension)) return null;
      const file = join(root, digest + extension);
      const font = await fontFile(file).catch(() => null);
      return font && createHash('sha256').update(font.bytes).digest('hex') === digest
        ? { path: file, family: font.family, exportName: font.exportName } : null;
    },
  };
}

module.exports = { FONT_EXTENSIONS, describeLyricFont, createFontLibrary, readFontNames, fontFile, fontLimit };
