/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_STUDIO_SHORTCUTS, parseStudioShortcuts, studioShortcutForEvent, studioShortcutHint,
} from '../src/domain/studio-shortcuts';
import { createStudioShortcuts, ensureJsonFile } from '../src/main/studio-shortcuts.cjs';

function key(code: string, fields: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, defaultPrevented: false, repeat: false, isComposing: false, ...fields } as KeyboardEvent;
}

test('loads partial files, supports empty bindings, and separates timing from editor actions', () => {
  const value = parseStudioShortcuts({ open: ['Shift+Control+KeyP', 'F11'], save: [] });
  assert.deepEqual(value.open, ['Control+Shift+KeyP', 'F11']);
  assert.deepEqual(value.save, []);
  assert.equal(studioShortcutForEvent(value, key('F11'), false), 'open');
  assert.ok(!value['toggle-fullscreen'].includes('F11'));
  assert.equal(studioShortcutForEvent(value, key('Space'), false), 'play-pause');
  assert.equal(studioShortcutForEvent(value, key('Space'), true), 'tap-timing');
  assert.equal(studioShortcutHint(value, 'open'), 'Ctrl+Shift+P / F11');
  assert.throws(() => parseStudioShortcuts({ open: ['Control+Shift+KeyP'], save: ['Shift+Control+KeyP'] }), /Conflicting shortcut Ctrl\+Shift\+P for Open Project and Save Project/);
  assert.throws(() => parseStudioShortcuts({ open: ['Control+Control+KeyA'] }), /Invalid shortcut/);
  assert.throws(() => parseStudioShortcuts({ unknown: ['Space'] }), /Unknown shortcut/);
});

test('keeps text editing, focused controls, IME, and shortcut recording intact', () => {
  const field = { closest: (selector: string) => selector.startsWith('input') ? {} : null } as Element;
  const button = { closest: (selector: string) => selector.startsWith('button') ? {} : null } as Element;
  const recorder = { closest: () => ({}) } as Element;
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('KeyZ', { ctrlKey: true, target: field }), true), null);
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('KeyZ', { ctrlKey: true }), true), 'undo-timing');
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('ArrowLeft', { target: field }), false), null);
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('Enter', { target: button }), true), null);
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('KeyS', { ctrlKey: true, target: field }), false), 'save');
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('F1', { target: recorder }), false), null);
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('F1', { repeat: true }), false), null);
  assert.equal(studioShortcutForEvent(DEFAULT_STUDIO_SHORTCUTS, key('KeyO', { ctrlKey: true, isComposing: true }), false), null);
});

test('seeds and atomically saves keybindings JSON and preserves malformed files on reload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-keybindings-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'keybindings.json');
  const shortcuts = createStudioShortcuts(file);
  assert.equal(shortcuts.get().warning, '');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), DEFAULT_STUDIO_SHORTCUTS);
  const updated = shortcuts.save({ open: ['F9'], save: [] }).value;
  assert.deepEqual(updated.open, ['F9']);
  assert.deepEqual(createStudioShortcuts(file).get().value.open, ['F9']);
  const previous = await readFile(file, 'utf8');
  assert.throws(() => shortcuts.save({ open: ['F9'], save: ['F9'] }), /Conflicting shortcut/);
  assert.equal(await readFile(file, 'utf8'), previous);
  await writeFile(file, '{"open":', 'utf8');
  assert.match(shortcuts.reload().warning, /Could not load keybindings.json/);
  assert.deepEqual(shortcuts.get().value.open, ['F9']);
  assert.equal(await readFile(file, 'utf8'), '{"open":');
  assert.deepEqual(createStudioShortcuts(file).get().value.open, DEFAULT_STUDIO_SHORTCUTS.open);
  await writeFile(file, '\uFEFF{"open":["F8"]}', 'utf8');
  assert.deepEqual(shortcuts.reload().value.open, ['F8']);
  assert.equal(shortcuts.get().warning, '');

  const settingsFile = join(directory, 'settings.json');
  ensureJsonFile(settingsFile, { custom: true });
  ensureJsonFile(settingsFile, { custom: false });
  assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), { custom: true });
});
