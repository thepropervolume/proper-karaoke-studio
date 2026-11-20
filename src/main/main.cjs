const { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, text, localFile, readCdg, loadSettings, saveSettings, exportKit, exportVideo, exportCdg, separate, alignLyrics, writeOutput } = require('./studio-operations.cjs');
const { validateVoiceRecording } = require('../domain/voice-recording.ts');
const { loadProject, projectRevision, saveProject } = require('../domain/project-file.mjs');
const { createRecoveryStore } = require('./recovery.cjs');
const { importKit } = require('./kit-import.cjs');
const { serveStudioMedia } = require('./media-protocol.cjs');
const { alignmentRuntimeRoot, alignmentRuntimeStatus, ensureAlignmentRuntime } = require('./alignment-runtime.cjs');
const { discoverModels } = require('./separator-models.cjs');
const { createIntegrationCatalog } = require('./integration-catalog.cjs');
const { createIntegrationSecrets } = require('./integration-secrets.cjs');
const { checkDangoConnection, normalizeDangoCredentials, separateWithDango } = require('./dango-separator.cjs');

// Files are served to the renderer through random one-session URLs, never file:// URLs.
protocol.registerSchemesAsPrivileged([{
  scheme: 'studio-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const media = new Map();
let mainWindow;
let recovery;
let quitting = false;
let microphoneExpiresAt = 0;

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

function alignmentProgress(event) {
  return progress => {
    if (!event.sender.isDestroyed()) event.sender.send('studio:alignment-progress', progress);
  };
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
  handleEditor('studio:save-integration-key', (_event, input) => {
    const key = input?.id === dangoId
      ? JSON.stringify(normalizeDangoCredentials({ appKey: input.appKey, appSecret: input.key }))
      : input?.key;
    return catalog.setKey(input?.id, key);
  });
  handleEditor('studio:remove-integration-key', (_event, id) => catalog.removeKey(id));
  handleEditor('studio:verify-dango', async () => checkDangoConnection(await dangoCredentials()));
  handleEditor('studio:integration-website', async (_event, id) => {
    const entry = (await catalog.list()).find(integration => integration.id === id);
    if (!entry?.website) throw new Error('This integration has no website.');
    await shell.openExternal(entry.website);
  });
  return dangoCredentials;
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
function createWindow() {
  const recoveryDirectory = path.join(app.getPath('userData'), 'recovery');
  recovery = createRecoveryStore(recoveryDirectory);
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1050, minHeight: 680,
    title: 'The Proper Volume Karaoke Studio', backgroundColor: '#090e18', icon: brandIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const window = mainWindow;
  microphoneExpiresAt = 0;
  configurePermissions(window.webContents.session);
  let closing = false;
  let waitingForRecovery = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (waitingForRecovery) return;
    waitingForRecovery = true;
    void recovery.flush().catch(error => console.error('Could not save the recovery draft:', error)).finally(() => {
      closing = true;
      if (quitting) app.quit();
      else if (!window.isDestroyed()) window.close();
    });
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
  const dangoCredentials = registerIntegrations(path.join(app.getPath('userData'), 'integrations'));
  protocol.handle('studio-media', request => serveStudioMedia(request, media.get(new URL(request.url).hostname)));
  ipcMain.handle('studio:get-settings', () => loadSettings(settingsPath()));
  ipcMain.handle('studio:save-settings', (_event, value) => saveSettings(settingsPath(), value));
  handleEditor('studio:separator-models', (_event, input) => discoverModels(input));
  handleEditor('studio:alignment-status', () => alignmentRuntimeStatus(alignmentRuntimeRoot()));
  handleEditor('studio:install-alignment', async event => {
    await ensureAlignmentRuntime(alignmentRuntimeRoot(), alignmentProgress(event));
    return alignmentRuntimeStatus(alignmentRuntimeRoot());
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
  ipcMain.handle('studio:save-project', async (_event, { project, opened }) => {
    const file = opened?.file || await chooseSave((String(project.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '').trim() || 'Untitled') + '.tpv.json', 'Studio Project', 'json');
    if (!file) return null;
    if (opened && (!path.isAbsolute(file) || !/^[a-f0-9]{64}$/.test(opened.revision))) throw new Error('The project needs to be reopened before saving.');
    const saved = await saveProject(file, project, { expectedRevision: opened?.revision });
    return { file, project: saved, revision: projectRevision(saved) };
  });
  ipcMain.handle('studio:register-media', async (_event, value) => {
    const file = await localFile(value, new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]));
    const token = require('node:crypto').randomUUID();
    media.set(token, file);
    return 'studio-media://' + token + '/' + encodeURIComponent(path.basename(file));
  });
  ipcMain.handle('studio:read-cdg', (_event, value) => readCdg(value));
  ipcMain.handle('studio:export-cdg', async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'CD+G name', 180) + '.cdg', 'CD+G Graphics', 'cdg');
    return destination ? exportCdg(input, destination) : null;
  });
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
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Image', extensions: [...IMAGE_EXTENSIONS].map(ext => ext.slice(1)) }] });
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
  ipcMain.handle('studio:export-kit', async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'kit name', 180) + '.tpvkit', 'TPV Karaoke Kit', 'tpvkit');
    if (!destination) return null;
    return exportKit(input, destination);
  });
  ipcMain.handle('studio:export-video', async (_event, input) => {
    const destination = await chooseSave(text(input.name, 'video name', 180) + '.mp4', 'MP4 Video', 'mp4');
    if (!destination) return null;
    return exportVideo(input, destination);
  });
  let separationBusy = false;
  handleEditor('studio:separate', async (event, input) => {
    if (separationBusy) throw new Error('Stem separation is already running.');
    separationBusy = true;
    try {
      const cloud = input?.adapter === 'dango';
      const credentials = cloud ? await dangoCredentials() : null;
      const source = await localFile(input?.sourcePath, cloud ? new Set(['.wav', '.mp3', '.flac']) : AUDIO_EXTENSIONS);
      const canceled = { files: [], outputDirectory: '' };
      const destination = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a Folder for Separated Stems', properties: ['openDirectory', 'createDirectory'],
      });
      const outputDirectory = destination.filePaths[0];
      if (destination.canceled || !outputDirectory || !isEditorFrame(event)) return canceled;
      if (!credentials) return await separate({ ...input, sourcePath: source }, outputDirectory);

      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning', buttons: ['Cancel', 'Upload and Separate'], defaultId: 0, cancelId: 0,
        title: 'Dango AI Stem Separation', message: 'Upload ' + path.basename(source) + ' to Dango AI?',
        detail: 'Dango processes the selected audio in the cloud. This job may use credits in your Dango account.',
      });
      if (response !== 1 || !isEditorFrame(event)) return canceled;
      return await separateWithDango({ credentials, sourcePath: source, outputDirectory, model: input.model });
    } finally { separationBusy = false; }
  });
  handleEditor('studio:align-lyrics', (event, input) => {
    const script = app.isPackaged
      ? path.join(process.resourcesPath, 'scripts', 'align_lyrics.py')
      : path.join(app.getAppPath(), 'scripts', 'align_lyrics.py');
    const report = alignmentProgress(event);
    return alignLyrics(input, script, async () => {
      const executable = await ensureAlignmentRuntime(alignmentRuntimeRoot(), report);
      report({ phase: 'aligning', message: 'Synchronizing lyrics locally. The first run downloads the language model…' });
      return executable;
    });
  });
  createWindow();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
