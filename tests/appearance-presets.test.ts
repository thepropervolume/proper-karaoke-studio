import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { defaultLyricStyle } from '../src/domain/lyric-style';
import { defaultTitleCard } from '../src/domain/video-presentation';
import appearance from '../src/main/appearance-presets.cjs';
import fontOperations from '../src/main/lyric-fonts.cjs';

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-appearance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = (folder: string) => appearance.createAppearancePresets(join(directory, folder),
    fontOperations.createFontLibrary(join(directory, folder, 'fonts')));
  return { directory, library };
}

test('lyric and title defaults and named presets survive a restart independently', async t => {
  const { library } = await setup(t);
  const first = library('studio');
  const blue = { ...defaultLyricStyle, highlightColor: '#007bff' };
  const pink = { ...defaultLyricStyle, highlightColor: '#d5167a', allCaps: true };
  assert.deepEqual(await first.list('lyrics'), { defaultStyle: defaultLyricStyle, presets: [] });
  await first.saveDefault({ kind: 'lyrics', style: blue });
  const { preset } = await first.save({ kind: 'lyrics', name: 'Modern', style: blue });
  await assert.rejects(first.save({ kind: 'lyrics', name: 'modern', style: pink }), /already exists/);
  await first.save({ kind: 'lyrics', id: preset.id, name: 'Modern', style: pink });
  const title = { ...defaultTitleCard, enabled: true, title: 'Show Opener' };
  await first.saveDefault({ kind: 'title', style: title });
  await first.save({ kind: 'title', name: 'Modern', style: title });

  const reopened = library('studio');
  const restoredLyrics = await reopened.list('lyrics');
  assert.equal(restoredLyrics.defaultStyle.highlightColor, '#007bff');
  assert.deepEqual(restoredLyrics.presets, [{ ...preset, style: pink }]);
  const restoredTitle = await reopened.list('title');
  assert.equal(restoredTitle.defaultStyle.title, 'Show Opener');
  assert.equal(restoredTitle.presets[0].style.title, 'Show Opener');
});

test('portable lyric presets embed the selected font by default and allow a fontless export', async t => {
  const { directory, library } = await setup(t);
  const original = library('original');
  const path = resolve('public', 'lyric-fonts', 'LiberationSans-Bold.ttf');
  const customFont = await fontOperations.describeLyricFont(path);
  const { preset } = await original.save({ kind: 'lyrics', name: 'Blue', style: { ...defaultLyricStyle, font: 'custom', customFont } });
  assert.notEqual(preset.style.customFont.path, path);
  const withFont = join(directory, 'blue.tpv-preset.json');
  const withoutFont = join(directory, 'blue-no-font.tpv-preset.json');
  await original.export('lyrics', preset.id, withFont);
  await original.export('lyrics', preset.id, withoutFont, false);
  const embedded = JSON.parse(await readFile(withFont, 'utf8'));
  assert.equal(embedded.style.customFont, undefined);
  assert.deepEqual(Buffer.from(embedded.font.data, 'base64'), await readFile(path));
  const excluded = JSON.parse(await readFile(withoutFont, 'utf8'));
  assert.equal(excluded.font.data, undefined);
  assert.equal(excluded.font.sha256, embedded.font.sha256);

  const destination = library('destination');
  const missing = await destination.import('lyrics', withoutFont);
  assert.equal(missing.fontMissing, true);
  assert.equal(missing.preset.style.font, 'sans');
  const imported = await destination.import('lyrics', withFont);
  assert.equal(imported.fontMissing, false);
  assert.equal(imported.preset.name, 'Blue (2)');
  assert.deepEqual(await readFile(imported.preset.style.customFont.path), await readFile(path));
  const matched = await destination.import('lyrics', withoutFont);
  assert.equal(matched.fontMissing, false);
  assert.equal(matched.preset.style.customFont.path, imported.preset.style.customFont.path);

  embedded.font.sha256 = '0'.repeat(64);
  await writeFile(withFont, JSON.stringify(embedded));
  await assert.rejects(destination.import('lyrics', withFont), /failed its integrity check/);
  assert.equal((await destination.list('lyrics')).presets.length, 3);
});

test('title presets travel separately and retain their selected font family source', async t => {
  const { directory, library } = await setup(t);
  const original = library('original');
  const { preset } = await original.save({ kind: 'title', name: 'Closing', style: {
    ...defaultTitleCard, placement: 'closing', font: 'lyrics', duration: 4.5,
  } });
  const destination = join(directory, 'closing.tpv-preset.json');
  await original.export('title', preset.id, destination, true);
  const portable = JSON.parse(await readFile(destination, 'utf8'));
  assert.equal(portable.font, undefined);
  const imported = await library('new').import('title', destination);
  assert.deepEqual(imported.preset.style, preset.style);
  await assert.rejects(library('new').import('lyrics', destination), /exported from this Studio appearance panel/);
});
