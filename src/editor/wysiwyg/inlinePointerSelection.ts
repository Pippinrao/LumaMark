import type { EditorView } from '@codemirror/view';

export const INLINE_OWNER_FROM_ATTRIBUTE = 'data-lm-inline-owner-from';
export const INLINE_OWNER_TO_ATTRIBUTE = 'data-lm-inline-owner-to';

export type InlinePointerOwner = {
  element: HTMLElement;
  from: number;
  to: number;
};

export function inlinePointerOwnerFromEvent(
  event: MouseEvent,
): InlinePointerOwner | null {
  const target = event.target;
  const element = target instanceof Element
    ? target.closest<HTMLElement>(`[${INLINE_OWNER_FROM_ATTRIBUTE}]`)
    : null;
  const from = Number(element?.getAttribute(INLINE_OWNER_FROM_ATTRIBUTE));
  const to = Number(element?.getAttribute(INLINE_OWNER_TO_ATTRIBUTE));

  if (
    !element ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    to - from < 2
  ) {
    return null;
  }

  return { element, from, to };
}

export function inlinePointerPosition(
  view: EditorView,
  owner: Pick<InlinePointerOwner, 'from' | 'to'>,
  coordinates: { x: number; y: number },
): number {
  const ownerDocument = view.dom.ownerDocument;
  const caretPosition = typeof ownerDocument.caretPositionFromPoint === 'function'
    ? ownerDocument.caretPositionFromPoint(coordinates.x, coordinates.y)
    : null;
  let node = caretPosition?.offsetNode ?? null;
  let offset = caretPosition?.offset ?? 0;

  if (!node && typeof ownerDocument.caretRangeFromPoint === 'function') {
    const caretRange = ownerDocument.caretRangeFromPoint(
      coordinates.x,
      coordinates.y,
    );
    node = caretRange?.startContainer ?? null;
    offset = caretRange?.startOffset ?? 0;
  }

  // Extension observers run before CodeMirror flushes its coordinate cache for
  // mousedown. The browser-native caret hit gives us the current rendered DOM
  // position without depending on that cache; posAtCoords remains a fallback.
  const domPosition = node && view.contentDOM.contains(node)
    ? view.posAtDOM(node, offset)
    : null;
  const coordinatePosition = domPosition ?? view.posAtCoords(coordinates);

  return Math.max(
    owner.from + 1,
    Math.min(coordinatePosition ?? owner.from + 1, owner.to - 1),
  );
}
