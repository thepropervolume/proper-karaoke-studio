/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */

const { isStudioUpdateMode } = require('../domain/desktop-update-preference.ts');

/** Hold the verified Core result in the main process. The renderer can express
 * intent, but cannot select a file, installer type, version, or URL. */
function createStudioUpdates({ updater, mode, saveMode, publish, handoff, reveal, appImage, canInstallOnQuit = true }) {
  let status = { status: 'idle' };
  let candidate;
  let operation;
  let scheduledVersion;
  let closing = false;
  const scheduled = () => canInstallOnQuit && status.status === 'downloaded' &&
    (mode === 'install' || scheduledVersion === candidate?.version);
  const snapshot = () => ({ ...status, mode, installOnQuit: canInstallOnQuit, scheduled: scheduled() });
  const notify = () => {
    const value = snapshot();
    try { publish(value); } catch { /* A closing renderer does not own the updater. */ }
    return value;
  };

  function change(next) {
    status = next;
    return notify();
  }

  function start(working, action, success, failure) {
    if (closing || operation) return Promise.resolve(snapshot());
    const current = new AbortController();
    operation = current;
    change({ status: working });
    return Promise.resolve().then(() => action(current.signal)).then(result => {
      if (operation === current && !closing) return success(result);
      return snapshot();
    }, () => {
      if (operation === current && !closing) return change({ status: 'error', message: failure });
      return snapshot();
    }).finally(() => { if (operation === current) operation = undefined; });
  }

  function check(manual = false) {
    if (!updater) return Promise.resolve(change({ status: 'unavailable' }));
    if (!manual && mode === 'off') return Promise.resolve(change({ status: 'disabled' }));
    return start('checking', signal => updater.check({ manual, signal }), result => {
      candidate = result.status === 'available' || result.status === 'downloaded' ? result.update : undefined;
      return change({ status: result.status, ...(candidate ? { version: candidate.version } : {}) });
    }, 'Studio could not verify an update. Try again later.');
  }

  return {
    snapshot,
    check,
    setMode(value) {
      if (!isStudioUpdateMode(value)) throw new Error('Choose a supported update preference.');
      if (closing || value === mode) return snapshot();
      mode = saveMode(value);
      operation?.abort();
      operation = undefined;
      candidate = undefined;
      scheduledVersion = undefined;
      updater?.setMode(mode);
      void check();
      return snapshot();
    },
    download() {
      if (!candidate || status.status !== 'available') return Promise.resolve(snapshot());
      const selected = candidate;
      return start('downloading', signal => updater.download(selected, { signal }),
        () => change({ status: 'downloaded', version: selected.version }), 'Studio could not verify the download. Check for updates and try again.');
    },
    schedule() {
      if (!closing && canInstallOnQuit && candidate && status.status === 'downloaded') scheduledVersion = candidate.version;
      return notify();
    },
    revealDownloaded() {
      if (closing || !candidate || status.status !== 'downloaded') return Promise.resolve(snapshot());
      const selected = candidate;
      return start('checking', async signal => {
        const result = await updater.prepareInstall(selected, { signal });
        signal.throwIfAborted();
        reveal(result.path);
      }, () => change({ status: 'downloaded', version: selected.version }), 'Studio could not locate the verified update.');
    },
    canHandoffOnQuit() {
      return !closing && !!candidate && scheduled();
    },
    cancel() {
      closing = true;
      operation?.abort();
    },
    async handoffOnQuit() {
      if (!this.canHandoffOnQuit()) return false;
      const selected = candidate;
      this.cancel();
      // Quit already came from the user. Core only verifies the local file here.
      const signal = AbortSignal.timeout(10_000);
      if (selected.artifact.kind === 'appimage') {
        await updater.applyAppImageUpdate(selected, appImage, { signal });
        return true;
      }
      const result = await updater.prepareInstall(selected, { signal });
      signal.throwIfAborted();
      await handoff(result.path, result.update.artifact.kind);
      return true;
    },
  };
}

module.exports = { createStudioUpdates };
