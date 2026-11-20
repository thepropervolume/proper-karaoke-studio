/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import cloud from '../src/main/cloud-separators.cjs';

const { mvsep, gaudio } = cloud.cloudSeparators;
const apiKey = 'private-example+key';
const wav = Buffer.from('RIFF----WAVEdata');
const gaJob = '145f8a80-3091-4562-a597-1dcd54339988';
const mvJob = '20260327071601-0e3e5c6c85-audio.wav';
const gaPrefix = '/developers/api/v1';
const gaShq = '/gsep_music_shq_v1/jobs';
const gaHq = '/gsep_music_hq_v1/jobs';
const gaUploadHost = 's3.ap-northeast-2.amazonaws.com';
const gaUpload = 'https://' + gaUploadHost + '/test?X-Amz-Signature=' + 'a'.repeat(64);
const gaDownloadBase = 'https://example.cloudfront.net/';
const mvDownloadBase = 'https://sg.mvsep.com/results/';
const gaOk = (data: unknown) => Response.json({ resultCode: 1000, resultData: data });
const empty = async () => {};

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tpv-cloud-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'Private Demo Song.wav');
  await writeFile(sourcePath, wav);
  return { credentials: apiKey, sourcePath, outputDirectory: root };
}

test('MVSEP credential check is read-only and excludes account details', async () => {
  assert.deepEqual(await mvsep.verify('  ' + apiKey + '  ', {
    fetchImpl: async (target: string, init: RequestInit) => {
      const url = new URL(target);
      assert.equal(url.host, 'mvsep.com');
      assert.equal(url.pathname, '/api/app/user');
      assert.equal(url.searchParams.get('api_token'), apiKey);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      return Response.json({ success: true, data: { api_token: apiKey, email: 'example@example.com' } });
    },
  }), { connected: true });
  await assert.rejects(mvsep.verify(apiKey, {
    fetchImpl: async () => Response.json({ success: false, message: apiKey }, { status: 400 }),
  }), (error: unknown) => error instanceof Error && /rejected/.test(error.message) && !error.message.includes(apiKey));
});

test('MVSEP Karaoke supplies separate WAV stems and drops the redundant mix', async t => {
  const input = await fixture(t);
  const fixtureStems = { 'Vocals lead': 'lead', 'Vocals back': 'backing', 'Instrum only': 'instrumental', 'Back instrum': 'mix' };
  let submissions = 0;
  let polls = 0;
  const downloads: string[] = [];
  const intervals: number[] = [];
  const result = await mvsep.separate({ ...input, model: '49' }, {
    delay: async (interval: number) => { intervals.push(interval); },
    fetchImpl: async (target: string | URL, init: RequestInit) => {
      const url = new URL(target);
      assert.equal(init.redirect, 'error');
      if (url.pathname === '/api/separation/create') {
        submissions++;
        assert.equal(url.hostname, 'mvsep.com');
        assert.equal(init.method, 'POST');
        assert(init.body instanceof FormData);
        assert.equal(init.body.get('api_token'), apiKey);
        assert.equal(init.body.get('sep_type'), '49');
        assert.equal(init.body.get('add_opt2'), '1');
        assert.equal(init.body.get('output_format'), '1');
        assert.equal(init.body.get('is_demo'), '0');
        assert.equal((init.body.get('audiofile') as File).name, 'audio.wav');
        return Response.json({ success: true, data: { hash: mvJob } });
      }
      if (url.pathname === '/api/separation/get') {
        assert.equal(url.searchParams.get('hash'), mvJob);
        assert.equal(url.searchParams.has('api_token'), false);
        if (++polls === 1) return new Response(null, { status: 429 });
        if (polls === 2) return Response.json({ success: true, status: 'processing' });
        const files = Object.entries(fixtureStems).map(([type, stem]) => ({ type, url: mvDownloadBase + stem + '.wav' }));
        return Response.json({ success: true, status: 'done', data: { files } });
      }
      assert.equal(url.hostname, 'sg.mvsep.com');
      assert.equal(init.headers, undefined);
      downloads.push(url.pathname);
      return new Response(wav);
    },
  });
  assert.equal(submissions, 1);
  assert.deepEqual(intervals, [10_000, 60_000, 10_000]);
  assert.equal(result.jobId, mvJob);
  assert.deepEqual(downloads, ['/results/lead.wav', '/results/backing.wav', '/results/instrumental.wav']);
  assert.deepEqual(result.files.map((file: string) => basename(file)), ['Lead Vocals.wav', 'Backing Vocals.wav', 'Instrumental.wav']);
  assert.deepEqual(await readFile(result.files[0]), wav);
});

