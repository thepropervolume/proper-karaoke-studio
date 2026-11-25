const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const { readFileSync, rmSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AUDIO_EXTENSIONS, BACKGROUND_EXTENSIONS, cloudAdapter, text, localFile, readCdg, exportKit, exportVideo, exportCdg, createGifPreview, separate, alignLyrics, prepareAlignmentInput, runCloudAlignment, writeOutput } = require('./studio-operations.cjs');
const { validateVoiceRecording } = require('../domain/voice-recording.ts');
const { loadProject, projectRevision, saveProject } = require('../domain/project-file.mjs');
const { createRecoveryStore } = require('./recovery.cjs');
const { importKit } = require('./kit-import.cjs');
const { serveStudioMedia } = require('./media-protocol.cjs');
const { alignmentRuntimeRoot, alignmentRuntimeStatus, ensureAlignmentRuntime } = require('./alignment-runtime.cjs');
const { alignmentEngines, isCloudAlignmentEngine } = require('../domain/alignment-engines.ts');
const { testCloudAlignmentConnection } = require('./cloud-alignment.cjs');
const { discoverModels } = require('./separator-models.cjs');
const { createIntegrationCatalog } = require('./integration-catalog.cjs');
const { createIntegrationSecrets } = require('./integration-secrets.cjs');
const { checkDangoConnection, normalizeDangoCredentials, separateWithDango } = require('./dango-separator.cjs');
const { createStudioMenu } = require('./studio-menu.cjs');
const { timingContextMenu } = require('./timing-context-menu.cjs');
const { createSessionPreferences } = require('./session-preferences.cjs');
const { createStudioShortcuts, ensureJsonFile } = require('./studio-shortcuts.cjs');
const { bindingFromStudioKey } = require('../domain/studio-shortcuts.ts');
const { createModelLibrary } = require('./model-library.cjs');
const { createFontLibrary, describeLyricFont } = require('./lyric-fonts.cjs');
const { cloudSeparators } = require('./cloud-separators.cjs');
const { createDesktopUpdater } = require('@thepropervolume/karaoke-core/desktop-updates');
const { createStudioUpdates } = require('./studio-updates.cjs');

