import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import dango from '../src/main/dango-separator.cjs';

const credentials = { appKey: 'example-key', appSecret: 'example-secret' };
const now = () => 1585135635331;
const channel = '25ff1dbf0d504d65bf1dbf0d50ed65da';
const jobId = '33441abf7d3f4d3c841abf7d3f2d3c86';
const apiHost = 'api.tuanziai.com';
const uploadHost = 'dangoai.oss-accelerate.aliyuncs.com';
const downloadHost = 'dangoai.oss-cn-hangzhou.aliyuncs.com';
const sourceBytes = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 3, 5, 7, 11);
const flacBytes = Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 7, 11, 13);
const mp3Bytes = Uint8Array.of(0x49, 0x44, 0x33, 0x04, 7, 11, 13);
const ok = (data: unknown) => Response.json({ code: 0, data });
const token = () => credentials.appKey + '$$' + now() + '$$' + createHash('md5').update(credentials.appSecret + now()).digest('hex');

async function sourceFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'studio-dango-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'private song.wav');
  await writeFile(sourcePath, sourceBytes);
  return { credentials, sourcePath, outputDirectory: root };
}

test('the credential test calls only the Dango echo endpoint and returns status', async () => {
  const requests: string[] = [];
  const result = await dango.checkDangoConnection(credentials, {
    now,
    fetchImpl: async (url: string, init: RequestInit) => {
      requests.push(url);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('token'), token());
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), { test: 'tpv-studio-check' });
      return ok('tpv-studio-check');
    },
  });
  assert.deepEqual(requests, ['https://' + apiHost + '/echo']);
  assert.deepEqual(result, { connected: true });
  await assert.rejects(() => dango.checkDangoConnection(credentials, {
    fetchImpl: async () => ok('ok'),
  }), /unexpected connection test result/u);
  await assert.rejects(() => dango.checkDangoConnection(credentials, {
    fetchImpl: async () => Response.json({ code: -1, message: credentials.appSecret }),
  }), error => error instanceof Error && /computer clock/u.test(error.message) && !error.message.includes(credentials.appSecret));
});

test('Dango separates a source through one submission and authenticated API calls only', async t => {
  const input = await sourceFixture(t);
  const apiPaths: string[] = [];
  const downloads: string[] = [];
  const intervals: number[] = [];
  let polls = 0;
  const result = await dango.separateWithDango({ ...input, model: '30' }, {
    now,
    delay: async (ms: number) => { intervals.push(ms); },
    fetchImpl: async (target: string | URL, init: RequestInit) => {
      const url = new URL(target);
      assert.equal(url.protocol, 'https:');
      assert.equal(init.redirect, 'error');
      const headers = new Headers(init.headers);
      if (url.hostname === apiHost) {
        assert.equal(headers.get('token'), token());
        assert.equal(init.method, 'POST');
        apiPaths.push(url.pathname);
        if (url.pathname === '/vocal-remover/upload/channel') {
          assert.deepEqual(JSON.parse(String(init.body)), { uploadVersion: 2, style: 30, filename: 'song.wav' });
          return ok({ channel, url: 'https://' + uploadHost + '/', form: { key: 'fake-oss-key', success_action_status: 204 } });
        }
        if (url.pathname === '/vocal-remover/upload/' + channel + '/result') return ok(jobId);
        if (url.pathname === '/vocal-remover/' + jobId) return ok({ status: ++polls === 1 ? 0 : 2, lossless: true });
        return ok({ url: 'http://' + downloadHost + '/out/' + jobId + url.pathname });
      }
      assert.equal(headers.has('token'), false);
      if (url.hostname === uploadHost) {
        assert.equal(init.method, 'POST');
        const form = init.body as FormData;
        assert.deepEqual([...form.keys()], ['key', 'success_action_status', 'file']);
        const file = form.get('file') as File;
        assert.equal(file.name, 'song.wav');
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), sourceBytes);
        return new Response(null, { status: 204 });
      }
      assert.equal(url.hostname, downloadHost);
      assert.equal(init.method, 'GET');
      downloads.push(url.pathname);
      return new Response(flacBytes);
    },
  });
  assert.deepEqual(intervals, [12_000, 5_000]);
  assert.equal(apiPaths.filter(path => path.endsWith('/result')).length, 1);
  assert.equal(downloads.length, 2);
  assert.equal(result.jobId, jobId);
  assert.deepEqual(result.files.map((file: string) => basename(file)), ['Instrumental.flac', 'Vocals.flac']);
  for (const file of result.files) assert.deepEqual(new Uint8Array(await readFile(file)), flacBytes);
});

