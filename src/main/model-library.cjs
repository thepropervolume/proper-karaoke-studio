/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const catalog = require('../domain/model-downloads.json');
const uvrHashes = require('../domain/uvr-file-checksums.json');

const mirror = 'https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs/';
const modelHosts = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'dl.fbaipublicfiles.com']);
const validModelFile = /^(?!\.{1,2}$)[\w.-]{1,160}$/;
const modelFolders = ['', 'VR_Models', 'VR_Arch', 'MDX_Net_Models', 'MDXNet', 'MDX23C', 'Roformer', 'Demucs', 'Demucs_Models', 'Demucs_Models/v3_v4_repo',
  'Demucs/v3_v4_repo', 'MDX_Net_Models/model_data/mdx_c_configs'];
const maxBytes = 1024 * 1024 * 1024;

function commonUvrPaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)
      .flatMap(root => ['Ultimate Vocal Remover', 'Ultimate Vocal Remover GUI', 'UVR'].map(name => path.join(root, name, 'models')));
  }
  if (process.platform === 'darwin') {
    return ['/Applications', path.join(home, 'Applications')].flatMap(root => ['Ultimate Vocal Remover', 'Ultimate Vocal Remover GUI', 'UVR']
      .flatMap(name => [path.join(root, name + '.app', 'Contents', 'Resources', 'models'), path.join(root, name + '.app', 'Contents', 'MacOS', 'models')]));
  }
  return [path.join(home, '.local', 'share'), home, '/opt']
    .flatMap(root => ['Ultimate Vocal Remover', 'ultimatevocalremovergui', 'UVR'].map(name => path.join(root, name, 'models')));
}

async function checkFile(file) {
  const info = await fs.stat(file).catch(() => null);
  return info?.isFile() && info.size > 0 && info.size <= maxBytes;
}

async function hasModelFolder(candidate) {
  const entries = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
  return entries.some(entry => entry.isDirectory() && modelFolders.includes(entry.name)
    || entry.isFile() && /\.(onnx|pth|ckpt|th)$/i.test(entry.name));
}

async function locateUvrFolder(input) {
  if (typeof input !== 'string' || !input || input.length > 4096 || !path.isAbsolute(input)) return null;
  for (const directory of [path.resolve(input), path.join(input, 'models')]) {
    if (await hasModelFolder(directory)) return directory;
  }
  return null;
}

async function borrowedFile(root, name, folders = modelFolders) {
  if (!root || !validModelFile.test(name)) return null;
  for (const folder of folders) {
    const candidate = path.join(root, folder, name);
    if (await checkFile(candidate)) return candidate;
  }
  return null;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function readSource(address, fetchModel, signal) {
  let url = new URL(address);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    if (url.protocol !== 'https:' || !modelHosts.has(url.hostname) || url.username || url.password || url.port) {
      throw new Error('The model host is unavailable.');
    }
    const response = await fetchModel(url, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const destination = response.headers.get('location');
      await response.body?.cancel();
      if (!destination) break;
      url = new URL(destination, url);
    } else {
      if (response.ok && response.body) return response;
      await response.body?.cancel();
      throw new Error('The model host returned HTTP ' + response.status + '.');
    }
  }
  throw new Error('The model download redirected too many times.');
}

async function downloadFile(file, directory, fetchModel) {
  const destination = path.join(directory, file.name);
  if (await checkFile(destination) && await hashFile(destination) === file.sha256) return;
  const signal = AbortSignal.timeout(20 * 60_000);
  let failure;
  for (const url of [...new Set([mirror + encodeURIComponent(file.name), file.url])]) {
    const temporary = path.join(directory, '.' + randomUUID() + '.download');
    try {
      const response = await readSource(url, fetchModel, signal);
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body.cancel();
        throw new Error('The model exceeds the download size limit.');
      }
      const hash = createHash('sha256');
      let size = 0;
      const validate = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > maxBytes) return callback(new Error('The model exceeds the download size limit.'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), validate, createWriteStream(temporary, { flags: 'wx' }), { signal });
      if (!size || hash.digest('hex') !== file.sha256) throw new Error('The model did not match its published checksum.');
      await fs.rename(temporary, destination);
      return;
    } catch (cause) { failure = cause; }
    finally { await fs.rm(temporary, { force: true }); }
  }
  throw new Error('Could not download ' + file.name + '. ' + (failure?.message || 'Try again.'));
}

