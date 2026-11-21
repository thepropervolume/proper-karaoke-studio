/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useEffect, useState } from 'react';
import type { StudioLibraryModel, StudioModelLibrary } from '../domain/model-library';
import { HelpTip } from './HelpTip';
import { SplitAction } from './SplitAction';

type Props = {
  uvrModelsPath: string;
  onFolderChange(path: string): void;
  onModelsChanged?(): void;
};

function errorText(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export function ModelsPanel({ uvrModelsPath, onFolderChange, onModelsChanged }: Props) {
  const [library, setLibrary] = useState<StudioModelLibrary>();
  const [family, setFamily] = useState('');
  const [modelId, setModelId] = useState('');
  const [downloading, setDownloading] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void window.studio.getModelLibrary(uvrModelsPath)
      .then(value => { if (active) setLibrary(value); })
      .catch(cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [uvrModelsPath, refresh]);

  const uvrDirectory = library?.uvrDirectory || '';
  const families = [...new Set(library?.models.map(model => model.group) ?? [])];
  const catalog = library?.models.filter(model => !family || model.group === family) ?? [];
  const selection: StudioLibraryModel | undefined = catalog.find(model => model.id === modelId) ?? catalog[0];

  async function chooseFolder() {
    setError('');
    try {
      const folder = await window.studio.chooseUvrModelsFolder(uvrDirectory);
      if (folder) onFolderChange(folder);
    } catch (cause) { setError(errorText(cause)); }
  }

  async function openFolder(folder: string) {
    setError('');
    try { await window.studio.openModelsFolder(folder); }
    catch (cause) { setError(errorText(cause)); }
  }

  async function install(model: StudioLibraryModel) {
    setError(''); setStatus('Downloading and verifying ' + model.label + '…'); setDownloading(model.id);
    try {
      await window.studio.downloadSeparationModel(model.id);
      setRefresh(value => value + 1);
      setStatus(model.label + ' is ready in the Studio models folder.');
      onModelsChanged?.();
    } catch (cause) { setStatus(''); setError(errorText(cause)); }
    finally { setDownloading(''); }
  }

  return <div className="stack">
    <section className="settings-group" aria-labelledby="model-storage-title">
      <div className="row spaced">
        <div className="row"><h3 id="model-storage-title">Model Storage</h3>
          <HelpTip label="Model storage">Studio checks its own cache first, then reuses verified models from Ultimate Vocal Remover when available.</HelpTip>
        </div>
        <SplitAction primary={{
          label: uvrModelsPath || uvrDirectory ? 'Change UVR Folder…' : 'Choose UVR Folder…',
          help: 'Choose the Ultimate Vocal Remover application directory or its models subfolder.',
          run: () => void chooseFolder(),
        }} alternatives={[
          { label: 'Open Studio Models Folder', help: 'Open ' + (library?.studioDirectory || 'the Studio model cache') + ' in the file manager.',
            run: () => void openFolder('') },
          ...(uvrDirectory ? [{ label: 'Open UVR Folder', help: 'Open ' + uvrDirectory + ' in the file manager.',
            run: () => void openFolder(uvrDirectory) }] : []),
        ]} menuLabel="Show model folder actions" />
      </div>
      <div className="row spaced">
        <span className="muted model-folder-status">{library ? uvrDirectory
          ? <>Using Studio and Ultimate Vocal Remover models from <code>{uvrDirectory}</code>.</>
          : 'Using Studio models. Select a UVR installation or its models folder to reuse additional weights.'
          : 'Looking for Ultimate Vocal Remover…'}</span>
        {uvrModelsPath && <button type="button" data-tip="Forget the custom UVR folder and look in standard installation locations."
          onClick={() => onFolderChange('')}>Use Automatic Detection</button>}
      </div>
    </section>
    <section className="settings-group" aria-labelledby="download-models-title">
      <h3 id="download-models-title">Download Models</h3>
      <div className="preferences-fields">
        <label className="field-label">Model Family
          <select value={family} onChange={event => { setFamily(event.target.value); setModelId(''); }} disabled={!library || !!downloading}>
            <option value="">All Families</option>
            {families.map(group => <option key={group} value={group}>{group}</option>)}
          </select>
        </label>
        <label className="field-label">Model
          <select value={selection?.id || ''} onChange={event => setModelId(event.target.value)} disabled={!catalog.length || !!downloading}>
            {catalog.map(model => <option key={model.id} value={model.id} data-model-ready={model.downloaded || undefined}>
              {model.label}{model.downloaded ? ' ✓' : ''}
            </option>)}
          </select>
        </label>
      </div>
      {selection && <div className="row spaced">
        <span className="muted">{selection.purpose === 'backing' ? 'Lead and backing vocal splitter' : selection.adapter === 'demucs' ? 'Demucs model' : 'Audio Separator model'}
          {selection.downloaded ? ' · In Studio folder' : selection.foundInUvr ? ' · Found in UVR' : ''}
        </span>
        <button type="button" className="primary" disabled={!!downloading} onClick={() => void install(selection)}
          data-tip="Download public model files from the maintainers and check their SHA-256.">
          {downloading ? 'Working…' : selection.downloaded ? 'Verify Model Files' : 'Download Model'}
        </button>
      </div>}
    </section>
    {status && <p className="muted" role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