test('Dango model options can request a third stem and select its download variants', async t => {
  const input = await sourceFixture(t);
  const downloads: string[] = [];
  const result = await dango.separateWithDango({
    ...input, model: '31', modelOptions: { separateBackingVocals: true, modelType: 'aggressive', format: 'mp3' },
  }, {
    now,
    delay: async () => {},
    fetchImpl: async (target: string | URL, init: RequestInit) => {
      const url = new URL(target);
      if (url.hostname === uploadHost) return new Response(null, { status: 204 });
      if (url.hostname === downloadHost) return new Response(mp3Bytes);
      if (url.pathname === '/vocal-remover/upload/channel') {
        assert.deepEqual(JSON.parse(String(init.body)), {
          uploadVersion: 2, style: 31, filename: 'song.wav', config: { separateBackingVocals: true },
        });
        return ok({ channel, url: 'https://' + uploadHost, form: { key: 'fake-oss-key' } });
      }
      if (url.pathname === '/vocal-remover/upload/' + channel + '/result') return ok(jobId);
      if (url.pathname === '/vocal-remover/' + jobId) return ok({ status: 2, lossless: true });
      const prefix = '/vocal-remover/' + jobId + '/download/aggressive/mp3/';
      assert.equal(url.pathname.startsWith(prefix), true);
      downloads.push(url.pathname.slice(prefix.length));
      return ok({ url: 'https://' + downloadHost + url.pathname });
    },
  });
  assert.deepEqual(downloads, ['instrumental', 'vocals', 'backVocals']);
  assert.deepEqual(result.files.map((file: string) => basename(file)), ['Instrumental.mp3', 'Vocals.mp3', 'Backing Vocals.mp3']);
  for (const file of result.files) assert.deepEqual(await readFile(file), Buffer.from(mp3Bytes));
});

test('Dango rejects unsupported model options before connecting', async t => {
  const input = await sourceFixture(t);
  const options = { fetchImpl: async () => assert.fail('Dango must validate options before connecting') };
  await assert.rejects(() => dango.separateWithDango({
    ...input, modelOptions: { separateBackingVocals: true },
  }, options), /Use Dango model 31/);
  await assert.rejects(() => dango.separateWithDango({
    ...input, sourcePath: join(input.outputDirectory, 'source.mp3'), modelOptions: { format: 'flac' },
  }, options), /Choose a WAV or FLAC source/);
  await assert.rejects(() => dango.separateWithDango({
    ...input, modelOptions: { splitType: 3 },
  }, options), /Choose supported Dango model options/);
  assert.deepEqual(await readdir(input.outputDirectory), ['private song.wav']);
});

test('Dango rejects file redirects to an unrecognized host and never retries a billed request', async t => {
  const input = await sourceFixture(t);
  let calls = 0;
  await assert.rejects(() => dango.separateWithDango(input, {
    fetchImpl: async () => {
      calls++;
      return ok({ channel, url: 'https://' + uploadHost + '.example.com', form: { key: 'fake-oss-key' } });
    },
  }), /unrecognized file storage location/);
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(input.outputDirectory), ['private song.wav']);

  const paths: string[] = [];
  await assert.rejects(() => dango.separateWithDango(input, {
    fetchImpl: async (target: string | URL) => {
      const { hostname, pathname } = new URL(target);
      paths.push(pathname);
      if (pathname.endsWith('/channel')) return ok({ channel, url: 'https://' + uploadHost, form: { key: 'fake-oss-key' } });
      if (hostname === uploadHost) return new Response(null, { status: 204 });
      throw new Error(credentials.appSecret);
    },
  }), error => error instanceof Error && /Check your Dango jobs before submitting again/u.test(error.message)
    && !error.message.includes(credentials.appSecret));
  assert.equal(paths.filter(path => path.endsWith('/result')).length, 1);
  assert.deepEqual(await readdir(input.outputDirectory), ['private song.wav']);
});
