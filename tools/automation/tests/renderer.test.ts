import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagramRenderer } from '../renderer.ts';

test('a rendering deadline rejects as an infrastructure failure and closes the job', async () => {
  const renderer = new DiagramRenderer(1);
  try {
    await assert.rejects(renderer.render({ source: 'flowchart TD\nA --> B', format: 'mermaid' }), { code: 'renderer.timeout' });
  } finally { await renderer.close(); }
  await assert.rejects(renderer.render({ source: 'flowchart TD\nA --> B', format: 'mermaid' }), { code: 'renderer.closed' });
});
