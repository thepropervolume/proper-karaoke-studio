/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import preferences from '../src/main/session-preferences.cjs';
import { DEFAULT_LYRIC_FORMAT_OPTIONS } from '../src/domain/lyric-format';

test('session settings survive a second read and saved defaults survive a new session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-settings-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'settings.json');
  await writeFile(file, JSON.stringify({ separatorAdapter: 'dango', separatorModel: '31' }));
  const settings = preferences.createSessionPreferences(file);
  const starting = settings.get();
  assert.equal(starting.separatorAdapter, 'dango');
  assert.equal(starting.separatorModel, '31');
  assert.deepEqual(starting.lyricFormat, DEFAULT_LYRIC_FORMAT_OPTIONS);
  assert.equal(starting.updateMode, 'notify');
  assert.equal(starting.alignmentEngine, 'whisperx');
  settings.save({ ...starting, alignmentLanguage: 'es' }, 'session');
  assert.equal(settings.get().alignmentLanguage, 'es');
  assert.equal(settings.defaults().saved.alignmentLanguage, 'en');
  assert.equal(settings.defaults().factory.separatorAdapter, 'audio-separator');
  assert.equal(preferences.createSessionPreferences(file).get().alignmentLanguage, 'en');
  assert.throws(() => settings.save({ ...starting, separatorModel: 'wrong' }, 'default'), /Choose an available model/);
  settings.save({ ...starting, alignmentLanguage: 'fr' }, 'default');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).alignmentLanguage, 'fr');
  assert.equal(preferences.createSessionPreferences(file).get().alignmentLanguage, 'fr');
});

test('the alignment engine follows session and saved scopes and validates provider languages', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-alignment-settings-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'settings.json');
  const settings = preferences.createSessionPreferences(file);
  const starting = settings.get();
  settings.save({ ...starting, alignmentEngine: 'qwen', alignmentLanguage: 'yue' }, 'session');
  assert.equal(settings.get().alignmentLanguage, 'yue');
  assert.equal(settings.defaults().saved.alignmentEngine, 'whisperx');
  assert.throws(() => settings.save({ ...starting, alignmentEngine: 'vultr', alignmentLanguage: 'ar' }, 'default'), /supported by Vultr/);
  assert.throws(() => settings.save({ ...starting, alignmentEngine: 'unknown' }, 'default'), /supported AI Sync engine/);
  settings.save({ ...starting, alignmentEngine: 'audioshake' }, 'default');
  const reloaded = preferences.createSessionPreferences(file).get();
  assert.equal(reloaded.alignmentEngine, 'audioshake');
  assert.equal(reloaded.alignmentLanguage, 'auto');
});

test('update mode saves independently of a Studio audio preference session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-update-settings-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'settings.json');
  await writeFile(file, JSON.stringify({ updateMode: 'unknown' }));
  const settings = preferences.createSessionPreferences(file);
  const beforeChange = settings.get();
  assert.equal(beforeChange.updateMode, 'notify');
  settings.save({ ...beforeChange, alignmentLanguage: 'es' }, 'session');
  assert.equal(settings.saveUpdateMode('off'), 'off');
  assert.equal(settings.get().alignmentLanguage, 'es');
  assert.equal(settings.get().updateMode, 'off');
  assert.equal(settings.defaults().saved.alignmentLanguage, 'en');
  assert.equal(settings.defaults().saved.updateMode, 'off');
  settings.save({ ...beforeChange, alignmentLanguage: 'de' }, 'default');
  assert.equal(preferences.createSessionPreferences(file).get().updateMode, 'off');
  assert.throws(() => settings.saveUpdateMode('automatic'), /supported update preference/);
});
