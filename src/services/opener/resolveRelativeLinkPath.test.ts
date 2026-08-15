import { describe, expect, it } from 'vitest';
import { resolveRelativeLinkPath } from './resolveRelativeLinkPath';

describe('resolveRelativeLinkPath', () => {
  it('resolves a sibling markdown path from the current document', () => {
    expect(
      resolveRelativeLinkPath('./note.md', 'C:/workspace/docs/readme.md'),
    ).toBe('C:/workspace/docs/note.md');
    expect(
      resolveRelativeLinkPath('.\\note.md', 'C:\\workspace\\docs\\readme.md'),
    ).toBe('C:\\workspace\\docs\\note.md');
  });

  it('resolves parent-relative paths', () => {
    expect(
      resolveRelativeLinkPath('../shared/a.md', '/home/user/docs/readme.md'),
    ).toBe('/home/user/shared/a.md');
  });

  it('returns null without a current document', () => {
    expect(resolveRelativeLinkPath('./note.md', null)).toBeNull();
  });

  it('returns null for hash-only links', () => {
    expect(
      resolveRelativeLinkPath('#heading', '/home/user/docs/readme.md'),
    ).toBeNull();
  });

  it('opens the local file portion of links with fragments or queries', () => {
    expect(
      resolveRelativeLinkPath(
        './other%20note.md#details',
        'C:/workspace/docs/readme.md',
      ),
    ).toBe('C:/workspace/docs/other note.md');
    expect(
      resolveRelativeLinkPath(
        '../shared/a.md?view=source#L10',
        '/home/user/docs/readme.md',
      ),
    ).toBe('/home/user/shared/a.md');
  });

  it('returns null for query-only links and malformed escapes', () => {
    expect(
      resolveRelativeLinkPath('?mode=preview', '/home/user/docs/readme.md'),
    ).toBeNull();
    expect(
      resolveRelativeLinkPath('./bad%E0%A4%A.md', '/home/user/docs/readme.md'),
    ).toBeNull();
  });
});
