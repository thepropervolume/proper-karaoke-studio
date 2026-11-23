const { BrowserWindow, dialog } = require('electron');
const { join } = require('node:path');

let documentation;

async function openDocumentationWindow(editor) {
  if (documentation && !documentation.isDestroyed()) {
    if (documentation.isMinimized()) documentation.restore();
    documentation.show();
    documentation.focus();
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
    if (process.env.VITE_DEV_SERVER_URL) {
      await window.loadURL(new URL('/src/help/index.html', process.env.VITE_DEV_SERVER_URL).href);
    } else {
      await window.loadFile(join(__dirname, '..', 'dist', 'src', 'help', 'index.html'));
    }
    if (!window.isDestroyed()) window.show();
  } catch {
    if (window.isDestroyed()) return;
    window.destroy();
    dialog.showErrorBox('Documentation unavailable', 'Studio could not open its bundled documentation. Reinstall the current version and try again.');
  }
}

module.exports = { openDocumentationWindow };
