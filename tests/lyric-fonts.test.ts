/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fontTools from '../src/main/lyric-fonts.cjs';
import { toAss } from '../src/domain/lyrics-formats';
import { defaultLyricStyle } from '../src/domain/lyric-style';
import { toPortableKitProject } from '../src/domain/project';
import { exportKit } from '../src/main/studio-operations.cjs';
import { importKit } from '../src/main/kit-import.cjs';

test('custom lyric fonts are named, reusable, and included in portable kits', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-font-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fontFile = resolve('public/lyric-fonts/LiberationSerif-Bold.ttf');
  const library = fontTools.createFontLibrary(join(dir, 'library'));
  assert.deepEqual(await library.list(), []);
  const imported = await library.add(fontFile);
  assert.match(imported.family, /Liberation Serif/);
  assert.equal(imported.exportName, 'LiberationSerif-Bold');
  assert.deepEqual(await library.add(fontFile), imported);
  assert.deepEqual(await library.list(), [imported]);
  assert.throws(() => fontTools.readFontNames(Buffer.alloc(100)), /font face/);
  const lyricStyle = { ...defaultLyricStyle, font: 'custom' as const, customFont: imported };
  assert.match(toAss('Song', 'Artist', 8, [], 'video', lyricStyle), /Style: Default,LiberationSerif-Bold,/);
  const project = toPortableKitProject({ schema: 'com.thepropervolume.karaoke-studio', version: 1,
    title: 'Song', artist: '', durationSeconds: 8, lyrics: [], stems: [], lyricStyle });
  assert.equal(project.lyricStyle?.customFont?.path, 'fonts/lyric-font.ttf');
  const kit = join(dir, 'track.tpvkit');
  await exportKit({ manifest: JSON.stringify(project), lyrics: {}, stems: [], customFontPath: imported.path }, kit);
  const reopened = (await importKit(kit, join(dir, 'track.tpv.json'))).project;
  assert.equal(reopened.lyricStyle.font, 'custom');
  assert.deepEqual(await readFile(reopened.lyricStyle.customFont.path), await readFile(fontFile));
});
