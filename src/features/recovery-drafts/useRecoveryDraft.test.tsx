import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import {
  readRecoveryDraft,
  saveRecoveryDraft,
} from '../../services/drafts/draftStore';
import { useRecoveryDraft, type RecoveryDraftWorkflow } from './useRecoveryDraft';

function RecoveryDraftHarness({
  currentFilePath = null,
  editorReady = true,
  editorRef,
  onWorkflow,
  onRestore,
}: {
  currentFilePath?: string | null;
  editorReady?: boolean;
  editorRef: RefObject<EditorDocumentPort | null>;
  onRestore: () => void;
  onWorkflow: (workflow: RecoveryDraftWorkflow) => void;
}) {
  onWorkflow(
    useRecoveryDraft({
      currentFilePath,
      editorReady,
      editorRef,
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

    expect(loadText).toHaveBeenCalledWith('# Recovered');
    expect(setContext).toHaveBeenCalledWith({ path: null });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(readRecoveryDraft()).toBeNull();
  });
});
