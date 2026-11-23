/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
const { openAsBlob } = require('node:fs');
const { extname, isAbsolute } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

const apiTimeout = 30_000;
const transferTimeout = 5 * 60_000;
const pollDeadline = 20 * 60_000;
const maximumJsonBytes = 4 * 1024 * 1024;
const vultrMaximumBytes = 25 * 1024 * 1024;
const vultrLanguages = new Set('af be bg ca cs cy da de en es et eu fi fr ga gl hr hu id is it ja lt lv mk ms nl no pl pt ro ru sk sl sq sv sw tl tr uk zh'.split(' '));
const audioTypes = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
  '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
};
const providers = {
  vultr: {
    name: 'Vultr', origin: 'https://api.vultrinference.com', verifyPath: '/v1/usage',
    auth: key => ({ Authorization: 'Bearer ' + key }),
    extensions: ['.wav', '.mp3'], fileLimit: vultrMaximumBytes, durationLimit: 900,
  },
  audioshake: {
    name: 'AudioShake', origin: 'https://api.audioshake.ai', verifyPath: '/tasks?take=1',
    auth: key => ({ 'x-api-key': key }),
    extensions: Object.keys(audioTypes), fileLimit: 5_000_000_000, durationLimit: 2700,
  },
};

function providerFor(engine) {
  if (!Object.hasOwn(providers, engine)) throw new Error('Choose a supported cloud lyric alignment provider.');
  return providers[engine];
}

function normalizeKey(value, name) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[!-~]{1,1024}$/u.test(key)) throw new Error('Enter a valid ' + name + ' API key.');
  return key;
}

function deadline(signal, timeout) {
  const timer = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

async function requestJson(fetchImpl, url, init, label, signal, timeout = apiTimeout) {
  const limit = deadline(signal, timeout);
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error', signal: limit });
  } catch {
    if (signal?.aborted) throw new Error(label + ' was interrupted.');
    if (limit.aborted) throw new Error(label + ' timed out.');
    throw new Error(label + ' could not connect. Check your internet connection.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const reason = {
      400: ' rejected the request. Check the audio format, duration, and lyric language.',
      401: ' rejected the API key.', 402: ' requires available credits or a funded account.',
      403: ' denied access. Check the API key and account permissions.',
      413: ' rejected the file because it is too large.', 429: ' limited requests. Try again in a minute.',
    }[response.status] ?? ' failed (HTTP ' + response.status + ').';
    const error = new Error(label + reason);
    error.status = response.status;
    throw error;
  }
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maximumJsonBytes) throw new Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(label + ' returned an unreadable or oversized response.');
  }
}

function client(provider, key, fetchImpl) {
  const headers = provider.auth(normalizeKey(key, provider.name));
  return (pathname, init, step, signal, timeout) => requestJson(fetchImpl, provider.origin + pathname,
    { ...init, headers: { ...headers, ...init.headers, Accept: 'application/json' } },
    provider.name + ' ' + step, signal, timeout);
}

async function testCloudAlignmentConnection(engine, key, { fetchImpl = fetch } = {}) {
  const provider = providerFor(engine);
  const api = client(provider, key, fetchImpl);
  const result = await api(provider.verifyPath, { method: 'GET' }, 'connection test');
  const valid = engine === 'vultr' ? Boolean(result?.usage) : Array.isArray(result);
  if (!valid) throw new Error(provider.name + ' returned an unexpected connection test response.');
  return { connected: true, status: 'connected', message: provider.name + ' accepted the API key.' };
}

async function audioForm(audioPath, provider) {
  const extension = typeof audioPath === 'string' ? extname(audioPath).toLowerCase() : '';
  if (!provider.extensions.includes(extension) || !isAbsolute(audioPath)) {
    const formats = provider === providers.vultr ? 'WAV or MP3' : 'WAV, AIFF, FLAC, MP3, M4A, or AAC';
    throw new Error('Choose a local ' + formats + ' file for ' + provider.name + '.');
  }
  let file;
  try { file = await openAsBlob(audioPath, { type: audioTypes[extension] }); }
  catch { throw new Error('Studio could not read the selected audio file.'); }
  if (!file.size || file.size > provider.fileLimit) {
    const size = provider === providers.vultr ? '25 MiB' : '5 GB';
    throw new Error('Choose a nonempty audio file no larger than ' + size + ' for ' + provider.name + '.');
  }
  return uploadForm(file, 'audio' + extension);
}

