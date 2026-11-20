import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import libraryModule from '../src/main/model-library.cjs';
import separation from '../src/main/local-separator.cjs';

const checkpoint = Buffer.from('Verified model fixture');
const sha256 = createHash('sha256').update(checkpoint).digest('hex');
const leaf = 'sample.onnx';
const catalog = [{
  id: leaf, label: 'Sample Model', group: 'MDX-Net', adapter: 'audio-separator', purpose: 'separation',
  files: [{ name: leaf, url: 'https://github.com/TRvlvr/model_repo/releases/download/models/' + leaf, sha256 }],
}];

test('detects a UVR installation and reuses verified weights without modifying the source folder', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tpv-model-library-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installation = path.join(directory, 'Ultimate Vocal Remover');
  const source = path.join(installation, 'models', 'MDX_Net_Models');
  await mkdir(source, { recursive: true });
  const original = path.join(source, leaf);
  await writeFile(original, checkpoint);
  const library = libraryModule.createModelLibrary(path.join(directory, 'cache'), {
    searchRoots: [installation], downloads: catalog,
    fetchModel: () => { throw new Error('Reuse must not fetch models.'); },
  });
  const inventory = await library.inventory();
  assert.deepEqual(inventory.detectedFolders, [path.join(installation, 'models')]);
  assert.equal(inventory.uvrDirectory, null);
  assert.equal(inventory.models[0].foundInUvr, true);
  assert.equal(inventory.models[0].downloaded, false);
  const destination = await library.prepare([leaf], installation);
  assert.deepEqual(await readFile(path.join(destination, leaf)), checkpoint);
  assert.deepEqual(await readFile(original), checkpoint);
  assert.equal((await library.inventory(installation)).models[0].downloaded, true);
  await assert.rejects(library.directory(path.join(directory, 'missing')), /Choose the Ultimate Vocal Remover/);
  await writeFile(path.join(destination, leaf), 'Changed checkpoint');
  await assert.rejects(library.prepare([leaf], installation), /failed verification/);
});

test('downloads only approved models, follows public CDN redirects, and verifies bytes before publishing', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tpv-model-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0, corrupt = true;
  const library = libraryModule.createModelLibrary(directory, {
    searchRoots: [], downloads: catalog,
    fetchModel: async (url: URL) => {
      calls++;
      if (url.hostname === 'github.com') return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/verified' } });
      return new Response(corrupt ? 'Blocked payload' : checkpoint);
    },
  });
  await assert.rejects(library.download('../evil'), /Choose a model from the Studio download catalog/);
  assert.equal(calls, 0);
  await assert.rejects(library.download(leaf), /published checksum/);
  assert.deepEqual(await readdir(path.join(directory, 'Audio Separator')), []);
  corrupt = false;
  await Promise.all([library.download(leaf), library.download(leaf)]);
  assert.equal(calls, 6);
  assert.deepEqual(await readFile(path.join(directory, 'Audio Separator', leaf)), checkpoint);
  await library.download(leaf);
  assert.equal(calls, 6);
});

test('runs an ensemble on the mix, splits only its vocals, and maps the three stem roles', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tpv-separator-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: string[][] = [];
  const expected = separation.normalizeEnsemble('leadmix.onnx', ['leadmix.onnx', 'second.onnx', 'second.onnx'], '5_HP-Karaoke-UVR.pth');
  assert.deepEqual(expected.extra, ['second.onnx']);
  const result = await separation.runAudioSeparator({
    ...expected, source: path.join(directory, 'mix.wav'), executable: 'audio-separator', model: 'leadmix.onnx',
    modelDirectory: path.join(directory, 'models'), modelArgs: [], extensions: new Set(['.wav']),
  }, directory, async (_executable: string, args: string[]) => {
    calls.push(args);
    const output = args[args.indexOf('--output_dir') + 1];
    const files = calls.length === 1 ? ['Vocals.wav', 'Instrumental.wav'] : ['Lead Vocals.wav', 'Backing Vocals.wav'];
    await Promise.all(files.map(file => writeFile(path.join(output, file), file)));
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(calls[0].indexOf('--extra_models'), calls[0].indexOf('--ensemble_algorithm')), ['--extra_models', 'second.onnx']);
  assert.equal(path.basename(calls[1][0]), 'Vocals.wav');
  assert.equal(calls[1][2], '5_HP-Karaoke-UVR.pth');
  assert.deepEqual(result.files.map((file: string) => result.roles[file]), ['instrumental', 'lead', 'backing']);
  assert.throws(() => separation.normalizeEnsemble('main.onnx', ['../unsafe']), /additional models/);
});
