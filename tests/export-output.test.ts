import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { exportCdg, writeOutput } from '../src/main/studio-operations.cjs';
import { CdgPlayer, cdgHeight, cdgWidth } from '../src/domain/cdg';
import { toAss } from '../src/domain/lyrics-formats';

const hasLibass = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { windowsHide: true }).stdout?.includes(' subtitles ');

test('authored CD+G retains all four lyric rows while a word changes color', { skip: !hasLibass }, async t => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'tpv-cdg-roundtrip-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const destination = join(folder, 'lyrics.cdg');
  const lyrics = ['Set the tempo', 'Let the whole room sing', 'Every note is right on time', 'Follow the colors'].map((text, index) => {
    const startSeconds = 2 + index * 1.5;
    return { id: String(index), text, startSeconds, endSeconds: startSeconds + 1.25, words: [] };
  });
  const ass = toAss('CD+G rehearsal', '', 8, lyrics, 'cdg');
  await exportCdg({ ass, duration: 8, ffmpegPath: 'ffmpeg' }, destination);
  const player = new CdgPlayer(await fs.readFile(destination));
  const readFrame = (seconds: number) => {
    player.seek(seconds);
    const rgba = new Uint8ClampedArray(cdgWidth * cdgHeight * 4);
    player.writeRgba(rgba);
    return rgba;
  };
  const before = readFrame(1.85);
  const during = readFrame(2.65);
  const quarters = [0, 0, 0, 0];
  let painted = 0;
  for (let pixel = 0; pixel < cdgWidth * cdgHeight; pixel++) {
    const red = pixel * 4;
    assert.equal(Boolean(during[red]), Boolean(before[red]), 'The highlight should only change the color of the ink');
    if (before[red]) quarters[Math.floor(pixel / cdgWidth / (cdgHeight / 4))]++;
    if (during[red] && during[red + 1] < 100) painted++;
  }
  assert.ok(quarters.every(count => count > 60), 'All four rows should be visible before the sweep');
  assert.ok(painted > 30);
  assert.equal(player.durationSeconds, 8);
});

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
