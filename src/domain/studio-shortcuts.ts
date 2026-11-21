/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */

// Physical key codes and the flat JSON shape follow the Booth shortcut editor.
export const STUDIO_SHORTCUT_ACTIONS = [
  { id: 'open', label: 'Open Project', group: 'Project', scope: 'editor' },
  { id: 'save', label: 'Save Project', group: 'Project', scope: 'editor' },
  { id: 'save-as', label: 'Save Project As', group: 'Project', scope: 'editor' },
  { id: 'import-audio', label: 'Import Audio', group: 'Project', scope: 'editor' },
  { id: 'import-lyrics', label: 'Import Lyrics', group: 'Project', scope: 'editor' },
  { id: 'choose-background', label: 'Choose Background', group: 'Project', scope: 'editor' },
  { id: 'preferences', label: 'Open Preferences', group: 'Application', scope: 'editor' },
  { id: 'keybindings', label: 'Open Keyboard Shortcuts', group: 'Application', scope: 'editor' },
  { id: 'appearance', label: 'Open Appearance', group: 'Application', scope: 'editor' },
  { id: 'lyrics-style', label: 'Open Lyric Appearance', group: 'Application', scope: 'editor' },
  { id: 'toggle-fullscreen', label: 'Toggle Full Screen', group: 'Application', scope: 'editor' },
  { id: 'play-pause', label: 'Play / Pause', group: 'Playback', scope: 'editor' },
  { id: 'restart', label: 'Jump to Start', group: 'Playback', scope: 'editor' },
  { id: 'skip-backward', label: 'Skip Back 5 Seconds', group: 'Playback', scope: 'editor' },
  { id: 'skip-forward', label: 'Skip Forward 10 Seconds', group: 'Playback', scope: 'editor' },
  { id: 'format-lyrics', label: 'Format Lyrics', group: 'Lyrics', scope: 'editor' },
  { id: 'build-cues', label: 'Build Cues', group: 'Lyrics', scope: 'editor' },
  { id: 'align-lyrics', label: 'AI Sync', group: 'Lyrics', scope: 'editor' },
  { id: 'split-words', label: 'Split Selected Line Into Word Timings', group: 'Lyrics', scope: 'editor' },
  { id: 'time-lines', label: 'Time Lines', group: 'Lyrics', scope: 'editor' },
  { id: 'time-words', label: 'Time Words', group: 'Lyrics', scope: 'editor' },
  { id: 'tap-timing', label: 'Mark Line or Word', group: 'During Timing', scope: 'timing' },
  { id: 'undo-timing', label: 'Undo Timing Mark', group: 'During Timing', scope: 'timing' },
  { id: 'redo-timing', label: 'Redo Timing Mark', group: 'During Timing', scope: 'timing' },
  { id: 'cancel-timing', label: 'Cancel Timing', group: 'During Timing', scope: 'timing' },
  { id: 'finish-timing', label: 'Finish Timing', group: 'During Timing', scope: 'timing' },
  { id: 'export-mp4', label: 'Export MP4', group: 'Export', scope: 'editor' },
  { id: 'export-kit', label: 'Export TPV Kit', group: 'Export', scope: 'editor' },
  { id: 'export-cdg', label: 'Export CD+G', group: 'Export', scope: 'editor' },
  { id: 'export-lrc', label: 'Export Enhanced LRC', group: 'Export', scope: 'editor' },
] as const;

export type StudioShortcutAction = typeof STUDIO_SHORTCUT_ACTIONS[number]['id'];
export type StudioShortcuts = Record<StudioShortcutAction, string[]>;
type KeyInput = { code: string; control: boolean; alt: boolean; shift: boolean; meta: boolean };
export const MAX_SHORTCUTS_PER_ACTION = 16;

export const DEFAULT_STUDIO_SHORTCUTS: StudioShortcuts = {
  open: ['Control+KeyO', 'Meta+KeyO'],
  save: ['Control+KeyS', 'Meta+KeyS'],
  'save-as': ['Control+Shift+KeyS', 'Shift+Meta+KeyS'],
  'import-audio': ['Control+KeyI', 'Meta+KeyI'],
  'import-lyrics': ['Control+Shift+KeyI', 'Shift+Meta+KeyI'],
  'choose-background': [],
  preferences: ['Control+Comma', 'Meta+Comma', 'Alt+Comma'],
  keybindings: ['Control+Slash', 'Meta+Slash', 'F1'],
  appearance: [],
  'lyrics-style': [],
  'toggle-fullscreen': ['F11', 'Control+Meta+KeyF'],
  'play-pause': ['Space'],
  restart: ['Home'],
  'skip-backward': ['ArrowLeft'],
  'skip-forward': ['ArrowRight'],
  'format-lyrics': ['Control+Shift+KeyL', 'Shift+Meta+KeyL'],
  'build-cues': [],
  'align-lyrics': [],
  'split-words': [],
  'time-lines': ['Alt+KeyL'],
  'time-words': ['Alt+KeyW'],
  'tap-timing': ['Space'],
  'undo-timing': ['Control+KeyZ', 'Meta+KeyZ'],
  'redo-timing': ['Control+KeyY', 'Control+Shift+KeyZ', 'Shift+Meta+KeyZ'],
  'cancel-timing': ['Escape'],
  'finish-timing': ['Enter'],
  'export-mp4': ['Control+Shift+KeyE', 'Shift+Meta+KeyE'],
  'export-kit': [],
  'export-cdg': [],
  'export-lrc': [],
};

