import { syntaxTree } from '@codemirror/language';
import type {
  EditorState,
  SelectionRange,
} from '@codemirror/state';
import { resolveEditorLinkTarget } from './editorLinkTarget';
import { collectProtectedSourceRanges } from './protectedSourceRanges';

export type EditorInteractionRange = {
  readonly from: number;
  readonly to: number;
};

export type EditorInteractionBlockKind =
  | 'ATXHeading1'
  | 'ATXHeading2'
  | 'ATXHeading3'
  | 'ATXHeading4'
  | 'ATXHeading5'
  | 'ATXHeading6'
  | 'Blockquote'
  | 'FencedCode'
  | 'ListItem'
  | 'MathBlock'
  | 'Paragraph'
  | 'SetextHeading1'
  | 'SetextHeading2'
  | 'TableCell';

export type EditorInteractionInlineKind =
  | 'Autolink'
  | 'Emphasis'
  | 'Image'
  | 'InlineCode'
  | 'InlineMath'
  | 'Link'
  | 'Strikethrough'
  | 'StrongEmphasis';

export type EditorInteractionDelimiterRange =
  EditorInteractionRange & {
    readonly kind:
      | 'CodeInfo'
      | 'CodeMark'
      | 'EmphasisMark'
      | 'HeaderMark'
      | 'LinkMark'
      | 'LinkTitle'
      | 'ListMark'
      | 'MathMark'
      | 'QuoteMark'
      | 'StrikethroughMark'
      | 'TableDelimiter'
      | 'URL';
  };

export type EditorInteractionBlock = EditorInteractionRange & {
  readonly delimiterRanges: readonly EditorInteractionDelimiterRange[];
  readonly kind: EditorInteractionBlockKind;
};

export type EditorInteractionInlineOwner =
  EditorInteractionRange & {
    readonly delimiterRanges: readonly EditorInteractionDelimiterRange[];
    readonly kind: EditorInteractionInlineKind;
  };

export type EditorSelectionInteraction = {
  readonly block: EditorInteractionBlock | null;
  readonly crossesBlocks: boolean;
  readonly delimiterRanges: readonly EditorInteractionDelimiterRange[];
  readonly inlineOwners: readonly EditorInteractionInlineOwner[];
  readonly selection: {
    readonly anchor: number;
    readonly from: number;
    readonly head: number;
    readonly to: number;
  };
};

export type EditorInteractionContext = {
  readonly activeBlocks: readonly EditorInteractionBlock[];
  readonly activeInlineOwners: readonly EditorInteractionInlineOwner[];
  readonly composition: boolean;
  readonly protectedSourceRanges: readonly EditorInteractionRange[];
  readonly selections: readonly EditorSelectionInteraction[];
};

type MarkdownSyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>['resolveInner']
>;

const INLINE_OWNER_NAMES =
  new Set<EditorInteractionInlineKind>([
    'Autolink',
    'Emphasis',
    'Image',
    'InlineCode',
    'InlineMath',
    'Link',
    'Strikethrough',
    'StrongEmphasis',
  ]);

function isBlockKind(name: string): name is EditorInteractionBlockKind {
  return (
    name === 'Paragraph' ||
    name === 'ListItem' ||
    name === 'Blockquote' ||
    name === 'FencedCode' ||
    name === 'MathBlock' ||
    name === 'TableCell' ||
    name === 'SetextHeading1' ||
    name === 'SetextHeading2' ||
    /^ATXHeading[1-6]$/.test(name)
  );
}

function isInlineKind(
  name: string,
): name is EditorInteractionInlineKind {
  return INLINE_OWNER_NAMES.has(name as EditorInteractionInlineKind);
}

