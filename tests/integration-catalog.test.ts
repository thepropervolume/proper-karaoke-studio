import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../src/main/integration-catalog.cjs';

function keyStore() {
  const keys = new Map<string, string>();
  return {
    storageAvailable: true,
    failRemove: false,
    async getStatus(id: string) { return { providerId: id, configured: keys.has(id), storageAvailable: this.storageAvailable }; },
    async setKey(id: string, value: string) { keys.set(id, value); },
    async removeKey(id: string) {
      if (this.failRemove) throw new Error('Could not remove stored key.');
      keys.delete(id);
    },
    async readKey(id: string) { return keys.get(id) ?? null; },
  };
}

test('catalog serializes edits and exposes only names, websites and credential status', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-integration-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secrets = keyStore();
  const store = catalog.createIntegrationCatalog({ directory, secrets });
  const [builtIn] = await store.list();
  assert.deepEqual(builtIn, {
    id: 'dango-ai',
    name: 'Dango AI',
    website: 'https://tuanziai.com/en-US/record?type=tool&tool=vocal-remover',
    kind: 'dango',
    configured: false,
    storageAvailable: true,
  });
  const [, final] = await Promise.all([
    store.add({ name: ' Mix Lab ', website: 'https://mix.example/docs?v=2' }),
    store.add({ name: 'Karaoke Tools' }),
  ]);
  assert.deepEqual(final.map(item => item.name), ['Dango AI', 'Mix Lab', 'Karaoke Tools']);
  const custom = final[1];
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.website, 'https://mix.example/docs?v=2');
  assert.equal(final[2].website, null);
  const privateKey = 'sample-key-never-written-to-registry';
  const configured = await store.setKey(custom.id, privateKey);
  assert.equal(configured[1].configured, true);
  assert.ok(!JSON.stringify(configured).includes(privateKey));
  assert.ok(!(await readFile(join(directory, 'integrations.json'), 'utf8')).includes(privateKey));
  const reopened = catalog.createIntegrationCatalog({ directory, secrets });
  assert.deepEqual(await reopened.list(), configured);
  assert.equal(await reopened.readKey(custom.id), privateKey);
  secrets.storageAvailable = false;
  assert.equal((await reopened.list())[1].storageAvailable, false);
  await reopened.setKey('dango-ai', 'test-key');
  const removed = await reopened.remove(custom.id);
  assert.equal(await secrets.readKey(custom.id), null);
  assert.deepEqual(removed.map(item => item.name), ['Dango AI', 'Karaoke Tools']);
  assert.equal((await reopened.removeKey('dango-ai'))[0].configured, false);
});

test('catalog rejects credentials in URLs and leaves pending or invalid data available for recovery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-integration-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secrets = keyStore();
  const store = catalog.createIntegrationCatalog({ directory, secrets });
  await assert.rejects(() => store.add({ name: 'dango ai' }), /already uses this name/);
  for (const website of ['file:///path', 'http://provider.example', 'javascript:alert(1)', 'data:text/plain,x']) {
    await assert.rejects(() => store.add({ name: 'Provider', website }), /valid HTTPS website/);
  }
  for (const website of ['https://name:secret@provider.example', 'https://provider.example/?api_key=abc', 'https://provider.example/#access_token=abc']) {
    await assert.rejects(() => store.add({ name: 'Provider', website }), /save credentials in the API key field/);
  }
  await assert.rejects(() => store.setKey('custom-missing', 'secret'), /Unknown integration/);
  await assert.rejects(() => store.readKey('custom-missing'), /Unknown integration/);
  await assert.rejects(() => store.remove('dango-ai'), /Remove Key/);

  const [, item] = await store.add({ name: 'Provider', website: 'https://provider.example/' });
  await store.setKey(item.id, 'saved-key');
  secrets.failRemove = true;
  await assert.rejects(() => store.remove(item.id), /Could not remove stored key/);
  assert.equal((await store.list())[1].configured, true);
  assert.equal(await store.readKey(item.id), 'saved-key');

  const registry = join(directory, 'integrations.json');
  const saved = await readFile(registry, 'utf8');
  const lock = join(directory, '.integrations.lock');
  await writeFile(lock, '');
  await assert.rejects(() => store.add({ name: 'Other window' }), /another Studio window/);
  assert.equal(await readFile(registry, 'utf8'), saved);
  await rm(lock);
  await writeFile(registry, '{ broken catalog');
  await assert.rejects(() => store.add({ name: 'Other provider' }), /could not read the saved integrations/);
  assert.equal(await readFile(registry, 'utf8'), '{ broken catalog');
  assert.equal(await secrets.readKey(item.id), 'saved-key');
});
