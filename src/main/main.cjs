const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { once } = require('node:events');
const yazl = require('yazl');

// Files are served to the renderer through random one-session URLs, never file:// URLs.
protocol.registerSchemesAsPrivileged([{
  scheme: 'studio-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const media = new Map();
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.wma']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const defaultSettings = { ffmpegPath: 'ffmpeg', separatorExecutable: 'audio-separator', separatorModel: 'UVR-MDX-NET-Inst_HQ_3.onnx' };
let mainWindow;

function text(input, field, max = 500) {
  if (typeof input !== 'string' || input.length > max) throw new Error('Invalid ' + field + '.');
  return input;
}
async function localFile(value, extensions) {
  const supplied = text(value, 'file path', 8192);
  if (!path.isAbsolute(supplied)) throw new Error('An absolute local file path is required.');
  const file = path.resolve(supplied), info = await fs.stat(file);
  if (!info.isFile() || info.size === 0) throw new Error('The selected file is empty or unavailable.');
  if (extensions && !extensions.has(path.extname(file).toLowerCase())) throw new Error('The selected file type is not supported.');
  return file;
}
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try {
    const value = JSON.parse(require('node:fs').readFileSync(settingsPath(), 'utf8'));
    return {
      ffmpegPath: typeof value.ffmpegPath === 'string' ? value.ffmpegPath : defaultSettings.ffmpegPath,
      separatorExecutable: typeof value.separatorExecutable === 'string' ? value.separatorExecutable : defaultSettings.separatorExecutable,
      separatorModel: typeof value.separatorModel === 'string' ? value.separatorModel : defaultSettings.separatorModel,
    };
  } catch { return { ...defaultSettings }; }
}
function saveSettings(value) {
  const result = {
    ffmpegPath: text(value?.ffmpegPath, 'FFmpeg executable', 4096).trim() || 'ffmpeg',
    separatorExecutable: text(value?.separatorExecutable, 'separator executable', 4096).trim() || 'audio-separator',
    separatorModel: text(value?.separatorModel, 'model name', 160).trim(),
  };
  if (!/^[\w.-]+$/.test(result.separatorModel)) throw new Error('Model names may contain letters, digits, dots, underscores, and hyphens.');
  require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true });
  require('node:fs').writeFileSync(settingsPath(), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1050, minHeight: 680,
    title: 'The Proper Volume Karaoke Studio', backgroundColor: '#171226',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
async function chooseSave(defaultPath, name, extension) {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath, filters: [{ name, extensions: [extension] }] });
  return result.canceled ? null : result.filePath;
}
function spawnTool(executable, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => reject(new Error('Could not start ' + label + ' (' + error.message + '). Check its executable in Preferences.')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(label + ' failed with exit code ' + code + ': ' + stderr.slice(-2400))));
  });
}

