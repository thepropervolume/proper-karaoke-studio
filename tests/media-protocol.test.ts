import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import protocol from '../src/main/media-protocol.cjs';

test('registered audio provides media length, single ranges, and a full body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-studio-media-test-'));
  const file = join(dir, 'studio recording.wav');
  const bytes = Buffer.from([2, 5, 7, 11, 13, 17, 19]);
  try {
    await writeFile(file, bytes);
    const request = (options?: RequestInit) => protocol.serveStudioMedia(new Request('studio-media://fixture/', options), file);
    const head = await request({ method: 'HEAD' });
    assert.equal(head.headers.get('content-type'), 'audio/wav');
    assert.equal(head.headers.get('content-length'), '7');
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.body, null);
    const full = await request();
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-length'), '7');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    const fromStart = await request({ headers: { Range: 'bytes=0-2' } });
    assert.equal(fromStart.status, 206);
    assert.equal(fromStart.headers.get('content-range'), 'bytes 0-2/7');
    assert.equal(fromStart.headers.get('content-length'), '3');
    assert.deepEqual(Buffer.from(await fromStart.arrayBuffer()), bytes.subarray(0, 3));
    const suffix = await request({ headers: { Range: 'bytes=-2' } });
    assert.equal(suffix.headers.get('content-range'), 'bytes 5-6/7');
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(5));
    const openEnded = await request({ headers: { Range: 'bytes=3-' } });
    assert.equal(openEnded.headers.get('content-range'), 'bytes 3-6/7');
    assert.deepEqual(Buffer.from(await openEnded.arrayBuffer()), bytes.subarray(3));
    for (const range of ['bytes=7-', 'bytes=-0', 'bytes=4-1', 'bytes=0-1,3-5']) {
      const invalid = await request({ headers: { Range: range } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get('content-range'), 'bytes */7');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
