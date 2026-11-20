const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:get-settings'),
  getPreferenceDefaults: () => ipcRenderer.invoke('studio:preference-defaults'),
  saveSettings: (value, scope) => ipcRenderer.invoke('studio:save-settings', { value, scope }),
  getModelLibrary: folder => ipcRenderer.invoke('studio:model-library', folder),
  downloadSeparationModel: id => ipcRenderer.invoke('studio:download-model', id),
  chooseUvrModelsFolder: () => ipcRenderer.invoke('studio:choose-models-folder'),
  openModelsFolder: folder => ipcRenderer.invoke('studio:open-models-folder', folder),
  onMenuAction: listener => {
    const onAction = (_event, action) => listener(action);
    ipcRenderer.on('studio:menu-action', onAction);
    return () => ipcRenderer.removeListener('studio:menu-action', onAction);
  },
  updateMenu: state => ipcRenderer.invoke('studio:update-menu', state),
  getSeparatorModels: input => ipcRenderer.invoke('studio:separator-models', input),
  getAlignmentStatus: () => ipcRenderer.invoke('studio:alignment-status'),
  installAlignment: () => ipcRenderer.invoke('studio:install-alignment'),
  onAlignmentProgress: listener => {
    const onProgress = (_event, progress) => listener(progress);
    ipcRenderer.on('studio:alignment-progress', onProgress);
    return () => ipcRenderer.removeListener('studio:alignment-progress', onProgress);
  },
  listIntegrations: () => ipcRenderer.invoke('studio:list-integrations'),
  addIntegration: input => ipcRenderer.invoke('studio:add-integration', input),
  removeIntegration: id => ipcRenderer.invoke('studio:remove-integration', id),
  saveIntegrationKey: input => ipcRenderer.invoke('studio:save-integration-key', input),
  removeIntegrationKey: id => ipcRenderer.invoke('studio:remove-integration-key', id),
  verifyDango: () => ipcRenderer.invoke('studio:verify-dango'),
  verifyIntegration: adapter => ipcRenderer.invoke('studio:verify-integration', adapter),
  openIntegrationWebsite: id => ipcRenderer.invoke('studio:integration-website', id),
  startRecovery: () => ipcRenderer.invoke('studio:recovery-start'),
  updateRecovery: draft => ipcRenderer.invoke('studio:recovery-update', draft),
  listRecovery: () => ipcRenderer.invoke('studio:recovery-list'),
  loadRecovery: id => ipcRenderer.invoke('studio:recovery-load', id),
  discardRecovery: id => ipcRenderer.invoke('studio:recovery-discard', id),
  initialProject: () => ipcRenderer.invoke('studio:initial-project'),
  openProject: () => ipcRenderer.invoke('studio:open-project'),
  saveProject: (project, opened) => ipcRenderer.invoke('studio:save-project', { project, opened }),
  getPathForFile: file => webUtils.getPathForFile(file),
  registerMedia: filePath => ipcRenderer.invoke('studio:register-media', filePath),
  registerBackground: filePath => ipcRenderer.invoke('studio:register-backdrop', filePath),
  readCdg: filePath => ipcRenderer.invoke('studio:read-cdg', filePath),
  exportCdg: input => ipcRenderer.invoke('studio:export-cdg', input),
  chooseAudioFiles: () => ipcRenderer.invoke('studio:choose-audio'),
  armVoiceRecording: () => ipcRenderer.invoke('studio:arm-voice-recording'),
  disarmVoiceRecording: () => ipcRenderer.invoke('studio:disarm-voice-recording'),
  saveVoiceRecording: input => ipcRenderer.invoke('studio:save-voice-recording', input),
  chooseImageFile: () => ipcRenderer.invoke('studio:choose-image'),
  saveText: input => ipcRenderer.invoke('studio:save-text', input),
  exportKit: input => ipcRenderer.invoke('studio:export-kit', input),
  exportVideo: input => ipcRenderer.invoke('studio:export-video', input),
  separate: input => ipcRenderer.invoke('studio:separate', input),
  alignLyrics: input => ipcRenderer.invoke('studio:align-lyrics', input),
});
