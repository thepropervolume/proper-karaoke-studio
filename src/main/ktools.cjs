const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const sources = new Set(['all', 'lrclib', 'liblrc', 'genius']);
const lyricsScript = path.join('python', 'tpv_karaoke_lyrics.py');

async function findLyricsScript(configuredHome) {
  const home = os.homedir();
  const requestedHome = configuredHome || process.env.TPV_KTOOLS_HOME;
  const dropboxFolders = [path.join(home, 'Dropbox'), path.join(home, 'Library', 'CloudStorage', 'Dropbox')];
  const roots = requestedHome ? [requestedHome] : dropboxFolders.map(folder => path.join(folder, 'Audio', 'Karaoke', 'Tools', 'ktools'));
  for (const root of roots) {
    const file = path.resolve(root, lyricsScript);
    const info = await fs.stat(file).catch(error => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      return null;
    });
    if (info?.isFile()) return file;
  }
  const where = requestedHome ? ` in ${path.resolve(requestedHome)}` : ' in the default Dropbox folders';
  throw new Error(`Could not find ${lyricsScript}${where}. Set TPV_KTOOLS_HOME to your ktools folder or specify the folder explicitly.`);
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function readManifest(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Use the same Python entry point as the ktools Bash and PowerShell launchers. */
async function downloadLyrics({ artist, title, album, duration, source = 'all', outputDirectory, ktoolsHome, python, inputLyrics, noFormat, force }) {
  artist = requireText(artist, 'Artist');
  title = requireText(title, 'Song title');
  outputDirectory = path.resolve(requireText(outputDirectory, 'Output directory'));
  if (!sources.has(source)) throw new Error('Lyric source must be all, lrclib, or genius.');
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error('Lyric lookup duration must be a positive number of seconds.');
  const script = await findLyricsScript(ktoolsHome);
  const executable = python || process.env.TPV_KTOOLS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

  // Use one argument per option so song titles that start with a dash are accepted.
  const args = [script, '--quiet', '--json', `--artist=${artist}`, `--track=${title}`, `--output-dir=${outputDirectory}`, `--source=${source}`];
  if (album) args.push(`--album=${album}`);
  if (duration !== undefined) args.push(`--duration=${duration}`);
  if (inputLyrics) args.push(`--input-lyrics=${path.resolve(inputLyrics)}`);
  if (noFormat) args.push('--no-format');
  if (force) args.push('--force');

  let stdout;
  try {
    ({ stdout } = await runFile(executable, args, {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    }));
  } catch (cause) {
    if (cause.code === 'ENOENT') throw new Error('Could not start Python for ktools. Install Python 3.9+ or set TPV_KTOOLS_PYTHON to its executable.');
    if (cause.killed) throw new Error('The lyrics lookup timed out. Try again or select a single lyric source.');
    const failure = readManifest(cause.stdout);
    if (failure?.success === false && Array.isArray(failure.errors)) {
      throw new Error(failure.errors.filter(item => typeof item === 'string').join('; ') || 'The lyrics lookup failed.');
    }
    const stderr = typeof cause.stderr === 'string' ? cause.stderr.trim().slice(-1600) : '';
    throw new Error(stderr || `The ktools lyrics lookup failed (${cause.code || 'unknown error'}).`);
  }

  // Keep the provider's selection metadata and warnings intact for the editor and automation.
  const result = readManifest(stdout);
  if (result?.success !== true || typeof result.plain_file !== 'string' || typeof result.manifest_file !== 'string') {
    throw new Error('The ktools lyrics command returned an invalid manifest.');
  }
  return result;
}

module.exports = { downloadLyrics };
