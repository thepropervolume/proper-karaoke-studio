/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  bindingFromStudioEvent, DEFAULT_STUDIO_SHORTCUTS, MAX_SHORTCUTS_PER_ACTION, parseStudioShortcuts,
  STUDIO_SHORTCUT_ACTIONS, studioShortcutLabel, type StudioShortcutAction, type StudioShortcuts,
} from '../domain/studio-shortcuts';
import './studio-shortcuts.css';

type Recording = { id: StudioShortcutAction; index: number | null };
const groups = [...new Set(STUDIO_SHORTCUT_ACTIONS.map(action => action.group))];

function errorText(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export function StudioShortcutPreferences({ value, onSave }: {
  value: StudioShortcuts;
  onSave(value: StudioShortcuts): Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Partial<Record<StudioConfigurationFile, string>>>({});
  const capture = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef('');
  const changed = JSON.stringify(draft) !== JSON.stringify(value);

  useEffect(() => { setDraft(value); setRecording(null); }, [value]);
  useEffect(() => {
    if (recording) capture.current?.focus();
    else if (restoreFocus.current) {
      document.getElementById(restoreFocus.current)?.focus();
      restoreFocus.current = '';
    }
  }, [recording]);
  useEffect(() => {
    let active = true;
    const unsubscribe = window.studio.onStudioShortcutsChanged(state => setWarning(state.warning));
    void window.studio.getStudioShortcuts().then(state => { if (active) setWarning(state.warning); }).catch(reason => {
      if (active) setError(errorText(reason));
    });
    void window.studio.getConfigurationFiles().then(paths => { if (active) setFiles(paths); }).catch(reason => {
      if (active) setError(errorText(reason));
    });
    return () => {
      active = false;
      unsubscribe();
      void window.studio.setStudioShortcutRecording(false).catch(() => {});
    };
  }, []);

  const nativeCapture = (active: boolean) => { void window.studio.setStudioShortcutRecording(active).catch(() => {}); };
  const stopRecording = () => { setRecording(null); nativeCapture(false); };

  function begin(id: StudioShortcutAction, index: number | null) {
    restoreFocus.current = index === null ? 'studio-shortcut-add-' + id : `studio-shortcut-${id}-${index}`;
    setError(''); setNotice('');
    setRecording({ id, index });
    nativeCapture(true);
  }

  function record(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopRecording(); setError(''); return; }
    if (!recording || event.repeat || event.nativeEvent.isComposing) return;
    const binding = bindingFromStudioEvent(event.nativeEvent);
    if (!binding) return;
    const bindings = [...draft[recording.id]];
    if (recording.index === null) bindings.push(binding);
    else bindings[recording.index] = binding;
    try {
      setDraft(parseStudioShortcuts({ ...draft, [recording.id]: bindings }));
      setError('');
      stopRecording();
    } catch (reason) { setError(errorText(reason)); }
  }

  async function save(next: StudioShortcuts, reset = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const validated = parseStudioShortcuts(next);
      await onSave(validated);
      setDraft(validated);
      stopRecording();
      setNotice(reset ? 'Default keyboard shortcuts restored.' : 'Keyboard shortcuts saved.');
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function reload() {
    if (changed && !window.confirm('Replace unsaved shortcut changes with the file on disk?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const state = await window.studio.reloadStudioShortcuts();
      setWarning(state.warning);
      if (!state.warning) {
        setDraft(state.value);
        stopRecording();
        setNotice('Keyboard shortcuts reloaded.');
      }
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  function open(action: () => Promise<void>) {
    setError('');
    void action().catch(reason => setError(errorText(reason)));
  }

  return <section className="studio-shortcuts" aria-label="Keyboard Shortcut Editor">
    <div className="row spaced shortcut-toolbar">
      <span className="muted">Click a key to change it or add alternate shortcuts.</span>
      <button type="button" disabled={busy} data-tip="Save the original shortcuts and replace your custom assignments."
        onClick={() => void save(DEFAULT_STUDIO_SHORTCUTS, true)}>Reset to Defaults</button>
    </div>
    {warning && <p className="error" role="alert">{warning}</p>}
    <div className="shortcut-groups">
      {groups.map(group => <section className="shortcut-group" key={group} aria-label={group + ' Shortcuts'}>
        <h3>{group}</h3>
        <dl>
          {STUDIO_SHORTCUT_ACTIONS.filter(action => action.group === group).map(({ id, label }) =>
            <div className="shortcut-row" key={id}>
              <dt>{label}</dt>
              <dd>
                <div className="shortcut-keys">
                  {draft[id].map((binding, index) => <span className="shortcut-binding" key={binding}>
                    <button type="button" id={`studio-shortcut-${id}-${index}`} disabled={busy} aria-label={'Change ' + studioShortcutLabel(binding) + ' for ' + label}
                      onClick={() => begin(id, index)}><kbd>{studioShortcutLabel(binding)}</kbd></button>
                    <button type="button" className="shortcut-remove" disabled={busy} aria-label={'Remove ' + studioShortcutLabel(binding) + ' from ' + label}
                      onClick={() => { setDraft({ ...draft, [id]: draft[id].filter((_, i) => i !== index) }); stopRecording(); setError(''); }}>×</button>
                  </span>)}
                  {!draft[id].length && <span className="muted">Unassigned</span>}
                  <button type="button" id={'studio-shortcut-add-' + id} disabled={busy || draft[id].length >= MAX_SHORTCUTS_PER_ACTION}
                    aria-label={'Add Shortcut for ' + label} onClick={() => begin(id, null)}>+ Add</button>
                </div>
                {recording?.id === id && <div className="shortcut-recording">
                  <input data-shortcut-capture ref={capture} readOnly value="Press a shortcut…" aria-label={'Record Shortcut for ' + label}
                    aria-describedby="studio-shortcut-record-help" onKeyDown={record} onFocus={() => nativeCapture(true)} onBlur={() => nativeCapture(false)} />
                  <button type="button" onClick={() => { stopRecording(); setError(''); }}>Cancel Recording</button>
                </div>}
              </dd>
            </div>)}
        </dl>
      </section>)}
    </div>
    {recording && <p className="muted" id="studio-shortcut-record-help">Press the key combination. Escape cancels recording. Assign Escape or Tab in the JSON file.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    <div className="row shortcut-toolbar">
      <button type="button" className="primary" disabled={busy || !!recording || !changed}
        data-tip="Apply and keep your key bindings independently of other preferences."
        onClick={() => void save(draft)}>Save Shortcuts</button>
      {changed && <span className="muted">Unsaved shortcut changes</span>}
    </div>
    <section className="shortcut-files">
      <h3>Configuration Files</h3>
      <p className="muted">Close Studio before editing settings.json. Use Reload Shortcuts to apply edits to keybindings.json.</p>
      <div className="toolbar">
        <button type="button" data-tip={files.settings ? 'Show ' + files.settings + ' in the file manager.' : 'Show your saved Studio defaults.'}
          onClick={() => open(() => window.studio.revealConfigurationFile('settings'))}>Show settings.json</button>
        <button type="button" data-tip={files.shortcuts ? 'Show ' + files.shortcuts + ' in the file manager.' : 'Show the shortcut file.'}
          onClick={() => open(() => window.studio.revealConfigurationFile('shortcuts'))}>Show keybindings.json</button>
        <button type="button" data-tip="Open keybindings.json in your default editor."
          onClick={() => open(window.studio.openStudioShortcutsFile)}>Edit Custom Shortcuts</button>
        <button type="button" disabled={busy} data-tip="Apply valid keyboard shortcut edits made in the JSON file."
          onClick={() => void reload()}>Reload Shortcuts</button>
      </div>
    </section>
  </section>;
}
