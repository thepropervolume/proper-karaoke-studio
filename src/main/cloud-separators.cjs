/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { createWriteStream, openAsBlob } = require('node:fs');
const { mkdtemp, rm, rmdir } = require('node:fs/promises');
const { extname, isAbsolute, join } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: wait } = require('node:timers/promises');
const { separatorModels } = require('../domain/studio-options.json');

const audioTypes = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
const sourceLimit = 1_000_000_000;
const maximumJsonBytes = 512 * 1024;
const apiTimeout = 30_000;
const transferTimeout = 5 * 60_000;
const jobTimeout = 45 * 60_000;
const mvsepApi = 'https://mvsep.com/api';
const gaudioApi = 'https://restapi.gaudiolab.io/developers/api/v1';

function normalizeKey(value, brand) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[!-~]{1,1024}$/u.test(key)) throw new Error('Enter a valid ' + brand + ' API key.');
  return key;
}

function abortAfter(signal, duration) {
  const timeout = AbortSignal.timeout(duration);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(fetchImpl, url, options, label, signal, timeout = apiTimeout) {
  try {
    return await fetchImpl(url, { ...options, redirect: 'error', signal: abortAfter(signal, timeout) });
  } catch {
    if (signal?.aborted) throw new Error(label + ' was interrupted.');
    throw new Error(label + ' could not connect. Check your internet connection.');
  }
}

async function readJson(response, label) {
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maximumJsonBytes) throw new Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(label + ' returned an unreadable response.');
  }
}

async function disregard(response) {
  await response.body?.cancel().catch(() => {});
}

async function rejectStatus(response, label, onStatus) {
  if (response.ok) return;
  await disregard(response);
  const error = new Error(onStatus(response.status) || label + ' failed (HTTP ' + response.status + ').');
  error.status = response.status;
  throw error;
}

function transferLink(value, allowed, label) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !allowed(url)) throw new Error();
    return url;
  } catch {
    throw new Error(label + ' returned an unrecognized file transfer link.');
  }
}

async function openSource(sourcePath, brand) {
  const extension = typeof sourcePath === 'string' ? extname(sourcePath).toLowerCase() : '';
  if (!Object.hasOwn(audioTypes, extension) || !isAbsolute(sourcePath)) {
    throw new Error('Choose a WAV, FLAC, MP3, or M4A file to separate with ' + brand + '.');
  }
  let blob;
  try { blob = await openAsBlob(sourcePath, { type: audioTypes[extension] }); }
  catch { throw new Error('Studio could not read the selected audio file.'); }
  if (!blob.size || blob.size > sourceLimit) throw new Error('Choose a nonempty audio file no larger than 1 GB.');
  return { blob, filename: 'audio' + extension };
}

async function saveWav(fetchImpl, url, file, label, signal) {
  const deadline = abortAfter(signal, transferTimeout);
  const response = await request(fetchImpl, url, { method: 'GET' }, label, deadline, transferTimeout);
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > sourceLimit) {
    await disregard(response);
    throw new Error(label + ' was unavailable.');
  }
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  const validate = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > sourceLimit) return done(new Error('The WAV exceeds the size limit.'));
      if (prefix.length < 12) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.length)]);
        if (prefix.length === 12 && (!['RIFF', 'RF64', 'RIFX'].includes(prefix.toString('ascii', 0, 4)) || prefix.toString('ascii', 8, 12) !== 'WAVE')) {
          return done(new Error('Expected a WAV response.'));
        }
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(response.body, validate, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: deadline });
    if (bytes < 12) throw new Error();
  } catch {
    throw new Error(label + ' returned an invalid or incomplete WAV.');
  }
}

