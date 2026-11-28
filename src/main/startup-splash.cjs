const { BrowserWindow, screen, shell } = require('electron');

const website = 'https://thepropervolume.com/';
const maximumPaintWaitMs = 350;
const minimumVisibleMs = 900;

function createStartupSplash(url, icon) {
  // Wayland leaves placement to the compositor and does not expose global cursor coordinates.
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(620, width), height: Math.min(360, height), center: true,
    show: false, frame: false,
    skipTaskbar: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    backgroundColor: '#090e18', icon, title: 'Starting The Proper Volume Karaoke Studio',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let shownAt;
  let displayEditor;
  let handoffTimer;

  function close() {
    clearTimeout(handoffTimer);
    displayEditor = undefined;
    if (!window.isDestroyed()) window.destroy();
  }

  function handoff() {
    const show = displayEditor;
    if (!show) return;
    show();
    close();
  }

  function scheduleHandoff() {
    clearTimeout(handoffTimer);
    let remaining = 0;
    if (!window.isDestroyed()) {
      // Let the splash finish its first paint if the editor loaded first.
      if (shownAt === undefined) remaining = maximumPaintWaitMs;
      // Leave a brief opportunity to use the link only if the splash visibly painted.
      else if (shownAt !== null) remaining = minimumVisibleMs - (performance.now() - shownAt);
    }
    if (remaining > 0) handoffTimer = setTimeout(handoff, remaining);
    else handoff();
  }

  function editorReady(show) {
    displayEditor = show;
    scheduleHandoff();
  }

  function openWebsite(destination) {
    if (destination === website) void shell.openExternal(website)
      .catch(error => console.warn('Studio could not open its website:', error.message));
  }

  window.webContents.setWindowOpenHandler(({ url: destination }) => {
    openWebsite(destination);
    return { action: 'deny' };
  });
  window.webContents.on('will-frame-navigate', event => {
    event.preventDefault();
    if (event.isMainFrame) openWebsite(event.url);
  });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      if (displayEditor) handoff();
      else close();
    }
  });
  window.webContents.once('render-process-gone', () => {
    if (displayEditor) handoff();
    else close();
  });
  window.once('ready-to-show', () => {
    window.show();
    shownAt = window.isVisible() ? performance.now() : null;
    if (displayEditor) scheduleHandoff();
  });
  window.once('closed', handoff);
  void window.loadURL(url).catch(error => {
    if (window.isDestroyed()) return;
    console.warn('Studio could not load its startup screen:', error.message);
    if (displayEditor) handoff();
    else close();
  });

  return { close, editorReady };
}

module.exports = { createStartupSplash };
