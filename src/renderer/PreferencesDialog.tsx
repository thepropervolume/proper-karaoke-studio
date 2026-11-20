import { useEffect, useState, type FormEvent } from 'react';
import { alignmentLanguages, separatorModels } from '../domain/studio-options.json';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const languages = alignmentLanguages.map(code => ({ code, name: languageNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function preferenceError(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

type Props = { settings: StudioSettings; close(): void; onSave(settings: StudioSettings): void };

export function PreferencesDialog({ settings, close, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [section, setSection] = useState<'tools' | 'integrations'>('tools');
  const [catalog, setCatalog] = useState<SeparatorCatalog>();
  const [listBusy, setListBusy] = useState(false);
  const [discovery, setDiscovery] = useState({ executable: settings.separatorExecutable, refresh: false });
  const [runtime, setRuntime] = useState<AlignmentStatus>();
  const [installing, setInstalling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { separatorAdapter: adapter, separatorExecutable: executable } = draft;
  const models = catalog?.models ?? separatorModels[adapter];
  const groups = [...new Set(models.map(model => model.group))];

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

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try { onSave(await window.studio.saveSettings(draft)); }
    catch (cause) { setError(preferenceError(cause)); setSaving(false); }
  }

  function changeAdapter(value: SeparatorAdapter) {
    const location = value === 'dango' ? '' : value;
    setDraft({ ...draft, separatorAdapter: value, separatorExecutable: location, separatorModel: separatorModels[value][0].id });
    setDiscovery({ executable: location, refresh: false });
  }

  return <div className="settings" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section className="settings-card preferences-card" role="dialog" aria-modal="true" aria-labelledby="preferences-title"
      onKeyDown={event => { if (event.key === 'Escape' && !saving) close(); }}>
      <div className="row spaced">
        <h2 id="preferences-title">Studio Preferences</h2>
        <button type="button" autoFocus disabled={saving} onClick={close}>Close</button>
      </div>
      <nav className="preferences-nav toolbar" aria-label="Preference sections">
        <button type="button" aria-pressed={section === 'tools'} onClick={() => setSection('tools')}>Audio &amp; Lyrics</button>
        <button type="button" aria-pressed={section === 'integrations'} onClick={() => setSection('integrations')}>Integrations</button>
      </nav>
      {section === 'tools' ? <form className="stack" onSubmit={event => void save(event)}>
        <div className="settings-group">
          <h3>Stem Separation</h3>
          <div className="preferences-fields">
            <label className="field-label">Stem Separator
              <select value={adapter} onChange={event => changeAdapter(event.target.value as SeparatorAdapter)}>
                <option value="audio-separator">Audio Separator (UVR)</option>
                <option value="demucs">Demucs</option>
                <option value="dango">Dango AI (Cloud)</option>
              </select>
            </label>
            <label className="field-label">Stem Separation Model
              <select value={draft.separatorModel} onChange={event => setDraft({ ...draft, separatorModel: event.target.value })}>
                {!models.some(model => model.id === draft.separatorModel) && <option value={draft.separatorModel}>{draft.separatorModel} (Saved)</option>}
                {groups.map(group => <optgroup key={group} label={group}>
                  {models.filter(model => model.group === group).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                </optgroup>)}
              </select>
            </label>
          </div>
          <div className="row spaced">
            <span className="muted" role="status">{adapter === 'dango'
              ? 'Set up your Dango credentials under Integrations.'
              : listBusy ? 'Checking the separator for models…'
                : catalog?.source === 'installed' ? 'Showing the separator’s model catalog.' : 'Showing recommended models.'}</span>
            {adapter !== 'dango' && <button type="button" disabled={listBusy} onClick={() => setDiscovery({ executable, refresh: true })}>Refresh Models</button>}
          </div>
        </div>
        <div className="settings-group">
          <h3>Lyric Synchronization</h3>
          <label className="field-label">Lyric Language
            <select value={draft.alignmentLanguage} onChange={event => setDraft({ ...draft, alignmentLanguage: event.target.value })}>
              {languages.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>
          </label>
          <div className="row spaced">
            <span className="muted" role="status">{runtime?.message ?? 'Checking AI Sync setup…'}</span>
            {runtime?.state === 'missing' && <button type="button" disabled={installing} onClick={() => void install()}>Install AI Sync</button>}
          </div>
        </div>
        <details className="settings-group preferences-details">
          <summary>Advanced Tool Locations</summary>
          <label className="field-label">FFmpeg Path (Video Export)<input value={draft.ffmpegPath} onChange={event => setDraft({ ...draft, ffmpegPath: event.target.value })} /></label>
          {adapter !== 'dango' && <label className="field-label">Stem Separator Path
            <input value={executable} onChange={event => setDraft({ ...draft, separatorExecutable: event.target.value })} />
          </label>}
        </details>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row preference-actions"><button className="primary" disabled={saving} type="submit">Save Preferences</button></div>
      </form> : <IntegrationsPanel />}
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
  const keyLabel = dango ? 'App Secret' : 'API Key';
  const closeEditor = () => { setAppKey(''); setSecret(''); setEditing(false); };

  return <article className="preferences-integration">
    <div className="row spaced"><h3>{integration.name}</h3>
      <span className="muted">{configured ? 'Credentials saved' : 'No credentials saved'}</span></div>
    <p className="muted">{dango ? 'Cloud stem separation. Uploads require your approval and may use Dango credits.'
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
      {dango && configured && <button type="button" disabled={busy || !storageAvailable} onClick={() => void perform(async () => {
        await window.studio.verifyDango();
        onNotice('Dango accepted the saved credentials.');
      })}>Verify Credentials</button>}
      {configured && <button type="button" disabled={busy} onClick={() => void perform(async () => onUpdate(await window.studio.removeIntegrationKey(id)))}>Remove Credentials</button>}
      {integration.website && <button type="button" disabled={busy} onClick={() => void perform(() => window.studio.openIntegrationWebsite(id))}>Open Website</button>}
      {!dango && <button type="button" disabled={busy} onClick={() => void perform(async () => onUpdate(await window.studio.removeIntegration(id)))}>Remove Integration</button>}
    </div>}
  </article>;
}
