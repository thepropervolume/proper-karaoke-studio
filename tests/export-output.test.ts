import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { exportCdg, writeOutput } from '../src/main/studio-operations.cjs';

test('a locked export directory preserves both the saved CD+G and any real export error', async t => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'tpv-export-test-'));
  const remove = fs.rm;
  t.after(() => remove(folder, { recursive: true, force: true }));
  const source = join(folder, 'original.cdg');
  const destination = join(folder, 'exported.cdg');
  const graphics = Buffer.alloc(24);
  graphics[0] = 9;
  graphics[1] = 1;
  await fs.writeFile(source, graphics);
  await fs.writeFile(destination, 'Previous export');

  t.mock.method(fs, 'rm', async (directory: string, options?: Parameters<typeof fs.rm>[1]) => {
    if (!basename(directory).startsWith('.tpv-export-')) return remove(directory, options);
    assert.ok(options?.maxRetries && options.retryDelay);
    throw Object.assign(new Error('Directory is busy'), { code: 'EBUSY' });
  });
  const warn = t.mock.method(console, 'warn', () => {});

  assert.equal(await exportCdg({ cdgPath: source }, destination), destination);
  assert.deepEqual(await fs.readFile(destination), graphics);
  await assert.rejects(exportCdg({ cdgPath: source }, destination, false), { code: 'EEXIST' });

  const writeError = new Error('Export data could not be written');
  await assert.rejects(writeOutput(destination, true, async file => {
    await fs.writeFile(file, 'Partial graphics');
    throw writeError;
  }), error => error === writeError);
  assert.deepEqual(await fs.readFile(destination), graphics);
  assert.equal(warn.mock.callCount(), 3);
});
