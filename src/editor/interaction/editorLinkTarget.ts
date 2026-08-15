import {
  syntaxTree,
  syntaxTreeAvailable,
} from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import { collectProtectedSourceRanges } from './protectedSourceRanges';

type MarkdownSyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>['resolveInner']
>;
type MarkdownTreeCursor = ReturnType<ReturnType<typeof syntaxTree>['cursor']>;
type ReferenceDestination = { href: string; rawHref: string };

type ReferenceIndexEntry =
  | {
      cursor: MarkdownTreeCursor;
      definitions: Map<string, ReferenceDestination>;
      status: 'building';
    }
  | {
      definitions: Map<string, ReferenceDestination>;
      status: 'ready';
    };

export type EditorReferenceIndexStatus = 'pending' | 'ready' | 'unparsed';

export type EditorReferenceIndexWorkOptions = {
  maxNodes?: number;
  maxWorkMs?: number;
};

const DEFAULT_REFERENCE_INDEX_MAX_NODES = 2_000;
const DEFAULT_REFERENCE_INDEX_MAX_WORK_MS = 4;
const referenceDefinitionCache = new WeakMap<
  Text,
  ReferenceIndexEntry
>();

export type EditorLinkTarget = {
  from: number;
  href: string;
  rawHref: string;
  to: number;
};

export function resolveEditorLinkHref(
  state: EditorState,
  position: number,
): string | null {
  return resolveEditorLinkTarget(state, position)?.href ?? null;
}

export function resolveEditorLinkTarget(
  state: EditorState,
  position: number,
): EditorLinkTarget | null {
  if (!Number.isInteger(position) || position < 0 || position > state.doc.length) {
    return null;
  }
  if (
    collectProtectedSourceRanges(state).some(
      (range) => range.from <= position && position < range.to,
    )
  ) {
    return null;
  }

  const owner = findLinkOwner(state, position);
  if (!owner) {
    return resolveBareUrl(state, position);
  }

  const directUrl = directChild(owner, 'URL');
  if (directUrl) {
    const rawHref = state.doc.sliceString(directUrl.from, directUrl.to).trim();
    const href = unwrapAngleDestination(rawHref);
    if (!href) {
      return null;
    }
    return owner.name === 'Autolink' && isEmailAutolink(href)
      ? {
          from: owner.from,
          href: `mailto:${href}`,
          rawHref,
          to: owner.to,
        }
      : { from: owner.from, href, rawHref, to: owner.to };
  }

  if (owner.name !== 'Link') {
    return null;
  }

  const referenceLabel = resolveReferenceLabel(state, owner);
  if (!referenceLabel) {
    return null;
  }

  const destination = getCachedReferenceDefinitions(state)?.get(
    referenceLabel,
  );
  return destination
    ? { from: owner.from, ...destination, to: owner.to }
    : null;
}

export function isEditorReferenceIndexReady(state: EditorState): boolean {
  return referenceDefinitionCache.get(state.doc)?.status === 'ready';
}

export function advanceEditorReferenceIndex(
  state: EditorState,
  options: EditorReferenceIndexWorkOptions = {},
): EditorReferenceIndexStatus {
  const existing = referenceDefinitionCache.get(state.doc);
  if (existing?.status === 'ready') {
    return 'ready';
  }
  if (!syntaxTreeAvailable(state, state.doc.length)) {
    return 'unparsed';
  }

  const entry = existing ?? {
    cursor: syntaxTree(state).cursor(),
    definitions: new Map<string, ReferenceDestination>(),
    status: 'building' as const,
  };
  if (!existing) {
    referenceDefinitionCache.set(state.doc, entry);
  }

  const maxNodes = Math.max(
    1,
    Math.floor(options.maxNodes ?? DEFAULT_REFERENCE_INDEX_MAX_NODES),
  );
  const maxWorkMs = Math.max(
    0,
    options.maxWorkMs ?? DEFAULT_REFERENCE_INDEX_MAX_WORK_MS,
  );
  const startedAt = currentTimeMs();

  for (let visited = 0; visited < maxNodes; visited += 1) {
    collectReferenceDefinitionAtCursor(state, entry);
    if (!entry.cursor.next()) {
      referenceDefinitionCache.set(state.doc, {
        definitions: entry.definitions,
        status: 'ready',
      });
      return 'ready';
    }
    if (currentTimeMs() - startedAt >= maxWorkMs) {
      return 'pending';
    }
  }

  return 'pending';
}