function uploadForm(blob, filename) {
  const form = new FormData();
  form.append('file', blob, filename);
  return form;
}

function responseId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error('AudioShake returned an invalid ' + label + '.');
  }
  return value;
}

function normalizeWords(raw, name) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 10_000) {
    throw new Error(name + ' did not return a usable set of word timings. Existing timings were kept.');
  }
  return raw.map(item => {
    const word = item?.text ?? item?.word;
    const start = item?.start ?? item?.startTime;
    const end = item?.end ?? item?.endTime;
    const confidence = item?.score ?? item?.confidence;
    if (typeof word !== 'string' || !word.trim() || word.length > 2000 ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(name + ' returned an invalid lyric timestamp. Existing timings were kept.');
    }
    return { word: word.trim(), start, end,
      ...(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? { confidence } : {}) };
  });
}

function normalizeDuration(duration, words, provider) {
  if (Number.isFinite(duration) && duration > 0 && duration <= provider.durationLimit + 1) return duration;
  const end = Math.max(...words.map(word => word.end));
  if (end > provider.durationLimit + 1) throw new Error(provider.name + ' returned invalid timing for this audio duration.');
  return end;
}

function audioShakeOutput(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error();
    const vendor = url.hostname === 'audioshake.ai' || url.hostname.endsWith('.audioshake.ai');
    const aws = /^(?:[a-z0-9.-]+\.)?s3(?:\.dualstack)?(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/u.test(url.hostname)
      && (url.searchParams.has('X-Amz-Signature') || url.searchParams.has('Signature'));
    const google = (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com'))
      && (url.searchParams.has('X-Goog-Signature') || url.searchParams.has('Signature'));
    const cloudfront = url.hostname.endsWith('.cloudfront.net') && url.searchParams.has('Signature') && url.searchParams.has('Key-Pair-Id');
    if (!(vendor || aws || google || cloudfront)) throw new Error();
    return url.toString();
  } catch { throw new Error('AudioShake returned an unrecognized alignment download link.'); }
}

async function waitForAudioShake(api, initial, id, options) {
  const signal = deadline(options.signal, pollDeadline);
  let task = initial;
  for (let attempt = 0; attempt < 240 && !signal.aborted; attempt++) {
    const target = Array.isArray(task?.targets) && task.targets.find(item => item?.model === 'alignment');
    if (target?.status === 'completed') return target;
    if (target?.status === 'error' || target?.status === 'failed') throw new Error('AudioShake could not align this audio to the supplied lyrics.');
    if (target && target.status !== 'processing') throw new Error('AudioShake returned an unknown alignment status.');
    try {
      await options.delay(5000, undefined, { signal });
      task = await api('/tasks/' + id, { method: 'GET' }, 'alignment status', signal);
      if (task?.id !== id || !Array.isArray(task.targets)) throw new Error('AudioShake returned the wrong alignment task.');
    } catch (error) {
      if (signal.aborted) break;
      // Polling is read-only. A 429 or service outage does not justify resubmitting the job.
      if (error.status !== 429 && !(error.status >= 500 && error.status <= 599)) throw error;
      try { await options.delay(15_000, undefined, { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
  }
  if (options.signal?.aborted) throw new Error('Waiting for AudioShake was interrupted.');
  throw new Error('AudioShake has not finished processing within 20 minutes.');
}

async function alignAudioShake(api, form, text, duration, options) {
  const { fetchImpl, signal } = options;
  const audio = await api('/assets', { method: 'POST', body: form }, 'audio upload', signal, transferTimeout);
  const assetId = responseId(audio?.id, 'audio asset ID');
  const transcriptForm = uploadForm(new Blob([text], { type: 'text/plain' }), 'lyrics.txt');
  const transcript = await api('/assets', { method: 'POST', body: transcriptForm }, 'lyric upload', signal);
  const transcriptAssetId = responseId(transcript?.id, 'lyric asset ID');
  if (assetId === transcriptAssetId) throw new Error('AudioShake did not create a separate lyric asset.');
  let task, jobId;
  try {
    task = await api('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, targets: [{ model: 'alignment', formats: ['json'], transcriptAssetId }] }),
    }, 'alignment submission', signal);
    jobId = responseId(task?.id, 'alignment task ID');
    const target = await waitForAudioShake(api, task, jobId, options);
    const output = Array.isArray(target.output) && target.output.find(item => item?.format === 'json');
    const result = await requestJson(fetchImpl, audioShakeOutput(output?.link), { method: 'GET' }, 'AudioShake alignment download', signal);
    // The AudioShake demo accepts both flat words and per-line word groups.
    const lines = result?.lines ?? result?.segments;
    const words = normalizeWords(result?.words ?? (Array.isArray(lines) ? lines.flatMap(line => line?.words ?? []) : result), 'AudioShake');
    const audioDuration = [target.duration, result?.duration, duration].find(value => Number.isFinite(value) && value > 0);
    return { duration: normalizeDuration(audioDuration, words, providers.audioshake), words };
  } catch (error) {
    // A missing or malformed submission response can still represent a billable job.
    if (jobId) throw new Error(error.message + ' Check AudioShake task ' + jobId + ' before submitting again.');
    if (!error.status || error.status >= 500) throw new Error(error.message + ' Check your AudioShake tasks before submitting again.');
    throw error;
  }
}

async function alignVultr(api, form, text, language, signal) {
  form.append('model', 'aligner-1');
  form.append('mode', 'lyrics');
  form.append('text', text);
  form.append('language', language);
  let result;
  try {
    result = await api('/v1/audio/alignments', { method: 'POST', body: form }, 'lyric alignment', signal, transferTimeout);
  } catch (error) {
    if (!error.status || error.status >= 500) throw new Error(error.message + ' Check Vultr usage before submitting again.');
    throw error;
  }
  if (Array.isArray(result?.unaligned) && result.unaligned.length) {
    const count = result.unaligned.length;
    throw new Error('Vultr could not place ' + count + ' lyric ' + (count === 1 ? 'line' : 'lines') + '. Existing timings were kept.');
  }
  const words = normalizeWords(result?.words, 'Vultr');
  const reviewLineIndexes = Array.isArray(result.lines) ? result.lines
    .filter(line => line?.certain === false && Number.isInteger(line.index) && line.index >= 0)
    .map(line => line.index) : [];
  return { duration: normalizeDuration(result.duration, words, providers.vultr), words, reviewLineIndexes };
}

async function alignCloudLyrics({ engine, audioPath, lyrics, language, duration, signal }, key, { fetchImpl = fetch, delay = wait } = {}) {
  const provider = providerFor(engine);
  const api = client(provider, key, fetchImpl);
  if (engine === 'vultr' && !vultrLanguages.has(language)) {
    throw new Error('Choose a lyric language supported by ' + provider.name + '.');
  }
  if (!Array.isArray(lyrics) || !lyrics.length || lyrics.length > 500 ||
      lyrics.some(line => typeof line !== 'string' || !line.trim() || line.length > 2000)) {
    throw new Error('Provide between 1 and 500 nonempty lyric lines.');
  }
  const suppliedText = lyrics.join('\n');
  if (Buffer.byteLength(suppliedText, 'utf8') > 256 * 1024) throw new Error('Provide lyric text of 256 KB or less.');
  if (engine === 'vultr' && [...suppliedText].length > 12_000) throw new Error('Vultr supports up to 12,000 lyric characters.');
  if (Number.isFinite(duration) && duration > provider.durationLimit) {
    throw new Error(provider.name + ' supports audio up to ' + provider.durationLimit / 60 + ' minutes.');
  }
  if (signal?.aborted) throw new Error('Lyric alignment was interrupted before upload.');
  const form = await audioForm(audioPath, provider);
  return engine === 'vultr' ? alignVultr(api, form, suppliedText, language, signal)
    : alignAudioShake(api, form, suppliedText, duration, { fetchImpl, delay, signal });
}

module.exports = { alignCloudLyrics, testCloudAlignmentConnection, vultrMaximumBytes };