function isDelimiterKind(
  name: string,
): name is EditorInteractionDelimiterRange['kind'] {
  return (
    name === 'CodeInfo' ||
    name === 'CodeMark' ||
    name === 'EmphasisMark' ||
    name === 'HeaderMark' ||
    name === 'LinkMark' ||
    name === 'LinkTitle' ||
    name === 'ListMark' ||
    name === 'MathMark' ||
    name === 'QuoteMark' ||
    name === 'StrikethroughMark' ||
    name === 'TableDelimiter' ||
    name === 'URL'
  );
}

function ownerKey(
  owner: EditorInteractionBlock | EditorInteractionInlineOwner,
): string {
  return `${owner.kind}:${owner.from}:${owner.to}`;
}

function uniqueOwners<
  Owner extends EditorInteractionBlock | EditorInteractionInlineOwner,
>(owners: readonly Owner[]): Owner[] {
  const seen = new Set<string>();

  return owners.filter((owner) => {
    const key = ownerKey(owner);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function delimiterRangesForInlineOwner(
  owner: MarkdownSyntaxNode,
): EditorInteractionDelimiterRange[] {
  const delimiters: EditorInteractionDelimiterRange[] = [];
  const allowedNames =
    owner.name === 'InlineCode'
      ? new Set(['CodeMark'])
      : owner.name === 'InlineMath'
        ? new Set(['MathMark'])
      : owner.name === 'Strikethrough'
        ? new Set(['StrikethroughMark'])
        : owner.name === 'Link' || owner.name === 'Image'
          ? new Set(['LinkMark', 'LinkTitle', 'URL'])
          : owner.name === 'Autolink'
            ? new Set(['LinkMark'])
            : new Set(['EmphasisMark']);

  for (
    let child = owner.firstChild;
    child;
    child = child.nextSibling
  ) {
    if (allowedNames.has(child.name) && isDelimiterKind(child.name)) {
      delimiters.push({
        from: child.from,
        kind: child.name,
        to: child.to,
      });
    }
  }

  return delimiters;
}

function nearestAncestor(
  node: MarkdownSyntaxNode,
  name: string,
): MarkdownSyntaxNode | null {
  for (
    let current: MarkdownSyntaxNode | null = node.parent;
    current;
    current = current.parent
  ) {
    if (current.name === name) {
      return current;
    }
  }

  return null;
}

function delimiterRangesForBlock(
  owner: MarkdownSyntaxNode,
): EditorInteractionDelimiterRange[] {
  if (owner.name === 'TableCell') {
    return [owner.prevSibling, owner.nextSibling].flatMap((sibling) =>
      sibling?.name === 'TableDelimiter'
        ? [
            {
              from: sibling.from,
              kind: 'TableDelimiter' as const,
              to: sibling.to,
            },
          ]
        : [],
    );
  }

  const delimiterName =
    owner.name === 'Blockquote'
      ? null
      : owner.name === 'FencedCode'
        ? null
        : owner.name === 'ListItem'
          ? 'ListMark'
          : owner.name.startsWith('ATXHeading') ||
              owner.name.startsWith('SetextHeading')
            ? 'HeaderMark'
            : null;
  const delimiters: EditorInteractionDelimiterRange[] = [];

  const cursor = owner.cursor();
  if (!cursor.firstChild()) {
    return delimiters;
  }

  do {
    const matchesFenceDelimiter =
      owner.name === 'FencedCode' &&
      (cursor.name === 'CodeMark' || cursor.name === 'CodeInfo');
    const matchesMathDelimiter =
      owner.name === 'MathBlock' && cursor.name === 'MathMark';
    const matchesOwnedDelimiter =
      delimiterName !== null &&
      cursor.name === delimiterName &&
      nearestAncestor(cursor.node, owner.name)?.from === owner.from;

    if (
      (matchesFenceDelimiter || matchesMathDelimiter || matchesOwnedDelimiter) &&
      isDelimiterKind(cursor.name)
    ) {
      delimiters.push({
        from: cursor.from,
        kind: cursor.name,
        to: cursor.to,
      });
    }
  } while (cursor.next());

  return delimiters;
}

function quoteDelimiterRangesForSelection(
  state: EditorState,
  selection: SelectionRange,
  block: EditorInteractionBlock | null,
): EditorInteractionDelimiterRange[] {
  const headLine = state.doc.lineAt(selection.head);
  const effectiveHead =
    !selection.empty &&
    selection.head === selection.to &&
    selection.head === headLine.from
      ? selection.head - 1
      : selection.head;
  const lineStarts = new Set([
    state.doc.lineAt(effectiveHead).from,
  ]);
  const delimiters: EditorInteractionDelimiterRange[] = [];

  if (block && block.kind !== 'Blockquote') {
    for (const range of block.delimiterRanges) {
      lineStarts.add(state.doc.lineAt(range.from).from);
    }
  }

  const tree = syntaxTree(state);
  for (const lineStart of lineStarts) {
    const line = state.doc.lineAt(lineStart);

    tree.iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        if (
          node.name === 'QuoteMark' &&
          node.from >= line.from &&
          node.to <= line.to
        ) {
          delimiters.push({
            from: node.from,
            kind: 'QuoteMark',
            to: node.to,
          });
        }
      },
    });
  }

  return delimiters;
}

