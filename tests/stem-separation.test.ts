/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { projectRevision, projectSchema, saveProject } from '../src/domain/project-file.mjs';
import separation from '../src/main/stem-separation.cjs';
import operations from '../src/main/studio-operations.cjs';

test('separation requires a current saved project and keeps results in its own sibling folder', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tpv-stem-job-')));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const source = join(directory, 'Mix.wav'), file = join(directory, 'Demo.tpv.json');
  const project = {
    schema: projectSchema, version: 1, title: 'Demo', artist: '', durationSeconds: 30, lyrics: [],
    stems: [{ id: 'mix', name: 'Mix', voice: '', role: 'other', path: source, durationSeconds: 30, volume: 1 }],
  };
  await assert.rejects(separation.projectStemDirectory(undefined, source), /Save the project/);
  const saved = await saveProject(file, project);
  const origin = { file, revision: projectRevision(saved) };
  const destination = join(directory, 'Demo.tpv.json.stems');
  await assert.rejects(separation.projectStemDirectory(origin, join(directory, 'Unknown.wav')), /Save the selected source/);
  assert.equal(await separation.projectStemDirectory(origin, source), destination);
  assert.equal(await separation.projectStemDirectory(origin, source), destination);
  const newer = await saveProject(file, { ...project, title: 'New title' });
  await assert.rejects(separation.projectStemDirectory(origin, source), /changed/);
  const redirected = join(directory, 'outside');
  await mkdir(redirected);
  await rm(destination, { recursive: true });
  await symlink(redirected, destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(separation.projectStemDirectory({ file, revision: projectRevision(newer) }, source), /local directory/);
});

test('stem progress reports only actual console progress and estimated seconds across chunks', () => {
  const progress: Array<{ message: string; progress: number; remainingSeconds: number }> = [];
  const collect = separation.stemToolProgress((item: (typeof progress)[number]) => progress.push(item), 'Separating stems…');
  collect('Loaded the model\n\u001b[2K18%|██ | ');
  collect('8/45 [00:06<00:33, 1.24it/s]\r18%|██ | 8/45 [00:06<00:33, 1.24it/s]\r');
  collect('90%|█████████ | 40/45 [01:00<00:08, 1.30it/s]\r');
  collect('writing output 99%\n');
  assert.deepEqual(progress, [
    { message: 'Separating stems…', progress: 0.18, remainingSeconds: 33 },
    { message: 'Separating stems…', progress: 0.90, remainingSeconds: 8 },
  ]);
});

test('local separation streams tool progress and keeps previous runs and the source', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-stem-run-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const source = join(directory, 'Mix.wav');
  const mock = `
    const fs = require('node:fs');
    const path = require('node:path');
    const output = process.argv[process.argv.indexOf('--output_dir') + 1];
    process.stderr.write('30%|██ | 3/10 [00:04<00:10, 2.1it/s]\\r');
    fs.writeFileSync(path.join(output, 'Vocals.wav'), 'mock vocals');
  `;
  await writeFile(source, mock);
  const input = { sourcePath: source, adapter: 'audio-separator', executable: process.execPath, model: 'model.onnx' };
  const updates: object[] = [];
  const first = await operations.separate(input, directory, (update: object) => updates.push(update));
  const second = await operations.separate(input, directory);
  assert.notEqual(first.outputDirectory, second.outputDirectory);
  assert.equal(await readFile(first.files[0], 'utf8'), 'mock vocals');
  assert.equal(await readFile(second.files[0], 'utf8'), 'mock vocals');
  assert.equal(await readFile(source, 'utf8'), mock);
  assert.deepEqual(updates, [
    { message: 'Separating stems…' },
    { message: 'Separating stems…', progress: 0.3, remainingSeconds: 10 },
  ]);
});
