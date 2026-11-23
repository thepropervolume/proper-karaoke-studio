/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import cloud from '../src/main/cloud-alignment.cjs';

const { alignCloudLyrics, testCloudAlignmentConnection } = cloud;
const key = 'private-test-token';
const lyrics = ['Here we sing', 'Together again'];
const source = Buffer.from('RIFF----WAVEdata');
const taskId = 'task-0001';
const output = 'https://example.s3.us-east-1.amazonaws.com/task-0001/result.json?X-Amz-Signature=example';

async function fixture(t: TestContext, extension = '.wav') {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-cloud-alignment-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = join(directory, 'Private Song Name' + extension);
  await writeFile(audioPath, source);
  return { audioPath, lyrics, language: 'en' };
}

test('connection tests use authenticated read-only endpoints and redact response details', async () => {
  for (const [engine, url, header, expected] of [
    ['vultr', 'https://api.vultrinference.com/v1/usage', 'authorization', 'Bearer ' + key],
    ['audioshake', 'https://api.audioshake.ai/tasks?take=1', 'x-api-key', key],
  ]) {
    const connected = await testCloudAlignmentConnection(engine, key, {
      fetchImpl: async (request: string, init: RequestInit) => {
        assert.equal(request, url);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.equal(new Headers(init.headers).get(header), expected);
        assert.equal(init.body, undefined);
        const privateResponse = engine === 'vultr' ? { usage: { private: key } } : [{ private: key }];
        return Response.json(privateResponse);
      },
    });
    assert.equal(connected.connected, true);
    assert.equal(connected.status, 'connected');
    assert(!JSON.stringify(connected).includes(key));
    await assert.rejects(testCloudAlignmentConnection(engine, key, {
      fetchImpl: async () => Response.json({ error: key }, { status: 401 }),
    }), (error: unknown) => error instanceof Error && /rejected the API key/.test(error.message) && !error.message.includes(key));
  }
});

test('Vultr submits exact supplied lyrics for music alignment once and returns confidence', async t => {
  const input = await fixture(t);
  let submissions = 0;
  const result = await alignCloudLyrics({ ...input, engine: 'vultr' }, key, {
    fetchImpl: async (request: string, init: RequestInit) => {
      submissions++;
      assert.equal(request, 'https://api.vultrinference.com/v1/audio/alignments');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + key);
      assert(init.body instanceof FormData);
      assert.equal(init.body.get('model'), 'aligner-1');
      assert.equal(init.body.get('mode'), 'lyrics');
      assert.equal(init.body.get('language'), 'en');
      assert.equal(init.body.get('text'), lyrics.join('\n'));
      const file = init.body.get('file') as File;
      assert.equal(file.name, 'audio.wav');
      assert.equal(file.type, 'audio/wav');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
      return Response.json({ duration: 9, unaligned: [], lines: [{ index: 0, certain: true }, { index: 1, certain: false }],
        words: [{ text: 'Here', start: 0, end: 0.55, score: 0.9 }, { text: 'we', start: 1, end: 1.2 }] });
    },
  });
  assert.equal(submissions, 1);
  assert.deepEqual(result, { duration: 9, reviewLineIndexes: [1],
    words: [{ word: 'Here', start: 0, end: 0.55, confidence: 0.9 }, { word: 'we', start: 1, end: 1.2 }] });
});

test('Vultr fails cleanly when a line is missing and validates unsupported formats before uploading', async t => {
  const input = await fixture(t);
  await assert.rejects(alignCloudLyrics({ ...input, engine: 'vultr' }, key, {
    fetchImpl: async () => Response.json({ unaligned: [{ line: 1, reason: 'unplaced' }] }),
  }), /could not place 1 lyric line.*Existing timings were kept/);
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; return Response.json({}); } };
  await assert.rejects(alignCloudLyrics({ ...input, engine: 'vultr', language: 'vi' }, key, options), /language supported by Vultr/);
  await assert.rejects(alignCloudLyrics({ ...input, engine: 'vultr', audioPath: input.audioPath + '.flac' }, key, options), /WAV or MP3/);
  assert.equal(calls, 0);
});

