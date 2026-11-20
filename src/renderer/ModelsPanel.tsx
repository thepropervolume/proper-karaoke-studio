/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { useEffect, useState } from 'react';
import type { StudioLibraryModel, StudioModelLibrary } from '../domain/model-library';

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

  const folders = [...new Set([uvrModelsPath, ...(library?.detectedFolders ?? [])].filter(Boolean))];
  const families = [...new Set(library?.models.map(model => model.group) ?? [])];
  const catalog = library?.models.filter(model => !family || model.group === family) ?? [];
  const selection: StudioLibraryModel | undefined = catalog.find(model => model.id === modelId) ?? catalog[0];

  async function chooseFolder() {
    setError('');
    try {
      const folder = await window.studio.chooseUvrModelsFolder();
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
        <h3 id="model-storage-title">Model Storage</h3>
        <button type="button" onClick={() => void openFolder('')} data-tip={library?.studioDirectory || 'Open Studio’s model cache.'}>Open Studio Models Folder</button>
      </div>
      <label className="field-label">Reuse Models from Ultimate Vocal Remover
        <select value={uvrModelsPath} onChange={event => onFolderChange(event.target.value)}>
          <option value="">Studio models only</option>
          {folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}
        </select>
      </label>
      <div className="row spaced">
        <span className="muted">{library?.detectedFolders.length ? 'Ultimate Vocal Remover detected.' : 'Choose the installation or its models folder to reuse weights.'}</span>
        <div className="toolbar">
          <button type="button" onClick={() => void chooseFolder()}>Choose UVR Folder…</button>
          {uvrModelsPath && <button type="button" onClick={() => void openFolder(uvrModelsPath)} data-tip={uvrModelsPath}>Open UVR Folder</button>}
        </div>
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
            {catalog.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
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
