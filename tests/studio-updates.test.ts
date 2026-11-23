/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */

import assert from 'node:assert/strict';
import test from 'node:test';
import desktop from '../src/main/studio-updates.cjs';

function fixture(mode: 'off' | 'notify' | 'download' | 'install' = 'notify', kind = 'nsis', canInstallOnQuit = true) {
  const calls: string[] = [], received: unknown[] = [];
  let activeMode = mode;
  const update = Object.freeze({ product: 'studio', version: '0.11.4', artifact: { kind } });
  const installedPath = 'fixture-existing.appimage', downloadedPath = 'verified-installer';
  const service = desktop.createStudioUpdates({
    mode, canInstallOnQuit, appImage: installedPath,
    saveMode(value: typeof mode) { calls.push('save:' + value); return value; },
    publish(value: unknown) { received.push(value); },
    async handoff(file: string, installer: string) {
      assert.equal(file, downloadedPath); assert.equal(installer, kind);
      calls.push('handoff');
    },
    reveal(file: string) { assert.equal(file, downloadedPath); calls.push('reveal'); },
    updater: {
      setMode(value: typeof mode) { activeMode = value; calls.push('mode:' + value); },
      async check({ manual }: { manual: boolean }) {
        calls.push(manual ? 'manual' : 'check');
        return { status: ['download', 'install'].includes(activeMode) ? 'downloaded' : 'available', update };
      },
      async download(selected: typeof update) {
        assert.equal(selected, update); calls.push('download');
        return { path: downloadedPath, update };
      },
      async prepareInstall(selected: typeof update) {
        assert.equal(selected, update); calls.push('verify');
        return { path: downloadedPath, update };
      },
      async applyAppImageUpdate(selected: typeof update, current: string) {
        assert.equal(selected, update); assert.equal(current, installedPath);
        calls.push('replace-appimage');
      },
    },
  });
  return { service, calls, received };
}

test('notify mode checks silently and manual installation is only armed by an explicit choice', async () => {
  const { service, calls, received } = fixture();
  assert.equal((await service.check()).status, 'available');
  assert.deepEqual(calls, ['check']);
  assert.equal(service.canHandoffOnQuit(), false);
  await service.download();
  assert.equal(service.snapshot().status, 'downloaded');
  assert.equal(service.canHandoffOnQuit(), false);
  await service.revealDownloaded();
  assert.deepEqual(calls, ['check', 'download', 'verify', 'reveal']);
  assert.equal(service.schedule().scheduled, true);
  assert.equal(await service.handoffOnQuit(), true);
  assert.deepEqual(calls, ['check', 'download', 'verify', 'reveal', 'verify', 'handoff']);
  assert.equal(await service.handoffOnQuit(), false);
  assert.doesNotMatch(JSON.stringify(received), /verified-installer|artifact/);
});

test('install mode waits for quit and AppImage applies through the shared verifier', async () => {
  for (const kind of ['nsis', 'appimage']) {
    const { service, calls } = fixture('install', kind);
    assert.equal((await service.check()).scheduled, true);
    assert.deepEqual(calls, ['check']);
    assert.equal(await service.handoffOnQuit(), true);
    assert.deepEqual(calls, kind === 'appimage' ? ['check', 'replace-appimage'] : ['check', 'verify', 'handoff']);
  }
});

test('download and portable builds do not launch installers on quit', async () => {
  const downloaded = fixture('download');
  assert.equal((await downloaded.service.check()).status, 'downloaded');
  assert.equal(await downloaded.service.handoffOnQuit(), false);
  assert.deepEqual(downloaded.calls, ['check']);
  const portable = fixture('install', 'zip', false);
  assert.equal((await portable.service.check()).installOnQuit, false);
  assert.equal(portable.service.schedule().scheduled, false);
  assert.equal(await portable.service.handoffOnQuit(), false);
  assert.deepEqual(portable.calls, ['check']);
});

test('off mode skips automatic requests and leaves an explicit check available', async () => {
  const { service, calls } = fixture('off');
  assert.equal((await service.check()).status, 'disabled');
  assert.deepEqual(calls, []);
  assert.equal((await service.check(true)).status, 'available');
  assert.deepEqual(calls, ['manual']);
  service.setMode('download');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.snapshot().status, 'downloaded');
  assert.deepEqual(calls, ['manual', 'save:download', 'mode:download', 'check']);
});

test('a mode change ignores a delayed check from the previous policy', async () => {
  const calls: string[] = [];
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  const service = desktop.createStudioUpdates({
    mode: 'install', saveMode: (value: string) => value, publish: () => {}, handoff: () => {}, reveal: () => {},
    updater: {
      check: ({ signal }: { signal: AbortSignal }) => { signal.addEventListener('abort', () => calls.push('abort')); return pending; },
      setMode: (value: string) => calls.push(value),
    },
  });
  const check = service.check();
  await Promise.resolve();
  service.setMode('off');
  release({ status: 'downloaded', update: { version: '0.11.4', artifact: { kind: 'nsis' } } });
  await check;
  assert.equal(service.snapshot().status, 'disabled');
  assert.equal(service.canHandoffOnQuit(), false);
  assert.deepEqual(calls, ['abort', 'off']);
});
