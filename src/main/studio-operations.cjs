const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { constants, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { CdgPlayer, cdgByteLimit, cdgHeight, cdgPacketBytes, cdgWidth } = require('../domain/cdg.ts');
const { CdgEncoder, cdgExportFrameRate, cdgRgbFrameBytes } = require('../domain/cdg-encode.ts');
const { alignmentLanguages, separatorModels } = require('../domain/studio-options.json');

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.wma']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const separationDefaults = {
  'audio-separator': { executable: 'audio-separator', model: 'UVR-MDX-NET-Inst_HQ_3.onnx' },
  demucs: { executable: 'demucs', model: 'htdemucs' },
  dango: { executable: '', model: '29' },
};
const defaultSettings = { ffmpegPath: 'ffmpeg', separatorAdapter: 'audio-separator', separatorExecutable: 'audio-separator', separatorModel: 'UVR-MDX-NET-Inst_HQ_3.onnx', lyricAlignerExecutable: '', alignmentLanguage: 'en' };

function supportedAlignmentLanguage(value) {
  const base = typeof value === 'string' ? value.trim().toLowerCase().split('-')[0] : '';
  return alignmentLanguages.includes(base) ? base : '';
}

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

async function readCdg(value) {
  const file = await localFile(value, new Set(['.cdg']));
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (!size || size > cdgByteLimit || size % cdgPacketBytes !== 0) {
      throw new Error('Choose a CD+G file with complete 24-byte packets and no more than one hour of graphics.');
    }
    // Read at most the checked size plus one byte, even if the file changes.
    const data = Buffer.alloc(size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== size) throw new Error('The CD+G file changed while it was open. Try again.');
    const bytes = new Uint8Array(data.buffer, data.byteOffset, size);
    new CdgPlayer(bytes);
    return bytes;
  } finally { await handle.close(); }
}
function loadSettings(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    const separatorAdapter = Object.hasOwn(separationDefaults, value.separatorAdapter) ? value.separatorAdapter : defaultSettings.separatorAdapter;
    return {
      ffmpegPath: typeof value.ffmpegPath === 'string' ? value.ffmpegPath : defaultSettings.ffmpegPath,
      separatorAdapter,
      separatorExecutable: typeof value.separatorExecutable === 'string' ? value.separatorExecutable : separationDefaults[separatorAdapter].executable,
      separatorModel: typeof value.separatorModel === 'string' ? value.separatorModel : separationDefaults[separatorAdapter].model,
      lyricAlignerExecutable: typeof value.lyricAlignerExecutable === 'string' ? value.lyricAlignerExecutable : defaultSettings.lyricAlignerExecutable,
      alignmentLanguage: supportedAlignmentLanguage(value.alignmentLanguage) || defaultSettings.alignmentLanguage,
    };
  } catch { return { ...defaultSettings }; }
}
function saveSettings(file, value) {
  const separatorAdapter = value?.separatorAdapter ?? defaultSettings.separatorAdapter;
  if (!Object.hasOwn(separationDefaults, separatorAdapter)) throw new Error('Choose a supported stem separator.');
  const result = {
    ffmpegPath: text(value?.ffmpegPath, 'FFmpeg executable', 4096).trim() || 'ffmpeg',
    separatorAdapter,
    separatorExecutable: text(value?.separatorExecutable, 'separator executable', 4096).trim() || separationDefaults[separatorAdapter].executable,
    separatorModel: text(value?.separatorModel, 'model name', 160).trim() || separationDefaults[separatorAdapter].model,
    lyricAlignerExecutable: text(value?.lyricAlignerExecutable, 'Python executable', 4096).trim() || defaultSettings.lyricAlignerExecutable,
    alignmentLanguage: text(value?.alignmentLanguage, 'alignment language', 16).trim() || 'en',
  };
  if (!/^(?!\.{1,2}$)[\w.-]+$/.test(result.separatorModel)) throw new Error('Model names may contain letters, digits, dots, underscores, and hyphens.');
  if (separatorAdapter === 'dango' && !separatorModels.dango.some(model => model.id === result.separatorModel)) throw new Error('Choose an available Dango model.');
  result.alignmentLanguage = supportedAlignmentLanguage(result.alignmentLanguage);
  if (!result.alignmentLanguage) throw new Error('Choose a language supported by AI Sync.');
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return result;
}

