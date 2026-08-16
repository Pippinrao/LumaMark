import { describe, expect, it } from 'vitest';
import { isPlantumlSyntaxErrorSvg } from './plantumlErrorSvg';

describe('isPlantumlSyntaxErrorSvg', () => {
  it('detects TeaVM PlantUML syntax-error diagrams', () => {
    expect(
      isPlantumlSyntaxErrorSvg(
        '<svg><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>',
      ),
    ).toBe(true);
    expect(isPlantumlSyntaxErrorSvg('<svg><text>Alice -> Bob</text></svg>')).toBe(
      false,
    );
  });
});
