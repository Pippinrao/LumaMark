import { describe, expect, it } from 'vitest';
import { handleMathDocumentWorkerRequest } from './mathDocumentWorkerHandler';

describe('handleMathDocumentWorkerRequest', () => {
  it('returns the document identity and generation with rendered CHTML', async () => {
    const response = await handleMathDocumentWorkerRequest({
      request: {
        documentId: 'worker-document',
        formulas: [{ display: false, id: 'formula', source: 'x+1' }],
        generation: 42,
        layoutMetrics: { containerWidth: 800, em: 16, ex: 8 },
        preferences: { numbering: 'none', physics: false },
      },
      type: 'render',
    });

    expect(response.type).toBe('render-result');
    if (response.type !== 'render-result') {
      throw new Error('Expected a successful render response.');
    }
    expect(response.result.documentId).toBe('worker-document');
    expect(response.result.generation).toBe(42);
    expect(response.result.formulas[0]?.chtml).toContain('<mjx-container');
  });

  it('returns a typed fatal response when rendering rejects', async () => {
    const response = await handleMathDocumentWorkerRequest({
      request: {
        documentId: 'worker-document',
        formulas: [{
          display: false,
          id: 'oversized',
          source: 'x'.repeat(10 * 1024 + 1),
        }],
        generation: 43,
        layoutMetrics: { containerWidth: 800, em: 16, ex: 8 },
        preferences: { numbering: 'none', physics: false },
      },
      type: 'render',
    });

    expect(response).toEqual({
      documentId: 'worker-document',
      error: 'Math formula exceeds 10240 characters.',
      generation: 43,
      type: 'render-fatal',
    });
  });
});