async function pollJob(read, { label, signal, delay, interval }) {
  const deadline = abortAfter(signal, jobTimeout);
  try {
    let next = interval;
    while (!deadline.aborted) {
      await delay(next, undefined, { signal: deadline });
      try {
        const result = await read(deadline);
        if (result) return result;
        next = interval;
      } catch (error) {
        if (error.status !== 429) throw error;
        next = 60_000;
      }
    }
  } catch (error) {
    if (!deadline.aborted) throw error;
  }
  if (signal?.aborted) throw new Error('Waiting for ' + label + ' was interrupted.');
  throw new Error(label + ' has not finished processing within 45 minutes.');
}

function createSeparator({ id, name, submit, stems, verify }) {
  const models = separatorModels[id];
  const defaultModel = models[0].id;
  return {
    name, models, defaultModel,
    normalizeKey: key => normalizeKey(key, name),
    verify: (key, { fetchImpl = fetch } = {}) => verify(normalizeKey(key, name), fetchImpl),
    async separate({ credentials, sourcePath, outputDirectory: parent, model = defaultModel, signal, onProgress },
      { fetchImpl = fetch, delay = wait } = {}) {
      const key = normalizeKey(credentials, name);
      const selected = String(model);
      if (!models.some(item => item.id === selected)) throw new Error('Choose a supported ' + name + ' model.');
      if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose a local folder for the separated stems.');
      const source = await openSource(sourcePath, name);
      const outputDirectory = await mkdtemp(join(parent, 'tpv-' + id + '-'));
      const label = name + ' job';
      const files = [];
      let jobId;
      let submitted = false;
      let succeeded = false;
      try {
        onProgress?.({ message: 'Uploading audio to ' + name + '…' });
        const { id: reference, result } = await submit({
          key, source, model: selected, signal, fetchImpl, delay,
          starting: () => {
            if (signal?.aborted) throw new Error(label + ' was canceled before submission.');
            submitted = true;
          },
          identify: id => { jobId = id; onProgress?.({ message: 'Waiting for ' + name + ' to separate the audio…' }); },
        });
        const downloads = stems(result, selected);
        for (const [index, [stem, url]] of downloads.entries()) {
          onProgress?.({ message: 'Downloading stems from ' + name + '…', progress: index / downloads.length });
          const file = join(outputDirectory, stem + '.wav');
          files.push(file);
          await saveWav(fetchImpl, url, file, name + ' stem download', signal);
        }
        succeeded = true;
        return { files, outputDirectory, jobId: reference };
      } catch (error) {
        // Never retry a billable submission. A missing response can still mean that a job exists.
        if (jobId) throw new Error(error.message + ' Check ' + label + ' ' + jobId + ' before submitting again.');
        if (submitted) throw new Error(error.message + ' Check your ' + name + ' jobs before submitting again.');
        throw error;
      } finally {
        if (!succeeded) {
          for (const file of files) await rm(file, { force: true }).catch(() => {});
          await rmdir(outputDirectory).catch(() => {});
        }
      }
    },
  };
}

async function mvsepRequest(fetchImpl, path, options, label, signal, timeout) {
  const response = await request(fetchImpl, mvsepApi + path, options, label, signal, timeout);
  await rejectStatus(response, label, status => {
    if ([401, 403].includes(status) || (status === 400 && path.startsWith('/app/user?'))) return 'MVSEP rejected the API key. Check your account’s API token.';
    return status === 429 ? 'MVSEP limited requests. Try again in a minute.' : '';
  });
  return readJson(response, label);
}

const mvsepOutputs = {
  '20': [['Vocals', ['vocals']], ['Drums', ['drums']], ['Bass', ['bass']], ['Other', ['other', 'others']]],
  '40': [['Vocals', ['vocals', 'vocal']], ['Instrumental', ['instrumental', 'other', 'accompaniment']]],
  '49': [['Lead Vocals', ['vocals lead', 'lead vocals']], ['Backing Vocals', ['vocals back', 'backing vocals']], ['Instrumental', ['instrum only', 'instrumental']]],
};

