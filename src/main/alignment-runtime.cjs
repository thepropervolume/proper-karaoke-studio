const { spawn, execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const yauzl = require('yauzl');

const uvVersion = '0.13.7';
const pythonVersion = '3.13.17';
const whisperxVersion = '3.7.9';
const runtimeName = 'alignment-runtime-cpu-v1';
const releaseBase = 'https://releases.astral.sh/github/uv/releases/download/';
const maximumArchiveBytes = 60 * 1024 * 1024;
const installerDownloadMs = 10 * 60 * 1000;
const maximumStepMs = 30 * 60 * 1000;
const installations = new Map();
const uvAssets = {
  'win32:x64': ['x86_64-pc-windows-msvc', 'zip', '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021'],
  'linux:x64': ['x86_64-unknown-linux-gnu', 'tar.gz', 'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83'],
  'darwin:arm64': ['aarch64-apple-darwin', 'tar.gz', '81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731'],
};
const audioEngineDependencies = ['torch==2.8.0', 'torchaudio==2.8.0'];
const managedDependencies = ['whisperx==' + whisperxVersion, 'faster-whisper==1.2.1', 'av==19.0.2'];
const packageRegistry = 'https://pypi.org/simple';
const cpuRegistry = 'https://download.pytorch.org/whl/cpu';
const openZip = promisify(yauzl.open);

function alignmentRuntimeRoot() {
  const home = homedir();
  const data = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(data, 'tpv-karaoke-studio');
}

function runtimePaths(root) {
  const directory = path.resolve(root, runtimeName);
  const environment = path.join(directory, 'venv');
  return {
    directory,
    environment,
    python: path.join(environment, ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python3'])),
    uv: path.join(directory, process.platform === 'win32' ? 'uv.exe' : 'uv'),
    marker: path.join(directory, 'ready.json'),
    lock: path.join(directory, 'install.lock'),
  };
}

function setupEnvironment(directory) {
  // Explicit paths keep both Python and uv out of global PATH and shell configuration.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(UV_|PIP_|PYTHON|VIRTUAL_ENV$|CONDA_PREFIX$)/i.test(key)));
  return {
    ...inherited,
    UV_CACHE_DIR: path.join(directory, 'package-cache'),
    UV_PYTHON_INSTALL_DIR: path.join(directory, 'python'),
    UV_PYTHON_BIN_DIR: path.join(directory, 'bin'),
    UV_NO_PROGRESS: '1',
    UV_NO_MODIFY_PATH: '1',
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1',
  };
}

function unsupportedMessage() {
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'Automatic lyric setup needs PyTorch wheels that are unavailable for Intel Mac. Use Studio on Apple silicon, Windows x64, or Linux x64 for managed alignment.';
  }
  return 'Automatic lyric setup is available on Windows x64, Linux x64, and Apple silicon Mac.';
}

async function isReady(paths) {
  try {
    const checked = JSON.parse(await fs.readFile(paths.marker, 'utf8'));
    return checked.pythonVersion === pythonVersion && checked.whisperxVersion === whisperxVersion
      && (await fs.stat(paths.python)).isFile();
  } catch { return false; }
}

async function alignmentRuntimeStatus(root) {
  const paths = runtimePaths(root);
  if (await isReady(paths)) return { state: 'ready', message: 'Local lyric sync is ready.', pythonVersion };
  if (!uvAssets[process.platform + ':' + process.arch]) return { state: 'unsupported', message: unsupportedMessage() };
  const current = installations.get(paths.directory);
  if (current) return { state: 'installing', message: current.stage?.message || 'Preparing local lyric sync…' };
  return { state: 'missing', message: 'Set up local lyric sync. Studio downloads a compatible runtime and model tools.' };
}

async function downloadUv(asset, destination) {
  let response;
  try {
    response = await fetch(releaseBase + uvVersion + '/uv-' + asset[0] + '.' + asset[1], {
      signal: AbortSignal.timeout(installerDownloadMs),
    });
  } catch (error) {
    throw new Error('Could not download the lyric sync installer. Check your internet connection and try again.', { cause: error });
  }
  if (!response.ok || !response.body) throw new Error('Could not download the lyric sync installer (HTTP ' + response.status + ').');
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumArchiveBytes) return callback(new Error('The lyric sync installer download was larger than expected.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (hash.digest('hex') !== asset[2]) throw new Error('The lyric sync installer failed its checksum. Try downloading it again.');
}

async function extractZipExecutable(archive, target) {
  const zip = await openZip(archive, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true });
  try {
    const entry = await new Promise((resolve, reject) => {
      zip.once('error', reject);
      zip.once('end', () => reject(new Error('The lyric sync installer archive did not include its executable.')));
      zip.on('entry', item => {
        if (item.fileName === 'uv.exe') resolve(item);
        else zip.readEntry();
      });
      zip.readEntry();
    });
    const read = promisify(zip.openReadStream.bind(zip));
    await pipeline(await read(entry), createWriteStream(target, { flags: 'wx', mode: 0o700 }));
  } finally {
    zip.close();
  }
}

async function obtainUv(paths, asset) {
  if (await fs.stat(paths.uv).then(info => info.isFile(), () => false)) return paths.uv;
  const scratch = await fs.mkdtemp(path.join(paths.directory, 'installer-'));
  const archive = path.join(scratch, 'uv.' + asset[1]);
  const executable = path.join(scratch, path.basename(paths.uv));
  try {
    await downloadUv(asset, archive);
    if (asset[1] === 'zip') await extractZipExecutable(archive, executable);
    else {
      // Official uv tarballs contain a single target directory. Read only its uv binary.
      const result = await promisify(execFile)('tar', ['-xOf', archive, 'uv-' + asset[0] + '/uv'], {
        encoding: 'buffer', maxBuffer: maximumArchiveBytes, timeout: installerDownloadMs,
      });
      await fs.writeFile(executable, result.stdout, { flag: 'wx', mode: 0o700 });
    }
    await fs.chmod(executable, 0o700);
    await fs.rename(executable, paths.uv);
    return paths.uv;
  } finally {
    await fs.unlink(archive).catch(() => {});
    await fs.unlink(executable).catch(() => {});
    await fs.rmdir(scratch).catch(() => {});
  }
}

function runStep(executable, args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let details = '';
    let timedOut = false;
    const cancel = () => { timedOut = true; child.kill(); };
    const watchdog = setTimeout(cancel, maximumStepMs);
    const collect = chunk => { details = (details + chunk.toString()).slice(-3000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(watchdog);
      if (timedOut) reject(new Error(label + ' timed out. Check your internet connection and try again.'));
      else if (code === 0) resolve();
      else reject(new Error(label + ' failed (' + (signal || code) + '). ' + details.trim()));
    });
  });
}

function missingProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

async function takeLock(paths) {
  const deadline = Date.now() + maximumStepMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(paths.lock, 'wx', 0o600);
      try { await handle.writeFile(String(process.pid)); }
      finally { await handle.close(); }
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await isReady(paths)) return false;
      const contents = await fs.readFile(paths.lock, 'utf8').catch(() => '');
      if (missingProcess(Number(contents))) await fs.unlink(paths.lock).catch(() => {});
      else await delay(1500);
    }
  }
  throw new Error('Another Studio session is already setting up lyric sync. Let it finish and try again.');
}

async function install(paths, report) {
  const asset = uvAssets[process.platform + ':' + process.arch];
  if (!asset) throw new Error(unsupportedMessage());
  await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  if (!await takeLock(paths)) return paths.python;
  try {
    if (await isReady(paths)) return paths.python;
    const env = setupEnvironment(paths.directory);
    report('downloading-tool', 'Downloading the lyric sync installer…');
    const uv = await obtainUv(paths, asset);
    report('installing-python', 'Installing Studio’s private Python workspace…');
    await runStep(uv, ['python', 'install', pythonVersion, '--no-bin', '--no-registry', '--no-config'], env, 'Python setup');
    await runStep(uv, ['venv', '--python', pythonVersion, '--managed-python', '--allow-existing', '--no-config', paths.environment], env, 'Lyric sync environment setup');
    const pip = ['pip', 'install', '--python', paths.python, '--no-config'];
    report('installing-packages', 'Installing the audio engine. This first download may take several minutes…');
    // Keep unrelated dependencies on PyPI rather than the dedicated PyTorch registry.
    const torchRegistry = process.platform === 'darwin' ? packageRegistry : cpuRegistry;
    await runStep(uv, [...pip, '--no-deps', '--default-index', torchRegistry, ...audioEngineDependencies], env, 'Audio engine setup');
    report('installing-packages', 'Installing WhisperX and checking the downloaded dependencies…');
    await runStep(uv, [...pip, '--default-index', packageRegistry, ...audioEngineDependencies, ...managedDependencies], env, 'WhisperX setup');
    report('checking', 'Checking local lyric sync…');
    const probe = 'import av, torch; from whisperx.alignment import align, load_align_model';
    await runStep(paths.python, ['-I', '-c', probe], env, 'Lyric sync verification');
    await fs.writeFile(paths.marker, JSON.stringify({ pythonVersion, whisperxVersion }) + '\n', { mode: 0o600 });
    return paths.python;
  } finally {
    await fs.unlink(paths.lock).catch(() => {});
  }
}

async function ensureAlignmentRuntime(root, onProgress) {
  const paths = runtimePaths(root);
  if (await isReady(paths)) return paths.python;
  let current = installations.get(paths.directory);
  if (!current) {
    current = { listeners: new Set(), stage: null, promise: null };
    current.promise = install(paths, (phase, message) => {
      current.stage = { phase, message };
      for (const listener of current.listeners) {
        try { listener(current.stage); } catch { /* A closed window cannot stop setup. */ }
      }
    }).finally(() => installations.delete(paths.directory));
    installations.set(paths.directory, current);
  }
  if (onProgress) {
    current.listeners.add(onProgress);
    if (current.stage) {
      try { onProgress(current.stage); } catch { /* A closed window cannot stop setup. */ }
    }
  }
  try { return await current.promise; }
  finally { if (onProgress) current.listeners.delete(onProgress); }
}

module.exports = { alignmentRuntimeRoot, alignmentRuntimeStatus, ensureAlignmentRuntime };
