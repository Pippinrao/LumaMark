import { describe, expect, it } from 'vitest';
import { resolveMathRefPosition } from './mathRefNavigation';
import type { MathInventoryFormula } from './mathInventory';
import type { MathRenderSessionSnapshot } from './mathRenderSession';

describe('resolveMathRefPosition', () => {
  it('maps a current-generation equation href through fresh inventory positions', () => {
    const snapshot: MathRenderSessionSnapshot = {
      documentId: 'document-a',
      error: null,
      generation: 4,
      lastSuccessfulFormulas: new Map(),
      result: {
        documentId: 'document-a',
        documentLabels: { 'eq:mass': { formulaId: 'math:block:0' } },
        formulas: [
          {
            chtml: '<mjx-container id="lm-math-abc-mjx-eqn:1"></mjx-container>',
            id: 'math:block:0',
            labels: ['eq:mass'],
          },
          {
            chtml: '<mjx-container><a href="#lm-math-abc-mjx-eqn%3a1">1</a></mjx-container>',
            id: 'math:inline:1',
            labels: [],
          },
        ],
        generation: 4,
        stylesheet: '',
      },
      status: 'success',
    };
    const inventory = [
      formula('math:block:0', 12),
      formula('math:inline:1', 80),
    ];

    expect(
      resolveMathRefPosition('#lm-math-abc-mjx-eqn%3a1', snapshot, inventory),
    ).toBe(12);
  });

  it('does not reuse a stale absolute offset after the labeled formula moves', () => {
    const snapshot: MathRenderSessionSnapshot = {
      documentId: 'document-a',
      error: null,
      generation: 5,
      lastSuccessfulFormulas: new Map(),
      result: {
        documentId: 'document-a',
        documentLabels: {},
        formulas: [
          {
            chtml: '<mjx-container id="lm-math-abc-mjx-eqn:1"></mjx-container>',
            id: 'math:block:0',
            labels: ['eq:mass'],
          },
        ],
        generation: 5,
        stylesheet: '',
      },
      status: 'success',
    };

    expect(
      resolveMathRefPosition('#lm-math-abc-mjx-eqn%3a1', snapshot, [
        formula('math:block:0', 40),
      ]),
    ).toBe(40);
  });
});

function formula(id: string, from: number): MathInventoryFormula {
  return {
    contentRanges: [{ from: from + 2, to: from + 10 }],
    delimiterRanges: [],
    display: true,
    from,
    id,
    source: 'E=mc^2',
    to: from + 12,
  };
}
