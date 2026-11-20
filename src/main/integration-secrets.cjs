const { randomUUID } = require('node:crypto');
const { lstat, mkdir, open, readFile, rename, rm } = require('node:fs/promises');
const { isAbsolute, join } = require('node:path');

const MAX_KEY_BYTES = 16 * 1024;
const MAX_FILE_BYTES = 64 * 1024;
const STORAGE_UNAVAILABLE = 'Secure key storage is unavailable. Unlock your system keyring and try again.';

function apiKey(value) {
  if (typeof value !== 'string' || value.length > MAX_KEY_BYTES
      || Buffer.byteLength(value) > MAX_KEY_BYTES || /[\x00-\x1f\x7f]/u.test(value.trim()) || !value.trim()) {
    throw new Error('Enter a valid API key.');
  }
  return value.trim();
}

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Keep decrypted credentials inside the main process. Only expose the status returned by mutations and getStatus over IPC. */
function createIntegrationSecrets({ directory, safeStorage, platform = process.platform }) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('An absolute integration storage path is required.');
  const mutations = new Map();

  function location(providerId) {
    if (typeof providerId !== 'string' || providerId.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(providerId)) {
      throw new Error('Unknown integration.');
    }
    return join(directory, 'provider-' + providerId + '.bin');
  }

  function validCiphertext(encrypted) {
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_FILE_BYTES) return false;
    if (platform !== 'linux') return true;
    // Chromium's Linux async fallback can report availability and emit a fixed
    // key (v10). Only accept real Secret Service/KWallet (v11) or Portal (v12).
    const tag = encrypted.subarray(0, 3).toString('ascii');
    return tag === 'v11' || tag === 'v12';
  }

  async function storageAvailable() {
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
      if (platform !== 'linux') return true;
      if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
      return validCiphertext(await safeStorage.encryptStringAsync('TPV integration storage check'));
    } catch {
      return false;
    }
  }

  async function storageDirectory() {
    const info = await statIfPresent(directory);
    if (info && !info.isDirectory()) throw new Error('The integration storage directory is unavailable.');
    return info;
  }

  async function savedFile(file) {
    if (!await storageDirectory()) return null;
    const info = await statIfPresent(file);
    if (info && (!info.isFile() || !info.size || info.size > MAX_FILE_BYTES)) {
      throw new Error('The saved credential file is invalid. Remove the key and save it again.');
    }
    return info;
  }

  function serial(providerId, mutate) {
    const current = (mutations.get(providerId) ?? Promise.resolve()).catch(() => {}).then(mutate);
    mutations.set(providerId, current);
    return current.finally(() => {
      if (mutations.get(providerId) === current) mutations.delete(providerId);
    });
  }

  async function getStatus(providerId) {
    const file = location(providerId);
    await mutations.get(providerId)?.catch(() => {});
    // A corrupt credential still counts as stored so the user can remove it.
    const configured = Boolean(await storageDirectory() && await statIfPresent(file));
    return { providerId, configured, storageAvailable: await storageAvailable() };
  }

  async function setKey(providerId, value) {
    const file = location(providerId);
    const key = apiKey(value);
    return serial(providerId, async () => {
      if (!await storageAvailable()) throw new Error(STORAGE_UNAVAILABLE);
      const payload = JSON.stringify({ providerId, key });
      let encrypted;
      try {
        encrypted = await safeStorage.encryptStringAsync(payload);
      } catch {
        throw new Error(STORAGE_UNAVAILABLE);
      }
      if (!validCiphertext(encrypted) || encrypted.includes(Buffer.from(payload))) throw new Error(STORAGE_UNAVAILABLE);

      await mkdir(directory, { recursive: true, mode: 0o700 });
      await storageDirectory();
      const temporary = join(directory, '.pending-' + randomUUID());
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(encrypted);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      return { providerId, configured: true, storageAvailable: true };
    });
  }

  async function removeKey(providerId) {
    const file = location(providerId);
    return serial(providerId, async () => {
      if (await storageDirectory()) await rm(file, { force: true });
      return { providerId, configured: false, storageAvailable: await storageAvailable() };
    });
  }

  async function readKey(providerId) {
    const file = location(providerId);
    await mutations.get(providerId)?.catch(() => {});
    if (!await savedFile(file)) return null;
    if (!await storageAvailable()) throw new Error(STORAGE_UNAVAILABLE);
    const encrypted = await readFile(file);
    if (!validCiphertext(encrypted)) throw new Error('The saved credential could not be read. Remove the key and save it again.');
    try {
      const { result } = await safeStorage.decryptStringAsync(encrypted);
      const payload = JSON.parse(result);
      if (payload.providerId !== providerId) throw new Error('Credential owner mismatch.');
      return apiKey(payload.key);
    } catch {
      throw new Error('The saved credential could not be read. Unlock your system keyring or save the key again.');
    }
  }

  return { getStatus, setKey, removeKey, readKey };
}

module.exports = { createIntegrationSecrets };