function resolveBareUrl(
  state: EditorState,
  position: number,
): EditorLinkTarget | null {
  for (const bias of [-1, 1] as const) {
    let current: MarkdownSyntaxNode | null = syntaxTree(state).resolveInner(
      position,
      bias,
    );
    let url: MarkdownSyntaxNode | null = null;
    let excluded = false;
    while (current) {
      if (
        current.name === 'URL' &&
        current.from <= position &&
        position < current.to
      ) {
        url = current;
      }
      if (
        current.name === 'Image' ||
        current.name === 'InlineCode' ||
        current.name === 'FencedCode' ||
        current.name === 'LinkReference'
      ) {
        excluded = true;
      }
      current = current.parent;
    }
    if (url && !excluded) {
      const href = state.doc.sliceString(url.from, url.to).trim();
      if (isEmailAutolink(href)) {
        return {
          from: url.from,
          href: `mailto:${href}`,
          rawHref: href,
          to: url.to,
        };
      }
      if (/^www\./i.test(href)) {
        return {
          from: url.from,
          href: `https://${href}`,
          rawHref: href,
          to: url.to,
        };
      }
      return href
        ? { from: url.from, href, rawHref: href, to: url.to }
        : null;
    }
  }
  return null;
}

function findLinkOwner(
  state: EditorState,
  position: number,
): MarkdownSyntaxNode | null {
  for (const bias of [-1, 1] as const) {
    let current: MarkdownSyntaxNode | null = syntaxTree(state).resolveInner(
      position,
      bias,
    );
    while (current) {
      if (
        (current.name === 'Link' || current.name === 'Autolink') &&
        current.from <= position &&
        position < current.to
      ) {
        return current;
      }
      current = current.parent;
    }
  }
  return null;
}

function directChild(
  owner: MarkdownSyntaxNode,
  name: string,
): MarkdownSyntaxNode | null {
  for (let child = owner.firstChild; child; child = child.nextSibling) {
    if (child.name === name) {
      return child;
    }
  }
  return null;
}

function resolveReferenceLabel(
  state: EditorState,
  owner: MarkdownSyntaxNode,
): string | null {
  const explicitLabel = directChild(owner, 'LinkLabel');
  if (explicitLabel) {
    const label = labelText(
      state.doc.sliceString(explicitLabel.from, explicitLabel.to),
    );
    if (label) {
      return normalizeReferenceLabel(label);
    }
  }

  const marks: MarkdownSyntaxNode[] = [];
  for (let child = owner.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') {
      marks.push(child);
    }
  }
  if (marks.length < 2) {
    return null;
  }

  const visibleLabel = state.doc.sliceString(marks[0].to, marks[1].from);
  return visibleLabel.trim()
    ? normalizeReferenceLabel(visibleLabel)
    : null;
}

function getCachedReferenceDefinitions(
  state: EditorState,
): Map<string, ReferenceDestination> | null {
  const entry = referenceDefinitionCache.get(state.doc);
  return entry?.status === 'ready' ? entry.definitions : null;
}

function collectReferenceDefinitionAtCursor(
  state: EditorState,
  entry: Extract<ReferenceIndexEntry, { status: 'building' }>,
): void {
  if (entry.cursor.name !== 'LinkReference') {
    return;
  }

  const node = entry.cursor.node;
  const label = directChild(node, 'LinkLabel');
  const url = directChild(node, 'URL');
  if (!label || !url) {
    return;
  }

  const key = normalizeReferenceLabel(
    labelText(state.doc.sliceString(label.from, label.to)),
  );
  const rawHref = state.doc.sliceString(url.from, url.to).trim();
  const href = unwrapAngleDestination(rawHref);
  if (key && href && !entry.definitions.has(key)) {
    entry.definitions.set(key, { href, rawHref });
  }
}

function currentTimeMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function labelText(label: string): string {
  return label.startsWith('[') && label.endsWith(']')
    ? label.slice(1, -1)
    : label;
}

function normalizeReferenceLabel(label: string): string {
  return decodeMarkdownString(label)
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function unwrapAngleDestination(href: string): string {
  const trimmed = href.trim();
  const destination = trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  return decodeMarkdownString(destination);
}

function decodeMarkdownString(value: string): string {
  const unescaped = value.replace(/\\(.)/gs, (match, character: string) =>
    isAsciiPunctuation(character) ? character : match,
  );
  return decodeCharacterReferences(unescaped);
}

function isAsciiPunctuation(character: string): boolean {
  const code = character.codePointAt(0) ?? -1;
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

const characterReferencePattern =
  /&(?:#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,8}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function decodeCharacterReferences(value: string): string {
  if (!value.includes('&') || typeof document === 'undefined') {
    return value;
  }

  const decoder = document.createElement('textarea');
  return value.replace(characterReferencePattern, (reference) => {
    decoder.innerHTML = reference;
    return decoder.value;
  });
}

function isEmailAutolink(href: string): boolean {
  return href.includes('@') && !href.includes(':');
}
