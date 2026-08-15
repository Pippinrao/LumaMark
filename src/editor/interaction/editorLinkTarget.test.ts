import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  advanceEditorReferenceIndex,
  isEditorReferenceIndexReady,
  resolveEditorLinkHref,
  resolveEditorLinkTarget,
} from './editorLinkTarget';

function createState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [markdownLanguage()],
  });
}

function warmReferenceIndex(state: EditorState) {
  const status = advanceEditorReferenceIndex(state, {
    maxNodes: 100_000,
    maxWorkMs: 100,
  });
  expect(status).toBe('ready');
}

function hrefAt(source: string, needle: string, offset = 0) {
  const state = createState(source);
  warmReferenceIndex(state);
  return resolveEditorLinkHref(state, source.indexOf(needle) + offset);
}

describe('resolveEditorLinkHref', () => {
  it('extracts inline, angle-bracket, web-autolink, and email-autolink targets', () => {
    expect(hrefAt('[Guide](./guide.md#install)', 'Guide', 2)).toBe(
      './guide.md#install',
    );
    expect(hrefAt('[Web](<https://example.com/a b>)', 'Web', 1)).toBe(
      'https://example.com/a b',
    );
    expect(hrefAt('<https://example.com/docs>', 'example')).toBe(
      'https://example.com/docs',
    );
    expect(hrefAt('<writer@example.com>', 'writer')).toBe(
      'mailto:writer@example.com',
    );
  });

  it('normalizes GFM bare web and email URL nodes', () => {
    expect(hrefAt('https://example.com/docs', 'example')).toBe(
      'https://example.com/docs',
    );
    expect(hrefAt('www.example.com/docs', 'example')).toBe(
      'https://www.example.com/docs',
    );
    expect(hrefAt('writer@example.com', 'writer')).toBe(
      'mailto:writer@example.com',
    );
  });

  it('resolves full, collapsed, and shortcut reference links through the first definition', () => {
    expect(
      hrefAt('[Guide][Ref]\n\n[ref]: ./guide.md#install', 'Guide', 1),
    ).toBe('./guide.md#install');
    expect(
      hrefAt('[Guide][]\n\n[Guide]: ./collapsed.md', 'Guide', 1),
    ).toBe('./collapsed.md');
    expect(hrefAt('[Ref]\n\n[ref]: ./shortcut.md', 'Ref', 1)).toBe(
      './shortcut.md',
    );
    expect(
      hrefAt(
        '[Guide][two words]\n\n[TWO   WORDS]: ./first.md\n[two words]: ./second.md',
        'Guide',
        1,
      ),
    ).toBe('./first.md');
  });

  it('fails closed without advancing an incomplete syntax tree on the interaction path', () => {
    const filler = Array.from(
      { length: 20_000 },
      (_, index) => `paragraph ${index}`,
    ).join('\n\n');
    const source = `[Guide][remote]\n\n${filler}\n\n[remote]: ./far.md#target`;
    const state = createState(source);
    const parsedLengthBefore = syntaxTree(state).length;

    expect(isEditorReferenceIndexReady(state)).toBe(false);
    expect(
      resolveEditorLinkHref(state, source.indexOf('Guide') + 1),
    ).toBeNull();
    expect(isEditorReferenceIndexReady(state)).toBe(false);
    expect(syntaxTree(state).length).toBe(parsedLengthBefore);
  });

  it('does not treat a standalone image destination as a navigable link', () => {
    expect(hrefAt('![Alt](./image.png)', 'Alt', 1)).toBeNull();
    expect(
      hrefAt('[![Alt](./image.png)](https://example.com)', 'Alt', 1),
    ).toBe('https://example.com');
  });

  it('excludes code spans and link-reference definitions from navigation', () => {
    expect(hrefAt('`https://example.com`', 'example')).toBeNull();
    expect(hrefAt('[ref]: ./guide.md', 'guide')).toBeNull();
  });

  it('does not navigate link-shaped content inside protected frontmatter', () => {
    const source = [
      '---',
      'homepage: [Guide](https://example.com)',
      '---',
      '',
      '[Body](https://body.example)',
    ].join('\n');

    expect(hrefAt(source, 'Guide', 1)).toBeNull();
    expect(hrefAt(source, 'Body', 1)).toBe('https://body.example');
  });

  it('does not leak link ownership across the half-open end boundary', () => {
    const createState = (doc: string) =>
      EditorState.create({ doc, extensions: [markdownLanguage()] });
    const inline = createState('[x](https://x.test) tail');
    const bare = createState('https://x.test tail');

    expect(resolveEditorLinkHref(inline, '[x](https://x.test)'.length)).toBeNull();
    expect(resolveEditorLinkHref(bare, 'https://x.test'.length)).toBeNull();
  });

  it('normalizes CommonMark escapes and character references in references and destinations', () => {
    expect(
      hrefAt('[Guide][a*b]\n\n[a\\*b]: ./escaped.md', 'Guide', 1),
    ).toBe('./escaped.md');
    expect(
      hrefAt('[Guide][a&b]\n\n[a&amp;b]: ./entity.md', 'Guide', 1),
    ).toBe('./entity.md');
    expect(hrefAt('[Guide](foo\\(bar\\).md)', 'Guide', 1)).toBe(
      'foo(bar).md',
    );
  });

  it('keeps the exact source destination separate from the normalized navigation href', () => {
    const source = '[Guide](foo\\(bar\\).md)';
    const state = EditorState.create({
      doc: source,
      extensions: [markdownLanguage()],
    });

    expect(resolveEditorLinkTarget(state, source.indexOf('Guide') + 1)).toEqual({
      from: 0,
      href: 'foo(bar).md',
      rawHref: 'foo\\(bar\\).md',
      to: source.length,
    });
  });
});
