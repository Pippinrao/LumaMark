import { describe, expect, it } from 'vitest';
import { resolveImageFilesystemPath } from './imagePathResolver';

describe('resolveImageFilesystemPath', () => {
  it('resolves relative and assets paths against the document directory', () => {
    expect(
      resolveImageFilesystemPath({
        documentPath: 'E:\\notes\\doc.md',
        source: './photo.png',
      }),
    ).toEqual({
      kind: 'local',
      path: 'E:\\notes\\photo.png',
    });

    expect(
      resolveImageFilesystemPath({
        documentPath: 'E:\\notes\\doc.md',
        source: 'assets/pic.png',
      }),
    ).toEqual({
      kind: 'local',
      path: 'E:\\notes\\assets\\pic.png',
    });
  });

  it('keeps remote URLs as copyable destinations without filesystem resolution', () => {
    expect(
      resolveImageFilesystemPath({
        documentPath: 'E:\\notes\\doc.md',
        source: 'https://example.com/a.png',
      }),
    ).toEqual({
      kind: 'remote',
      url: 'https://example.com/a.png',
    });
  });

  it('resolves titled-image URL segments as local filesystem paths', () => {
    expect(
      resolveImageFilesystemPath({
        documentPath: 'E:\\notes\\doc.md',
        source: 'a.png',
      }),
    ).toEqual({
      kind: 'local',
      path: 'E:\\notes\\a.png',
    });
  });

  it('fails closed for relative sources without a document path', () => {
    expect(
      resolveImageFilesystemPath({
        documentPath: null,
        source: './photo.png',
      }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'relative_without_document',
    });
  });
});