function runTool(executable, args, label, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => reject(new Error('Could not start ' + label + ' (' + error.message + '). Check its executable in Preferences.')));
    child.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
}

async function spawnTool(executable, args, label, options) {
  const result = await runTool(executable, args, label, options);
  if (result.code !== 0) throw new Error(label + ' failed (' + (result.signal || result.code) + '): ' + result.stderr.slice(-2400));
}

async function probeAudio(file, ffmpegPath = defaultSettings.ffmpegPath) {
  const source = await localFile(file, AUDIO_EXTENSIONS);
  const { code, stderr } = await runTool(ffmpegPath, [
    '-hide_banner', '-nostdin', '-i', source, '-map', '0:a:0', '-c:a', 'copy', '-t', '0', '-f', 'null', '-',
  ], 'FFmpeg');
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (code !== 0 || !duration) throw new Error('Could not read the audio duration for ' + path.basename(file) + '. Check FFmpeg or provide --duration.');
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  if (seconds <= 0) throw new Error('The audio has no readable duration. Provide --duration.');
  return seconds;
}

// Finish writing next to the destination before publishing the result.
async function writeOutput(destination, overwrite, write) {
  const temporaryDirectory = await fs.mkdtemp(path.join(path.dirname(destination), '.tpv-export-'));
  const temporaryFile = path.join(temporaryDirectory, path.basename(destination));
  try {
    await write(temporaryFile);
    if (overwrite) await fs.rename(temporaryFile, destination);
    else {
      try {
        await fs.link(temporaryFile, destination);
      } catch (error) {
        if (!['ENOTSUP', 'EPERM', 'EOPNOTSUPP'].includes(error.code)) throw error;
        await fs.copyFile(temporaryFile, destination, constants.COPYFILE_EXCL);
      }
    }
    return destination;
  } finally { await fs.rm(temporaryDirectory, { recursive: true, force: true }); }
}

