/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_LYRIC_FORMAT_OPTIONS, formatLyricText, normalizeLyricFormatOptions, readLyricVersions,
  readTextForLyricFormat, validateLyricFormatOptions,
} from '../src/domain/lyric-format';
import { formatLyricsFile } from '../src/cli/standalone-lyrics.mjs';

test('balanced line wrapping keeps words, short phrases, and stanza breaks', () => {
  const input = '[Verse 1]\r\nSilver lanterns shine in the rain\r\nOh\r\n\r\nAcross the crowded avenue';
  const options = { minLength: 10, targetLength: 16, maxLength: 20 };
  const formatted = formatLyricText(input, options);
  assert.equal(formatted, 'Silver lanterns\nshine in the rain\nOh\n\nAcross the\ncrowded avenue\n');
  assert.equal(formatLyricText(formatted, options), formatted);
  assert.equal(formatLyricText('👩‍🎤 heliotropium sky', 8), '👩‍🎤\nheliotropium\nsky\n');
  assert.equal(formatLyricText('One two three four five six', { minLength: 8, targetLength: 10, maxLength: 18 }),
    'One two\nthree four\nfive six\n');
  assert.equal(formatLyricText('One two three four five six', { minLength: 8, targetLength: 15, maxLength: 18 }),
    'One two three\nfour five six\n');
  assert.deepEqual(normalizeLyricFormatOptions({ maxLength: 3 }), DEFAULT_LYRIC_FORMAT_OPTIONS);
  assert.throws(() => validateLyricFormatOptions({ minLength: 11, targetLength: 8, maxLength: 15 }), /ordered minimum/);
});

test('selects lyric JSON versions and safely formats LRC and JSON into text', async t => {
  const catalog = JSON.stringify([
    { trackName: 'Lanterns', artistName: 'Example Artist', albumName: 'First Mix', duration: 201, plainLyrics: 'Candles glow' },
    { trackName: 'Lanterns', artistName: 'Example Artist', albumName: 'Second Mix', syncedLyrics: '[00:04.00] Silver lanterns\n[00:06.00] Shine in the rain' },
    { instrumental: true, plainLyrics: 'Unusable entry' },
  ]);
  assert.deepEqual(readLyricVersions(catalog)?.map(version => version.album), ['First Mix', 'Second Mix']);
  assert.throws(() => readTextForLyricFormat('results.json', catalog), /Choose one with --candidate/);
  assert.throws(() => readTextForLyricFormat('results.json', catalog, 3), /Choose a lyric version from 1 to 2/);
  assert.equal(readTextForLyricFormat('results.json', catalog, 2), 'Silver lanterns\nShine in the rain');
  assert.equal(readTextForLyricFormat('song.lrc', '[ar:Test]\n[00:03.00]Music in the hall\n[00:07.00]Keep moving'), 'Music in the hall\nKeep moving');

  const directory = await mkdtemp(join(tmpdir(), 'tpv-format-versions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lyricsFile = join(directory, 'results.json');
  const output = join(directory, 'formatted.txt');
  await writeFile(lyricsFile, catalog);
  await assert.rejects(formatLyricsFile({ lyricsFile, output: lyricsFile, candidate: 2, force: true }), /preserve the original lyric file/);
  assert.deepEqual(await formatLyricsFile({ lyricsFile, output, candidate: 2 }), { output, lines: 2 });
  assert.equal(await readFile(output, 'utf8'), 'Silver lanterns\nShine in the rain\n');
  assert.equal(await readFile(lyricsFile, 'utf8'), catalog);
});
