import { describe, expect, it } from 'vitest';
import { areFilePathsEqual } from './filePathIdentity';

describe('areFilePathsEqual', () => {
  it('compares Windows drive paths case-insensitively without changing POSIX semantics', () => {
    expect(
      areFilePathsEqual('E:\\Notes\\Draft.md', 'e:/notes/draft.md'),
    ).toBe(true);
    expect(areFilePathsEqual('/notes/Readme.md', '/notes/readme.md')).toBe(
      false,
    );
    expect(areFilePathsEqual('/notes/a\\b.md', '/notes/a/b.md')).toBe(false);
  });

  it('compares standard and extended UNC paths case-insensitively', () => {
    expect(
      areFilePathsEqual(
        '\\\\server\\share\\Notes\\Draft.md',
        '//SERVER/SHARE/notes/draft.md',
      ),
    ).toBe(true);
    expect(
      areFilePathsEqual(
        '\\\\?\\UNC\\server\\share\\Notes\\Draft.md',
        '\\\\?\\unc\\SERVER\\SHARE\\notes\\draft.md',
      ),
    ).toBe(true);
    expect(
      areFilePathsEqual(
        '\\\\server\\share\\Notes\\Draft.md',
        '\\\\?\\UNC\\SERVER\\SHARE\\notes\\draft.md',
      ),
    ).toBe(true);
  });

  it('compares standard and extended drive paths case-insensitively', () => {
    expect(
      areFilePathsEqual(
        'E:\\Notes\\Draft.md',
        '\\\\?\\e:\\notes\\draft.md',
      ),
    ).toBe(true);
  });
});