async function rasterizeCdg(ass, duration, ffmpeg) {
  const encoder = new CdgEncoder(duration);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tpv-studio-cdg-'));
  try {
    await fs.writeFile(path.join(directory, 'lyrics.ass'), text(ass, 'subtitle data', 8 * 1024 * 1024), 'utf8');
    const executable = /[\\/]/.test(ffmpeg) ? path.resolve(ffmpeg) : ffmpeg;
    const child = spawn(executable, [
      '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=' + cdgWidth + 'x' + cdgHeight + ':r=' + cdgExportFrameRate + ':d=' + duration,
      '-vf', 'subtitles=filename=lyrics.ass', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo', 'pipe:1',
    ], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', startupError;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2400); });
    child.once('error', error => { startupError = error; });
    const completion = new Promise(resolve => child.once('close', resolve));
    const frame = Buffer.alloc(cdgRgbFrameBytes);
    let length = 0;
    try {
      for await (const chunk of child.stdout) {
        let offset = 0;
        while (offset < chunk.length) {
          const count = Math.min(frame.length - length, chunk.length - offset);
          chunk.copy(frame, length, offset, offset + count);
          offset += count;
          length += count;
          if (length === frame.length) {
            encoder.pushFrame(frame);
            length = 0;
          }
        }
      }
    } catch (error) {
      child.kill();
      await completion;
      throw error;
    }
    const code = await completion;
    if (startupError) throw new Error('Could not start FFmpeg for CD+G export. Check its executable in Preferences.');
    if (code !== 0 || length) throw new Error('FFmpeg could not render the CD+G lyrics. ' + stderr.trim());
    return encoder.finish();
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function exportCdg(input, destination, overwrite = true) {
  const bytes = input.cdgPath ? await readCdg(input.cdgPath)
    : await rasterizeCdg(input.ass, input.duration, text(input.ffmpegPath, 'FFmpeg executable', 4096).trim() || 'ffmpeg');
  return writeOutput(destination, overwrite, file => fs.writeFile(file, bytes));
}

async function exportKit(input, destination, overwrite = true) {
  if (!input || !Array.isArray(input.stems) || input.stems.length > 24 || !input.lyrics || typeof input.lyrics !== 'object') throw new Error('Invalid TPV kit project.');
  const manifest = text(input.manifest, 'kit manifest', 2 * 1024 * 1024);
  const stems = [];
  for (const stem of input.stems) stems.push({ path: await localFile(stem.path, AUDIO_EXTENSIONS), name: text(stem.name, 'stem name', 300) });
  const cdg = input.cdgPath ? await localFile(input.cdgPath, new Set(['.cdg'])) : null;
  const lyricEntries = Object.entries(input.lyrics);
  if (lyricEntries.some(([name]) => !['lyrics.json', 'lyrics.enhanced.lrc', 'lyrics.srt'].includes(name))) throw new Error('Unexpected kit lyrics file.');
  return writeOutput(destination, overwrite, async temporaryFile => {
    const zip = new yazl.ZipFile();
    zip.on('error', error => zip.outputStream.destroy(error));
    zip.addBuffer(Buffer.from(manifest), 'manifest.json');
    for (const [name, contents] of lyricEntries) zip.addBuffer(Buffer.from(text(contents, 'kit lyrics', 4 * 1024 * 1024)), 'lyrics/' + name);
    stems.forEach((stem, index) => {
      const filename = path.basename(stem.path).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 140) || 'stem.wav';
      zip.addFile(stem.path, 'stems/' + String(index + 1).padStart(2, '0') + '-' + filename);
    });
    if (cdg) zip.addFile(cdg, 'source/' + path.basename(cdg).replace(/[^\p{L}\p{N}._ -]/gu, '_'));
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(temporaryFile));
  });
}

async function exportVideo(input, destination, overwrite = true) {
  if (!input || !Array.isArray(input.stems) || !input.stems.length || input.stems.length > 24) throw new Error('Add at least one audio stem before exporting a video.');
  const duration = Number(input.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('The project duration is invalid.');
  const ffmpeg = text(input.ffmpegPath, 'FFmpeg executable', 4096).trim() || 'ffmpeg';
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpv-studio-'));
  const assPath = path.join(tempDir, 'lyrics.ass');
  try {
    const args = ['-y', '-nostdin'];
    if (input.cdgPath) {
      const graphics = path.join(tempDir, 'lyrics.cdg');
      const bytes = await readCdg(input.cdgPath);
      if ((bytes[0] & 63) !== 9) {
        // FFmpeg emits frames only for graphics packets. Start with an unchanged
        // frame when the original stream opens with an empty or non-CDG packet.
        bytes.fill(0, 0, cdgPacketBytes);
        bytes[0] = 9;
      }
      await fs.writeFile(graphics, bytes);
      args.push('-protocol_whitelist', 'file,pipe', '-f', 'cdg', '-i', graphics);
    } else {
      await fs.writeFile(assPath, text(input.ass, 'subtitle data', 8 * 1024 * 1024), 'utf8');
      if (input.backgroundPath) args.push('-loop', '1', '-framerate', '30', '-i', await localFile(input.backgroundPath, IMAGE_EXTENSIONS));
      else args.push('-f', 'lavfi', '-i', 'color=c=0x171226:s=1920x1080:r=30:d=' + duration);
    }
    const stems = [];
    for (const stem of input.stems) {
      const file = await localFile(stem.path, AUDIO_EXTENSIONS);
      args.push('-i', file);
      stems.push({ volume: Math.max(0, Math.min(2, Number(stem.volume) || 0)) });
    }
    const filters = [input.cdgPath
      ? '[0:v]fps=30:start_time=0,format=yuv420p,scale=1500:1080:flags=neighbor,pad=1920:1080:210:0,setsar=1,tpad=stop_mode=clone:stop_duration=' + duration + '[v]'
      : '[0:v]subtitles=filename=lyrics.ass[v]'];
    stems.forEach((stem, index) => filters.push('[' + (index + 1) + ':a]volume=' + stem.volume + '[a' + index + ']'));
    filters.push(stems.map((_stem, index) => '[a' + index + ']').join('') + 'amix=inputs=' + stems.length + ':normalize=0:duration=longest,alimiter=limit=0.95[mix]');
    args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[mix]', '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-metadata', 'title=' + text(input.title, 'song title', 300),
      '-metadata', 'artist=' + text(input.artist, 'song artist', 300), '-f', 'mp4');
    const executable = /[\\/]/.test(ffmpeg) ? path.resolve(ffmpeg) : ffmpeg;
    return await writeOutput(destination, overwrite, temporaryFile => spawnTool(executable, [...args, temporaryFile], 'FFmpeg', { cwd: tempDir }));
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}

async function separate(input, directory) {
  const source = await localFile(input?.sourcePath, AUDIO_EXTENSIONS);
  const adapter = input.adapter ?? defaultSettings.separatorAdapter;
  if (adapter !== 'audio-separator' && adapter !== 'demucs') throw new Error('Choose Audio Separator or Demucs for local separation.');
  const executable = text(input.executable ?? separationDefaults[adapter].executable, 'separator executable', 4096).trim();
  const model = text(input.model ?? separationDefaults[adapter].model, 'model name', 160).trim();
  if (!executable || model === '.' || model === '..' || !/^[\w.-]+$/.test(model)) throw new Error('Configure a valid executable and model name in Preferences.');
  const outputDirectory = await fs.mkdtemp(path.join(directory, 'tpv-separated-'));
  const demucs = adapter === 'demucs';
  if (demucs) await spawnTool(executable, ['--name', model, '--out', outputDirectory, source], 'Demucs');
  else await spawnTool(executable, [source, '--model_filename', model, '--output_dir', outputDirectory], 'Audio Separator');
  const stemDirectory = demucs ? path.join(outputDirectory, model, path.parse(source).name) : outputDirectory;
  const entries = await fs.readdir(stemDirectory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = entries.filter(item => item.isFile() && AUDIO_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
    .map(item => path.join(stemDirectory, item.name)).sort();
  if (!files.length) throw new Error('Separation completed but produced no supported audio files.');
  return { files, outputDirectory };
}

async function alignLyrics(input, scriptPath, prepareExecutable) {
  const language = supportedAlignmentLanguage(text(input?.language, 'alignment language', 16));
  const lyrics = input?.lyrics;
  if (!language) throw new Error('Choose a language supported by AI Sync.');
  if (!Array.isArray(lyrics) || !lyrics.length || lyrics.length > 500 || lyrics.some(line => typeof line !== 'string' || line.length > 2000) || Buffer.byteLength(JSON.stringify(lyrics)) > 256 * 1024) throw new Error('Provide up to 500 lyric lines (maximum 256 KB total).');
  const source = await localFile(input?.audioPath, AUDIO_EXTENSIONS);
  const executable = text(prepareExecutable ? await prepareExecutable() : input?.executable, 'AI Sync runtime', 4096).trim();
  if (!executable) throw new Error('The AI Sync runtime is unavailable.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpv-align-'));
  const inputPath = path.join(tempDir, 'lyrics.json'), outputPath = path.join(tempDir, 'aligned.json');
  try {
    await fs.writeFile(inputPath, JSON.stringify({ lyrics }), 'utf8');
    await spawnTool(executable, [scriptPath, '--audio', source, '--input', inputPath, '--output', outputPath, '--language', language], 'WhisperX lyric alignment');
    const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    if (!Number.isFinite(result.duration) || !Array.isArray(result.words) || result.words.length > 10000) throw new Error('The alignment tool returned an invalid result.');
    return result;
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}

module.exports = { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, defaultSettings, separationDefaults, text, localFile, readCdg, loadSettings, saveSettings, exportKit, exportVideo, exportCdg, separate, alignLyrics, probeAudio, writeOutput };
