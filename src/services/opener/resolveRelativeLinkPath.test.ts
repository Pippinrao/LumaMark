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

  it('never traverses above a Windows drive, POSIX root, or UNC share', () => {
    expect(
      resolveRelativeLinkPath('../../../Windows/x.md', 'C:/docs/note.md'),
    ).toBeNull();
    expect(
      resolveRelativeLinkPath('../../../etc/passwd', '/home/note.md'),
    ).toBeNull();
    expect(
      resolveRelativeLinkPath(
        '..\\..\\..\\other.md',
        '\\\\server\\share\\docs\\note.md',
      ),
    ).toBeNull();
  });

  it('keeps relative navigation on the same Windows drive or UNC share', () => {
    expect(
      resolveRelativeLinkPath('../shared/a.md', 'C:/workspace/docs/readme.md'),
    ).toBe('C:/workspace/shared/a.md');
    expect(
      resolveRelativeLinkPath(
        '..\\shared\\a.md',
        '\\\\server\\share\\docs\\readme.md',
      ),
    ).toBe('\\\\server\\share\\shared\\a.md');
  });

  it('keeps extended UNC navigation inside the original share root', () => {
    expect(
      resolveRelativeLinkPath(
        '..\\shared\\a.md',
        '\\\\?\\UNC\\server\\share\\docs\\readme.md',
      ),
    ).toBe('\\\\?\\UNC\\server\\share\\shared\\a.md');
    expect(
      resolveRelativeLinkPath(
        '..\\..\\..\\escape.md',
        '\\\\?\\UNC\\server\\share\\docs\\readme.md',
      ),
    ).toBeNull();
  });

  it('supports extended drive roots without allowing root traversal', () => {
    expect(
      resolveRelativeLinkPath(
        '.\\other.md',
        '\\\\?\\C:\\docs\\readme.md',
      ),
    ).toBe('\\\\?\\C:\\docs\\other.md');
    expect(
      resolveRelativeLinkPath(
        '..\\..\\escape.md',
        '\\\\?\\C:\\docs\\readme.md',
      ),
    ).toBeNull();
  });

  it('rejects Win32 device namespace document paths', () => {
    expect(
      resolveRelativeLinkPath(
        '.\\other.md',
        '\\\\.\\C:\\docs\\readme.md',
      ),
    ).toBeNull();
  });

  it('rejects rooted targets and encoded path separators', () => {
    for (const href of [
      '/etc/passwd',
      '\\\\server\\share\\secret.md',
      'C:/Windows/system.ini',
      'C:\\Windows\\system.ini',
      '..%2f..%2fWindows%2fsystem.ini',
      '..%5c..%5cWindows%5csystem.ini',
    ]) {
      expect(resolveRelativeLinkPath(href, 'C:/workspace/docs/readme.md')).toBeNull();
    }
  });
});