function createInlineOwner(
  node: MarkdownSyntaxNode,
): EditorInteractionInlineOwner {
  if (!isInlineKind(node.name)) {
    throw new Error(`Unsupported inline owner: ${node.name}`);
  }

  return {
    delimiterRanges: delimiterRangesForInlineOwner(node),
    from: node.from,
    kind: node.name,
    to: node.to,
  };
}

function createBlock(
  node: MarkdownSyntaxNode,
): EditorInteractionBlock {
  if (!isBlockKind(node.name)) {
    throw new Error(`Unsupported block owner: ${node.name}`);
  }

  return {
    delimiterRanges: delimiterRangesForBlock(node),
    from: node.from,
    kind: node.name,
    to: node.to,
  };
}

function scopeBlockDelimitersToSelection(
  state: EditorState,
  selection: SelectionRange,
  block: EditorInteractionBlock,
): EditorInteractionBlock {
  if (block.kind !== 'FencedCode') {
    return block;
  }

  return {
    ...block,
    delimiterRanges: block.delimiterRanges.filter(
      (range) =>
        selection.empty
          ? state.doc.lineAt(range.from).from ===
            state.doc.lineAt(selection.head).from
          : selection.from < range.to && selection.to > range.from,
    ),
  };
}

function findSmallestBlockAt(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): EditorInteractionBlock | null {
  const tree = syntaxTree(state);
  const resolved = tree.resolveInner(position, bias);
  const structuralBlocks: MarkdownSyntaxNode[] = [];
  let paragraph: MarkdownSyntaxNode | null = null;

  for (
    let node: MarkdownSyntaxNode | null = resolved;
    node;
    node = node.parent
  ) {
    if (!isBlockKind(node.name)) {
      continue;
    }

    if (node.name === 'Paragraph') {
      paragraph ??= node;
    } else {
      structuralBlocks.push(node);
    }
  }

  const block = structuralBlocks[0] ?? paragraph;
  return block ? createBlock(block) : null;
}

function sameBlock(
  first: EditorInteractionBlock | null,
  second: EditorInteractionBlock | null,
): boolean {
  return (
    first?.kind === second?.kind &&
    first?.from === second?.from &&
    first?.to === second?.to
  );
}

function collectInlineOwners(
  state: EditorState,
  selection: SelectionRange,
): EditorInteractionInlineOwner[] {
  const nodes = new Map<string, MarkdownSyntaxNode>();

  if (selection.empty) {
    for (const bias of [-1, 1] as const) {
      for (
        let node: MarkdownSyntaxNode | null = syntaxTree(state).resolveInner(
          selection.from,
          bias,
        );
        node;
        node = node.parent
      ) {
        if (
          isInlineKind(node.name) &&
          node.from < selection.from &&
          selection.from < node.to
        ) {
          nodes.set(`${node.name}:${node.from}:${node.to}`, node);
          break;
        }
      }
    }
  } else {
    syntaxTree(state).iterate({
      from: selection.from,
      to: selection.to,
      enter(node) {
        if (
          isInlineKind(node.name) &&
          selection.from < node.to &&
          selection.to > node.from
        ) {
          nodes.set(`${node.name}:${node.from}:${node.to}`, node.node);
        }
      },
    });
  }

  return [...nodes.values()]
    .sort(
      (left, right) =>
        left.from - right.from ||
        right.to - left.to,
    )
    .map(createInlineOwner);
}

