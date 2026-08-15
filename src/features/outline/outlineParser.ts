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

type MarkdownTree = ReturnType<typeof outlineMarkdownParser.parse>;
type MarkdownSyntaxNode = MarkdownTree['topNode'];

const outlineMarkdownParser = parser.configure(GFM);
const headingNodePattern = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/;

export function parseMarkdownOutline(markdown: string): OutlineHeading[] {
  const parsedHeadings: ParsedHeading[] = [];
  const decodeCharacterReference = createCharacterReferenceDecoder();
  let scannedTo = 0;
  let line = 1;
  let lineStart = 0;

  outlineMarkdownParser.parse(markdown).iterate({
    enter(nodeRef) {
      const level = headingLevel(nodeRef.name);
      if (level === null) {
        return;
      }

      while (scannedTo < nodeRef.from) {
        if (markdown.charCodeAt(scannedTo) === 10) {
          line += 1;
          lineStart = scannedTo + 1;
        }
        scannedTo += 1;
      }

      const text = normalizeVisibleHeadingText(
        renderVisibleNodeText(
          markdown,
          nodeRef.node,
          decodeCharacterReference,
        ),
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
    },
  });

  return assignUniqueHeadingIds(parsedHeadings);
}

function headingLevel(name: string): OutlineHeading['level'] | null {
  const match = headingNodePattern.exec(name);
  if (!match) {
    return null;
  }

  return Number(match[1] ?? match[2]) as OutlineHeading['level'];
}

function renderVisibleNodeText(
  markdown: string,
  node: MarkdownSyntaxNode,
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
    return decodeCharacterReference(markdown.slice(node.from, node.to));
  }
  if (node.name === 'Escape') {
    return markdown.slice(node.from + 1, node.to);
  }

  const rendered = renderVisibleChildText(
    markdown,
    node,
    decodeCharacterReference,
  );
  return node.name === 'InlineCode'
    ? normalizeInlineCodeText(rendered)
    : rendered;
}

function renderVisibleChildText(
  markdown: string,
  node: MarkdownSyntaxNode,
  decodeCharacterReference: (reference: string) => string,
): string {
  let rendered = '';
  let position = node.from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    rendered += markdown.slice(position, child.from);
    rendered += renderVisibleNodeText(
      markdown,
      child,
      decodeCharacterReference,
      node.name,
    );
    position = child.to;
  }

  return rendered + markdown.slice(position, node.to);
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
