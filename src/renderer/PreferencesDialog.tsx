import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { alignmentLanguages, separatorModels } from '../domain/studio-options.json';
import type { StudioModelLibrary } from '../domain/model-library';
import type { StudioShortcuts } from '../domain/studio-shortcuts';
import { HelpTip } from './HelpTip';
import { ModelsPanel } from './ModelsPanel';
import { SplitAction } from './SplitAction';
import { StudioShortcutPreferences } from './StudioShortcutPreferences';
import { StudioUpdates } from './StudioUpdates';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const languages = alignmentLanguages.map(code => ({ code, name: languageNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function preferenceError(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

type Props = {
  settings: StudioSettings;
  initialSection?: 'shortcuts' | 'updates';
  updates?: StudioUpdateStatus;
  shortcuts: StudioShortcuts;
  close(): void;
  onSave(settings: StudioSettings, scope: PreferenceScope): void;
  onSaveShortcuts(value: StudioShortcuts): Promise<void>;
};
const adapterLabels: Record<SeparatorAdapter, string> = {
  'audio-separator': 'Audio Separator (UVR)', demucs: 'Demucs', dango: 'Dango AI (Cloud)', mvsep: 'MVSEP (Cloud)', gaudio: 'GAUDIO (Cloud)',
};
const formatterFields = [
  ['minLength', 'Minimum Characters', 'Short lines can remain at stanza boundaries or where a split would be awkward.'],
  ['targetLength', 'Target Characters', 'Studio aims for this length when there is a natural break.'],
  ['maxLength', 'Maximum Characters', 'Studio wraps by this length without splitting a word.'],
] as const;

export function PreferenceField({ label, hint, reset, children }: {
  label: string; hint: string; reset?(): void; children(id: string): ReactNode;
}) {
  const id = useId();
  return <div className="preference-field">
    <div className="preference-field-label">
      <label htmlFor={id}>{label}</label><HelpTip label={label}>{hint}</HelpTip>
      {reset && <button type="button" className="field-reset" aria-label={'Reset ' + label} data-tip="Restore the saved default." onClick={reset}>Reset</button>}
    </div>
    {children(id)}
  </div>;
}

export function PreferencesDialog({ settings, initialSection, updates, shortcuts, close, onSave, onSaveShortcuts }: Props) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<'tools' | 'models' | 'integrations' | 'shortcuts' | 'updates'>(initialSection ?? 'tools');
  const [defaults, setDefaults] = useState<{ saved: StudioSettings; factory: StudioSettings }>();
  const [catalog, setCatalog] = useState<SeparatorCatalog>();
  const [library, setLibrary] = useState<StudioModelLibrary>();
  const [listBusy, setListBusy] = useState(false);
  const [discovery, setDiscovery] = useState({ executable: settings.separatorExecutable, refresh: false });
  const [runtime, setRuntime] = useState<AlignmentStatus>();
  const [installing, setInstalling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { separatorAdapter: adapter, separatorExecutable: executable } = draft;
  const local = adapter === 'audio-separator' || adapter === 'demucs';
  const saved = defaults?.saved ?? settings;
  const standard = catalog?.models ?? separatorModels[adapter];
  const models = [...new Map([
    ...(library?.models.filter(model => model.adapter === adapter && model.purpose === 'separation') ?? []),
    ...standard,
  ].map(model => [model.id, model])).values()];
  const groups = [...new Set(models.map(model => model.group))];
  const downloadedModels = new Set(library?.models.filter(model => model.adapter === adapter && model.downloaded).map(model => model.id));

  useEffect(() => { void window.studio.getPreferenceDefaults().then(setDefaults).catch(cause => setError(preferenceError(cause))); }, []);
  useEffect(() => {
    let active = true;
    void window.studio.getModelLibrary(draft.uvrModelsPath).then(value => { if (active) setLibrary(value); })
      .catch(() => { if (active) setLibrary(undefined); });
    return () => { active = false; };
  }, [draft.uvrModelsPath, section]);

  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setListBusy(true);
    void window.studio.getSeparatorModels({ adapter, executable: discovery.executable || adapter, refresh: discovery.refresh })
      .then(value => { if (active) setCatalog(value); })
      .catch(cause => { if (active) setError(preferenceError(cause)); })
      .finally(() => { if (active) setListBusy(false); });
    return () => { active = false; };
  }, [adapter, discovery]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.studio.onAlignmentProgress(progress => {
      if (progress.phase !== 'aligning') setRuntime({ state: 'installing', message: progress.message });
    });
    const update = () => void window.studio.getAlignmentStatus()
      .then(value => { if (active) setRuntime(value); })
      .catch(cause => { if (active) setError(preferenceError(cause)); });
    update();
    const timer = window.setInterval(update, 5000);
    return () => { active = false; unsubscribe(); window.clearInterval(timer); };
  }, []);

  async function install() {
    setError('');
    setInstalling(true);
    try { setRuntime(await window.studio.installAlignment()); }
    catch (cause) {
      setError(preferenceError(cause));
      setRuntime({ state: 'missing', message: 'AI Sync setup stopped.' });
    } finally { setInstalling(false); }
  }

  async function save(scope: PreferenceScope) {
    setSaving(true);
    setError('');
    try { onSave(await window.studio.saveSettings(draft, scope), scope); }
    catch (cause) { setError(preferenceError(cause)); setSaving(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save('session');
  }

  function changeAdapter(value: SeparatorAdapter) {
    const location = value === saved.separatorAdapter ? saved.separatorExecutable : ['audio-separator', 'demucs'].includes(value) ? value : '';
    const model = value === saved.separatorAdapter ? saved.separatorModel : separatorModels[value][0].id;
    setDraft({ ...draft, separatorAdapter: value, separatorExecutable: location, separatorModel: model });
    setDiscovery({ executable: location, refresh: false });
  }

  function edit<Key extends keyof StudioSettings>(key: Key, value: StudioSettings[Key]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  const refreshModels = () => setDiscovery({ executable, refresh: true });
  const modelReset = adapter === saved.separatorAdapter ? saved.separatorModel : separatorModels[adapter][0].id;
  const backingChoices = library?.models.filter(model => model.purpose === 'backing') ?? [];
  const saveControl = <SplitAction emphasized upward disabled={saving} menuLabel="Show settings save options" primary={{
    label: 'Save Session Settings',
    help: 'Apply these changes now, until Studio closes. Your startup defaults stay the same.',
    run: () => void save('session'),
  }} alternatives={[{
    label: 'Save as Default Settings',
    help: 'Apply these changes now and load them automatically each time Studio starts.',
    run: () => void save('default'),
  }]} />;

  return <div className="settings" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section className="settings-card preferences-card" role="dialog" aria-modal="true" aria-labelledby="preferences-title"
      onKeyDown={event => { if (event.key === 'Escape' && !saving) close(); }}>
      <div className="row spaced">
        <h2 id="preferences-title">Studio Preferences</h2>
        <button type="button" autoFocus disabled={saving} onClick={close}>Close</button>
      </div>
      <nav className="preferences-nav toolbar" aria-label="Preference sections">
        <button type="button" aria-pressed={section === 'tools'} onClick={() => setSection('tools')}>Audio &amp; Lyrics</button>
        <button type="button" aria-pressed={section === 'models'} onClick={() => setSection('models')}>Download Models</button>
        <button type="button" aria-pressed={section === 'integrations'} onClick={() => setSection('integrations')}>Integrations</button>
        <button type="button" aria-pressed={section === 'shortcuts'} onClick={() => setSection('shortcuts')}>Keyboard Shortcuts</button>
        <button type="button" aria-pressed={section === 'updates'} onClick={() => setSection('updates')}>Updates</button>
      </nav>
      {section === 'tools' ? <form className="stack" onSubmit={submit}>
        <div className="settings-group">
          <h3>Stem Separation</h3>
          <div className="preferences-fields">
            <PreferenceField label="Stem Separator" hint="Local tools process on this computer. Cloud providers require credentials and approval per upload."
              reset={() => changeAdapter(saved.separatorAdapter)}>
              {id => <select id={id} value={adapter} onChange={event => changeAdapter(event.target.value as SeparatorAdapter)}>
                {Object.entries(adapterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>}
            </PreferenceField>
            <PreferenceField label="Stem Separation Model" hint="The model controls which parts of the mix Studio can separate." reset={() => edit('separatorModel', modelReset)}>
              {id => <select id={id} value={draft.separatorModel} onChange={event => edit('separatorModel', event.target.value)}>
                {!models.some(model => model.id === draft.separatorModel) && <option value={draft.separatorModel}>{draft.separatorModel} (Saved)</option>}
                {groups.map(group => <optgroup key={group} label={group}>
                  {models.filter(model => model.group === group).map(model => <option key={model.id} value={model.id} data-model-ready={downloadedModels.has(model.id) || undefined}>
                    {model.label}{downloadedModels.has(model.id) ? ' ✓' : ''}
                  </option>)}
                </optgroup>)}
              </select>}
            </PreferenceField>
          </div>
          {adapter === 'audio-separator' && <div className="preferences-fields">
            <PreferenceField label="Ensemble Models" hint="Add up to three models to combine with the primary model. Hold Ctrl or Cmd to select multiple models."
              reset={() => edit('ensembleModels', saved.ensembleModels)}>
              {id => <select id={id} multiple size={4} value={draft.ensembleModels} onChange={event => {
                const selected = [...event.target.selectedOptions].map(option => option.value);
                if (selected.length > 3) { setError('Choose up to three additional models.'); return; }
                setError(''); edit('ensembleModels', selected);
              }}>
                {models.filter(model => model.id !== draft.separatorModel).map(model => <option key={model.id} value={model.id} data-model-ready={downloadedModels.has(model.id) || undefined}>
                  {model.label}{downloadedModels.has(model.id) ? ' ✓' : ''}
                </option>)}
              </select>}
            </PreferenceField>
            <PreferenceField label="Backing Vocal Model" hint="Run a second pass on the separated vocals to create lead and backing vocal stems."
              reset={() => edit('backingModel', saved.backingModel)}>
              {id => <select id={id} value={draft.backingModel} onChange={event => edit('backingModel', event.target.value)}>
                <option value="">Off</option>
                {!backingChoices.length && <option value="5_HP-Karaoke-UVR.pth">UVR Karaoke Vocal Split</option>}
                {draft.backingModel && draft.backingModel !== '5_HP-Karaoke-UVR.pth' && !backingChoices.some(model => model.id === draft.backingModel) && <option>{draft.backingModel}</option>}
                {backingChoices.map(model => <option key={model.id} value={model.id} data-model-ready={model.downloaded || undefined}>
                  {model.label}{model.downloaded ? ' ✓' : ''}
                </option>)}
              </select>}
            </PreferenceField>
          </div>}
          <div className="row spaced">
            <span className="muted" role="status">{!local
              ? 'Set up cloud credentials under Integrations.'
              : listBusy ? 'Checking the separator for models…'
                : catalog?.source === 'installed' ? 'Showing the separator’s model catalog.' : 'Showing recommended models.'}</span>
            <div className="toolbar">
              <button type="button" data-tip="Show model storage, available downloads, and folder actions." onClick={() => setSection('models')}>Models and Folders</button>
              {local && <button type="button" disabled={listBusy} data-tip="Check your local separator for an updated model list." onClick={refreshModels}>Refresh Models</button>}
            </div>
          </div>
        </div>
        <div className="settings-group">
          <h3>Lyric Synchronization</h3>
          <PreferenceField label="Lyric Language" hint="Choose the language sung in the recording so AI Sync loads the matching alignment model." reset={() => edit('alignmentLanguage', saved.alignmentLanguage)}>
            {id => <select id={id} value={draft.alignmentLanguage} onChange={event => edit('alignmentLanguage', event.target.value)}>
              {languages.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>}
          </PreferenceField>
          <div className="row spaced">
            <span className="muted" role="status">{runtime?.message ?? 'Checking AI Sync setup…'}</span>
            {runtime?.state === 'missing' && <button type="button" disabled={installing} onClick={() => void install()}>Install AI Sync</button>}
          </div>
        </div>
        <div className="settings-group">
          <h3>Lyric Formatting Defaults</h3>
          <div className="formatter-preferences">
            {formatterFields.map(([key, label, hint]) => <PreferenceField key={key} label={label} hint={hint}
              reset={() => edit('lyricFormat', { ...draft.lyricFormat, [key]: saved.lyricFormat[key] })}>
              {id => <input id={id} type="number" min={1} max={160} value={draft.lyricFormat[key]}
                onChange={event => edit('lyricFormat', { ...draft.lyricFormat, [key]: Number(event.target.value) })} />}
            </PreferenceField>)}
          </div>
        </div>
        <details className="settings-group preferences-details">
          <summary>Advanced Tool Locations</summary>
          <PreferenceField label="FFmpeg Path" hint="Used for video export and animated GIF previews." reset={() => edit('ffmpegPath', saved.ffmpegPath)}>
            {id => <input id={id} value={draft.ffmpegPath} onChange={event => edit('ffmpegPath', event.target.value)} />}
          </PreferenceField>
          {local && <PreferenceField label="Stem Separator Path" hint="Use the command name or full executable path of your local separator."
            reset={() => edit('separatorExecutable', adapter === saved.separatorAdapter ? saved.separatorExecutable : adapter)}>
            {id => <input id={id} value={executable} onChange={event => edit('separatorExecutable', event.target.value)} />}
          </PreferenceField>}
        </details>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row spaced preference-footer">
          <button type="button" disabled={saving || !defaults} data-tip="Load Studio’s factory values into this form. Save to apply them." onClick={() => {
            if (!defaults) return;
            setDraft(defaults.factory); setDiscovery({ executable: defaults.factory.separatorExecutable, refresh: false });
          }}>Restore Factory Settings</button>
          {saveControl}
        </div>
      </form> : section === 'models' ? <>
        <ModelsPanel uvrModelsPath={draft.uvrModelsPath}
          onFolderChange={folder => edit('uvrModelsPath', folder)} onModelsChanged={refreshModels} />
        <div className="row spaced preference-footer">
          <button type="button" data-tip="Restore your saved UVR folder selection without moving or deleting model files."
            onClick={() => edit('uvrModelsPath', saved.uvrModelsPath)}>Reset UVR Folder</button>
          {saveControl}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </> : section === 'shortcuts' ? <StudioShortcutPreferences value={shortcuts} onSave={onSaveShortcuts} /> :
        section === 'updates' ? <StudioUpdates status={updates} /> : <IntegrationsPanel />}
    </section>
  </div>;
}

function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<StudioIntegration[]>();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void window.studio.listIntegrations().then(value => { if (active) setIntegrations(value); })
      .catch(cause => { if (active) setError(preferenceError(cause)); });
    return () => { active = false; };
  }, []);

  async function perform(action: () => Promise<void>) {
    setError(''); setNotice(''); setBusy(true);
    try { await action(); }
    catch (cause) { setError(preferenceError(cause)); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    <div className="row spaced"><h3>Third-Party Integrations</h3>
      <button type="button" aria-expanded={adding} disabled={!integrations || busy} onClick={() => setAdding(!adding)}>Add Integration</button></div>
    {adding && <form className="preferences-integration" onSubmit={event => {
      event.preventDefault();
      void perform(async () => {
        setIntegrations(await window.studio.addIntegration({ name, website }));
        setName(''); setWebsite(''); setAdding(false);
      });
    }}>
      <div className="preferences-fields">
        <label className="field-label">Service Name<input autoFocus required value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label className="field-label">Website (Optional)<input type="url" value={website} placeholder="https://" onChange={event => setWebsite(event.target.value)} /></label>
      </div>
      <div className="row preference-actions"><button type="submit" disabled={busy}>Add Service</button></div>
    </form>}
    {!integrations && !error && <span className="muted" role="status">Loading integrations…</span>}
    {integrations?.map(integration => <IntegrationRow key={integration.id} integration={integration} busy={busy}
      onUpdate={setIntegrations} onNotice={setNotice} perform={perform} />)}
    {notice && <p className="muted" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

type IntegrationRowProps = {
  integration: StudioIntegration;
  busy: boolean;
  onUpdate(value: StudioIntegration[]): void;
  onNotice(value: string): void;
  perform(action: () => Promise<void>): Promise<void>;
};

function IntegrationRow({ integration, busy, onUpdate, onNotice, perform }: IntegrationRowProps) {
  const [editing, setEditing] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [secret, setSecret] = useState('');
  const { id, kind, configured, storageAvailable } = integration;
  const dango = kind === 'dango';
  const provider = kind !== 'custom';
  const keyLabel = dango ? 'App Secret' : 'API Key';
  const closeEditor = () => { setAppKey(''); setSecret(''); setEditing(false); };

  return <article className="preferences-integration">
    <div className="row spaced"><h3>{integration.name}</h3>
      <span className="muted">{configured ? 'Credentials saved' : 'No credentials saved'}</span></div>
    <p className="muted">{provider ? 'Cloud stem separation. Uploads require your approval and may incur a charge.'
      : 'Custom entry for storing credentials securely.'}</p>
    {!storageAvailable && <p className="muted">Unlock your system keyring to save or verify credentials.</p>}
    {editing ? <form className="stack" onSubmit={event => {
      event.preventDefault();
      void perform(async () => {
        onUpdate(await window.studio.saveIntegrationKey({ id, key: secret, ...(dango ? { appKey } : {}) }));
        closeEditor();
      });
    }}>
      <div className="preferences-fields">
        {dango && <label className="field-label">App Key<input autoFocus type="password" required autoComplete="off" value={appKey} onChange={event => setAppKey(event.target.value)} /></label>}
        <label className="field-label">{keyLabel}<input autoFocus={!dango} type="password" required autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} /></label>
      </div>
      <div className="toolbar">
        <button type="submit" disabled={busy || !storageAvailable}>Save Credentials</button>
        <button type="button" onClick={closeEditor}>Cancel</button>
      </div>
    </form> : <div className="toolbar">
      <button type="button" disabled={busy || !storageAvailable} onClick={() => setEditing(true)}>{configured ? 'Replace Credentials' : 'Add Credentials'}</button>
      {kind !== 'custom' && configured && <button type="button" disabled={busy || !storageAvailable} onClick={() => void perform(async () => {
        await window.studio.verifyIntegration(kind);
        onNotice(integration.name + ' accepted the saved credentials.');
      })}>Verify Credentials</button>}
      {configured && <button type="button" disabled={busy} onClick={() => void perform(async () => onUpdate(await window.studio.removeIntegrationKey(id)))}>Remove Credentials</button>}
      {integration.website && <button type="button" disabled={busy} onClick={() => void perform(() => window.studio.openIntegrationWebsite(id))}>Open Website</button>}
      {!provider && <button type="button" disabled={busy} onClick={() => void perform(async () => onUpdate(await window.studio.removeIntegration(id)))}>Remove Integration</button>}
    </div>}
  </article>;
}
