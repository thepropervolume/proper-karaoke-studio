import { useEffect, useState } from 'react';
import type { AppearanceKind, AppearanceLibrary, AppearanceStyles } from '../domain/appearance-presets';
import type { TitleCardStyle } from '../domain/video-presentation';
import { HelpTip } from './HelpTip';
import { preferenceError } from './PreferencesDialog';

export function AppearancePresetControls<K extends AppearanceKind>({ kind, value, onChange, onDefaultSaved }: {
  kind: K;
  value: AppearanceStyles[K];
  onChange(value: AppearanceStyles[K]): void;
  onDefaultSaved?(value: AppearanceStyles[K]): void;
}) {
  const [library, setLibrary] = useState<AppearanceLibrary<K>>();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [includeFont, setIncludeFont] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void window.studio.listAppearancePresets(kind).then(result => {
      if (active) setLibrary(result);
    }, cause => {
      if (active) setError(preferenceError(cause));
    });
    return () => { active = false; };
  }, [kind]);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (cause) { setError(preferenceError(cause)); }
    finally { setWorking(false); }
  }

  const selected = library?.presets.find(preset => preset.id === id);
  const disabled = working || !library;
  async function save(updateId?: string) {
    const result = await window.studio.saveAppearancePreset({ kind, id: updateId, name, style: value });
    setLibrary(result.library);
    setId(result.preset.id);
    setName(result.preset.name);
    setNotice('Saved ' + result.preset.name + '.');
  }

  return <div className="settings-group appearance-presets">
    <div className="row spaced">
      <div className="row"><h3>Presets</h3><HelpTip label="Presets">Save looks to reuse across projects or move them to another computer.</HelpTip></div>
      <div className="row">
        <button type="button" disabled={disabled} onClick={() => library && onChange(library.defaultStyle)}>Use Default</button>
        <button type="button" disabled={disabled} onClick={() => void run(async () => {
          const result = await window.studio.saveAppearanceDefault({ kind, style: value });
          setLibrary(result);
          onChange(result.defaultStyle);
          onDefaultSaved?.(result.defaultStyle);
          setNotice('Saved as the default for new projects.');
        })}>Save as Default</button>
      </div>
    </div>
    <div className="row">
      <select aria-label="Appearance preset" disabled={disabled} value={id} onChange={event => {
        const next = event.target.value;
        setId(next);
        setName(library?.presets.find(item => item.id === next)?.name ?? '');
      }}>
        <option value="">Choose a preset…</option>
        {library?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
      <button type="button" disabled={disabled || !selected} onClick={() => selected && onChange(selected.style)}>Apply</button>
      <button type="button" disabled={disabled} onClick={() => void run(async () => {
        const result = await window.studio.importAppearancePreset(kind);
        if (!result) return;
        setLibrary(result.library);
        setId(result.preset.id);
        setName(result.preset.name);
        onChange(result.preset.style);
        setNotice(result.fontMissing ? 'Imported ' + result.preset.name + '. Its font was unavailable, so Studio used Sans Serif.' : 'Imported ' + result.preset.name + '.');
      })}>Import…</button>
      <button type="button" disabled={disabled || !selected} onClick={() => void run(async () => {
        if (selected && await window.studio.exportAppearancePreset({ kind, id, includeFont })) setNotice('Exported ' + selected.name + '.');
      })}>Export…</button>
      {selected?.style.font === 'custom' && <label className="row lyric-caps"><input type="checkbox" checked={includeFont}
        disabled={working} onChange={event => setIncludeFont(event.target.checked)} />Include Font</label>}
    </div>
    <div className="row">
      <input type="text" aria-label="Preset name" placeholder="Preset name" disabled={disabled} maxLength={80}
        value={name} onChange={event => setName(event.target.value)} />
      <button type="button" disabled={disabled || !name.trim()} onClick={() => void run(() => save())}>Save New</button>
      <button type="button" disabled={disabled || !selected || !name.trim()} onClick={() => void run(() => save(id))}>Update Selected</button>
    </div>
    {notice && <div className="muted" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
  </div>;
}

export function TitlePresetControls({ value, onChange, onDefaultSaved }: {
  value: TitleCardStyle;
  onChange(value: TitleCardStyle): void;
  onDefaultSaved?(value: TitleCardStyle): void;
}) {
  return <AppearancePresetControls kind="title" value={value} onChange={onChange} onDefaultSaved={onDefaultSaved} />;
}
