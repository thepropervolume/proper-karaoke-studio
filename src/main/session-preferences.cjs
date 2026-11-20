/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { defaultSettings, loadSettings, saveSettings, validateSettings } = require('./studio-operations.cjs');

function createSessionPreferences(file) {
  let current;
  return {
    get: () => current ?? loadSettings(file),
    defaults: () => ({ saved: loadSettings(file), factory: defaultSettings }),
    save(value, scope) {
      if (scope !== 'session' && scope !== 'default') throw new Error('Choose whether to save for this session or as the default.');
      current = scope === 'default' ? saveSettings(file, value) : validateSettings(value);
      return current;
    },
  };
}

module.exports = { createSessionPreferences };