const mvsep = createSeparator({
  id: 'mvsep', name: 'MVSEP',
  async verify(key, fetchImpl) {
    const query = new URLSearchParams({ api_token: key });
    const result = await mvsepRequest(fetchImpl, '/app/user?' + query, { method: 'GET' }, 'MVSEP connection test');
    if (result?.success !== true) throw new Error('MVSEP rejected the API key. Check your account’s API token.');
    return { connected: true };
  },
  async submit({ key, source, model, signal, fetchImpl, delay, identify, starting }) {
    const form = new FormData();
    form.append('api_token', key);
    form.append('sep_type', model);
    form.append('output_format', '1');
    form.append('is_demo', '0');
    if (model === '49') form.append('add_opt2', '1');
    form.append('audiofile', source.blob, source.filename);
    starting();
    const created = await mvsepRequest(fetchImpl, '/separation/create', { method: 'POST', body: form }, 'MVSEP submission', signal, transferTimeout);
    if (created?.success !== true) throw new Error('MVSEP rejected the separation. Check your account, service queue, and audio file.');
    const id = created.data?.hash;
    if (typeof id !== 'string' || !/^[\w.-]{8,256}$/u.test(id)) throw new Error('MVSEP returned an invalid job reference.');
    identify(id);
    const query = new URLSearchParams({ hash: id });
    const result = await pollJob(async deadline => {
      const status = await mvsepRequest(fetchImpl, '/separation/get?' + query, { method: 'GET' }, 'MVSEP job status', deadline);
      if (status?.success !== true || status.status === 'not_found') throw new Error('MVSEP could not find the separation job.');
      if (status.status === 'failed') throw new Error('MVSEP could not separate this audio.');
      if (status.status === 'done') return status.data ?? {};
      if (!['waiting', 'processing', 'distributing', 'merging'].includes(status.status)) throw new Error('MVSEP returned an unknown job status.');
      return null;
    }, { label: 'MVSEP', signal, delay, interval: 10_000 });
    return { id, result };
  },
  stems(result, model) {
    if (!Array.isArray(result?.files) || result.files.length > 32) throw new Error('MVSEP returned an incomplete stem list.');
    // Pull only independent stems. Some models return an alternate mix that would double the audio in Studio.
    return mvsepOutputs[model].map(([name, aliases]) => {
      const entry = result.files.find(stem => typeof stem?.type === 'string' && aliases.includes(stem.type.trim().toLowerCase()));
      return [name, transferLink(entry?.url, url => ['mvsep.com', 'de.mvsep.com', 'de2.mvsep.com', 'sg.mvsep.com', 'hk.mvsep.com'].includes(url.hostname), 'MVSEP')];
    });
  },
});

const shq = 'gsep_music_shq_v1';
const hq = 'gsep_music_hq_v1';
const verificationId = '00000000-0000-4000-8000-000000000000';
const gaudioFailure = {
  1102: 'Gaudio reports insufficient credits.',
  1103: 'The Gaudio project’s contract is invalid or expired.',
  1104: 'Gaudio could not find this job.',
  1107: 'Gaudio does not support the audio format.',
  1109: 'The audio is longer than this Gaudio model accepts.',
  1110: 'The audio file is larger than Gaudio accepts.',
};
const gaudioS3 = hostname => /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/u.test(hostname);

async function gaudioRequest(fetchImpl, key, path, { data, label, signal, readOnlyTest } = {}) {
  const headers = { Accept: 'application/json', 'x-ga-apikey': key };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await request(fetchImpl, gaudioApi + path, { method: data === undefined ? 'GET' : 'POST', headers, body: JSON.stringify(data) }, label, signal);
  await rejectStatus(response, label, status => {
    if (status === 401) return 'Gaudio rejected the API key. Check your Developers project’s key.';
    if (status === 403) return 'Gaudio has not granted this API key access to the selected model.';
    return status === 429 ? 'Gaudio limited requests. Try again in a minute.' : '';
  });
  const result = await readJson(response, label);
  if (readOnlyTest && result?.resultCode === 1104) return { connected: true };
  if (!readOnlyTest && result?.resultCode === 1000) return result.resultData;
  throw new Error(Object.hasOwn(gaudioFailure, result?.resultCode) ? gaudioFailure[result.resultCode] : label + ' returned an unexpected result.');
}

