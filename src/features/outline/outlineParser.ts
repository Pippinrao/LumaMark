import { Text, type EditorState } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';

export type OutlineHeading = {
  from: number;
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  line: number;
  text: string;
  to: number;
};

type ParsedHeading = Omit<OutlineHeading, 'id'> & {
  baseId: string;
};

type OutlineSyntaxNode = {
  readonly firstChild: OutlineSyntaxNode | null;
  readonly from: number;
  readonly name: string;
  readonly nextSibling: OutlineSyntaxNode | null;
  readonly to: number;
};

type OutlineTextSource = {
  slice(from: number, to: number): string;
};

const outlineMarkdownParser = parser.configure(GFM);
const headingNodePattern = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/;
const atxHeadingPattern = /^( {0,3})(#{1,6})(?:([ \t]+)|$)(.*)$/;
const setextUnderlinePattern = /^( {0,3})(=+|-+)[ \t]*$/;
const fenceOpenPattern = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const fenceClosePattern = /^( {0,3})(`{3,}|~{3,})[ \t]*$/;
const headingInlineMarkupPattern = /[*_~`\\[\]!<&]/u;

export function parseMarkdownOutlineFromState(
  state: EditorState,
): OutlineHeading[] {
  return parseMarkdownOutlineFromText(state.doc);
}

function parseMarkdownOutlineFromText(doc: Text): OutlineHeading[] {
  const parsedHeadings: ParsedHeading[] = [];
  let fence: { character: string; length: number } | null = null;
  let pendingSetext: { from: number; line: number; text: string } | null = null;
  let from = 0;
  let lineNumber = 1;
  const lines = doc.iterLines();

  while (!lines.next().done) {
    const text = lines.value;
    const to = from + text.length;
    const unquoted = stripBlockquotePrefix(text);
    const fenceLine = matchFenceLine(unquoted);

    if (fence) {
      if (
        fenceLine &&
        fenceLine.character === fence.character &&
        fenceLine.length >= fence.length &&
        fenceLine.closing
      ) {
        fence = null;
      }
      pendingSetext = null;
    } else if (fenceLine && !fenceLine.closing) {
      fence = { character: fenceLine.character, length: fenceLine.length };
      pendingSetext = null;
    } else {
      const atx = matchAtxHeading(unquoted);
      if (atx) {
        pendingSetext = null;
        parsedHeadings.push(
          headingFromSource({
            from,
            level: atx.level,
            line: lineNumber,
            source: unquoted,
            to,
          }),
        );
      } else {
        const underline = matchSetextUnderline(unquoted);
        if (underline && pendingSetext && pendingSetext.text.trim() !== '') {
          parsedHeadings.push(
            headingFromSource({
              from: pendingSetext.from,
              level: underline.level,
              line: pendingSetext.line,
              source: `${pendingSetext.text}\n${text}`,
              to,
            }),
          );
          pendingSetext = null;
        } else {
          pendingSetext =
            unquoted.trim() === '' || isIndentedCodeLine(unquoted)
              ? null
              : { from, line: lineNumber, text };
        }
      }
    }

    from = to + 1;
    lineNumber += 1;
  }

  return assignUniqueHeadingIds(parsedHeadings);
}

export function parseMarkdownOutline(markdown: string): OutlineHeading[] {
  let scannedTo = 0;
  let line = 1;
  let lineStart = 0;

  return collectOutlineHeadings({
    iterate(enter) {
      outlineMarkdownParser.parse(markdown).iterate({
        enter(nodeRef) {
          return enter({
            from: nodeRef.from,
            name: nodeRef.name,
            node: nodeRef.node,
            to: nodeRef.to,
          });
        },
      });
    },
    lineAt(position) {
      while (scannedTo < position) {
        if (markdown.charCodeAt(scannedTo) === 10) {
          line += 1;
          lineStart = scannedTo + 1;
        }
        scannedTo += 1;
      }

      return { line, lineStart };
    },
    text: {
      slice(from, to) {
        return markdown.slice(from, to);
      },
    },
  });
}

function collectOutlineHeadings(source: {
  iterate: (
    enter: (nodeRef: {
      from: number;
      name: string;
      node: OutlineSyntaxNode;
      to: number;
    }) => boolean | void,
  ) => void;
  lineAt: (position: number) => { line: number; lineStart: number };
  text: OutlineTextSource;
}): OutlineHeading[] {
  const parsedHeadings: ParsedHeading[] = [];
  const decodeCharacterReference = createCharacterReferenceDecoder();

  source.iterate((nodeRef) => {
    const level = headingLevel(nodeRef.name);
    if (level === null) {
      return;
    }

    const { line, lineStart } = source.lineAt(nodeRef.from);
    const text = normalizeVisibleHeadingText(
      renderVisibleNodeText(source.text, nodeRef.node, decodeCharacterReference),
    );
    parsedHeadings.push({
      baseId: createOutlineHeadingId(text),
      from: lineStart,
      level,
      line,
      text,
      to: nodeRef.to,
    });

    return false;
  });

  return assignUniqueHeadingIds(parsedHeadings);
}

function headingFromSource(heading: {
  from: number;
  level: OutlineHeading['level'];
  line: number;
  source: string;
  to: number;
}): ParsedHeading {
  const text = headingInlineMarkupPattern.test(heading.source)
    ? (parseMarkdownOutline(heading.source)[0]?.text ??
      normalizeVisibleHeadingText(heading.source))
    : normalizeVisibleHeadingText(stripSimpleHeadingMarks(heading.source));

  return {
    baseId: createOutlineHeadingId(text),
    from: heading.from,
    level: heading.level,
    line: heading.line,
    text,
    to: heading.to,
  };
}

function stripSimpleHeadingMarks(source: string): string {
  const atx = matchAtxHeading(stripBlockquotePrefix(source));
  if (atx) {
    return atx.content;
  }

  const lines = source.split('\n');
  return lines[0] ?? source;
}

function stripBlockquotePrefix(line: string): string {
  let rest = line;
  while (true) {
    const quote = /^( {0,3})>( ?)/.exec(rest);
    if (!quote) {
      return rest;
    }
    rest = rest.slice(quote[0].length);
  }
}

function isIndentedCodeLine(line: string): boolean {
  return line.startsWith('    ') || line.startsWith('\t');
}

function matchAtxHeading(line: string): {
  content: string;
  level: OutlineHeading['level'];
} | null {
  const match = atxHeadingPattern.exec(line);
  if (!match || isIndentedCodeLine(line)) {
    return null;
  }

  const level = match[2].length as OutlineHeading['level'];
  if (level < 1 || level > 6) {
    return null;
  }

  const rest = match[4] ?? '';
  const closing = /[ \t]+#+[ \t]*$/.exec(rest);

  return {
    content: closing ? rest.slice(0, closing.index) : rest,
    level,
  };
}

function matchSetextUnderline(line: string): {
  level: 1 | 2;
} | null {
  const match = setextUnderlinePattern.exec(line);
  if (!match || isIndentedCodeLine(line)) {
    return null;
  }

  return { level: match[2].startsWith('=') ? 1 : 2 };
}

function matchFenceLine(line: string): {
  character: string;
  closing: boolean;
  length: number;
} | null {
  if (isIndentedCodeLine(line)) {
    return null;
  }

  const closing = fenceClosePattern.exec(line);
  if (closing) {
    return {
      character: closing[2][0] ?? '`',
      closing: true,
      length: closing[2].length,
    };
  }

  const opening = fenceOpenPattern.exec(line);
  if (!opening) {
    return null;
  }

  return {
    character: opening[2][0] ?? '`',
    closing: false,
    length: opening[2].length,
  };
}

function headingLevel(name: string): OutlineHeading['level'] | null {
  const match = headingNodePattern.exec(name);
  if (!match) {
    return null;
  }

  return Number(match[1] ?? match[2]) as OutlineHeading['level'];
}

function renderVisibleNodeText(
  text: OutlineTextSource,
  node: OutlineSyntaxNode,
  decodeCharacterReference: (reference: string) => string,
  parentName = '',
): string {
  if (node.name.endsWith('Mark')) {
    return '';
  }
  if (
    node.name === 'HTMLTag' ||
    node.name === 'LinkLabel' ||
    node.name === 'LinkTitle' ||
    (node.name === 'URL' && parentName !== 'Autolink')
  ) {
    return '';
  }
  if (node.name === 'Entity') {
    return decodeCharacterReference(text.slice(node.from, node.to));
  }
  if (node.name === 'Escape') {
    return text.slice(node.from + 1, node.to);
  }

  const rendered = renderVisibleChildText(text, node, decodeCharacterReference);
  return node.name === 'InlineCode'
    ? normalizeInlineCodeText(rendered)
    : rendered;
}

function renderVisibleChildText(
  text: OutlineTextSource,
  node: OutlineSyntaxNode,
  decodeCharacterReference: (reference: string) => string,
): string {
  let rendered = '';
  let position = node.from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    rendered += text.slice(position, child.from);
    rendered += renderVisibleNodeText(
      text,
      child,
      decodeCharacterReference,
      node.name,
    );
    position = child.to;
  }

  return rendered + text.slice(position, node.to);
}

