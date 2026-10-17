import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { exportMathPlugin } from './exportMathPlugin';

function parse(
  source: string,
  syntaxMode: 'disabled' | 'legacy' | 'pandoc',
) {
  const md = new MarkdownIt({ html: false });
  exportMathPlugin(md, { syntaxMode });
  const env: Record<string, unknown> = {};
  const tokens = md.parse(source, env);
  return {
    env: env as {
      exportMathFormulas?: { display: boolean; id: string; source: string }[];
    },
    tokens,
  };
}

function mathTokens(
  tokens: { children?: { type: string }[] | null; type: string }[],
): string[] {
  return tokens.flatMap((token) => [
    ...(token.type === 'math_inline' || token.type === 'math_block'
      ? [token.type]
      : []),
    ...(token.children ?? [])
      .filter(
        (child) =>
          child.type === 'math_inline' || child.type === 'math_block',
      )
      .map((child) => child.type),
  ]);
}

describe('exportMathPlugin', () => {
  it('parses Pandoc inline math and exposes formulas in order', () => {
    const { env, tokens } = parse('Inline $a+b$ and $c$ text.', 'pandoc');

    expect(mathTokens(tokens)).toEqual(['math_inline', 'math_inline']);
    expect(env.exportMathFormulas?.map((formula) => formula.source)).toEqual([
      'a+b',
      'c',
    ]);
    expect(env.exportMathFormulas?.[0]?.display).toBe(false);
  });

  it('follows Pandoc rules for whitespace and trailing digits', () => {
    const spaced = parse('Cost $5 and $6 total.', 'pandoc');
    const closingSpace = parse('Text $a $ b.', 'pandoc');
    const followedByDigit = parse('Text $a$2 b.', 'pandoc');

    expect(mathTokens(spaced.tokens)).toEqual([]);
    expect(mathTokens(closingSpace.tokens)).toEqual([]);
    expect(mathTokens(followedByDigit.tokens)).toEqual([]);
  });

  it('keeps legacy rules more permissive', () => {
    const { tokens } = parse('Text $a $ b.', 'legacy');
    expect(mathTokens(tokens)).toEqual(['math_inline']);
  });

  it('does not parse math inside code spans', () => {
    const { tokens } = parse('Use `$x$` literally.', 'pandoc');
    expect(mathTokens(tokens)).toEqual([]);
  });

  it('parses block math on independent lines, including nested containers', () => {
    const { env, tokens } = parse(
      ['> $$', '> x^2', '> $$', '', '- item', '', '  $$', '  1+1', '  $$'].join(
        '\n',
      ),
      'pandoc',
    );

    const blocks = env.exportMathFormulas?.filter((formula) => formula.display);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]?.source).toBe('x^2');
    expect(blocks?.[1]?.source).toBe('1+1');
    expect(mathTokens(tokens)).toContain('math_block');
  });

  it('consumes an unclosed block to the end of the document', () => {
    const { env, tokens } = parse(['$$', 'x', 'y'].join('\n'), 'pandoc');

    expect(mathTokens(tokens)).toEqual(['math_block']);
    expect(env.exportMathFormulas?.[0]?.source).toBe('x\ny');
  });

  it('does nothing when math syntax is disabled', () => {
    const { env, tokens } = parse('Inline $a$ and $$', 'disabled');
    expect(mathTokens(tokens)).toEqual([]);
    expect(env.exportMathFormulas).toBeUndefined();
  });
});