function mergeDelimiterRanges(
  owners: readonly (
    | EditorInteractionBlock
    | EditorInteractionInlineOwner
  )[],
  additionalRanges: readonly EditorInteractionDelimiterRange[] = [],
): EditorInteractionDelimiterRange[] {
  const ranges = new Map<string, EditorInteractionDelimiterRange>();

  for (const owner of owners) {
    for (const range of owner.delimiterRanges) {
      ranges.set(`${range.kind}:${range.from}:${range.to}`, range);
    }
  }

  for (const range of additionalRanges) {
    ranges.set(`${range.kind}:${range.from}:${range.to}`, range);
  }

  return [...ranges.values()].sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to,
  );
}

function deriveSelectionInteraction(
  state: EditorState,
  selection: SelectionRange,
): EditorSelectionInteraction {
  let startBlock = findSmallestBlockAt(state, selection.from, 1);

  if (selection.empty && !startBlock) {
    const precedingBlock = findSmallestBlockAt(
      state,
      selection.from,
      -1,
    );

    if (precedingBlock?.to === selection.from) {
      startBlock = precedingBlock;
    }
  }

  const endBlock = selection.empty
    ? startBlock
    : findSmallestBlockAt(state, selection.to, -1);
  const crossesBlocks = !sameBlock(startBlock, endBlock);
  const block = crossesBlocks || !startBlock
    ? null
    : scopeBlockDelimitersToSelection(state, selection, startBlock);
  const inlineOwners = collectInlineOwners(state, selection);

  return {
    block,
    crossesBlocks,
    delimiterRanges: mergeDelimiterRanges([
      ...(block ? [block] : []),
      ...inlineOwners,
    ], quoteDelimiterRangesForSelection(state, selection, block)),
    inlineOwners,
    selection: {
      anchor: selection.anchor,
      from: selection.from,
      head: selection.head,
      to: selection.to,
    },
  };
}

export function deriveEditorInteractionContext(
  state: EditorState,
  composition: boolean,
): EditorInteractionContext {
  const selections = state.selection.ranges.map((selection) =>
    deriveSelectionInteraction(state, selection),
  );

  return {
    activeBlocks: uniqueOwners(
      selections.flatMap((selection) =>
        selection.block ? [selection.block] : [],
      ),
    ),
    activeInlineOwners: uniqueOwners(
      selections.flatMap((selection) => selection.inlineOwners),
    ),
    composition,
    protectedSourceRanges: collectProtectedSourceRanges(state),
    selections,
  };
}

export type EditorContextTarget =
  | { at: number; kind: 'plain' }
  | {
      from: number;
      href: string;
      kind: 'link';
      rawHref: string;
      to: number;
    }
  | { from: number; kind: 'codeBlock'; to: number }
  | { from: number; kind: 'mermaid'; to: number }
  | { from: number; kind: 'selection'; to: number }
  | { from: number; kind: 'table'; to: number }
  | { from: number; kind: 'image'; src: string; to: number };

export function deriveTableInteractionAtPosition(
  state: EditorState,
  pos: number,
): Extract<EditorContextTarget, { kind: 'table' }> | null {
  const clamped = Math.max(0, Math.min(pos, state.doc.length));

  for (const bias of [1, -1] as const) {
    const table = findAncestorNamed(
      syntaxTree(state).resolveInner(clamped, bias),
      'Table',
    );
    if (table && table.from <= clamped && clamped <= table.to) {
      return { from: table.from, kind: 'table', to: table.to };
    }
  }

  return null;
}

