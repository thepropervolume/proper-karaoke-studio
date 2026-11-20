const { createHash } = require('node:crypto');
const { createWriteStream, openAsBlob } = require('node:fs');
const { mkdtemp, rm, rmdir, stat } = require('node:fs/promises');
const { extname, isAbsolute, join } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: waitFor } = require('node:timers/promises');

const API = 'https://api.tuanziai.com';
const STORAGE_HOSTS = new Set([
  'dangoai.oss-accelerate.aliyuncs.com',
  'dangoai.oss-cn-hangzhou.aliyuncs.com',
]);
const AUDIO_FORMATS = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac' };
const SEPARATION_STYLES = new Set(['29', '30', '31']);
const DOWNLOAD_MODELS = new Set(['default', 'conserve', 'aggressive']);
const DOWNLOAD_FORMATS = new Set(['mp3', 'flac']);
const MAX_JSON_BYTES = 128 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const JOB_POLL_TIMEOUT_MS = 8 * 60_000;
const TRANSFER_TIMEOUT_MS = 2 * 60_000;

function allowedFormField([name, value]) {
  return /^[A-Za-z0-9_-]+$/u.test(name) && name.toLowerCase() !== 'file'
    && (typeof value === 'string' || Number.isFinite(value) || typeof value === 'boolean');
}

function normalizeDangoCredentials(credentials) {
  const appKey = typeof credentials?.appKey === 'string' ? credentials.appKey.trim() : '';
  const appSecret = typeof credentials?.appSecret === 'string' ? credentials.appSecret.trim() : '';
  if (!/^[!-~]{1,1024}$/u.test(appKey) || appKey.includes('$$') || !/^[!-~]{1,1024}$/u.test(appSecret)) {
    throw new Error('Enter a valid Dango App Key and App Secret.');
  }
  return { appKey, appSecret };
}

function separationOptions(style, extension, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['separateBackingVocals', 'modelType', 'format'].includes(key))) {
    throw new Error('Choose supported Dango model options.');
  }
  const { separateBackingVocals = false, modelType = 'default', format } = options;
  if (typeof separateBackingVocals !== 'boolean') throw new Error('Set separateBackingVocals to true or false.');
  if (separateBackingVocals && style !== '31') throw new Error('Use Dango model 31 to separate backing vocals.');
  if (!DOWNLOAD_MODELS.has(modelType)) throw new Error('Choose the Dango download model default, conserve, or aggressive.');
  if (format !== undefined && !DOWNLOAD_FORMATS.has(format)) throw new Error('Choose MP3 or FLAC for Dango stems.');
  if (format === 'flac' && !['.flac', '.wav'].includes(extension)) throw new Error('Choose a WAV or FLAC source to download Dango stems as FLAC.');
  return { separateBackingVocals, modelType, format };
}

function storageUrl(value, forDownload = false) {
  let url;
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error('Dango returned an invalid file transfer link.');
  }
  if (!STORAGE_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash) {
    throw new Error('Dango returned an unrecognized file storage location.');
  }
  // Dango documents HTTP download URLs for this bucket. Use its HTTPS endpoint.
  if (forDownload && url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new Error('Dango returned an insecure file transfer link.');
  return url;
}

async function closeBody(response) {
  await response.body?.cancel().catch(() => {});
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(fetchImpl, url, options, label, signal, ms) {
  try {
    return await fetchImpl(url, { ...options, redirect: 'error', signal: withTimeout(signal, ms) });
  } catch {
    if (signal?.aborted) throw new Error(label + ' was interrupted.');
    throw new Error(label + ' could not reach Dango. Check your connection.');
  }
}

async function readJson(response) {
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_JSON_BYTES) throw new Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Dango returned an unreadable response.');
  }
}

