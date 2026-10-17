import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { scanDocumentImageReferences } from './documentImageReferences';

function state(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdownLanguage()] });
}

describe('scanDocumentImageReferences', () => {
  it('collects an inline image destination', () => {
    const doc = 'text ![alt](assets/a.png "title") more';
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images).toHaveLength(1);
    expect(scan.images[0]).toMatchObject({
      angleBracketed: false,
      lineNumber: 0,
      source: 'assets/a.png',
    });
    expect(
      doc.slice(scan.images[0]!.destination.from, scan.images[0]!.destination.to),
    ).toBe('assets/a.png');
  });

  it('keeps angle brackets out of the source', () => {
    const doc = '![alt](<my pic.png>)';
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images[0]).toMatchObject({
      angleBracketed: true,
      source: 'my pic.png',
    });
    expect(
      doc.slice(scan.images[0]!.destination.from, scan.images[0]!.destination.to),
    ).toBe('<my pic.png>');
  });

  it('resolves full, collapsed, and shortcut references', () => {
    const doc = [
      '![full][id]',
      '![collapsed][]',
      '![shortcut]',
      '',
      '[id]: assets/full.png',
      '[collapsed]: assets/collapsed.png',
      '[shortcut]: assets/shortcut.png',
    ].join('\n');
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images.map((image) => image.source)).toEqual([
      'assets/full.png',
      'assets/collapsed.png',
      'assets/shortcut.png',
    ]);
    expect(scan.images.map((image) => image.lineNumber)).toEqual([4, 5, 6]);
  });

  it('deduplicates images that share one reference definition', () => {
    const doc = '![a][id]\n\n![b][id]\n\n[id]: assets/a.png';
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images).toHaveLength(1);
    expect(scan.images[0]!.source).toBe('assets/a.png');
  });

  it('ignores unresolved references and images inside code fences', () => {
    const doc = '![missing][nope]\n\n```\n![code](no.png)\n```\n';
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images).toEqual([]);
  });

  it('counts raw HTML images without treating them as Markdown images', () => {
    const doc = '<img src="a.png">\n\n<div><img src="b.png"></div>';
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.images).toEqual([]);
    expect(scan.htmlImageCount).toBe(2);
  });

  it('counts draft, data, and blob sources', () => {
    const doc = [
      '![d](lumamark-draft://draft-1/image-001.png)',
      '![i](data:image/png;base64,AAAA)',
      '![b](blob:https://example.com/1)',
    ].join('\n\n');
    const scan = scanDocumentImageReferences(state(doc));

    expect(scan.draftImageCount).toBe(1);
    expect(scan.dataImageCount).toBe(1);
    expect(scan.blobImageCount).toBe(1);
  });
});
