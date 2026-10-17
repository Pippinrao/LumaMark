import type {
  MarkdownIt,
  StateBlock,
  StateInline,
  Token,
} from 'markdown-it';
import type { ExportMathFormula, ExportMathPreferences } from './exportTypes';

const DOLLAR_SIGN = 0x24;
const BACKSLASH = 0x5c;

export type ExportMathEnv = {
  exportMathById?: Map<string, string>;
  exportMathFormulas?: ExportMathFormula[];
  exportMathMessages?: {
    mathFailed: string;
  };
};

export type ExportMathTokenMeta = {
  exportMathId: string;
};

type MathSyntaxMode = ExportMathPreferences['syntaxMode'];

function isPandocWhitespace(character: number): boolean {
  return character === 0x20 || character === 0x09;
}

function isAsciiDigit(character: number): boolean {
  return character >= 0x30 && character <= 0x39;
}

function pushFormula(
  env: ExportMathEnv,
  id: string,
  source: string,
  display: boolean,
): void {
  const formulas = (env.exportMathFormulas ??= []);
  formulas.push({ display, id, source });
}

function isBlockDelimiterLine(
  state: StateBlock,
  line: number,
): { contentStart: number; lineEnd: number } | null {
  const start = state.bMarks[line] + state.tShift[line];
  const lineEnd = state.eMarks[line];
  if (state.sCount[line] - state.blkIndent >= 4) {
    return null;
  }
  if (start + 2 > lineEnd || state.src.slice(start, start + 2) !== '$$') {
    return null;
  }
  if (state.src.slice(start + 2, lineEnd).trim() !== '') {
    return null;
  }

  return { contentStart: start + 2, lineEnd };
}

function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const delimiter = isBlockDelimiterLine(state, startLine);
  if (!delimiter) {
    return false;
  }
  if (silent) {
    return true;
  }

  const env = state.env as ExportMathEnv;
  const formulas = (env.exportMathFormulas ??= []);
  const id = `math:${formulas.length}`;
  const lines: string[] = [];
  let nextLine = startLine + 1;

  for (; nextLine < endLine; nextLine += 1) {
    const closing = isBlockDelimiterLine(state, nextLine);
    if (closing) {
      const token = state.push('math_block', 'math', 0);
      token.block = true;
      token.content = lines.join('\n');
      token.map = [startLine, nextLine + 1];
      token.markup = '$$';
      (token.meta ??= {} as ExportMathTokenMeta).exportMathId = id;
      pushFormula(env, id, token.content, true);
      state.line = nextLine + 1;
      return true;
    }

    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    lines.push(state.src.slice(lineStart, lineEnd));
  }

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = lines.join('\n');
  token.map = [startLine, endLine];
  token.markup = '$$';
  (token.meta ??= {} as ExportMathTokenMeta).exportMathId = id;
  pushFormula(env, id, token.content, true);
  state.line = endLine;
  return true;
}

function mathInline(
  state: StateInline,
  silent: boolean,
  mode: Exclude<MathSyntaxMode, 'disabled'>,
): boolean {
  const position = state.pos;
  if (state.src.charCodeAt(position) !== DOLLAR_SIGN) {
    return false;
  }
  if (
    state.src.charCodeAt(position - 1) === DOLLAR_SIGN ||
    state.src.charCodeAt(position + 1) === DOLLAR_SIGN
  ) {
    return false;
  }

  const firstContentCharacter = state.src.charCodeAt(position + 1);
  if (
    firstContentCharacter < 0 ||
    firstContentCharacter === 0x0a ||
    (mode === 'pandoc' && isPandocWhitespace(firstContentCharacter))
  ) {
    return false;
  }

  for (let cursor = position + 1; cursor < state.posMax; cursor += 1) {
    const character = state.src.charCodeAt(cursor);
    if (character === 0x0a) {
      return false;
    }
    if (character !== DOLLAR_SIGN) {
      continue;
    }
    if (
      state.src.charCodeAt(cursor - 1) === DOLLAR_SIGN ||
      state.src.charCodeAt(cursor + 1) === DOLLAR_SIGN
    ) {
      return false;
    }

    const beforeClosingMark = state.src.charCodeAt(cursor - 1);
    if (
      beforeClosingMark === BACKSLASH ||
      (mode === 'pandoc' && isPandocWhitespace(beforeClosingMark)) ||
      (mode === 'pandoc' && isAsciiDigit(state.src.charCodeAt(cursor + 1)))
    ) {
      continue;
    }

    if (!silent) {
      const env = state.env as ExportMathEnv;
      const formulas = (env.exportMathFormulas ??= []);
      const id = `math:${formulas.length}`;
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(position + 1, cursor);
      token.markup = '$';
      (token.meta ??= {} as ExportMathTokenMeta).exportMathId = id;
      pushFormula(env, id, token.content, false);
    }
    state.pos = cursor + 1;
    return true;
  }

  return false;
}

function fallbackMath(env: ExportMathEnv, token: Token): string {
  const source = token.content;
  const escaped = escapeHtml(source);
  const label = env.exportMathMessages?.mathFailed ?? 'Formula could not be rendered.';
  return `<span class="lm-export-math-error" title="${escapeHtml(label)}">${escaped}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportMathPlugin(
  md: MarkdownIt,
  options: { syntaxMode: MathSyntaxMode },
): void {
  if (options.syntaxMode === 'disabled') {
    return;
  }

  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.inline.ruler.after('backticks', 'math_inline', (state, silent) =>
    mathInline(state, silent, options.syntaxMode as 'legacy' | 'pandoc'),
  );

  md.renderer.rules.math_inline = (tokens, index, _options, env) => {
    const token = tokens[index]!;
    const id = (token.meta as ExportMathTokenMeta | undefined)?.exportMathId;
    const rendered = id
      ? (env as ExportMathEnv).exportMathById?.get(id)
      : undefined;
    return rendered ?? fallbackMath(env as ExportMathEnv, token);
  };

  md.renderer.rules.math_block = (tokens, index, _options, env) => {
    const token = tokens[index]!;
    const id = (token.meta as ExportMathTokenMeta | undefined)?.exportMathId;
    const rendered = id
      ? (env as ExportMathEnv).exportMathById?.get(id)
      : undefined;
    return `<div class="lm-export-math-block">${
      rendered ?? fallbackMath(env as ExportMathEnv, token)
    }</div>\n`;
  };
}
