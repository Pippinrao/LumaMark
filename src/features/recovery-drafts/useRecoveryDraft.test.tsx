import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEditorDocumentPort,
  type EditorDocumentPort,
} from '../../editor/commands/editorCommandPort';
import {
  createEditorApi,
  type EditorDocumentSnapshot,
} from '../../editor/core/editorApi';
import {
  readRecoveryDraft,
  saveRecoveryDraft,
} from '../../services/drafts/draftStore';
import { useRecoveryDraft, type RecoveryDraftWorkflow } from './useRecoveryDraft';

type TestEditorDocumentPort = Omit<
  EditorDocumentPort,
  'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
> &
  Partial<
    Pick<
      EditorDocumentPort,
      'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
    >
  >;

const snapshotEditorRefs = new WeakMap<
  RefObject<TestEditorDocumentPort | null>,
  RefObject<EditorDocumentPort | null>
>();

function withSnapshotEditorRef(
  editorRef: RefObject<TestEditorDocumentPort | null>,
): RefObject<EditorDocumentPort | null> {
  const existing = snapshotEditorRefs.get(editorRef);
  if (existing) {
    return existing;
  }

  const adapted = {
    get current() {
      const editor = editorRef.current;
      if (!editor) {
        return null;
      }

      return {
        ...editor,
        captureSnapshot:
          editor.captureSnapshot ??
          (() => ({ serializedText: editor.getText() })),
        isSnapshotCurrent:
          editor.isSnapshotCurrent ??
          ((snapshot: EditorDocumentSnapshot) =>
            snapshot.serializedText === editor.getText()),
        serializeText: editor.serializeText ?? editor.getText,
      };
    },
  };
  snapshotEditorRefs.set(editorRef, adapted);

  return adapted;
}

function RecoveryDraftHarness({
  currentFilePath = null,
  editorReady = true,
  editorRef,
  onWorkflow,
  onRestore,
}: {
  currentFilePath?: string | null;
  editorReady?: boolean;
  editorRef: RefObject<TestEditorDocumentPort | null>;
  onRestore: () => void;
  onWorkflow: (workflow: RecoveryDraftWorkflow) => void;
}) {
  onWorkflow(
    useRecoveryDraft({
      currentFilePath,
      editorReady,
      editorRef: withSnapshotEditorRef(editorRef),
      onRestore,
    }),
  );

  return null;
}

describe('useRecoveryDraft', () => {
  let storage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    const entries = new Map<string, string>();
    storage = {
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: () => null,
      get length() {
        return entries.size;
      },
      removeItem: (key) => entries.delete(key),
      setItem: (key, value) => entries.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
    vi.unstubAllGlobals();
  });

  it('keeps the latest user edit as a local recovery draft', () => {
    const getText = vi.fn(() => '# Recovered');
    const workflowRef: { current: RecoveryDraftWorkflow | null } = {
      current: null,
    };

    render(
      <RecoveryDraftHarness
        currentFilePath="E:/notes/plan.md"
        editorRef={{
          current: {
            focus: vi.fn(),
            getText,
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onRestore={vi.fn()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
      />,
    );

    workflowRef.current?.scheduleRecoveryDraft();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(readRecoveryDraft()).toEqual({
      filePath: 'E:/notes/plan.md',
      text: '# Recovered',
    });
    expect(getText).toHaveBeenCalledTimes(1);
  });

  it('round-trips BOM and mixed line endings through draft save and restore', () => {
    const source = '\uFEFF# Draft\r\nfirst\rsecond\n';
    const getText = vi.fn(() => '# Draft\nfirst\nsecond\n');
    const serializeText = vi.fn(() => source);
    const workflowRef: { current: RecoveryDraftWorkflow | null } = {
      current: null,
    };
    const firstView = render(
      <RecoveryDraftHarness
        currentFilePath="E:/notes/mixed.md"
        editorRef={{
          current: {
            focus: vi.fn(),
            getText,
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            serializeText,
            setContext: vi.fn(),
          },
        }}
        onRestore={vi.fn()}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
      />,
    );

    workflowRef.current?.scheduleRecoveryDraft();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    firstView.unmount();

    expect(readRecoveryDraft()).toEqual({
      filePath: 'E:/notes/mixed.md',
      text: source,
    });
    expect(serializeText).toHaveBeenCalledTimes(1);
    expect(getText).not.toHaveBeenCalled();

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const restoredEditor = createEditorApi({ doc: '', parent });
    const restoredPort = createEditorDocumentPort(restoredEditor);
    render(
      <RecoveryDraftHarness
        editorRef={{
          current: restoredPort,
        }}
        onRestore={vi.fn()}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
      />,
    );

    expect(workflowRef.current?.pendingRecoveryDraft?.text).toBe(source);
    act(() => {
      workflowRef.current?.restoreRecoveryDraft();
    });

    expect(restoredPort.serializeText()).toBe(source);
    expect(restoredPort.getText()).toBe('# Draft\nfirst\nsecond\n');
    expect(readRecoveryDraft()).toEqual({
      filePath: null,
      text: source,
    });
    restoredEditor.destroy();
    parent.remove();
  });

  it('loads a pending draft as an untitled dirty document only after the user restores it', () => {
    const loadText = vi.fn();
    const setContext = vi.fn();
    const focus = vi.fn();
    const onRestore = vi.fn();
    const workflowRef: { current: RecoveryDraftWorkflow | null } = {
      current: null,
    };
    saveRecoveryDraft({ filePath: 'E:/notes/plan.md', text: '# Recovered' });

    render(
      <RecoveryDraftHarness
        editorRef={{
          current: {
            focus,
            getText: vi.fn(),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext,
          },
        }}
        onRestore={onRestore}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
      />,
    );

    expect(workflowRef.current?.pendingRecoveryDraft).toEqual({
      filePath: 'E:/notes/plan.md',
      text: '# Recovered',
    });
    expect(loadText).not.toHaveBeenCalled();

    act(() => {
      workflowRef.current?.restoreRecoveryDraft();
    });

    expect(loadText).toHaveBeenCalledWith('# Recovered', { saved: false });
    expect(setContext).toHaveBeenCalledWith({ path: null });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(readRecoveryDraft()).toEqual({
      filePath: null,
      text: '# Recovered',
    });
  });
});