test('Gaudio verifies access through a documented not-found result, with HQ fallback', async () => {
  const paths: string[] = [];
  assert.deepEqual(await gaudio.verify(apiKey, {
    fetchImpl: async (target: string, init: RequestInit) => {
      const url = new URL(target);
      const path = url.pathname.slice(gaPrefix.length);
      paths.push(path);
      assert.equal(url.host, 'restapi.gaudiolab.io');
      assert.equal(init.method, 'GET');
      assert.equal(new Headers(init.headers).get('x-ga-apikey'), apiKey);
      if (path.startsWith(gaShq)) return new Response(null, { status: 403 });
      assert(path.startsWith(gaHq));
      return Response.json({ resultCode: 1104, resultMessage: 'Requested job ID not found.' });
    },
  }), { connected: true });
  assert.equal(paths.length, 2);
  await assert.rejects(gaudio.verify(apiKey, {
    fetchImpl: async () => Response.json({ message: apiKey }, { status: 401 }),
  }), (error: unknown) => error instanceof Error && /rejected/.test(error.message) && !error.message.includes(apiKey));
});

test('Gaudio completes a multipart upload, submits once, and saves SHQ vocals and accompaniment', async t => {
  const input = await fixture(t);
  const operations: string[] = [];
  const result = await gaudio.separate(input, {
    delay: empty,
    fetchImpl: async (target: string | URL, init: RequestInit) => {
      const url = new URL(target);
      assert.equal(init.redirect, 'error');
      const headers = new Headers(init.headers);
      if (url.hostname === gaUploadHost) {
        const part = Number(url.searchParams.get('partNumber'));
        operations.push('upload ' + part);
        const blob = init.body as Blob;
        assert.equal(init.method, 'PUT');
        assert.equal(headers.has('x-ga-apikey'), false);
        assert.deepEqual(Buffer.from(await blob.arrayBuffer()), wav.subarray((part - 1) * 8, part * 8));
        return new Response(null, { headers: { ETag: '"abc' + part + '"' } });
      }
      if (url.hostname.endsWith('.cloudfront.net')) {
        operations.push(url.pathname);
        assert.equal(headers.has('x-ga-apikey'), false);
        return new Response(wav);
      }
      assert.equal(headers.get('x-ga-apikey'), apiKey);
      assert.equal(url.hostname, 'restapi.gaudiolab.io');
      const path = url.pathname.slice(gaPrefix.length);
      operations.push(path);
      const payload = init.body && JSON.parse(String(init.body));
      if (path === '/files/upload-multipart/create') {
        assert.deepEqual(payload, { fileName: 'audio.wav', fileSize: wav.length });
        return gaOk({ uploadId: 'test-upload-id', chunkSize: 8, preSignedUrl: [gaUpload + '&partNumber=1', gaUpload + '&partNumber=2'] });
      }
      if (path === '/files/upload-multipart/complete') {
        assert.deepEqual(payload, { uploadId: 'test-upload-id', parts: [{ awsETag: 'abc1', partNumber: 1 }, { awsETag: 'abc2', partNumber: 2 }] });
        return gaOk({});
      }
      if (path === gaShq) {
        assert.deepEqual(payload, { audioUploadId: 'test-upload-id' });
        return gaOk({ jobId: gaJob });
      }
      assert.equal(path, gaShq + '/' + gaJob);
      assert.equal(init.method, 'GET');
      return gaOk({ status: 'success', downloadUrl: { vocal: { wav: gaDownloadBase + 'sung.wav' }, accom: { wav: gaDownloadBase + 'music.wav' } } });
    },
  });
  assert.deepEqual(operations, ['/files/upload-multipart/create', 'upload 1', 'upload 2', '/files/upload-multipart/complete', gaShq, gaShq + '/' + gaJob, '/sung.wav', '/music.wav']);
  assert.equal(result.jobId, gaJob);
  assert.deepEqual(result.files.map((file: string) => basename(file)), ['Vocals.wav', 'Instrumental.wav']);
  assert.deepEqual(await readFile(result.files[1]), wav);
});

test('cloud separation blocks untrusted destinations and does not retry a lost submission', async t => {
  const input = await fixture(t);
  let calls = 0;
  await assert.rejects(gaudio.separate(input, {
    delay: empty,
    fetchImpl: async () => {
      calls++;
      return gaOk({ uploadId: 'test-upload-id', chunkSize: 100, preSignedUrl: ['https://127.0.0.1/'] });
    },
  }), /unrecognized file transfer link/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(mvsep.separate(input, {
    delay: empty,
    fetchImpl: async () => {
      calls++;
      throw new Error(apiKey);
    },
  }), (error: unknown) => error instanceof Error && /Check your MVSEP jobs before submitting again/.test(error.message) && !error.message.includes(apiKey));
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(input.outputDirectory), ['Private Demo Song.wav']);
});
