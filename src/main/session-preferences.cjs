/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { defaultSettings, loadSettings, saveSettings, validateSettings } = require('./studio-operations.cjs');
const { isStudioUpdateMode } = require('../domain/desktop-update-preference.ts');

function createSessionPreferences(file) {
  let current;
  return {
    get: () => current ?? loadSettings(file),
    defaults: () => ({ saved: loadSettings(file), factory: defaultSettings }),
    save(value, scope) {
      if (scope !== 'session' && scope !== 'default') throw new Error('Choose whether to save for this session or as the default.');
      // The dedicated updater control saves immediately. An older open audio
      // preferences form must not change the user's machine-wide update policy.
      const proposed = { ...value, updateMode: loadSettings(file).updateMode };
      current = scope === 'default' ? saveSettings(file, proposed) : validateSettings(proposed);
      return current;
    },
    saveUpdateMode(mode) {
      if (!isStudioUpdateMode(mode)) throw new Error('Choose a supported update preference.');
      const saved = saveSettings(file, { ...loadSettings(file), updateMode: mode });
      if (current) current = { ...current, updateMode: mode };
      return saved.updateMode;
    },
  };
}

module.exports = { createSessionPreferences };