async function borrowVerified(file, directory, sourceRoot) {
  const destination = path.join(directory, file.name);
  if (await checkFile(destination)) {
    if (await hashFile(destination) === file.sha256) return;
    throw new Error(file.name + ' in Studio’s models folder failed verification. Use Download Models to replace it.');
  }
  const source = await borrowedFile(sourceRoot, file.name);
  if (!source) return;
  const temporary = path.join(directory, '.' + randomUUID() + '.import');
  try {
    await fs.copyFile(source, temporary);
    if (await hashFile(temporary) !== file.sha256) {
      throw new Error(file.name + ' in the UVR folder differs from the published model. Download a verified copy into Studio instead.');
    }
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

function createModelLibrary(studioDirectory, { searchRoots = commonUvrPaths(), fetchModel = fetch, downloads = catalog } = {}) {
  let activeDownload;
  const modelSpec = (id, adapter) => downloads.find(model => model.id === id && model.adapter === adapter
    || adapter === 'audio-separator' && model.adapter === 'demucs' && model.id + '.yaml' === id);
  const cacheDirectory = (adapter, root = studioDirectory) => path.join(root, adapter === 'demucs' ? 'Demucs' : 'Audio Separator');
  async function directory(uvrModelsPath = '') {
    if (uvrModelsPath) {
      const resolved = await locateUvrFolder(uvrModelsPath);
      if (!resolved) throw new Error('Choose the Ultimate Vocal Remover installation or its models folder.');
      return resolved;
    }
    await fs.mkdir(studioDirectory, { recursive: true });
    return studioDirectory;
  }

  async function inventory(uvrModelsPath = '') {
    const detectedFolders = [...new Set((await Promise.all(searchRoots.map(locateUvrFolder))).filter(Boolean))];
    const uvrDirectory = await locateUvrFolder(uvrModelsPath);
    const source = uvrDirectory || detectedFolders[0];
    return {
      studioDirectory, detectedFolders, uvrDirectory,
      models: await Promise.all(downloads.map(async ({ files, ...model }) => ({
        ...model,
        downloaded: (await Promise.all(files.map(file => checkFile(path.join(cacheDirectory(model.adapter), file.name))))).every(Boolean),
        foundInUvr: Boolean(source) && (await Promise.all(files.map(file => borrowedFile(source, file.name)))).every(Boolean),
      }))),
    };
  }

  async function download(id) {
    const model = downloads.find(entry => entry.id === id);
    if (!model) throw new Error('Choose a model from the Studio download catalog.');
    if (activeDownload) {
      if (activeDownload.id === id) return activeDownload.promise;
      throw new Error('Wait for the current model download to finish.');
    }
    const destination = cacheDirectory(model.adapter);
    const promise = (async () => {
      await fs.mkdir(destination, { recursive: true });
      for (const file of model.files) await downloadFile(file, destination, fetchModel);
    })();
    activeDownload = { id, promise };
    try { await promise; }
    finally { activeDownload = undefined; }
  }

  async function prepare(ids, uvrModelsPath = '', adapter = 'audio-separator') {
    if (adapter !== 'audio-separator' && adapter !== 'demucs') return undefined;
    const sourceRoot = uvrModelsPath ? await directory(uvrModelsPath) : null;
    const destination = cacheDirectory(adapter);
    await fs.mkdir(destination, { recursive: true });
    const models = ids.map(id => modelSpec(id, adapter));
    for (const [index, id] of ids.entries()) {
      const model = models[index];
      const files = model?.files || (Object.hasOwn(uvrHashes, id) ? [{ name: id, sha256: uvrHashes[id] }] : []);
      for (const file of files) {
        // Downloaded Demucs weights can also be loaded by Audio Separator's Demucs adapter.
        const cached = adapter !== model?.adapter && model?.adapter === 'demucs' ? cacheDirectory('demucs') : null;
        const borrowed = cached && await borrowedFile(cached, file.name) ? cached : sourceRoot;
        await borrowVerified(file, destination, borrowed);
      }
    }
    if (adapter === 'audio-separator') return destination;
    if (models[0] && (await Promise.all(models[0].files.map(file => checkFile(path.join(destination, file.name))))).every(Boolean)) return destination;
    // Standalone Demucs uses its own remote repository when Studio has no complete bundle.
    return undefined;
  }

  return { inventory, directory, download, prepare };
}

module.exports = { createModelLibrary, locateUvrFolder };
