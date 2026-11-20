import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

const { downloadLyrics } = createRequire(import.meta.url)('../src/main/ktools.cjs');

async function stubKtools(context: TestContext, contents: string) {
  const ktoolsHome = await mkdtemp(join(tmpdir(), 'Studio ktools test '));
  context.after(() => rm(ktoolsHome, { recursive: true, force: true }));
  await mkdir(join(ktoolsHome, 'python'));
  // Use Node as the child interpreter so this test exercises the CLI contract without a Python install.
  await writeFile(join(ktoolsHome, 'python', 'tpv_karaoke_lyrics.py'), contents);
  return { ktoolsHome, python: process.execPath, outputDirectory: join(ktoolsHome, 'output') };
}

test('passes literal lyric lookup arguments and keeps selection details', async context => {
  const stub = await stubKtools(context, `
    const args = process.argv.slice(2);
    const selection = { text_version_count: 2 };
    console.log(JSON.stringify({
      success: true, plain_file: 'lyrics.txt', manifest_file: 'lyrics.json', args,
      metadata: { selection }, warnings: ['Multiple versions matched.'],
    }));
  `);
  const result = await downloadLyrics({ ...stub, artist: 'A & B', title: '- Élégie', album: 'Record', duration: 180, source: 'lrclib' });
  assert.deepEqual(result.args, [
    '--quiet', '--json', '--artist=A & B', '--track=- Élégie', `--output-dir=${stub.outputDirectory}`,
    '--source=lrclib', '--album=Record', '--duration=180',
  ]);
  assert.equal(result.metadata.selection.text_version_count, 2);
  assert.deepEqual(result.warnings, ['Multiple versions matched.']);
});

test('reports the ktools error from a failed lookup', async context => {
  const stub = await stubKtools(context, `
    console.log(JSON.stringify({ success: false, errors: ['No exact artist/title match.'] }));
    process.exitCode = 1;
  `);
  await assert.rejects(downloadLyrics({ ...stub, artist: 'Artist', title: 'Song' }), /No exact artist\/title match/);
});
