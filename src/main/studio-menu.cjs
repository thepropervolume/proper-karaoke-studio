const { Menu } = require('electron');

function createStudioMenu(window) {
  const action = (id, label) => ({
    id, label, enabled: false,
    click: () => { if (!window.isDestroyed()) window.webContents.send('studio:menu-action', id); },
  });
  const choice = (id, label) => ({ ...action(id, label), type: 'radio' });
  const mac = process.platform === 'darwin';
  const menu = Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      action('open', 'Open…'),
      action('save', 'Save'),
      action('save-as', 'Save As…'),
      { type: 'separator' },
      { id: 'export', label: 'Export As…', enabled: false, submenu: [
        action('export-mp4', 'Karaoke Video (MP4)…'),
        action('export-cdg', 'CD+G Graphics…'),
        action('export-cdg-original', 'Original CD+G…'),
        { type: 'separator' },
        action('export-lrc', 'Enhanced LRC…'),
        action('export-srt', 'SRT Subtitles…'),
        action('export-json', 'Studio Lyric JSON…'),
        action('export-kit', 'TPV Kit…'),
      ] },
      { type: 'separator' },
      { role: mac ? 'close' : 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      action('preferences', 'Preferences…'),
      action('keybindings', 'Keyboard Shortcuts…'),
    ] },
    { label: 'View', submenu: [
      action('appearance', 'App Appearance…'),
      { label: 'Theme', submenu: [choice('theme-day', 'Day'), choice('theme-night', 'Night')] },
      { label: 'Accent Color', submenu: [choice('accent-blue', 'Blue'), choice('accent-pink', 'Pink'), choice('accent-purple', 'Purple')] },
      action('lyrics-style', 'Lyric Appearance…'),
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize' }, { label: 'Toggle Full Screen', click: () => {
        if (!window.isDestroyed()) window.setFullScreen(!window.isFullScreen());
      } },
      ...(mac ? [{ role: 'front' }] : []),
    ] },
  ]);
  Menu.setApplicationMenu(menu);
  const enable = (ids, value) => {
    for (const id of ids) menu.getMenuItemById(id).enabled = value;
  };
  return (state = {}) => {
    const editing = state.editing === true;
    const stems = editing && state.stems === true, lyrics = editing && state.lyrics === true, cdg = editing && state.cdg === true;
    enable(['open', 'save', 'save-as', 'preferences', 'keybindings', 'appearance', 'theme-day', 'theme-night', 'accent-blue', 'accent-pink', 'accent-purple'], editing);
    enable(['export'], stems || lyrics || cdg);
    enable(['export-mp4', 'export-kit'], stems);
    enable(['export-cdg', 'export-lrc', 'export-srt', 'export-json'], lyrics);
    enable(['export-cdg-original'], cdg);
    enable(['lyrics-style'], editing && state.styling === true);
    menu.getMenuItemById(state.theme === 'day' ? 'theme-day' : 'theme-night').checked = true;
    menu.getMenuItemById('accent-' + (['blue', 'pink', 'purple'].includes(state.accent) ? state.accent : 'blue')).checked = true;
  };
}

module.exports = { createStudioMenu };