const modifiers = ['Control', 'Alt', 'Shift', 'Meta'] as const;
const keyCode = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Minus|Equal|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/;
const keyLabels: Record<string, string> = {
  Control: 'Ctrl', Meta: 'Cmd', Space: 'Space', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

export function studioShortcutLabel(binding: string): string {
  return binding.split('+').map(part => keyLabels[part] ?? part.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Numpad ')).join('+');
}

export function studioShortcutHint(shortcuts: StudioShortcuts, action: StudioShortcutAction): string {
  return shortcuts[action].slice(0, 2).map(studioShortcutLabel).join(' / ');
}

export function canonicalStudioShortcut(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Shortcut bindings must be strings of at most 128 characters.');
  const parts = value.split('+'), code = parts.pop() ?? '';
  if (!keyCode.test(code) || parts.some(part => !modifiers.some(modifier => modifier === part)) || new Set(parts).size !== parts.length) {
    throw new Error(`Invalid shortcut: ${value}`);
  }
  return [...modifiers.filter(modifier => parts.includes(modifier)), code].join('+');
}

/** Explicit bindings win over newly added defaults. Timing and editing are exclusive scopes. */
export function parseStudioShortcuts(value: unknown): StudioShortcuts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Keyboard shortcuts must be a JSON object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_STUDIO_SHORTCUTS, key))) throw new Error('Unknown shortcut action.');
  const used = new Map<string, string>();
  const explicit = new Map<StudioShortcutAction, string[]>();
  for (const { id, label, scope } of STUDIO_SHORTCUT_ACTIONS) {
    if (!Object.hasOwn(input, id)) continue;
    const bindings = input[id];
    if (!Array.isArray(bindings) || bindings.length > MAX_SHORTCUTS_PER_ACTION) {
      throw new Error(`${label} must have 0 to ${MAX_SHORTCUTS_PER_ACTION} bindings.`);
    }
    explicit.set(id, bindings.map(value => {
      const binding = canonicalStudioShortcut(value);
      const previous = used.get(`${scope}:${binding}`);
      if (previous) throw new Error(`Conflicting shortcut ${studioShortcutLabel(binding)} for ${previous} and ${label}.`);
      used.set(`${scope}:${binding}`, label);
      return binding;
    }));
  }
  return Object.fromEntries(STUDIO_SHORTCUT_ACTIONS.map(({ id, scope }) => [
    id, explicit.get(id) ?? DEFAULT_STUDIO_SHORTCUTS[id].filter(binding => !used.has(`${scope}:${binding}`)),
  ])) as StudioShortcuts;
}

export function bindingFromStudioKey(input: KeyInput): string | null {
  if (!keyCode.test(input.code)) return null;
  return [input.control && 'Control', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Meta', input.code].filter(Boolean).join('+');
}

export function bindingFromStudioEvent(event: KeyboardEvent): string | null {
  return bindingFromStudioKey({
    code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey,
  });
}

export function studioShortcutForEvent(shortcuts: StudioShortcuts, event: KeyboardEvent, timing: boolean): StudioShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  const target = event.target as Element | null;
  if (target?.closest?.('[data-shortcut-capture]')) return null;
  if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    if (event.getModifierState?.('AltGraph')) return null;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && /^Key[ACVXYZ]$/.test(event.code)) return null;
    if (/^(?:Arrow|Home|End|Delete|Backspace|Insert)/.test(event.code)) return null;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && /^(?:Space|Enter|NumpadEnter|Arrow|Home|End)/.test(event.code)
    && target?.closest?.('button, a[href], summary, [role="slider"], [role="separator"], [role="menuitem"]')) return null;
  const binding = bindingFromStudioEvent(event);
  const scope = timing ? 'timing' : 'editor';
  return binding ? STUDIO_SHORTCUT_ACTIONS.find(action => action.scope === scope && shortcuts[action.id].includes(binding))?.id ?? null : null;
}
