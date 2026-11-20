import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRecoveryStore } from '../src/main/recovery.cjs';
import { loadProject, projectRevision, saveProject } from '../src/domain/project-file.mjs';
import type { StudioProject } from '../src/domain/project';

const project: StudioProject = {
  schema: 'com.thepropervolume.karaoke-studio',
  version: 1,
  title: 'Original',
  artist: '',
  stems: [],
  lyrics: [],
  durationSeconds: 0,
};

test('flushes the latest session draft and retains the original project revision', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-recovery-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const original = join(folder, 'track.tpv.json');
  await saveProject(original, project);
  const revision = projectRevision(await loadProject(original));
  const source = await readFile(original, 'utf8');
  const directory = join(folder, 'recovery');
  const writer = createRecoveryStore(directory);
  const origin = { file: original, revision };
  const first = writer.update({ project: { ...project, title: 'Early edit' }, origin, lyricsDraft: null });
  const latest = writer.update({ project: { ...project, title: 'Last edit' }, origin, lyricsDraft: 'Unbuilt words' });
  await Promise.all([first, latest, writer.flush()]);

  const restartedEditor = createRecoveryStore(directory);
  const [entry] = await restartedEditor.list();
  assert.equal(entry.title, 'Last edit');
  assert.equal(entry.sourceFile, original);
  const recovered = await restartedEditor.get(entry.id);
  assert.equal(recovered.lyricsDraft, 'Unbuilt words');
  assert.deepEqual(recovered.origin, origin);
  assert.equal(await readFile(original, 'utf8'), source);
  assert.equal(await restartedEditor.get('../track.tpv'), null);
  assert.deepEqual(await writer.list(), []);

  await writeFile(original, source.replace('Original', 'Changed in another editor'), 'utf8');
  await assert.rejects(saveProject(original, recovered.project, { expectedRevision: recovered.origin.revision }), /changed on disk/);
  await restartedEditor.discard(entry.id);
  assert.deepEqual(await restartedEditor.list(), []);
});

test('clears only the current draft after saving or discarding its edits', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-recovery-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const writer = createRecoveryStore(folder);
  await Promise.all([writer.update({ project, origin: null, lyricsDraft: null }), writer.flush()]);
  const previousWriter = createRecoveryStore(folder);
  await Promise.all([previousWriter.update({ project: { ...project, title: 'Prior session' }, origin: null, lyricsDraft: null }), previousWriter.flush()]);
  await Promise.all([writer.update(null), writer.flush()]);
  assert.deepEqual((await createRecoveryStore(folder).list()).map(entry => entry.title), ['Prior session']);
});
