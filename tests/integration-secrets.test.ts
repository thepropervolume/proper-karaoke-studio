import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import secrets from '../src/main/integration-secrets.cjs';

function keyring() {
  const key = randomBytes(32);
  return {
    available: true,
    backend: 'gnome_libsecret',
    tag: 'v11',
    encryptions: 0,
    async isAsyncEncryptionAvailable() { return this.available; },
    getSelectedStorageBackend() { return this.backend; },
    async encryptStringAsync(value: string) {
      this.encryptions++;
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([Buffer.from(this.tag), nonce, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(encrypted: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15));
      decipher.setAuthTag(encrypted.subarray(15, 31));
      const result = Buffer.concat([decipher.update(encrypted.subarray(31)), decipher.final()]).toString();
      return { result, shouldReEncrypt: false };
    },
  };
}

test('integration credentials are encrypted across instances and mutations return only status', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-integration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'integrations');
  const safeStorage = keyring();
  const store = secrets.createIntegrationSecrets({ directory, safeStorage, platform: 'win32' });
  const providerId = 'dango';
  const empty = { providerId, configured: false, storageAvailable: true };
  assert.deepEqual(await store.getStatus(providerId), empty);
  assert.equal(await store.readKey(providerId), null);
  await assert.rejects(() => store.setKey('../outside', 'value'), /Unknown integration/);
  await assert.rejects(() => store.setKey(providerId, 'one\rtwo'), /valid API key/);

  const credential = JSON.stringify({ appKey: 'example-app', appSecret: randomBytes(20).toString('hex') });
  const configured = { ...empty, configured: true };
  assert.deepEqual(await store.setKey(providerId, credential), configured);
  const [filename] = await readdir(directory);
  const saved = await readFile(join(directory, filename));
  assert.ok(!saved.includes(credential));
  assert.deepEqual(await readdir(directory), [filename]);
  const reopened = secrets.createIntegrationSecrets({ directory, safeStorage, platform: 'win32' });
  assert.equal(await reopened.readKey(providerId), credential);

  await Promise.all([store.setKey(providerId, 'earlier'), store.setKey(providerId, credential)]);
  assert.equal(await store.readKey(providerId), credential);
  safeStorage.available = false;
  assert.deepEqual(await store.getStatus(providerId), { ...configured, storageAvailable: false });
  await assert.rejects(() => store.readKey(providerId), /Secure key storage is unavailable/);
  assert.deepEqual(await store.removeKey(providerId), { ...empty, storageAvailable: false });
  assert.deepEqual(await readdir(directory), []);
});

test('Linux refuses both explicit basic-text and async fallback encryption', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-integration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const safeStorage = keyring();
  const store = secrets.createIntegrationSecrets({ directory, safeStorage, platform: 'linux' });
  safeStorage.backend = 'basic_text';
  assert.deepEqual(await store.getStatus('dango'), { providerId: 'dango', configured: false, storageAvailable: false });
  await assert.rejects(() => store.setKey('dango', 'example'), /Secure key storage is unavailable/);
  assert.equal(safeStorage.encryptions, 0);

  safeStorage.backend = 'gnome_libsecret';
  safeStorage.tag = 'v10';
  await assert.rejects(() => store.setKey('dango', 'example'), /Secure key storage is unavailable/);
  assert.deepEqual(await readdir(directory), []);

  safeStorage.tag = 'v12';
  await store.setKey('dango', 'example');
  assert.equal(await store.readKey('dango'), 'example');
  const [filename] = await readdir(directory);
  await writeFile(join(directory, filename), await safeStorage.encryptStringAsync('{"providerId":"another","key":"other-key"}'));
  await assert.rejects(() => store.readKey('dango'), /could not be read/);
});
