const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:get-settings'),
  saveSettings: value => ipcRenderer.invoke('studio:save-settings', value),
  getPathForFile: file => webUtils.getPathForFile(file),
  registerMedia: filePath => ipcRenderer.invoke('studio:register-media', filePath),
  chooseAudioFiles: () => ipcRenderer.invoke('studio:choose-audio'),
  chooseImageFile: () => ipcRenderer.invoke('studio:choose-image'),
  saveText: input => ipcRenderer.invoke('studio:save-text', input),
  exportKit: input => ipcRenderer.invoke('studio:export-kit', input),
  exportVideo: input => ipcRenderer.invoke('studio:export-video', input),
  separate: input => ipcRenderer.invoke('studio:separate', input),
});
