import { describe, expect, it, vi } from 'vitest';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { createEditorState } from './createEditorState';
import type { EditorDocumentChangedEvent } from './editorEvents';

describe('createEditorState', () => {
  const initialNavigatorUserAgent = window.navigator.userAgent;

  it('creates a readable editor document from Markdown text', () => {
    const markdown = '# LumaMark\n\nStart writing.\n';

    const state = createEditorState({ doc: markdown });

    expect(state.doc.toString()).toBe(markdown);
  });

  it('emits lightweight document change events without Markdown source text', () => {
    const events: EditorDocumentChangedEvent[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: '# Initial\n',
        onDocumentChanged: (event) => {
          events.push(event);
        },
      }),
    });

    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: '\nUpdated body.',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dirty: true,
      docVersion: 1,
      documentLength: view.state.doc.length,
      type: 'documentChanged',
    });
    expect(JSON.stringify(events)).not.toContain('Updated body');

    view.destroy();
    parent.remove();
  });

  it('reports clean when undo returns to the saved document and dirty when redo leaves it', () => {
    const events: EditorDocumentChangedEvent[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: '# Saved\n',
        onDocumentChanged: (event) => events.push(event),
      }),
    });

    view.dispatch({ changes: { from: view.state.doc.length, insert: 'draft' } });
    expect(undo(view)).toBe(true);
    expect(redo(view)).toBe(true);

    expect(events.map((event) => event.dirty)).toEqual([true, false, true]);

    view.destroy();
    parent.remove();
  });

  it('does not compare document text for a selection-only update', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({ doc: '# Saved\n' }),
    });
    const eqSpy = vi.spyOn(view.state.doc, 'eq');

    view.dispatch({ selection: { anchor: 1 } });

    expect(eqSpy).not.toHaveBeenCalled();

    view.destroy();
    parent.remove();
  });

  it('opens the built-in search panel from the registered search command', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({ doc: 'Find this Markdown text.' }),
    });

    expect(searchPanelOpen(view.state)).toBe(false);
    expect(openSearchPanel(view)).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(parent.querySelector('.cm-search')).not.toBeNull();
    expect(parent.querySelector('.cm-panels-top > .cm-search')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('localizes the built-in search panel with the requested editor language', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: 'Find this Markdown text.',
        language: 'zh-CN',
      }),
    });

    expect(openSearchPanel(view)).toBe(true);
    expect(
      parent.querySelector<HTMLInputElement>('[name="search"]')?.placeholder,
    ).toBe('查找');
    expect(parent.querySelector<HTMLButtonElement>('[name="next"]')?.textContent).toBe(
      '下一个',
    );
    expect(
      parent.querySelector<HTMLButtonElement>('[name="replaceAll"]')?.textContent,
    ).toBe('全部替换');

    view.destroy();
    parent.remove();
  });

  it('requests editor zoom from the whole scroll area and prevents WebView zoom', () => {
    const onZoomRequested = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: 'Zoom this document.',
        onZoomRequested,
      }),
    });

    const zoomInEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    Object.defineProperty(zoomInEvent, 'timeStamp', { value: 100 });
    view.scrollDOM.dispatchEvent(zoomInEvent);

    const zoomOutEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: 100,
    });
    Object.defineProperty(zoomOutEvent, 'timeStamp', { value: 180 });
    view.scrollDOM.dispatchEvent(zoomOutEvent);

    const plainWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    view.scrollDOM.dispatchEvent(plainWheelEvent);

    expect(onZoomRequested.mock.calls).toEqual([['in'], ['out']]);
    expect(zoomInEvent.defaultPrevented).toBe(true);
    expect(zoomOutEvent.defaultPrevented).toBe(true);
    expect(plainWheelEvent.defaultPrevented).toBe(false);

    view.destroy();
    parent.remove();
  });

  it.each([
    {
      eventInit: { ctrlKey: true },
      handled: true,
      isMacPlatform: false,
      name: 'Control on Windows',
    },
    {
      eventInit: { metaKey: true },
      handled: false,
      isMacPlatform: false,
      name: 'Meta on Windows',
    },
    {
      eventInit: { ctrlKey: true },
      handled: true,
      isMacPlatform: false,
      name: 'Control on Linux',
    },
    {
      eventInit: { metaKey: true },
      handled: false,
      isMacPlatform: false,
      name: 'Meta on Linux',
    },
    {
      eventInit: { metaKey: true },
      handled: true,
      isMacPlatform: true,
      name: 'Meta on macOS',
    },
    {
      eventInit: { ctrlKey: true },
      handled: false,
      isMacPlatform: true,
      name: 'Control on macOS',
    },
    {
      eventInit: { altKey: true, ctrlKey: true },
      handled: false,
      isMacPlatform: false,
      name: 'Control+Alt on Windows',
    },
    {
      eventInit: { ctrlKey: true, metaKey: true },
      handled: false,
      isMacPlatform: false,
      name: 'Control+Meta on Windows',
    },
    {
      eventInit: { ctrlKey: true, shiftKey: true },
      handled: false,
      isMacPlatform: false,
      name: 'Control+Shift on Windows',
    },
  ])(
    'handles only the platform primary wheel modifier: $name',
    ({ eventInit, handled, isMacPlatform }) => {
      const onZoomRequested = vi.fn();
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: createEditorState({
          doc: 'Platform zoom modifier.',
          isMacPlatform,
          onZoomRequested,
        }),
      });
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
        ...eventInit,
      });

      view.scrollDOM.dispatchEvent(event);

      expect(onZoomRequested).toHaveBeenCalledTimes(handled ? 1 : 0);
      expect(event.defaultPrevented).toBe(handled);

      view.destroy();
      parent.remove();
    },
  );

  it('rejects AltGraph wheel input even when it reports the primary modifier', () => {
    const onZoomRequested = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: 'AltGraph zoom modifier.',
        isMacPlatform: false,
        onZoomRequested,
      }),
    });
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    vi.spyOn(event, 'getModifierState').mockImplementation(
      (key) => key === 'AltGraph',
    );

    view.scrollDOM.dispatchEvent(event);

    expect(onZoomRequested).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    view.destroy();
    parent.remove();
  });

  it('does not leak platform test state into the global navigator', () => {
    expect(window.navigator.userAgent).toBe(initialNavigatorUserAgent);
  });

  it('handles a bubbling modified wheel event once and throttles touchpad bursts', () => {
    const onZoomRequested = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: 'Zoom this document.',
        onZoomRequested,
      }),
    });

    const dispatchWheel = (timeStamp: number) => {
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -10,
      });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      view.contentDOM.dispatchEvent(event);
      return event;
    };

    const first = dispatchWheel(100);
    const throttled = dispatchWheel(140);
    const next = dispatchWheel(180);

    expect(onZoomRequested.mock.calls).toEqual([['in'], ['in']]);
    expect(first.defaultPrevented).toBe(true);
    expect(throttled.defaultPrevented).toBe(true);
    expect(next.defaultPrevented).toBe(true);

    view.destroy();
    parent.remove();
  });
});
