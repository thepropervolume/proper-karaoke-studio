const { randomUUID } = require('node:crypto');
const { lstat, mkdir, open, readFile, rename, rm } = require('node:fs/promises');
const { isAbsolute, join } = require('node:path');

const builtIns = [
  { id: 'dango-ai', name: 'Dango AI', website: 'https://tuanziai.com/en-US/record?type=tool&tool=vocal-remover', kind: 'dango' },
  { id: 'mvsep', name: 'MVSEP', website: 'https://mvsep.com/user-api', kind: 'mvsep' },
  { id: 'gaudio', name: 'GAUDIO', website: 'https://developers.gaudiolab.io/', kind: 'gaudio' },
  { id: 'vultr', name: 'Vultr', website: 'https://console.vultr.com/inference/', kind: 'vultr' },
  { id: 'audioshake', name: 'AudioShake', website: 'https://dashboard.audioshake.ai/', kind: 'audioshake' },
];
const maxCustom = 24;
const maxRegistryBytes = 64 * 1024;
const customId = /^custom-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const possibleCredentials = /^(?:api[-_]?key|(?:access|refresh|auth)[-_]?token|token|key|(?:app|client)[-_]?secret|secret|password|authorization|signature|x-amz-signature)$/iu;

function providerName(value) {
  if (typeof value !== 'string') throw new Error('Enter an integration name.');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/u.test(name)) {
    throw new Error('Enter an integration name of up to 80 characters.');
  }
  return name;
}

function providerWebsite(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new Error('Enter a valid HTTPS website of up to 512 characters.');
  }
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('Enter a valid HTTPS website.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.href.length > 512) {
    throw new Error('Enter a valid HTTPS website of up to 512 characters.');
  }
  const params = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  if (url.username || url.password || params.some(key => possibleCredentials.test(key))) {
    throw new Error('Enter a public website URL and save credentials in the API key field.');
  }
  return url.href;
}

async function statIfPresent(file) {
  try { return await lstat(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** The metadata registry only contains labels and websites. The separate key store owns credentials. */
function createIntegrationCatalog({ directory, secrets }) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new Error('An absolute integration catalog path is required.');
  }
  const file = join(directory, 'integrations.json');
  const lockPath = join(directory, '.integrations.lock');
  let tail = Promise.resolve();

  function serial(operation) {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }

  async function load() {
    const folder = await statIfPresent(directory);
    if (!folder) return [];
    if (!folder.isDirectory()) throw new Error('The integration catalog directory is unavailable.');
    const info = await statIfPresent(file);
    if (!info) return [];
    try {
      if (!info.isFile() || info.size > maxRegistryBytes) throw new Error();
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > maxCustom) throw new Error();
      const ids = new Set();
      return value.entries.map(item => {
        if (typeof item?.id !== 'string' || !customId.test(item.id) || ids.has(item.id)) throw new Error();
        ids.add(item.id);
        return { id: item.id, name: providerName(item.name), website: providerWebsite(item.website), kind: 'custom' };
      });
    } catch {
      throw new Error('Studio could not read the saved integrations. Restore the integrations catalog from a backup before editing it.');
    }
  }

  async function write(entries) {
    const temp = join(directory, '.integrations-' + randomUUID() + '.tmp');
    try {
      const handle = await open(temp, 'wx', 0o600);
      try {
        const value = { version: 1, entries: entries.map(({ id, name, website }) => ({ id, name, website })) };
        await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
  }

  function mutate(operation) {
    return serial(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(directory)).isDirectory()) throw new Error('The integration catalog directory is unavailable.');
      let lock;
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error('Integration settings are being edited in another Studio window. Try again.');
        throw error;
      }
      try { return await operation(await load()); }
      finally {
        await lock.close();
        await rm(lockPath, { force: true });
      }
    });
  }

  function known(entries, id) {
    const builtIn = builtIns.find(integration => integration.id === id);
    if (builtIn) return builtIn;
    const match = entries.find(entry => entry.id === id);
    if (!match) throw new Error('Unknown integration.');
    return match;
  }

  function publicList(entries) {
    return Promise.all([...builtIns, ...entries].map(async item => {
      const { configured, storageAvailable } = await secrets.getStatus(item.id);
      return { ...item, configured, storageAvailable };
    }));
  }

  function list() { return serial(async () => publicList(await load())); }

  function add(input) {
    return mutate(async entries => {
      const name = providerName(input?.name);
      const website = providerWebsite(input?.website);
      if (entries.length >= maxCustom) throw new Error('Studio supports up to ' + maxCustom + ' custom integrations.');
      if ([...builtIns, ...entries].some(item => item.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('An integration already uses this name.');
      }
      const updated = [...entries, { id: 'custom-' + randomUUID(), name, website, kind: 'custom' }];
      await write(updated);
      return publicList(updated);
    });
  }

  function remove(id) {
    return mutate(async entries => {
      const item = known(entries, id);
      if (item.kind !== 'custom') throw new Error('Use Remove Credentials to clear the saved credentials for this service.');
      // Keep the row available for retry if deleting its credential fails.
      await secrets.removeKey(item.id);
      const updated = entries.filter(entry => entry.id !== item.id);
      await write(updated);
      return publicList(updated);
    });
  }

  function setKey(id, key) {
    return mutate(async entries => {
      await secrets.setKey(known(entries, id).id, key);
      return publicList(entries);
    });
  }

  function removeKey(id) {
    return mutate(async entries => {
      await secrets.removeKey(known(entries, id).id);
      return publicList(entries);
    });
  }

  function readKey(id) {
    return serial(async () => secrets.readKey(known(await load(), id).id));
  }

  return { list, add, remove, setKey, removeKey, readKey };
}

module.exports = { createIntegrationCatalog };
