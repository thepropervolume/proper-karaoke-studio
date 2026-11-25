/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import operations from '../src/main/studio-operations.cjs';

const hubWarning = 'Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.';
const progress = '\u001b[2KLoading weights: 33%|███       | 20/60 [00:02<00:04, 10it/s]';

async function failedAlignment(t: TestContext, stderr: string | string[], exitCode: number) {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-alignment-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = join(directory, 'track.wav');
  const scriptPath = join(directory, 'align.cjs');
  await Promise.all([
    writeFile(audioPath, 'Fake audio for the error fixture'),
    writeFile(scriptPath, `
      (async () => {
        for (const chunk of ${JSON.stringify([stderr].flat())}) {
          process.stderr.write(chunk);
          await new Promise(resolve => setTimeout(resolve, 15));
        }
        process.exitCode = ${exitCode};
      })();
    `),
  ]);
  return operations.alignLyrics({ audioPath, lyrics: ['One line'], language: 'en' }, scriptPath,
    () => process.execPath, 'qwen');
}

test('local AI Sync surfaces the bundled script error without model loading output', async t => {
  const message = 'Qwen couldn’t align this track reliably.\nSelect another AI Sync engine.';
  await assert.rejects(failedAlignment(t, [
    [hubWarning, progress, 'Lyric align'].join('\r\n'), 'ment failed: ' + message + '\r',
    (progress + '\r').repeat(200) + 'Download complete: 1.5GB [00:15, 100MB/s]',
  ], 1), { message });
});

test('local AI Sync retains diagnostic stderr when the script cannot print its summary', async t => {
  const diagnosis = 'ModuleNotFoundError: No module named qwen_asr';
  await assert.rejects(failedAlignment(t, [hubWarning, diagnosis, progress].join('\r'), 1), {
    message: 'Qwen3 ForcedAligner (Local) lyric alignment failed (1): ' + diagnosis,
  });
});

test('local AI Sync retains the NLTK lookup error before a long diagnostic tail', async t => {
  await assert.rejects(failedAlignment(t, [
    'Traceback (most recent call last):\r\nLook',
    'upError:\r\n**************************************************\r\nResource punkt_tab not found.\r\n',
    'Searched in:\r\n' + '  - /var/tmp/studio-runtime/nltk_data\r\n'.repeat(450) + hubWarning,
  ], 1), error => {
    assert(error instanceof Error);
    assert.match(error.message, /^Qwen3 ForcedAligner \(Local\) lyric alignment failed \(1\): LookupError:\nResource punkt_tab not found\./);
    assert.doesNotMatch(error.message, /unauthenticated requests/);
    return true;
  });
});

test('local AI Sync reports cancellation from an interrupted runtime', async t => {
  await assert.rejects(failedAlignment(t, [hubWarning, progress, 'KeyboardInterrupt'].join('\n'), 130), {
    message: 'Lyric synchronization canceled.',
  });
});