test('AudioShake uploads the lyric text separately and polls only the submitted alignment job', async t => {
  const input = await fixture(t, '.flac');
  const steps: string[] = [];
  const delays: number[] = [];
  let polls = 0;
  const result = await alignCloudLyrics({ ...input, engine: 'audioshake' }, key, {
    delay: async (time: number) => { delays.push(time); },
    fetchImpl: async (request: string, init: RequestInit) => {
      const url = new URL(request);
      const headers = new Headers(init.headers);
      assert.equal(init.redirect, 'error');
      if (request === output) {
        steps.push('download');
        assert.equal(init.method, 'GET');
        assert.equal(headers.has('x-api-key'), false);
        assert.equal(headers.has('authorization'), false);
        return Response.json({ lines: [{ words: [{ text: ' Here ', start: 0, end: 0.8 }] },
          { words: [{ word: 'Together', startTime: 4.4, endTime: 5.2, confidence: 0.75 }] }] });
      }
      assert.equal(url.host, 'api.audioshake.ai');
      assert.equal(headers.get('x-api-key'), key);
      if (url.pathname === '/assets') {
        assert.equal(init.method, 'POST');
        assert(init.body instanceof FormData);
        const file = init.body.get('file') as File;
        steps.push(file.name);
        if (file.name === 'audio.flac') {
          assert.equal(file.type, 'audio/flac');
          assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
          return Response.json({ id: 'test-audio-1' });
        }
        assert.equal(file.name, 'lyrics.txt');
        assert.equal(file.type, 'text/plain');
        assert.equal(await file.text(), lyrics.join('\n'));
        return Response.json({ id: 'test-lyrics-1' });
      }
      if (url.pathname === '/tasks') {
        steps.push('submit');
        assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(String(init.body)), { assetId: 'test-audio-1', targets: [
          { model: 'alignment', formats: ['json'], transcriptAssetId: 'test-lyrics-1' },
        ] });
        return Response.json({ id: taskId, targets: [{ model: 'alignment', status: 'processing' }] });
      }
      steps.push('poll');
      assert.equal(url.pathname, '/tasks/' + taskId);
      assert.equal(init.method, 'GET');
      if (++polls === 1) return new Response(null, { status: 429 });
      return Response.json({ id: taskId, targets: [{ model: 'alignment', status: 'completed', duration: 6.2,
        output: [{ format: 'json', link: output }] }] });
    },
  });
  assert.deepEqual(steps, ['audio.flac', 'lyrics.txt', 'submit', 'poll', 'poll', 'download']);
  assert.deepEqual(delays, [5000, 15_000, 5000]);
  assert.deepEqual(result, { duration: 6.2, words: [
    { word: 'Here', start: 0, end: 0.8 }, { word: 'Together', start: 4.4, end: 5.2, confidence: 0.75 },
  ] });
});

test('cloud alignment rejects credential redirects, unsafe output destinations, and repeat submission', async t => {
  const input = await fixture(t);
  let calls = 0;
  await assert.rejects(alignCloudLyrics({ ...input, engine: 'vultr' }, key, {
    fetchImpl: async (url: string, init: RequestInit) => {
      calls++;
      assert.equal(init.redirect, 'error');
      assert.equal(new URL(url).host, 'api.vultrinference.com');
      throw new Error('Redirect, credential: ' + key);
    },
  }), (error: unknown) => error instanceof Error && /Check Vultr usage/.test(error.message) && !error.message.includes(key));
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(alignCloudLyrics({ ...input, engine: 'audioshake' }, key, {
    fetchImpl: async (url: string) => {
      assert.equal(new URL(url).host, 'api.audioshake.ai');
      if (++calls < 3) return Response.json({ id: 'asset-' + calls });
      return Response.json({ id: taskId, targets: [{ model: 'alignment', status: 'completed',
        output: [{ format: 'json', link: 'https://127.0.0.1/result.json' }] }] });
    },
  }), /unrecognized alignment download link.*Check AudioShake task task-0001/);
  assert.equal(calls, 3);
});