const gaudio = createSeparator({
  id: 'gaudio', name: 'Gaudio',
  async verify(key, fetchImpl) {
    // The API documents no key-only endpoint. A read of a nonexistent job checks model access without uploading or spending credits.
    const check = model => gaudioRequest(fetchImpl, key, '/' + model + '/jobs/' + verificationId,
      { label: 'Gaudio connection test', readOnlyTest: true });
    try { return await check(shq); }
    catch (error) {
      if (error.status !== 403) throw error;
      return check(hq);
    }
  },
  async submit({ key, source, model, signal, fetchImpl, delay, identify, starting }) {
    const api = (path, options) => gaudioRequest(fetchImpl, key, path, { signal, ...options });
    const upload = await api('/files/upload-multipart/create', {
      data: { fileName: source.filename, fileSize: source.blob.size }, label: 'Gaudio upload setup',
    });
    const uploadId = upload?.uploadId;
    const { chunkSize, preSignedUrl } = upload || {};
    if (typeof uploadId !== 'string' || !/^[\w.-]{1,256}$/u.test(uploadId) || !Number.isSafeInteger(chunkSize) || chunkSize <= 0
      || !Array.isArray(preSignedUrl) || preSignedUrl.length > 1024 || preSignedUrl.length !== Math.ceil(source.blob.size / chunkSize)) {
      throw new Error('Gaudio returned an invalid upload plan.');
    }
    const locations = preSignedUrl.map(value => transferLink(value,
      url => gaudioS3(url.hostname) && /^[a-f\d]{64}$/iu.test(url.searchParams.get('X-Amz-Signature') || ''), 'Gaudio'));
    const parts = [];
    for (const [index, url] of locations.entries()) {
      const blob = source.blob.slice(index * chunkSize, (index + 1) * chunkSize, source.blob.type);
      const response = await request(fetchImpl, url, { method: 'PUT', body: blob }, 'Gaudio file upload', signal, transferTimeout);
      const tag = response.headers.get('etag')?.replace(/^"|"$/g, '');
      await disregard(response);
      if (!response.ok || !tag || !/^[a-z0-9-]{1,128}$/iu.test(tag)) throw new Error('Gaudio could not verify an uploaded audio part.');
      parts.push({ awsETag: tag, partNumber: index + 1 });
    }
    await api('/files/upload-multipart/complete', { data: { uploadId, parts }, label: 'Gaudio upload completion' });
    const path = '/' + model + '/jobs';
    starting();
    const created = await api(path, { data: { audioUploadId: uploadId, ...(model === hq ? { type: 'vocal' } : {}) }, label: 'Gaudio submission' });
    const id = created?.jobId;
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(id)) throw new Error('Gaudio returned an invalid job reference.');
    identify(id);
    const result = await pollJob(async deadline => {
      const status = await api(path + '/' + id, { label: 'Gaudio job status', signal: deadline });
      if (status?.status === 'success') return status.downloadUrl ?? {};
      if (status?.status === 'failed') throw new Error('Gaudio could not separate this audio.');
      if (!['running', 'waiting'].includes(status?.status)) throw new Error('Gaudio returned an unknown job status.');
      return null;
    }, { label: 'Gaudio', signal, delay, interval: 10_000 });
    return { id, result };
  },
  stems(result, model) {
    const stems = [['Vocals', 'vocal']];
    if (model === shq) stems.push(['Instrumental', 'accom']);
    return stems.map(([name, key]) => [name, transferLink(result?.[key]?.wav, url =>
      gaudioS3(url.hostname) || /^(?:[\w.-]+\.)?gaudiolab\.(?:com|io)$/u.test(url.hostname) || /^[a-z0-9]+\.cloudfront\.net$/u.test(url.hostname), 'Gaudio')]);
  },
});

module.exports = { cloudSeparators: { mvsep, gaudio } };
