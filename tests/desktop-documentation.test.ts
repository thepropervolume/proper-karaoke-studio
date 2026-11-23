import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGuide } from '../scripts/desktop-documentation.mts';

test('bundled help links to its own guides and strips external resources', () => {
  const html = renderGuide('workspace', [
    '# Start here',
    '[Update guide](releases.md#update-studio)',
    '[Page section](#start-here)',
    '[External](https://example.org/)',
    '[Outside file](../README.md)',
    '![Image](https://example.org/preview.png)',
    '<iframe src="https://example.org/"></iframe>',
  ].join('\n\n'));
  assert.match(html, /<h1 id="workspace\/start-here"/);
  assert.match(html, /href="#releases\/update-studio"/);
  assert.match(html, /href="#workspace\/start-here"/);
  assert.doesNotMatch(html, /example\.org|README\.md|<iframe|<img/);
});
