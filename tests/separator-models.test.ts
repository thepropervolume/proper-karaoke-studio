import test from 'node:test';
import assert from 'node:assert/strict';
import separator from '../src/main/separator-models.cjs';

test('model discovery reads Audio Separator catalogs, filters unsafe IDs, and caches results', async () => {
  let calls = 0;
  const discover = separator.createModelDiscovery(async (executable: string, args: string[]) => {
    calls++;
    assert.equal(executable, 'trusted-audio-separator');
    assert.deepEqual(args, ['--list_models', '--list_format=json']);
    return { stdout: JSON.stringify({
      VR: { Example: { filename: 'example.pth' }, Invalid: { filename: '../outside.pth' } },
      MDX: { Another: { filename: 'example-mix.onnx' }, Empty: {} },
    }) };
  });
  const options = { adapter: 'audio-separator', executable: 'trusted-audio-separator' };
  const results = await Promise.all([discover(options), discover(options)]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], {
    source: 'installed',
    models: [
      { group: 'VR', label: 'Example', id: 'example.pth' },
      { group: 'MDX', label: 'Another', id: 'example-mix.onnx' },
    ],
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(await discover({ ...options, refresh: true }), results[0]);
  assert.equal(calls, 2);
});

test('model discovery handles Demucs groups and leaves cloud model lookup offline', async () => {
  assert.deepEqual(separator.parseDemucsModels('Bag of models:\r\n  htdemucs_ft\r\nSingle models:\r\n  mdx_q'), [
    { id: 'htdemucs_ft', label: 'htdemucs_ft', group: 'Model collections' },
    { id: 'mdx_q', label: 'mdx_q', group: 'Individual models' },
  ]);
  const discover = separator.createModelDiscovery(async () => { throw new Error('Could not start tool'); });
  assert.equal((await discover({ adapter: 'demucs', executable: 'demucs' })).source, 'fallback');
  const cloud = await discover({ adapter: 'dango' });
  assert.equal(cloud.source, 'provider');
  assert.deepEqual(cloud.models.map(({ id }: { id: string }) => id), ['29', '30', '31']);
});
