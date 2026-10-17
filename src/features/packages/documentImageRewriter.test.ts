import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { scanDocumentImageReferences } from '../../editor/capabilities/image/documentImageReferences';
import {
  documentSourceFormatExtension,
  parseDocumentSource,
  serializeDocumentSource,
} from '../../editor/core/documentSourceFormat';
import { markdownLanguage } from '../../editor/markdown/markdownLanguage';
import { rewriteDocumentImageDestinations } from './documentImageRewriter';

function createState(source: string): EditorState {
  const parsed = parseDocumentSource(source);
  return EditorState.create({
    doc: parsed.text,
    extensions: [
      markdownLanguage(),
      documentSourceFormatExtension(parsed.format),
    ],
  });
}

function replaceAll(state: EditorState, prefix: string) {
  return scanDocumentImageReferences(state).images.map((image) => ({
    destination: `${prefix}${image.source}`,
    from: image.destination.from,
    to: image.destination.to,
  }));
}

describe('rewriteDocumentImageDestinations', () => {
  it('preserves BOM and mixed line endings around replaced destinations', () => {
    const source = '\uFEFF# A\r\n![a](a.png)\r\n![b](b.png)\n';
    const state = createState(source);

    const text = rewriteDocumentImageDestinations(
      state,
      replaceAll(state, 'lumamark-assets/'),
    );

    expect(text).toBe(
      '\uFEFF# A\r\n![a](lumamark-assets/a.png)\r\n![b](lumamark-assets/b.png)\n',
    );
  });

  it('returns the existing serialized source when nothing changes', () => {
    const state = createState('a\r\nb\nc');
    expect(rewriteDocumentImageDestinations(state, [])).toBe(
      serializeDocumentSource(state),
    );
  });

  it('rewrites a reference definition URL once', () => {
    const source = '![a][id]\n\n![b][id]\n\n[id]: a.png\n';
    const state = createState(source);
    const replacements = replaceAll(state, 'lumamark-assets/');

    expect(replacements).toHaveLength(1);
    expect(rewriteDocumentImageDestinations(state, replacements)).toBe(
      '![a][id]\n\n![b][id]\n\n[id]: lumamark-assets/a.png\n',
    );
  });

  it('rewrites multiple images on the same line', () => {
    const state = createState('x ![a](a.png) y ![b](b.png) z');

    expect(
      rewriteDocumentImageDestinations(state, replaceAll(state, 'p/')),
    ).toBe('x ![a](p/a.png) y ![b](p/b.png) z');
  });

  it('rejects overlapping and duplicate replacements', () => {
    const state = createState('![a](a.png)');
    const [image] = scanDocumentImageReferences(state).images;

    expect(() =>
      rewriteDocumentImageDestinations(state, [
        { destination: 'x.png', from: image!.destination.from, to: image!.destination.to },
        { destination: 'y.png', from: image!.destination.from + 1, to: image!.destination.to },
      ]),
    ).toThrow(/overlap/u);

    expect(() =>
      rewriteDocumentImageDestinations(state, [
        { destination: 'x.png', from: image!.destination.from, to: image!.destination.to },
        { destination: 'x.png', from: image!.destination.from, to: image!.destination.to },
      ]),
    ).toThrow(/Duplicate/u);
  });
});