// Files are served to the renderer through random one-session URLs, never file:// URLs.
protocol.registerSchemesAsPrivileged([{
  scheme: 'studio-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const media = new Map();
const gifPreviews = new Map();
let gifDirectory;
let mainWindow;
let updateStudioMenu;
let shortcuts;
let recordingShortcut = false;
let recovery;
let quitting = false;
let microphoneExpiresAt = 0;
let updates;
let finishingUpdateHandoff = false;
let recoverySavedForQuit = true;
let projectOperations = 0;

function editorUrl() {
  return process.env.VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
}

function isEditorContents(contents, url) {
  if (!contents || !mainWindow || mainWindow.isDestroyed() || contents !== mainWindow.webContents) return false;
  try { return new URL(url || contents.getURL()).href === new URL(editorUrl()).href; }
  catch { return false; }
}

function isEditorFrame(event) {
  return event.senderFrame === event.sender.mainFrame && isEditorContents(event.sender, event.senderFrame?.url);
}

function handleEditor(channel, action) {
  ipcMain.handle(channel, (event, input) => {
    if (!isEditorFrame(event)) throw new Error('Only the Studio editor can perform this action.');
    return action(event, input);
  });
}

function trackProjectOperation(action) {
  return async (...args) => {
    projectOperations++;
    try { return await action(...args); }
    finally { projectOperations--; }
  };
}

function alignmentProgress(event) {
  return progress => {
    if (!event.sender.isDestroyed()) event.sender.send('studio:alignment-progress', progress);
  };
}

function mediaUrl(file) {
  const token = randomUUID();
  media.set(token, file);
  return 'studio-media://' + token + '/' + encodeURIComponent(path.basename(file));
}

async function registerBackdrop(value, ffmpegPath) {
  const file = await localFile(value, BACKGROUND_EXTENSIONS);
  const extension = path.extname(file).toLowerCase();
  if (extension !== '.gif') return { url: mediaUrl(file), motion: extension === '.mp4' };
  const { size, mtimeMs } = await fs.stat(file);
  const fingerprint = file + '\0' + size + '\0' + mtimeMs;
  let preview = gifPreviews.get(fingerprint);
  if (!preview) {
    gifDirectory ??= fs.mkdtemp(path.join(app.getPath('temp'), 'tpv-studio-backdrops-'));
    preview = gifDirectory.then(async directory => {
      const output = path.join(directory, randomUUID() + '.mp4');
      await createGifPreview(file, output, ffmpegPath);
      return output;
    }).catch(error => { gifPreviews.delete(fingerprint); throw error; });
    gifPreviews.set(fingerprint, preview);
  }
  return { url: mediaUrl(await preview), motion: true };
}

function registerIntegrations(directory) {
  const secrets = createIntegrationSecrets({ directory: path.join(directory, 'keys'), safeStorage });
  const catalog = createIntegrationCatalog({ directory, secrets });
  const dangoId = 'dango-ai';
  const dangoCredentials = async () => {
    const saved = await catalog.readKey(dangoId);
    if (!saved) throw new Error('Add your Dango App Key and App Secret in Preferences → Integrations.');
    try { return normalizeDangoCredentials(JSON.parse(saved)); }
    catch { throw new Error('The saved Dango credentials could not be read. Replace them in Preferences → Integrations.'); }
  };

  handleEditor('studio:list-integrations', () => catalog.list());
  handleEditor('studio:add-integration', (_event, input) => catalog.add(input));
  handleEditor('studio:remove-integration', (_event, id) => catalog.remove(id));
  async function credentials(adapter) {
    if (adapter === 'dango') return dangoCredentials();
    if (isCloudAlignmentEngine(adapter)) {
      const key = await catalog.readKey(adapter);
      if (!key) throw new Error('Add your ' + (adapter === 'vultr' ? 'Vultr' : 'AudioShake') + ' API key in Preferences → Integrations.');
      return key;
    }
    if (!Object.hasOwn(cloudSeparators, adapter)) throw new Error('Choose a supported cloud separator.');
    const key = await catalog.readKey(adapter);
    const provider = cloudSeparators[adapter];
    if (!key) throw new Error('Add your ' + provider.name + ' API key in Preferences → Integrations.');
    return provider.normalizeKey(key);
  }

  handleEditor('studio:save-integration-key', (_event, input) => {
    const key = input?.id === dangoId
      ? JSON.stringify(normalizeDangoCredentials({ appKey: input.appKey, appSecret: input.key }))
      : Object.hasOwn(cloudSeparators, input?.id) ? cloudSeparators[input.id].normalizeKey(input.key) : input?.key;
    return catalog.setKey(input?.id, key);
  });
  handleEditor('studio:remove-integration-key', (_event, id) => catalog.removeKey(id));
  handleEditor('studio:verify-dango', async () => checkDangoConnection(await dangoCredentials()));
  handleEditor('studio:verify-integration', async (_event, adapter) => {
    const key = await credentials(adapter);
    if (isCloudAlignmentEngine(adapter)) return testCloudAlignmentConnection(adapter, key);
    return adapter === 'dango' ? checkDangoConnection(key) : cloudSeparators[adapter].verify(key);
  });
  handleEditor('studio:integration-website', async (_event, id) => {
    const entry = (await catalog.list()).find(integration => integration.id === id);
    if (!entry?.website) throw new Error('This integration has no website.');
    await shell.openExternal(entry.website);
  });
  return credentials;
}

function configurePermissions(session) {
  const isArmed = (contents, details) => details?.isMainFrame === true
    && Date.now() < microphoneExpiresAt && isEditorContents(contents, details.requestingUrl);
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === 'media' && details?.mediaType === 'audio' && isArmed(contents, details));
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && details?.mediaTypes?.length === 1
      && details.mediaTypes[0] === 'audio' && isArmed(contents, details));
  });
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function shortcutsPath() { return path.join(app.getPath('userData'), 'keybindings.json'); }

function updateTarget() {
  if (process.platform === 'win32') {
    try {
      if (readFileSync(path.join(process.resourcesPath, 'tpv-studio-install-kind'), 'utf8') === 'nsis') return { kind: 'nsis' };
    } catch { /* The portable ZIP has no installer marker. */ }
    return { kind: 'zip' };
  }
  if (process.platform === 'darwin') return { kind: 'dmg' };
  if (process.platform === 'linux') return process.env.APPIMAGE
    ? { kind: 'appimage', appImage: process.env.APPIMAGE } : { kind: 'deb' };
  return {};
}

