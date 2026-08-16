import { describe, expect, it, vi } from 'vitest';
import {
  applyEditorDocumentContextPatch,
  createFallbackDocumentId,
  createInitialEditorDocumentContext,
} from './editorDocumentIdentity';

describe('editorDocumentIdentity', () => {
  it('treats an explicit claim identity as the authority over a path spelling', () => {
    const explicit = createInitialEditorDocumentContext({
      documentId: 'document:claim-owner',
      path: 'E:\\Notes\\Explicit.md',
    });
    const patched = applyEditorDocumentContextPatch(explicit, {
      documentId: 'document:claim-owner',
      path: 'e:/notes/explicit.md',
    });

    expect(explicit.documentId).toBe('document:claim-owner');
    expect(patched.documentId).toBe('document:claim-owner');
  });

  it('does not guess Windows drive or UNC folding for browser fallback identities', () => {
    expect(createFallbackDocumentId('E:\\Research\\Equations.md')).not.toBe(
      createFallbackDocumentId('e:/research/equations.md'),
    );
    expect(
      createFallbackDocumentId('\\\\Server\\Share\\Research\\Equations.md'),
    ).not.toBe(
      createFallbackDocumentId('//server/share/research/equations.md'),
    );
  });

  it('keeps POSIX backslashes, case, and slash-looking UNC text as identity-significant', () => {
    expect(createFallbackDocumentId('/notes/a\\b.md')).not.toBe(
      createFallbackDocumentId('/notes/a/b.md'),
    );
    expect(createFallbackDocumentId('/notes/Case.md')).not.toBe(
      createFallbackDocumentId('/notes/case.md'),
    );
    expect(createFallbackDocumentId('//server/share/file.md')).not.toBe(
      createFallbackDocumentId('/server/share/file.md'),
    );
  });

  it('assigns each untitled editor and each new-document transition a unique identity', () => {
    const first = createInitialEditorDocumentContext({ path: null });
    const second = createInitialEditorDocumentContext({ path: null });
    const next = applyEditorDocumentContextPatch(first, { path: null });

    expect(first.documentId).toMatch(/^document:untitled:/);
    expect(second.documentId).toMatch(/^document:untitled:/);
    expect(next.documentId).toMatch(/^document:untitled:/);
    expect(new Set([first.documentId, second.documentId, next.documentId])).toHaveProperty(
      'size',
      3,
    );
  });

  it('honors an explicit identity through handler-only patches', () => {
    const handler = vi.fn();
    const explicit = createInitialEditorDocumentContext({
      documentId: 'document:explicit-owner',
      path: '/notes/explicit.md',
    });
    const patched = applyEditorDocumentContextPatch(explicit, {
      onMediaPreviewRequest: handler,
    });

    expect(patched.documentId).toBe('document:explicit-owner');
    expect(patched.path).toBe('/notes/explicit.md');
    expect(patched.onMediaPreviewRequest).toBe(handler);
  });
});