function normalizeInlineCodeText(text: string): string {
  const normalized = text.replace(/[\t\r\n ]+/g, ' ');
  return normalized.startsWith(' ') &&
    normalized.endsWith(' ') &&
    /[^ ]/.test(normalized)
    ? normalized.slice(1, -1)
    : normalized;
}

function normalizeVisibleHeadingText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function createCharacterReferenceDecoder(): (reference: string) => string {
  if (typeof document === 'undefined') {
    return decodeCharacterReferenceWithoutDom;
  }

  const decoder = document.createElement('textarea');
  return (reference) => {
    decoder.innerHTML = reference;
    return decoder.value;
  };
}

const namedCharacterReferenceFallbacks: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
};

function decodeCharacterReferenceWithoutDom(reference: string): string {
  const body = reference.slice(1, -1);
  if (body.startsWith('#')) {
    const hexadecimal = body[1]?.toLowerCase() === 'x';
    const value = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : '\ufffd';
  }

  return namedCharacterReferenceFallbacks[body] ?? reference;
}

export function createOutlineHeadingId(text: string): string {
  const id = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return id || 'heading';
}

function assignUniqueHeadingIds(
  headings: readonly ParsedHeading[],
): OutlineHeading[] {
  const baseCounts = new Map<string, number>();
  const baseOccurrences = new Map<string, number>();
  const collisionSuffixes = new Map<string, number>();
  const usedIds = new Set<string>();

  for (const heading of headings) {
    baseCounts.set(heading.baseId, (baseCounts.get(heading.baseId) ?? 0) + 1);
  }

  return headings.map(({ baseId, ...heading }) => {
    const occurrence = (baseOccurrences.get(baseId) ?? 0) + 1;
    baseOccurrences.set(baseId, occurrence);
    const preferredId =
      (baseCounts.get(baseId) ?? 0) > 1
        ? `${baseId}-${occurrence}`
        : baseId;

    return {
      ...heading,
      id: reserveUniqueHeadingId(
        preferredId,
        usedIds,
        collisionSuffixes,
      ),
    };
  });
}

function reserveUniqueHeadingId(
  preferredId: string,
  usedIds: Set<string>,
  collisionSuffixes: Map<string, number>,
): string {
  if (!usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }

  let suffix = collisionSuffixes.get(preferredId) ?? 2;
  let id = `${preferredId}-${suffix}`;
  while (usedIds.has(id)) {
    suffix += 1;
    id = `${preferredId}-${suffix}`;
  }
  collisionSuffixes.set(preferredId, suffix + 1);
  usedIds.add(id);
  return id;
}