function registerUpdates(preferences) {
  const mode = preferences.get().updateMode;
  const target = app.isPackaged ? updateTarget() : {};
  let updater;
  if (target.kind) {
    try {
      updater = createDesktopUpdater({
        product: 'studio', runningVersion: app.getVersion(), cacheDirectory: path.join(app.getPath('userData'), 'updates'),
        mode, preferredKind: target.kind,
      });
    } catch { console.warn('Studio update checks are unavailable.'); }
  }
  updates = createStudioUpdates({
    updater, mode, saveMode: value => preferences.saveUpdateMode(value), canInstallOnQuit: !!updater && target.kind !== 'zip',
    appImage: target.appImage,
    publish: state => {
      if (isEditorContents(mainWindow?.webContents)) mainWindow.webContents.send('studio:update-status-changed', state);
    },
    reveal: file => shell.showItemInFolder(file),
    handoff: async (file, kind) => {
      if (kind !== target.kind || !['nsis', 'dmg', 'deb'].includes(kind) || await shell.openPath(file))
        throw new Error('Studio could not open the verified installer.');
    },
  });
  handleEditor('studio:update-status', () => updates.snapshot());
  handleEditor('studio:update-mode', (_event, value) => updates.setMode(value));
  handleEditor('studio:update-check', () => updates.check(true));
  handleEditor('studio:update-download', () => updates.download());
  handleEditor('studio:update-schedule', () => updates.schedule());
  handleEditor('studio:update-reveal', () => updates.revealDownloaded());
}

