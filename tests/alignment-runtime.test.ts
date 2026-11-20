import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import runtime from '../src/main/alignment-runtime.cjs';

test('lyric setup recognizes only the managed environment and its matching receipt', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tpv-runtime-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'alignment-runtime-cpu-v1');
  const executable = process.platform === 'win32'
    ? path.join(directory, 'venv', 'Scripts', 'python.exe')
    : path.join(directory, 'venv', 'bin', 'python3');
  const receipt = path.join(directory, 'ready.json');
  const unavailableState = (await runtime.alignmentRuntimeStatus(root)).state;
  assert.match(unavailableState, /^(missing|unsupported)$/);

  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'Test fixture, must not run.');
  await writeFile(receipt, JSON.stringify({ pythonVersion: '3.15.2', whisperxVersion: '3.7.9' }));
  assert.equal((await runtime.alignmentRuntimeStatus(root)).state, unavailableState);

  await writeFile(receipt, JSON.stringify({ pythonVersion: '3.13.17', whisperxVersion: '3.7.9' }));
  assert.equal((await runtime.alignmentRuntimeStatus(root)).state, 'ready');
  for (const result of await Promise.all([runtime.ensureAlignmentRuntime(root), runtime.ensureAlignmentRuntime(root)])) {
    assert.equal(result, executable);
  }

  await rm(executable);
  assert.equal((await runtime.alignmentRuntimeStatus(root)).state, unavailableState);
});
