/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { Menu } = require('electron');

function timingContextMenu(window, context) {
  if (!['field', 'field-with-split', 'line'].includes(context) || !window || window.isDestroyed()) return null;
  return new Promise(resolve => {
    const timingField = context !== 'line';
    const split = context !== 'field';
    const menu = Menu.buildFromTemplate([
      ...(timingField ? [{ label: 'Set to Current Position', click: () => resolve('playhead') }] : []),
      ...(split ? [{ label: 'Split Line into Word Timings', click: () => resolve('split-words') }] : []),
      ...(timingField ? [
        { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ] : []),
    ]);
    menu.popup({ window, callback: () => setImmediate(() => resolve(null)) });
  });
}

module.exports = { timingContextMenu };
