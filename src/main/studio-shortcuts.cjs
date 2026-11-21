/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { DEFAULT_STUDIO_SHORTCUTS, parseStudioShortcuts } = require('../domain/studio-shortcuts.ts');

function ensureJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function readShortcuts(file) {
  ensureJsonFile(file, DEFAULT_STUDIO_SHORTCUTS);
  return parseStudioShortcuts(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}

function writeShortcuts(file, input) {
  const value = parseStudioShortcuts(input);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return value;
}

function createStudioShortcuts(file) {
  let value = parseStudioShortcuts(DEFAULT_STUDIO_SHORTCUTS);
  let warning = '';
  let loaded = false;
  const state = () => ({ value, warning });
  const reload = () => {
    try {
      value = readShortcuts(file);
      warning = '';
    } catch (error) {
      // A malformed file stays available for repair. Keep the last working bindings.
      warning = `Could not load keybindings.json. ${error.message}`;
    }
    loaded = true;
    return state();
  };
  return {
    get: () => loaded ? state() : reload(),
    reload,
    ensureFile: () => ensureJsonFile(file, DEFAULT_STUDIO_SHORTCUTS),
    save(input) {
      value = writeShortcuts(file, input);
      warning = '';
      loaded = true;
      return state();
    },
  };
}

module.exports = { createStudioShortcuts, ensureJsonFile };
