import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import yazl from 'yazl';
import { importKit } from '../src/main/kit-import.cjs';

const original = {
  schema: 'com.thepropervolume.karaoke-studio',
  version: 1,
  title: 'A portable song',
  artist: 'TPV',
  durationSeconds: 5,
  stems: [{ id: 'stem-one', name: 'Vocals', role: 'lead', voice: 'Singer', path: 'stems/01-vocals.wav', volume: 0.4, durationSeconds: 5 }],
  lyrics: [{ id: 'line-one', text: 'Hello', startSeconds: 1, endSeconds: 1.6, words: [{ text: 'Hello', startSeconds: 1, endSeconds: 1.6 }] }],
  importedCdg: 'source/graphics.cdg',
};

async function makeKit(archive: string, manifest: unknown, entries: Record<string, string>) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  for (const [name, contents] of Object.entries(entries)) zip.addBuffer(Buffer.from(contents), name, { compress: false });
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(archive));
}

test('reopens a kit into a new project with usable local media and unchanged cue timing', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-kit-import-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const archive = join(folder, 'song.tpvkit');
  const destination = join(folder, 'song.tpv.json');
  await makeKit(archive, original, { 'stems/01-vocals.wav': 'audio fixture', 'source/graphics.cdg': 'graphics fixture' });
  const result = await importKit(archive, destination);
  assert.equal(result.file, destination);
  assert.equal(result.project.stems[0].volume, 0.4);
  assert.deepEqual(result.project.lyrics, original.lyrics);
  assert.equal(await readFile(result.project.stems[0].path, 'utf8'), 'audio fixture');
  assert.equal(await readFile(result.project.importedCdg, 'utf8'), 'graphics fixture');
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).title, original.title);
  await assert.rejects(importKit(archive, destination), /new project file/);
});

test('rejects traversal and duplicate normalized paths before writing any project assets', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-kit-paths-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const archive = join(folder, 'bad.tpvkit');
  const destination = join(folder, 'song.tpv.json');
  await makeKit(archive, original, { 'ab/stem.mp3': 'outside fixture' });
  // Modify a same-length archive name so the ZIP writer cannot reject the fixture first.
  const bytes = await readFile(archive);
  for (let index = bytes.indexOf('ab/stem.mp3'); index !== -1; index = bytes.indexOf('ab/stem.mp3', index + 11)) {
    bytes.write('../stem.mp3', index);
  }
  await writeFile(archive, bytes);
  await assert.rejects(importKit(archive, destination), /invalid.*path|invalid relative path/i);
  await makeKit(archive, original, { 'stems/01-vocals.wav': 'audio fixture', 'STEMS/01-VOCALS.WAV': 'duplicate' });
  await assert.rejects(importKit(archive, destination), /duplicate archive paths/);
  assert.deepEqual(await readdir(folder), ['bad.tpvkit']);
});

test('rejects corrupted audio and removes photos or stems staged by a failed import', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'tpv-kit-corrupt-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const archive = join(folder, 'bad.tpvkit');
  const destination = join(folder, 'song.tpv.json');
  await makeKit(archive, original, { 'stems/01-vocals.wav': 'audio fixture', 'source/graphics.cdg': 'graphics fixture' });
  const bytes = await readFile(archive);
  const marker = bytes.indexOf('graphics fixture');
  assert.notEqual(marker, -1);
  bytes[marker] ^= 0x10;
  await writeFile(archive, bytes);
  await assert.rejects(importKit(archive, destination), /ZIP integrity check/);
  assert.deepEqual(await readdir(folder), ['bad.tpvkit']);
});
