const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { separatorModels } = require('../domain/studio-options.json');

const run = promisify(execFile);
const modelId = /^(?!\.{1,2}$)[\w.-]{1,160}$/;
const labelText = value => String(value).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180);

function parseUvrModels(output) {
  const raw = JSON.parse(output);
  const models = [];
  for (const [group, entries] of Object.entries(raw)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [label, entry] of Object.entries(entries)) {
      if (typeof entry?.filename !== 'string' || !modelId.test(entry.filename)) continue;
      models.push({ id: entry.filename, label: labelText(label) || entry.filename, group: labelText(group) || 'Other' });
    }
  }
  return models;
}

function parseDemucsModels(output) {
  const models = [];
  let group;
  for (const line of output.split(/\r?\n/)) {
    if (/^Bag of models:/i.test(line)) group = 'Model collections';
    else if (/^Single models:/i.test(line)) group = 'Individual models';
    else if (group && /^\s+[\w.-]+\s*$/.test(line)) {
      const id = line.trim();
      if (modelId.test(id)) models.push({ id, label: id, group });
    }
  }
  return models;
}

function createModelDiscovery(execute = run) {
  const cache = new Map();
  return async function discoverModels({ adapter, executable, refresh = false } = {}) {
    if (!Object.hasOwn(separatorModels, adapter)) throw new Error('Choose a supported stem separator.');
    if (adapter === 'dango') return { models: separatorModels.dango, source: 'provider' };
    if (typeof executable !== 'string' || !executable.trim() || executable.length > 4096) {
      return { models: separatorModels[adapter], source: 'fallback' };
    }
    const key = adapter + '\u0000' + executable.trim();
    let entry = cache.get(key);
    if (!entry || (refresh && entry.finished) || Date.now() - entry.updated > 5 * 60_000) {
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      entry = { updated: Date.now(), finished: false };
      entry.result = (async () => {
        try {
          const args = adapter === 'demucs' ? ['--list-models'] : ['--list_models', '--list_format=json'];
          const { stdout } = await execute(executable.trim(), args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' });
          const discovered = (adapter === 'demucs' ? parseDemucsModels : parseUvrModels)(stdout);
          const byId = new Map(discovered.map(model => [model.id, model]));
          if (byId.size) return { models: [...byId.values()].slice(0, 2000), source: 'installed' };
        } catch { /* Older or missing executables can still use the recommended list. */ }
        return { models: separatorModels[adapter], source: 'fallback' };
      })().finally(() => { entry.finished = true; });
      cache.set(key, entry);
    }
    return entry.result;
  };
}

module.exports = { discoverModels: createModelDiscovery(), createModelDiscovery, parseUvrModels, parseDemucsModels };