function apiClient(credentials, fetchImpl, now) {
  const { appKey, appSecret } = normalizeDangoCredentials(credentials);
  return async (endpoint, { data, label, signal } = {}) => {
    const timestamp = String(now());
    // Dango's published authentication format uses MD5 and epoch milliseconds.
    const signature = createHash('md5').update(appSecret + timestamp).digest('hex');
    const headers = { Accept: 'application/json', token: appKey + '$$' + timestamp + '$$' + signature };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const response = await request(fetchImpl, API + endpoint, { method: 'POST', headers, body: JSON.stringify(data) }, label, signal, 15_000);
    if (!response.ok) {
      await closeBody(response);
      const detail = [401, 403].includes(response.status) ? ' Check your Dango App Key and App Secret.' : '';
      throw new Error(label + ' failed (HTTP ' + response.status + ').' + detail);
    }
    const result = await readJson(response);
    if (result?.code === 0) return result.data;
    // Provider messages can include echoed request data. Only use known safe diagnostics.
    if (result?.code === -10 && endpoint.includes('/upload/')) {
      throw new Error('Dango reported insufficient credits. Check your account balance and try again.');
    }
    const detail = endpoint === '/echo' ? ' Check your credentials and your computer clock.' : ' Check your Dango account and audio file.';
    throw new Error(label + ' was rejected by Dango.' + detail);
  };
}

async function checkDangoConnection(credentials, { fetchImpl = fetch, now = Date.now } = {}) {
  const api = apiClient(credentials, fetchImpl, now);
  // The live endpoint accepts the documented JSON echo. Its bodyless GET can reject a valid signature.
  const test = 'tpv-studio-check';
  if (await api('/echo', { data: { test }, label: 'Dango connection test' }) !== test) {
    throw new Error('Dango returned an unexpected connection test result.');
  }
  return { connected: true };
}

async function sourceAudio(sourcePath, extension) {
  if (!(typeof sourcePath === 'string' && isAbsolute(sourcePath) && Object.hasOwn(AUDIO_FORMATS, extension))) {
    throw new Error('Choose a WAV, FLAC, or MP3 file to separate with Dango.');
  }
  try {
    const info = await stat(sourcePath);
    if (!info.isFile() || !info.size) throw new Error();
    if (info.size <= MAX_AUDIO_BYTES) {
      const audio = await openAsBlob(sourcePath, { type: AUDIO_FORMATS[extension] });
      if (audio.size > 0 && audio.size <= MAX_AUDIO_BYTES) return audio;
    }
  } catch {
    throw new Error('Studio could not read the selected audio file.');
  }
  throw new Error('Choose an audio file smaller than 512 MB for Dango separation.');
}

function jobIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{32}$/u.test(value)) throw new Error('Dango returned an invalid job reference.');
  return value;
}

async function uploadAudio(fetchImpl, channel, audio, filename, signal) {
  const url = storageUrl(channel?.url);
  if (!channel.form || typeof channel.form !== 'object' || Array.isArray(channel.form)) {
    throw new Error('Dango returned an invalid upload form.');
  }
  const form = new FormData();
  const fields = Object.entries(channel.form);
  if (!fields.length || !fields.every(allowedFormField)) {
    throw new Error('Dango returned an invalid upload form.');
  }
  for (const [name, value] of fields) form.append(name, String(value));
  // Aliyun requires the audio file to be the last multipart field.
  form.append('file', audio, filename);
  const response = await request(fetchImpl, url, { method: 'POST', body: form }, 'Dango upload', signal, TRANSFER_TIMEOUT_MS);
  await closeBody(response);
  if (!response.ok) throw new Error('Dango could not receive the audio file (HTTP ' + response.status + ').');
}

async function waitForJob(api, jobId, signal, delay) {
  const deadline = withTimeout(signal, JOB_POLL_TIMEOUT_MS);
  try {
    await delay(12_000, undefined, { signal: deadline });
    while (!deadline.aborted) {
      const status = await api('/vocal-remover/' + jobId, { label: 'Dango job status', signal: deadline });
      if (status?.status === 2) return status;
      if (status?.status === 1) throw new Error('Dango could not separate this audio and reports no charge for a failed job.');
      if (status?.status !== 0) throw new Error('Dango returned an unknown job status.');
      await delay(5_000, undefined, { signal: deadline });
    }
  } catch (error) {
    if (!deadline.aborted) throw error;
  }
  if (signal?.aborted) throw new Error('Waiting for Dango was interrupted.');
  throw new Error('Dango has not finished processing within eight minutes.');
}

