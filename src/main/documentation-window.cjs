const { BrowserWindow, dialog } = require('electron');
const { join } = require('node:path');

let documentation;

function loadGuide(window, topic) {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL('/src/help/index.html', process.env.VITE_DEV_SERVER_URL);
    if (topic) url.hash = topic;
    return window.loadURL(url.href);
  }
  return window.loadFile(join(__dirname, '..', 'dist', 'src', 'help', 'index.html'), { hash: topic });
}

async function openDocumentationWindow(editor, topic = '') {
  if (documentation && !documentation.isDestroyed()) {
    const window = documentation;
    if (topic && !window.webContents.getURL().endsWith('#' + topic)) {
      try { await loadGuide(window, topic); }
      catch { if (!window.isDestroyed()) dialog.showErrorBox('Documentation unavailable', 'Studio could not open this guide.'); }
    }
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  if (editor.isDestroyed()) return;
  const window = new BrowserWindow({
    title: 'Karaoke Studio Documentation', width: 1000, height: 760, minWidth: 490, minHeight: 400,
    show: false, parent: editor,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  documentation = window;
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { if (documentation === window) documentation = undefined; });
  try {
    await loadGuide(window, topic);
    if (!window.isDestroyed()) window.show();
  } catch {
    if (window.isDestroyed()) return;
    window.destroy();
    dialog.showErrorBox('Documentation unavailable', 'Studio could not open its bundled documentation. Reinstall the current version and try again.');
  }
}

module.exports = { openDocumentationWindow };
