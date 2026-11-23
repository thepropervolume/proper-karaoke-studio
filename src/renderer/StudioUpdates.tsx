import { useEffect, useState } from 'react';
import { isStudioUpdateMode, type StudioUpdateMode } from '../domain/desktop-update-preference';

const modeLabels: Record<StudioUpdateMode, string> = {
  notify: 'Notify Me on Startup',
  download: 'Download Automatically',
  install: 'Install on Quit',
  off: 'Turn Off Automatic Checks',
};

export function useStudioUpdates() {
  const [status, setStatus] = useState<StudioUpdateStatus>();
  useEffect(() => {
    let active = true, received = false;
    const unsubscribe = window.studio.onUpdateStatus(value => {
      received = true;
      if (active) setStatus(value);
    });
    void window.studio.getUpdateStatus().then(value => {
      if (active && !received) setStatus(value);
    }).catch(() => {
      if (active && !received) setStatus({ status: 'unavailable', mode: 'notify', installOnQuit: false, scheduled: false });
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  return status;
}

function updateMessage(status: StudioUpdateStatus) {
  switch (status.status) {
    case 'idle': return '';
    case 'unavailable': return 'Update checks are available in installed Studio builds.';
    case 'disabled': return 'Automatic update checks are off.';
    case 'checking': return 'Checking for updates…';
    case 'downloading': return 'Downloading and verifying the update…';
    case 'current': return 'This version is up to date.';
    case 'available': return `Studio ${status.version} is available.`;
    case 'downloaded': return status.scheduled
      ? `Studio ${status.version} is ready. Studio will apply or open the installer when you quit.`
      : `Studio ${status.version} is downloaded and verified.`;
    case 'error': return status.message;
  }
}

export function StudioUpdateNotice({ status, hidden, review }: {
  status?: StudioUpdateStatus; hidden: boolean; review(): void;
}) {
  const [dismissed, setDismissed] = useState<string>();
  if (hidden || !status?.version || status.version === dismissed || status.mode === 'off'
    || (status.status !== 'available' && status.status !== 'downloaded')) return null;
  const version = status.version;
  return <aside className="update-notice" aria-label="Studio update">
    <span role="status">{updateMessage(status)}</span>
    <button type="button" className="primary" onClick={() => { setDismissed(version); review(); }}>Review Update</button>
    <button type="button" onClick={() => setDismissed(version)}>Dismiss</button>
  </aside>;
}

export function StudioUpdates({ status }: { status?: StudioUpdateStatus }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  if (!status) return <p role="status">Loading update preferences…</p>;
  const busy = working || status.status === 'checking' || status.status === 'downloading';
  const message = updateMessage(status);
  async function perform(action: () => Promise<StudioUpdateStatus>) {
    setWorking(true);
    setError('');
    try { await action(); }
    catch { setError('Studio could not complete the update action. Try again.'); }
    finally { setWorking(false); }
  }
  return <div className="settings-group stack">
    <label className="field-label">Update Behavior
      <select value={status.mode} disabled={working} onChange={event => {
        const mode = event.target.value;
        if (isStudioUpdateMode(mode)) void perform(() => window.studio.setUpdateMode(mode));
      }}>
        {Object.entries(modeLabels).map(([mode, label]) => <option key={mode} value={mode} disabled={mode === 'install' && !status.installOnQuit}>{label}</option>)}
      </select>
    </label>
    {!status.installOnQuit && status.status !== 'unavailable' && <p className="muted">Portable builds can download updates for manual installation.</p>}
    {message && <p role="status" className={status.status === 'error' ? 'error' : 'muted'}>{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row">
      <button type="button" disabled={busy || status.status === 'unavailable'} onClick={() => void perform(() => window.studio.checkForUpdate())}>Check for Updates</button>
      {status.status === 'available' && <button type="button" disabled={busy} onClick={() => void perform(() => window.studio.downloadUpdate())}>Download Update</button>}
      {status.status === 'downloaded' && status.installOnQuit && !status.scheduled &&
        <button type="button" disabled={busy} onClick={() => void perform(() => window.studio.scheduleUpdate())}>Install on Quit</button>}
      {status.status === 'downloaded' && <button type="button" disabled={busy} onClick={() => void perform(() => window.studio.revealUpdate())}>Show Download</button>}
    </div>
  </div>;
}