function findInlineOwnerAt(
  state: EditorState,
  position: number,
  kind: EditorInteractionInlineKind,
): MarkdownSyntaxNode | null {
  for (const bias of [-1, 1] as const) {
    for (
      let node: MarkdownSyntaxNode | null = syntaxTree(state).resolveInner(
        position,
        bias,
      );
      node;
      node = node.parent
    ) {
      if (node.name === kind && node.from <= position && position < node.to) {
        return node;
      }
    }
  }

  return null;
}

function readUrlChildHref(
  state: EditorState,
  owner: MarkdownSyntaxNode,
): string | null {
  const urlChild = owner.getChild('URL');
  if (urlChild) {
    return state.doc.sliceString(urlChild.from, urlChild.to).trim();
  }

  if (owner.name !== 'Autolink') {
    return null;
  }

  const raw = state.doc.sliceString(owner.from, owner.to);
  if (raw.startsWith('<') && raw.endsWith('>')) {
    return raw.slice(1, -1).trim();
  }

  return raw.trim();
}

function isMermaidFencedCode(
  state: EditorState,
  fencedCode: MarkdownSyntaxNode,
): boolean {
  const codeInfo = fencedCode.getChild('CodeInfo');
  if (!codeInfo) {
    return false;
  }

  const info = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
  const language = info.split(/\s+/)[0]?.toLowerCase() ?? '';
  return language === 'mermaid';
}

function findAncestorNamed(
  node: MarkdownSyntaxNode,
  name: string,
): MarkdownSyntaxNode | null {
  for (
    let current: MarkdownSyntaxNode | null = node;
    current;
    current = current.parent
  ) {
    if (current.name === name) {
      return current;
    }
  }

  return null;
}

export function deriveInteractionAtPosition(
  state: EditorState,
  pos: number,
): EditorContextTarget {
  const clamped = Math.max(0, Math.min(pos, state.doc.length));

  if (
    collectProtectedSourceRanges(state).some(
      (range) => range.from <= clamped && clamped < range.to,
    )
  ) {
    return { at: clamped, kind: 'plain' };
  }

  const inlineCode = findInlineOwnerAt(state, clamped, 'InlineCode');
  if (inlineCode) {
    return { at: clamped, kind: 'plain' };
  }

  const fencedCode = findAncestorNamed(
    syntaxTree(state).resolveInner(clamped, 1),
    'FencedCode',
  ) ?? findAncestorNamed(
    syntaxTree(state).resolveInner(clamped, -1),
    'FencedCode',
  );

  if (
    fencedCode &&
    fencedCode.from <= clamped &&
    clamped < fencedCode.to
  ) {
    if (isMermaidFencedCode(state, fencedCode)) {
      return {
        from: fencedCode.from,
        kind: 'mermaid',
        to: fencedCode.to,
      };
    }

    return {
      from: fencedCode.from,
      kind: 'codeBlock',
      to: fencedCode.to,
    };
  }

  const image = findInlineOwnerAt(state, clamped, 'Image');
  if (image) {
    const src = readUrlChildHref(state, image);
    if (src !== null) {
      return {
        from: image.from,
        kind: 'image',
        src,
        to: image.to,
      };
    }
  }

  const link = resolveEditorLinkTarget(state, clamped);
  if (link) {
    return {
      from: link.from,
      href: link.href,
      kind: 'link',
      rawHref: link.rawHref,
      to: link.to,
    };
  }

  const table = deriveTableInteractionAtPosition(state, clamped);
  if (table) {
    return table;
  }

  const selection = state.selection.main;
  if (
    !selection.empty &&
    selection.from <= clamped &&
    clamped < selection.to
  ) {
    return {
      from: selection.from,
      kind: 'selection',
      to: selection.to,
    };
  }

  return { at: clamped, kind: 'plain' };
}