function bindStudioShortcuts(window) {
  recordingShortcut = false;
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const binding = bindingFromStudioKey(input);
    // Native menu equivalents would intercept a remapped chord before React can
    // preserve normal text editing or route it to the active timing session.
    const assigned = binding && Object.values(shortcuts.get().value).some(keys => keys.includes(binding));
    window.webContents.setIgnoreMenuShortcuts(recordingShortcut || Boolean(assigned));
  });
  window.on('blur', () => { window.webContents.setIgnoreMenuShortcuts(false); });
}
function brandIcon() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'branding')
    : path.join(__dirname, '..', 'assets', 'branding');
  return path.join(root, process.platform === 'win32' ? 'app.ico' : 'app.png');
}
async function openProject(file) {
  const project = await loadProject(file);
  return { file, project, revision: projectRevision(project) };
}
function createWindow({ checkForUpdates = false } = {}) {
  const recoveryDirectory = path.join(app.getPath('userData'), 'recovery');
  recovery = createRecoveryStore(recoveryDirectory);
  recoverySavedForQuit = true;
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1050, minHeight: 680,
    title: 'The Proper Volume Karaoke Studio', backgroundColor: '#090e18', icon: brandIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const window = mainWindow;
  updateStudioMenu = createStudioMenu(window, brandIcon());
  bindStudioShortcuts(window);
  microphoneExpiresAt = 0;
  configurePermissions(window.webContents.session);
  let closing = false;
  let waitingForRecovery = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (waitingForRecovery) return;
    waitingForRecovery = true;
    void recovery.flush().catch(error => {
      recoverySavedForQuit = false;
      console.error('Could not save the recovery draft:', error);
    }).finally(() => {
      closing = true;
      if (quitting) app.quit();
      else if (!window.isDestroyed()) window.close();
    });
  });
  // Start once, after the initial editor can receive update status.
  if (checkForUpdates) window.webContents.once('did-finish-load', () => {
    if (isEditorContents(window.webContents)) void updates.check();
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
async function chooseSave(defaultPath, name, extension) {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath, filters: [{ name, extensions: [extension] }] });
  return result.canceled ? null : result.filePath;
}
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.thepropervolume.karaokestudio');
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(brandIcon());
  const integrationCredentials = registerIntegrations(path.join(app.getPath('userData'), 'integrations'));
  handleEditor('studio:update-menu', (_event, state) => updateStudioMenu(state ?? {}));
  protocol.handle('studio-media', request => serveStudioMedia(request, media.get(new URL(request.url).hostname)));
  const preferences = createSessionPreferences(settingsPath());
  registerUpdates(preferences);
  shortcuts = createStudioShortcuts(shortcutsPath());
  const publishShortcuts = (event, state) => {
    event.sender.send('studio:shortcuts-changed', state);
    return state;
  };
  handleEditor('studio:get-shortcuts', () => shortcuts.get());
  handleEditor('studio:save-shortcuts', (event, value) => publishShortcuts(event, shortcuts.save(value)));
  handleEditor('studio:reload-shortcuts', event => publishShortcuts(event, shortcuts.reload()));
  handleEditor('studio:record-shortcut', (_event, value) => { recordingShortcut = value === true; });
  handleEditor('studio:configuration-files', () => ({ settings: settingsPath(), shortcuts: shortcutsPath() }));
  handleEditor('studio:reveal-configuration-file', (_event, kind) => {
    if (kind === 'settings') {
      ensureJsonFile(settingsPath(), preferences.defaults().saved);
      shell.showItemInFolder(settingsPath());
    } else if (kind === 'shortcuts') {
      shortcuts.ensureFile();
      shell.showItemInFolder(shortcutsPath());
    } else throw new Error('Choose a Studio configuration file.');
  });
  handleEditor('studio:open-shortcuts-file', async () => {
    shortcuts.ensureFile();
    const failure = await shell.openPath(shortcutsPath());
    if (failure) throw new Error('Studio could not open the keyboard shortcuts file.');
  });
  handleEditor('studio:toggle-full-screen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
  const models = createModelLibrary(path.join(app.getPath('userData'), 'models'));
  const fonts = createFontLibrary(path.join(app.getPath('userData'), 'lyric-fonts'));
  handleEditor('studio:list-lyric-fonts', () => fonts.list());
  handleEditor('studio:add-lyric-font', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Add Lyric Font File', properties: ['openFile'],
      filters: [{ name: 'Font Files', extensions: ['ttf', 'otf'] }] });
    return result.canceled || !result.filePaths[0] ? null : fonts.add(result.filePaths[0]);
  });
  handleEditor('studio:register-lyric-font', async (_event, file) => {
    const font = await describeLyricFont(file);
    return { ...font, url: mediaUrl(font.path) };
  });
  handleEditor('studio:get-settings', () => preferences.get());
  handleEditor('studio:preference-defaults', () => preferences.defaults());
  handleEditor('studio:save-settings', (_event, input) => preferences.save(input?.value, input?.scope));
  handleEditor('studio:model-library', (_event, folder) => models.inventory(folder));
  handleEditor('studio:download-model', (_event, id) => models.download(id));
  handleEditor('studio:choose-models-folder', async (_event, folder) => {
    const defaultPath = typeof folder === 'string' && folder ? await models.directory(folder).catch(() => undefined) : undefined;
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose UVR Installation or Models Folder', defaultPath, properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : models.directory(result.filePaths[0]);
  });
  handleEditor('studio:open-models-folder', async (_event, folder) => {
    const failure = await shell.openPath(await models.directory(folder));
    if (failure) throw new Error('Studio could not open the models folder.');
  });
  handleEditor('studio:separator-models', (_event, input) => discoverModels(input));
  const localAlignmentEngine = (engine = 'whisperx') => {
    if (engine !== 'whisperx' && engine !== 'qwen') throw new Error('Choose a local AI Sync engine.');
    return engine;
  };
  handleEditor('studio:alignment-status', (_event, engine) => alignmentRuntimeStatus(alignmentRuntimeRoot(), localAlignmentEngine(engine)));
  handleEditor('studio:install-alignment', async (event, selected) => {
    const engine = localAlignmentEngine(selected);
    await ensureAlignmentRuntime(alignmentRuntimeRoot(), alignmentProgress(event), engine);
    return alignmentRuntimeStatus(alignmentRuntimeRoot(), engine);
  });
  ipcMain.handle('studio:recovery-start', async () => {
    // A restarted renderer adopts a fresh draft, leaving its prior edits available.
    await recovery.flush().catch(error => console.error('Could not save the previous recovery draft:', error));
    recovery = createRecoveryStore(path.join(app.getPath('userData'), 'recovery'));
    return recovery.list();
  });
  ipcMain.handle('studio:recovery-update', (_event, draft) => recovery.update(draft));
  ipcMain.handle('studio:recovery-list', () => recovery.list());
  ipcMain.handle('studio:recovery-load', (_event, id) => recovery.get(id));
  ipcMain.handle('studio:recovery-discard', (_event, id) => recovery.discard(id));
  ipcMain.handle('studio:initial-project', () => {
    const file = app.commandLine.getSwitchValue('studio-project');
    return file && path.isAbsolute(file) ? openProject(file) : null;
  });
  ipcMain.handle('studio:open-project', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Studio Projects and TPV Kits', extensions: ['json', 'tpvkit'] }],
    });
    const source = selected.filePaths[0];
    if (selected.canceled || !source) return null;
    if (path.extname(source).toLowerCase() !== '.tpvkit') return openProject(source);
    const destination = await chooseSave(path.join(path.dirname(source), path.basename(source, path.extname(source)) + '.tpv.json'), 'New Studio Project', 'json');
    if (!destination) return null;
    const { file, project } = await importKit(source, destination);
    return { file, project, revision: projectRevision(project) };
  });
  ipcMain.handle('studio:save-project', trackProjectOperation(async (_event, { project, opened }) => {
    const file = opened?.file || await chooseSave((String(project.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled') + '.tpv.json', 'Studio Project', 'json');
    if (!file) return null;
    if (opened && (!path.isAbsolute(file) || !/^[a-f0-9]{64}$/.test(opened.revision))) throw new Error('The project needs to be reopened before saving.');
    const saved = await saveProject(file, project, { expectedRevision: opened?.revision });
    return { file, project: saved, revision: projectRevision(saved) };
  }));
  ipcMain.handle('studio:register-media', async (_event, value) => {
    return mediaUrl(await localFile(value, new Set([...AUDIO_EXTENSIONS, ...BACKGROUND_EXTENSIONS])));
  });
  handleEditor('studio:register-backdrop', (_event, file) => registerBackdrop(file, preferences.get().ffmpegPath));
  handleEditor('studio:timing-context-menu', (_event, context) => timingContextMenu(mainWindow, context));
  ipcMain.handle('studio:read-cdg', (_event, value) => readCdg(value));
  ipcMain.handle('studio:export-cdg', trackProjectOperation(async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'CD+G name', 180) + '.cdg', 'CD+G Graphics', 'cdg');
    return destination ? exportCdg(input, destination) : null;
  }));
  ipcMain.handle('studio:choose-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS].map(ext => ext.slice(1)) }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('studio:arm-voice-recording', async event => {
    if (!isEditorFrame(event)) throw new Error('Only the Studio editor can request the microphone.');
    if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone'))) {
      throw new Error('Enable the microphone for Studio in macOS Privacy & Security, then reopen the app.');
    }
    if (!isEditorFrame(event)) throw new Error('The Studio editor has closed.');
    microphoneExpiresAt = Date.now() + 15_000;
  });
  ipcMain.handle('studio:disarm-voice-recording', event => {
    if (isEditorFrame(event)) microphoneExpiresAt = 0;
  });
  ipcMain.handle('studio:save-voice-recording', async (event, input) => {
    if (!isEditorFrame(event)) throw new Error('Only the Studio editor can save a recording.');
    validateVoiceRecording(input?.wav);
    const name = text(input?.name, 'recording name', 150).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Studio recording';
    const destination = await chooseSave(name + '.wav', 'WAV Recording', 'wav');
    if (!destination) return null;
    if (path.extname(destination).toLowerCase() !== '.wav') throw new Error('Choose a WAV filename for the voice recording.');
    try { await writeOutput(destination, false, temporary => fs.writeFile(temporary, input.wav)); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('That file already exists. Choose a new filename to save this take.');
      throw error;
    }
    return destination;
  });
  ipcMain.handle('studio:choose-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose Background Image or Video', properties: ['openFile'],
      filters: [{ name: 'Backdrop Media', extensions: [...BACKGROUND_EXTENSIONS].map(ext => ext.slice(1)) }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('studio:save-text', async (_event, input) => {
    const extension = text(input?.extension, 'file extension', 12).replace(/^\./, '');
    if (!['json', 'lrc', 'srt'].includes(extension)) throw new Error('Unsupported lyrics file format.');
    const content = text(input?.content, 'file contents', 4 * 1024 * 1024);
    const destination = await chooseSave(text(input.name, 'file name', 180) + '.' + extension, extension.toUpperCase(), extension);
    if (!destination) return null;
    await fs.writeFile(destination, content, 'utf8');
    return destination;
  });
  ipcMain.handle('studio:export-kit', trackProjectOperation(async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'kit name', 180) + '.tpvkit', 'TPV Karaoke Kit', 'tpvkit');
    if (!destination) return null;
    return exportKit(input, destination);
  }));
  ipcMain.handle('studio:export-video', trackProjectOperation(async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'video name', 180) + '.mp4', 'MP4 Video', 'mp4');
    if (!destination) return null;
    return exportVideo(input, destination);
  }));
  let separationBusy = false;
  handleEditor('studio:separate', trackProjectOperation(async (event, input) => {
    if (separationBusy) throw new Error('Stem separation is already running.');
    separationBusy = true;
    try {
      const settings = preferences.get();
      const { separatorAdapter: adapter, separatorExecutable: executable, separatorModel: model } = settings;
      const cloud = cloudAdapter(adapter);
      const credentials = cloud ? await integrationCredentials(adapter) : null;
      const source = await localFile(input?.sourcePath, adapter === 'dango' ? new Set(['.wav', '.mp3', '.flac']) : AUDIO_EXTENSIONS);
      const canceled = { files: [], outputDirectory: '' };
      const destination = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a Folder for Separated Stems', properties: ['openDirectory', 'createDirectory'],
      });
      const outputDirectory = destination.filePaths[0];
      if (destination.canceled || !outputDirectory || !isEditorFrame(event)) return canceled;
      if (!cloud) {
        const ensembleModels = adapter === 'audio-separator' ? settings.ensembleModels : [];
        const backingModel = adapter === 'audio-separator' ? settings.backingModel : '';
        const modelDirectory = await models.prepare([model, ...ensembleModels, ...(backingModel ? [backingModel] : [])], settings.uvrModelsPath, adapter);
        return await separate({ sourcePath: source, adapter, executable, model, modelDirectory, ensembleModels, backingModel }, outputDirectory);
      }

      const serviceName = adapter === 'dango' ? 'Dango AI' : cloudSeparators[adapter].name;
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning', buttons: ['Cancel', 'Upload and Separate'], defaultId: 0, cancelId: 0,
        title: serviceName + ' Stem Separation', message: 'Upload ' + path.basename(source) + ' to ' + serviceName + '?',
        detail: serviceName + ' processes the selected audio online. This job may use credits or incur a charge on your account.',
      });
      if (response !== 1 || !isEditorFrame(event)) return canceled;
      const options = { credentials, sourcePath: source, outputDirectory, model };
      return adapter === 'dango'
        ? await separateWithDango({ ...options, modelOptions: model === '31' ? { separateBackingVocals: true } : {} })
        : await cloudSeparators[adapter].separate(options);
    } finally { separationBusy = false; }
  }));
  let alignmentBusy = false;
  handleEditor('studio:align-lyrics', trackProjectOperation(async (event, input) => {
    if (alignmentBusy) throw new Error('AI Sync is already running.');
    alignmentBusy = true;
    try {
      const { alignmentEngine: engine, ffmpegPath } = preferences.get();
      const report = alignmentProgress(event);
      if (isCloudAlignmentEngine(engine)) {
        const request = await prepareAlignmentInput(input, engine);
        const key = await integrationCredentials(engine);
        const service = engine === 'vultr' ? 'Vultr Aligner 1' : 'AudioShake';
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Cancel', 'Upload and Sync'], defaultId: 0, cancelId: 0,
          title: service + ' Lyric Synchronization', message: 'Upload ' + path.basename(request.audioPath) + ' and its lyrics to ' + service + '?',
          detail: 'The service processes the audio and supplied lyric text online. This request may incur a charge on your account.',
        });
        if (response !== 1 || !isEditorFrame(event)) return null;
        report({ phase: 'aligning', message: 'Synchronizing your supplied lyrics with ' + service + '…' });
        return await runCloudAlignment(request, key, ffmpegPath);
      }
      const script = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'scripts', 'align_lyrics.py');
      return await alignLyrics(input, script, async () => {
        const executable = await ensureAlignmentRuntime(alignmentRuntimeRoot(), report, engine);
        report({ phase: 'aligning', message: 'Synchronizing lyrics with ' + alignmentEngines[engine].label + '. The first run downloads the model…' });
        return executable;
      }, engine);
    } finally { alignmentBusy = false; }
  }));
  createWindow({ checkForUpdates: true });
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', event => {
  if (!finishingUpdateHandoff && recoverySavedForQuit && projectOperations === 0 && updates?.canHandoffOnQuit()) {
    event.preventDefault();
    finishingUpdateHandoff = true;
    // Electron has closed the editor and its recovery write has settled.
    // Continue an existing user quit after the verified installer handoff.
    void updates.handoffOnQuit().catch(() => console.error('Studio could not apply the verified update.'))
      .finally(() => app.quit());
    return;
  }
  updates?.cancel();
  void gifDirectory?.then(directory => {
    const parent = path.resolve(app.getPath('temp'));
    if (path.dirname(directory) === parent && path.basename(directory).startsWith('tpv-studio-backdrops-')) {
      try { rmSync(directory, { recursive: true, force: true }); } catch { /* Chromium may still have a frame open. */ }
    }
  }).catch(() => {});
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow(); });