app.whenReady().then(() => {
  protocol.handle('studio-media', request => {
    const filePath = media.get(new URL(request.url).hostname);
    if (!filePath) return new Response('Not found', { status: 404 });
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
      '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff',
      '.wma': 'audio/x-ms-wma', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    }[ext] || 'application/octet-stream';
    return new Response(Readable.toWeb(require('node:fs').createReadStream(filePath)), {
      headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
    });
  });
  ipcMain.handle('studio:get-settings', () => loadSettings());
  ipcMain.handle('studio:save-settings', (_event, value) => saveSettings(value));
  ipcMain.handle('studio:register-media', async (_event, value) => {
    const file = await localFile(value, new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]));
    const token = require('node:crypto').randomUUID();
    media.set(token, file);
    return 'studio-media://' + token + '/' + encodeURIComponent(path.basename(file));
  });
  ipcMain.handle('studio:choose-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS].map(ext => ext.slice(1)) }] });
    return result.canceled ? [] : result.filePaths;
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
    if (!input || !Array.isArray(input.stems) || input.stems.length > 24 || !input.lyrics || typeof input.lyrics !== 'object') throw new Error('Invalid TPV kit project.');
    const manifest = text(input.manifest, 'kit manifest', 2 * 1024 * 1024);
    const stems = [];
    for (const stem of input.stems) stems.push({ path: await localFile(stem.path, AUDIO_EXTENSIONS), name: text(stem.name, 'stem name', 300) });
    const cdg = input.cdgPath ? await localFile(input.cdgPath, new Set(['.cdg'])) : null;
    const lyricEntries = Object.entries(input.lyrics);
    if (lyricEntries.some(([name]) => !['lyrics.json', 'lyrics.enhanced.lrc', 'lyrics.srt'].includes(name))) throw new Error('Unexpected kit lyrics file.');
    const destination = await chooseSave(text(input.name, 'kit name', 180) + '.tpvkit', 'TPV Karaoke Kit', 'tpvkit');
    if (!destination) return null;
    const zip = new yazl.ZipFile(), output = createWriteStream(destination);
    zip.outputStream.pipe(output);
    zip.addBuffer(Buffer.from(manifest), 'manifest.json');
    for (const [name, contents] of lyricEntries) zip.addBuffer(Buffer.from(text(contents, 'kit lyrics', 4 * 1024 * 1024)), 'lyrics/' + name);
    stems.forEach((stem, index) => {
      const filename = path.basename(stem.path).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 140) || 'stem.wav';
      zip.addFile(stem.path, 'stems/' + String(index + 1).padStart(2, '0') + '-' + filename);
    });
    if (cdg) zip.addFile(cdg, 'source/' + path.basename(cdg).replace(/[^\p{L}\p{N}._ -]/gu, '_'));
    zip.end();
    await once(output, 'close');
    return destination;
  });
  ipcMain.handle('studio:export-video', async (_event, input) => {
    if (!input || !Array.isArray(input.stems) || !input.stems.length || input.stems.length > 24) throw new Error('Add at least one audio stem before exporting a video.');
    const duration = Number(input.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('The project duration is invalid.');
    const ffmpeg = text(input.ffmpegPath, 'FFmpeg executable', 4096).trim() || 'ffmpeg';
    const destination = await chooseSave(text(input.name, 'video name', 180) + '.mp4', 'MP4 Video', 'mp4');
    if (!destination) return null;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpv-studio-'));
    const assPath = path.join(tempDir, 'lyrics.ass');
    try {
      await fs.writeFile(assPath, text(input.ass, 'subtitle data', 8 * 1024 * 1024), 'utf8');
      const args = ['-y'];
      if (input.backgroundPath) args.push('-loop', '1', '-framerate', '30', '-i', await localFile(input.backgroundPath, IMAGE_EXTENSIONS));
      else args.push('-f', 'lavfi', '-i', 'color=c=0x171226:s=1920x1080:r=30:d=' + duration);
      const stems = [];
      for (const stem of input.stems) {
        const file = await localFile(stem.path, AUDIO_EXTENSIONS);
        args.push('-i', file);
        stems.push({ volume: Math.max(0, Math.min(2, Number(stem.volume) || 0)) });
      }
      const subtitlePath = assPath.replace(/\\/g, '/').replace(':', '\\:').replace(/'/g, "\\'");
      const filters = ["[0:v]subtitles=filename='" + subtitlePath + "'[v]"];
      stems.forEach((stem, index) => filters.push('[' + (index + 1) + ':a]volume=' + stem.volume + '[a' + index + ']'));
      filters.push(stems.map((_stem, index) => '[a' + index + ']').join('') + 'amix=inputs=' + stems.length + ':normalize=0:duration=longest,alimiter=limit=0.95[mix]');
      args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[mix]', '-t', String(duration),
        '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', '-metadata', 'title=' + text(input.title, 'song title', 300),
        '-metadata', 'artist=' + text(input.artist, 'song artist', 300), destination);
      await spawnTool(ffmpeg, args, 'FFmpeg');
      return destination;
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });
  ipcMain.handle('studio:separate', async (_event, input) => {
    const source = await localFile(input?.sourcePath, AUDIO_EXTENSIONS);
    const executable = text(input?.executable, 'separator executable', 4096).trim();
    const model = text(input?.model, 'separator model', 160).trim();
    if (!executable || !/^[\w.-]+$/.test(model)) throw new Error('Configure a valid executable and model name in Preferences.');
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return { files: [], outputDirectory: '' };
    const outputDirectory = await fs.mkdtemp(path.join(selected.filePaths[0], 'tpv-separated-'));
    await spawnTool(executable, [source, '--model_filename', model, '--output_dir', outputDirectory], 'Audio Separator');
    const entries = await fs.readdir(outputDirectory, { withFileTypes: true });
    const files = entries.filter(item => item.isFile() && AUDIO_EXTENSIONS.has(path.extname(item.name).toLowerCase())).map(item => path.join(outputDirectory, item.name));
    if (!files.length) throw new Error('Separation completed but produced no supported audio files.');
    return { files, outputDirectory };
  });
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
