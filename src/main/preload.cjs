const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:get-settings'),
  getUpdateStatus: () => ipcRenderer.invoke('studio:update-status'),
  setUpdateMode: mode => ipcRenderer.invoke('studio:update-mode', mode),
  checkForUpdate: () => ipcRenderer.invoke('studio:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('studio:update-download'),
  scheduleUpdate: () => ipcRenderer.invoke('studio:update-schedule'),
  revealUpdate: () => ipcRenderer.invoke('studio:update-reveal'),
  onUpdateStatus: listener => {
    const receive = (_event, value) => listener(value);
    ipcRenderer.on('studio:update-status-changed', receive);
    return () => ipcRenderer.removeListener('studio:update-status-changed', receive);
  },
  getStudioShortcuts: () => ipcRenderer.invoke('studio:get-shortcuts'),
  saveStudioShortcuts: value => ipcRenderer.invoke('studio:save-shortcuts', value),
  reloadStudioShortcuts: () => ipcRenderer.invoke('studio:reload-shortcuts'),
  onStudioShortcutsChanged: listener => {
    const onChange = (_event, value) => listener(value);
    ipcRenderer.on('studio:shortcuts-changed', onChange);
    return () => ipcRenderer.removeListener('studio:shortcuts-changed', onChange);
  },
  setStudioShortcutRecording: recording => ipcRenderer.invoke('studio:record-shortcut', recording),
  getConfigurationFiles: () => ipcRenderer.invoke('studio:configuration-files'),
  revealConfigurationFile: kind => ipcRenderer.invoke('studio:reveal-configuration-file', kind),
  openStudioShortcutsFile: () => ipcRenderer.invoke('studio:open-shortcuts-file'),
  toggleFullScreen: () => ipcRenderer.invoke('studio:toggle-full-screen'),
  getPreferenceDefaults: () => ipcRenderer.invoke('studio:preference-defaults'),
  saveSettings: (value, scope) => ipcRenderer.invoke('studio:save-settings', { value, scope }),
  getModelLibrary: folder => ipcRenderer.invoke('studio:model-library', folder),
  downloadSeparationModel: id => ipcRenderer.invoke('studio:download-model', id),
  chooseUvrModelsFolder: folder => ipcRenderer.invoke('studio:choose-models-folder', folder),
  openModelsFolder: folder => ipcRenderer.invoke('studio:open-models-folder', folder),
  onMenuAction: listener => {
    const onAction = (_event, action) => listener(action);
    ipcRenderer.on('studio:menu-action', onAction);
    return () => ipcRenderer.removeListener('studio:menu-action', onAction);
  },
  updateMenu: state => ipcRenderer.invoke('studio:update-menu', state),
  getSeparatorModels: input => ipcRenderer.invoke('studio:separator-models', input),
  getAlignmentStatus: engine => ipcRenderer.invoke('studio:alignment-status', engine),
  installAlignment: engine => ipcRenderer.invoke('studio:install-alignment', engine),
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
  verifyIntegration: provider => ipcRenderer.invoke('studio:verify-integration', provider),
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
  listLyricFonts: () => ipcRenderer.invoke('studio:list-lyric-fonts'),
  addLyricFont: () => ipcRenderer.invoke('studio:add-lyric-font'),
  registerLyricFont: filePath => ipcRenderer.invoke('studio:register-lyric-font', filePath),
  readCdg: filePath => ipcRenderer.invoke('studio:read-cdg', filePath),
  exportCdg: input => ipcRenderer.invoke('studio:export-cdg', input),
  chooseAudioFiles: () => ipcRenderer.invoke('studio:choose-audio'),
  armVoiceRecording: () => ipcRenderer.invoke('studio:arm-voice-recording'),
  disarmVoiceRecording: () => ipcRenderer.invoke('studio:disarm-voice-recording'),
  saveVoiceRecording: input => ipcRenderer.invoke('studio:save-voice-recording', input),
  chooseImageFile: () => ipcRenderer.invoke('studio:choose-image'),
  saveText: input => ipcRenderer.invoke('studio:save-text', input),
  timingContextMenu: context => ipcRenderer.invoke('studio:timing-context-menu', context),
  exportKit: input => ipcRenderer.invoke('studio:export-kit', input),
  exportVideo: input => ipcRenderer.invoke('studio:export-video', input),
  separate: input => ipcRenderer.invoke('studio:separate', input),
  alignLyrics: input => ipcRenderer.invoke('studio:align-lyrics', input),
});
