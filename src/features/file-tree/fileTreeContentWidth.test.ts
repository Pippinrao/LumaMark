import { describe, expect, it } from 'vitest';
import {
  FILE_TREE_INDENT_WIDTH,
  measureFileTreeContentWidth,
} from './fileTreeContentWidth';

const measureText = (text: string) => text.length * 10;

describe('measureFileTreeContentWidth', () => {
  it('reports nothing for an empty tree', () => {
    expect(measureFileTreeContentWidth([], measureText)).toBe(0);
  });

  it('uses the widest row rather than the last one', () => {
    const width = measureFileTreeContentWidth(
      [
        { depth: 0, label: 'short.md' },
        { depth: 0, label: 'a-much-longer-name.md' },
        { depth: 0, label: 'mid.md' },
      ],
      measureText,
    );

    expect(width).toBe(measureText('a-much-longer-name.md'));
  });

  it('counts indentation so deep nodes win over shallow ones', () => {
    const width = measureFileTreeContentWidth(
      [
        { depth: 0, label: 'notes.md' },
        { depth: 3, label: 'notes.md' },
      ],
      measureText,
    );

    expect(width).toBe(measureText('notes.md') + 3 * FILE_TREE_INDENT_WIDTH);
  });

  it('keeps a shallow long name ahead of a deep short name when it is wider', () => {
    const width = measureFileTreeContentWidth(
      [
        { depth: 0, label: 'a-very-long-file-name.md' },
        { depth: 1, label: 'x.md' },
      ],
      measureText,
    );

    expect(width).toBe(measureText('a-very-long-file-name.md'));
  });

  it('matches the indentation react-arborist is configured with', () => {
    expect(FILE_TREE_INDENT_WIDTH).toBe(16);
  });
});
