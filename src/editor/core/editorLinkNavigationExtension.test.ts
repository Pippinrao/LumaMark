import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import {
  isEditorReferenceIndexReady,
  resolveEditorLinkHref,
} from '../interaction/editorLinkTarget';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { createEditorApi } from './editorApi';
import { editorLinkNavigationExtension } from './editorLinkNavigationExtension';

function createHarness(
  isMacPlatform: boolean,
  doc = '[Guide](https://example.com/docs)',
  position = 2,
) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const onLinkNavigationRequest = vi.fn();
  const editor = createEditorApi({
    doc,
    extensions: [
      editorLinkNavigationExtension(
        onLinkNavigationRequest,
        isMacPlatform,
      ),
    ],
    parent,
  });
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(position);

  return {
    destroy() {
      editor.destroy();
      parent.remove();
    },
    editor,
    onLinkNavigationRequest,
  };
}

async function waitForReferenceIndex(
  state: () => EditorState,
  attempts = 500,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isEditorReferenceIndexReady(state())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('reference index did not finish warming');
}

function dispatchMouse(
  target: HTMLElement,
  type: 'click' | 'mousedown' | 'mouseup',
  init: MouseEventInit,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: 12,
    clientY: 18,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('editorLinkNavigationExtension', () => {
  it('warms a far reference off the gesture path and navigates exactly once', async () => {
    const filler = Array.from(
      { length: 20_000 },
      (_, index) => `paragraph ${index}`,
    ).join('\n\n');
    const source = `[Guide][remote]\n\n${filler}\n\n[remote]: ./far.md#target`;
    const guidePosition = source.indexOf('Guide') + 1;
    const harness = createHarness(false, source, guidePosition);

    expect(isEditorReferenceIndexReady(harness.editor.view.state)).toBe(false);
    expect(
      resolveEditorLinkHref(harness.editor.view.state, guidePosition),
    ).toBeNull();

    await waitForReferenceIndex(() => harness.editor.view.state);

    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });
    dispatchMouse(harness.editor.view.contentDOM, 'click', {
      ctrlKey: true,
    });

    expect(harness.onLinkNavigationRequest).toHaveBeenCalledOnce();
    expect(harness.onLinkNavigationRequest).toHaveBeenCalledWith(
      './far.md#target',
    );
    harness.destroy();
  });

  it('invalidates on document change and shares a completed revision cache', async () => {
    const source = '[Guide][remote]\n\n[remote]: ./before.md';
    const guidePosition = source.indexOf('Guide') + 1;
    const harness = createHarness(false, source, guidePosition);
    await waitForReferenceIndex(() => harness.editor.view.state);

    expect(
      resolveEditorLinkHref(harness.editor.view.state, guidePosition),
    ).toBe('./before.md');

    const destinationFrom = source.indexOf('./before.md');
    harness.editor.view.dispatch({
      changes: {
        from: destinationFrom,
        to: destinationFrom + './before.md'.length,
        insert: './after.md',
      },
    });

    expect(isEditorReferenceIndexReady(harness.editor.view.state)).toBe(false);
    expect(
      resolveEditorLinkHref(harness.editor.view.state, guidePosition),
    ).toBeNull();
    await waitForReferenceIndex(() => harness.editor.view.state);
    expect(
      resolveEditorLinkHref(harness.editor.view.state, guidePosition),
    ).toBe('./after.md');

    const sharedRevisionState = EditorState.create({
      doc: harness.editor.view.state.doc,
      extensions: [markdownLanguage()],
    });
    expect(isEditorReferenceIndexReady(sharedRevisionState)).toBe(true);
    expect(resolveEditorLinkHref(sharedRevisionState, guidePosition)).toBe(
      './after.md',
    );
    harness.destroy();
  });

  it('cancels scheduled reference-index work when destroyed', () => {
    vi.useFakeTimers();
    try {
      const source = `[Guide][remote]\n\n${'paragraph\n\n'.repeat(20_000)}[remote]: ./far.md`;
      const harness = createHarness(
        false,
        source,
        source.indexOf('Guide') + 1,
      );

      expect(vi.getTimerCount()).toBeGreaterThan(0);
      harness.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes an exact Windows Ctrl primary click without moving selection', () => {
    const harness = createHarness(false);
    const selectionBefore = harness.editor.view.state.selection;

    const down = dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    const up = dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });
    const click = dispatchMouse(harness.editor.view.contentDOM, 'click', {
      ctrlKey: true,
    });

    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(harness.onLinkNavigationRequest).toHaveBeenCalledOnce();
    expect(harness.onLinkNavigationRequest).toHaveBeenCalledWith(
      'https://example.com/docs',
    );
    expect(harness.editor.view.state.selection).toEqual(selectionBefore);
    harness.destroy();
  });

  it('requires Cmd on macOS and rejects wrong or additional modifiers', () => {
    const mac = createHarness(true);
    dispatchMouse(mac.editor.view.contentDOM, 'mousedown', { metaKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'mouseup', { metaKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'click', { metaKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'mousedown', { ctrlKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'mouseup', { ctrlKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'click', { ctrlKey: true });
    dispatchMouse(mac.editor.view.contentDOM, 'mousedown', {
      metaKey: true,
      shiftKey: true,
    });
    dispatchMouse(mac.editor.view.contentDOM, 'mouseup', {
      metaKey: true,
      shiftKey: true,
    });
    dispatchMouse(mac.editor.view.contentDOM, 'click', {
      metaKey: true,
      shiftKey: true,
    });

    expect(mac.onLinkNavigationRequest).toHaveBeenCalledOnce();
    mac.destroy();
  });

  it('ignores unmodified and secondary clicks', () => {
    const harness = createHarness(false);
    const plain = dispatchMouse(harness.editor.view.contentDOM, 'click', {});
    const secondary = dispatchMouse(
      harness.editor.view.contentDOM,
      'click',
      { button: 2, ctrlKey: true },
    );

    expect(plain.defaultPrevented).toBe(false);
    expect(secondary.defaultPrevented).toBe(false);
    expect(harness.onLinkNavigationRequest).not.toHaveBeenCalled();
    harness.destroy();
  });

  it('cancels drag, blur, and document-change gestures without a late navigation', () => {
    const harness = createHarness(false);

    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
      clientX: 10,
      clientY: 10,
    });
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
      clientX: 16,
      clientY: 10,
    });

    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    window.dispatchEvent(new Event('blur'));
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });

    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    harness.editor.view.dispatch({
      changes: { from: harness.editor.view.state.doc.length, insert: '!' },
    });
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });

    expect(harness.onLinkNavigationRequest).not.toHaveBeenCalled();
    harness.destroy();
  });

  it('re-hit-tests the mouseup target and refuses link navigation during IME composition', () => {
    const harness = createHarness(false);
    const posAtCoords = vi.mocked(harness.editor.view.posAtCoords);

    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    posAtCoords.mockReturnValue(null);
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });
    expect(harness.onLinkNavigationRequest).not.toHaveBeenCalled();

    posAtCoords.mockReturnValue(2);
    Object.defineProperty(harness.editor.view, 'composing', {
      configurable: true,
      value: true,
    });
    dispatchMouse(harness.editor.view.contentDOM, 'mousedown', {
      ctrlKey: true,
    });
    dispatchMouse(harness.editor.view.contentDOM, 'mouseup', {
      ctrlKey: true,
    });

    expect(harness.onLinkNavigationRequest).not.toHaveBeenCalled();
    harness.destroy();
  });
});