async function downloadStem(fetchImpl, remoteUrl, file, format, signal) {
  const url = storageUrl(remoteUrl, true);
  const deadline = withTimeout(signal, TRANSFER_TIMEOUT_MS);
  const response = await request(fetchImpl, url, { method: 'GET' }, 'Dango stem download', deadline, TRANSFER_TIMEOUT_MS);
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
    await closeBody(response);
    throw new Error('Dango could not return a usable audio download.');
  }

  let bytes = 0;
  let prefix = Buffer.alloc(0);
  const validateAudio = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > MAX_AUDIO_BYTES) return done(new Error('Audio download exceeded its size limit.'));
      if (prefix.length < 4) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
        if (prefix.length === 4) {
          const mp3 = prefix.subarray(0, 3).toString('ascii') === 'ID3' || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0);
          const flac = prefix.toString('ascii') === 'fLaC';
          if (format === 'flac' ? !flac : !mp3) return done(new Error('Unexpected audio format.'));
        }
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(response.body, validateAudio, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: deadline });
    if (bytes < 4) throw new Error('Empty audio file.');
  } catch {
    throw new Error('Dango returned an invalid or incomplete audio download.');
  }
}

/** Call only after the user confirms uploading this file and spending their Dango credits. */
async function separateWithDango({ credentials, sourcePath, outputDirectory: parent, model = '29', modelOptions = {}, signal },
  { fetchImpl = fetch, now = Date.now, delay = waitFor } = {}) {
  const api = apiClient(credentials, fetchImpl, now);
  const style = String(model);
  if (!SEPARATION_STYLES.has(style)) throw new Error('Choose a supported Dango separation model.');
  const extension = typeof sourcePath === 'string' ? extname(sourcePath).toLowerCase() : '';
  const options = separationOptions(style, extension, modelOptions);
  const audio = await sourceAudio(sourcePath, extension);
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose a valid local stem destination.');
  const outputDirectory = await mkdtemp(join(parent, 'tpv-dango-'));

  let jobId;
  let submitted = false;
  let complete = false;
  let outputs = [];
  try {
    const filename = 'song' + extension;
    const channel = await api('/vocal-remover/upload/channel', {
      data: {
        uploadVersion: 2, style: Number(style), filename,
        ...(options.separateBackingVocals ? { config: { separateBackingVocals: true } } : {}),
      },
      label: 'Dango upload setup', signal,
    });
    const channelId = jobIdentifier(channel?.channel);
    await uploadAudio(fetchImpl, channel, audio, filename, signal);

    // This one-time request can spend credits even if we never receive its response.
    if (signal?.aborted) throw new Error('Dango separation was canceled before submission.');
    submitted = true;
    jobId = jobIdentifier(await api('/vocal-remover/upload/' + channelId + '/result', { label: 'Dango submission', signal }));
    const status = await waitForJob(api, jobId, signal, delay);
    const lossless = extension !== '.mp3' && status.lossless === true;
    if (options.format === 'flac' && !lossless) throw new Error('Dango reports MP3-only results. Download the MP3 stems from your Dango jobs.');
    const format = options.format ?? (lossless ? 'flac' : 'mp3');
    const stems = [['instrumental', 'Instrumental'], ['vocals', 'Vocals']];
    if (options.separateBackingVocals) stems.push(['backVocals', 'Backing Vocals']);
    outputs = stems.map(([item, name]) => ({ item, file: join(outputDirectory, name + '.' + format) }));
    for (const { item, file } of outputs) {
      const result = await api('/vocal-remover/' + jobId + '/download/' + options.modelType + '/' + format + '/' + item,
        { label: 'Dango download setup', signal });
      await downloadStem(fetchImpl, result?.url, file, format, signal);
    }
    complete = true;
    return { files: outputs.map(output => output.file), outputDirectory, jobId };
  } catch (error) {
    if (jobId) throw new Error(error.message + ' Check Dango job ' + jobId + ' before submitting again.');
    if (submitted) throw new Error(error.message + ' Check your Dango jobs before submitting again.');
    throw error;
  } finally {
    if (!complete) {
      // Remove only the app-generated paths, including any partially downloaded stem.
      for (const { file } of outputs) await rm(file, { force: true }).catch(() => {});
      await rmdir(outputDirectory).catch(() => {});
    }
  }
}

module.exports = { normalizeDangoCredentials, checkDangoConnection, separateWithDango };
