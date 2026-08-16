import type { markdown } from '@codemirror/lang-markdown';

type CodeMirrorMarkdownExtension = NonNullable<
  NonNullable<Parameters<typeof markdown>[0]>['extensions']
>;
type CodeMirrorMarkdownConfig = Exclude<
  CodeMirrorMarkdownExtension,
  readonly unknown[]
>;
type CodeMirrorBlockParser = NonNullable<
  CodeMirrorMarkdownConfig['parseBlock']
>[number];
type CodeMirrorInlineParser = NonNullable<
  CodeMirrorMarkdownConfig['parseInline']
>[number];
type MathBlockContext = Parameters<
  NonNullable<CodeMirrorBlockParser['parse']>
>[0];
type MathLine = Parameters<NonNullable<CodeMirrorBlockParser['parse']>>[1];
type MathElement = ReturnType<MathBlockContext['elt']>;
type MathInlineContext = Parameters<CodeMirrorInlineParser['parse']>[0];

export type MathSyntaxMode = 'disabled' | 'pandoc' | 'legacy';

export interface MathMarkdownExtensionOptions {
  inlineMode: MathSyntaxMode;
}

const DOLLAR_SIGN = 36;
const BACKSLASH = 92;

function isHorizontalWhitespace(character: number): boolean {
  return character === 32 || character === 9;
}

function isMathBlockDelimiter(line: MathLine): boolean {
  if (
    line.next !== DOLLAR_SIGN ||
    line.text.charCodeAt(line.pos + 1) !== DOLLAR_SIGN ||
    line.indent - line.baseIndent >= 4
  ) {
    return false;
  }

  for (let index = line.pos + 2; index < line.text.length; index += 1) {
    if (!isHorizontalWhitespace(line.text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

function parseMathBlock(context: MathBlockContext, line: MathLine): boolean {
  if (!isMathBlockDelimiter(line)) {
    return false;
  }

  const blockFrom = context.lineStart + line.pos;
  const children: MathElement[] = [
    context.elt('MathMark', blockFrom, blockFrom + 2),
  ];
  let blockTo = blockFrom + 2;
  const containerBaseIndent = line.baseIndent;

  while (context.nextLine() && line.baseIndent >= containerBaseIndent) {
    if (isMathBlockDelimiter(line)) {
      const markFrom = context.lineStart + line.pos;
      blockTo = markFrom + 2;
      children.push(context.elt('MathMark', markFrom, blockTo));
      context.nextLine();
      context.addElement(
        context.elt('MathBlock', blockFrom, blockTo, children),
      );
      return true;
    }

    const textFrom = context.lineStart + line.basePos;
    const textTo = context.lineStart + line.text.length;
    children.push(context.elt('MathText', textFrom, textTo));
    blockTo = textTo;
  }

  context.addElement(context.elt('MathBlock', blockFrom, blockTo, children));
  return true;
}

function isAsciiDigit(character: number): boolean {
  return character >= 48 && character <= 57;
}

function parseInlineMath(
  context: MathInlineContext,
  next: number,
  position: number,
  mode: Exclude<MathSyntaxMode, 'disabled'>,
): number {
  if (
    next !== DOLLAR_SIGN ||
    context.char(position - 1) === DOLLAR_SIGN ||
    context.char(position + 1) === DOLLAR_SIGN
  ) {
    return -1;
  }

  const firstContentCharacter = context.char(position + 1);
  if (
    firstContentCharacter < 0 ||
    firstContentCharacter === 10 ||
    (mode === 'pandoc' && isHorizontalWhitespace(firstContentCharacter))
  ) {
    return -1;
  }

  for (let cursor = position + 1; cursor < context.end; cursor += 1) {
    const character = context.char(cursor);
    if (character === 10) {
      return -1;
    }
    if (character !== DOLLAR_SIGN) {
      continue;
    }
    if (
      context.char(cursor - 1) === DOLLAR_SIGN ||
      context.char(cursor + 1) === DOLLAR_SIGN
    ) {
      return -1;
    }

    const beforeClosingMark = context.char(cursor - 1);
    if (
      beforeClosingMark === BACKSLASH ||
      (mode === 'pandoc' && isHorizontalWhitespace(beforeClosingMark)) ||
      (mode === 'pandoc' && isAsciiDigit(context.char(cursor + 1)))
    ) {
      continue;
    }

    const end = cursor + 1;
    return context.addElement(
      context.elt('InlineMath', position, end, [
        context.elt('MathMark', position, position + 1),
        context.elt('MathMark', cursor, end),
      ]),
    );
  }

  return -1;
}

export function mathMarkdownExtension({
  inlineMode,
}: MathMarkdownExtensionOptions): CodeMirrorMarkdownConfig {
  const extension: CodeMirrorMarkdownConfig = {
    defineNodes: [
      { name: 'MathBlock', block: true },
      'MathText',
      'InlineMath',
      'MathMark',
    ],
    parseBlock: [
      {
        name: 'MathBlock',
        parse: parseMathBlock,
        endLeaf(_context, line) {
          return isMathBlockDelimiter(line);
        },
        before: 'IndentedCode',
      },
    ],
  };

  if (inlineMode !== 'disabled') {
    extension.parseInline = [
      {
        name: 'InlineMath',
        parse(context, next, position) {
          return parseInlineMath(context, next, position, inlineMode);
        },
        after: 'InlineCode',
      },
    ];
  }

  return extension;
}
