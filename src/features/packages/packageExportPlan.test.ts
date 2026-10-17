import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  documentSourceFormatExtension,
  parseDocumentSource,
} from '../../editor/core/documentSourceFormat';
import { markdownLanguage } from '../../editor/markdown/markdownLanguage';
import {
  buildPackageExportPlan,
  packageEntryName,
} from './packageExportPlan';

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

function plan(
  markdown: string,
  options: { documentPath?: string | null; downloadRemoteImages?: boolean } = {},
) {
  return buildPackageExportPlan({
    documentPath:
      options.documentPath === undefined
        ? 'E:\\notes\\note.md'
        : options.documentPath,
    downloadRemoteImages: options.downloadRemoteImages ?? false,
    entryName: 'note.md',
    state: createState(markdown),
  });
}

describe('buildPackageExportPlan', () => {
  it('keeps document-relative images and declares them as resources', () => {
    const result = plan('![a](note.assets/a.png)');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(result.entryText).toBe('![a](note.assets/a.png)');
    expect(result.resources).toEqual([
      {
        archivePath: 'note.assets/a.png',
        kind: 'local',
        source: 'note.assets/a.png',
      },
    ]);
  });

  it('rewrites absolute images into package assets', () => {
    const result = plan('![a](E:/pics/photo.png)');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(result.entryText).toMatch(
      /!\[a\]\(lumamark-assets\/photo-[0-9a-f]{8}\.png\)/u,
    );
    expect(result.resources[0]?.kind).toBe('local');
  });

  it('keeps remote images as links unless downloading is enabled', () => {
    const skipped = plan('![a](https://example.com/a.png)');
    expect(skipped.status).toBe('ok');
    if (skipped.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(skipped.entryText).toBe('![a](https://example.com/a.png)');
    expect(skipped.resources).toEqual([]);
    expect(skipped.warnings).toEqual([
      { code: 'package_remote_skipped', source: 'https://example.com/a.png' },
    ]);

    const downloaded = plan('![a](https://example.com/a.png)', {
      downloadRemoteImages: true,
    });
    expect(downloaded.status).toBe('ok');
    if (downloaded.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(downloaded.resources).toHaveLength(1);
    expect(downloaded.resources[0]?.kind).toBe('remote');
    expect(downloaded.entryText).toMatch(/^!\[a\]\(lumamark-assets\//u);
  });

  it('packages draft images', () => {
    const result = plan('![d](lumamark-draft://draft-1/image-001.png)');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(result.resources[0]).toMatchObject({
      kind: 'draft',
      source: 'lumamark-draft://draft-1/image-001.png',
    });
    expect(result.entryText).toMatch(/^!\[d\]\(lumamark-assets\/draft-/u);
  });

  it('leaves data URIs inline and warns for HTML images', () => {
    const result = plan(
      '![a](data:image/png;base64,AAAA)\n\n<img src="a.png">',
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(result.entryText).toContain('data:image/png;base64,AAAA');
    expect(result.resources).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: 'package_html_image_unsupported',
      source: 'HTML <img>',
    });
  });

  it('deduplicates one file referenced with relative and absolute paths', () => {
    const result = plan(
      '![a](note.assets/a.png)\n\n![b](E:/notes/note.assets/a.png)',
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected a plan');
    }
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.archivePath).toBe('note.assets/a.png');
    expect(result.entryText).toContain('![b](note.assets/a.png)');
  });

  it('errors when a relative image has no document path', () => {
    const result = plan('![a](a.png)', { documentPath: null });

    expect(result).toEqual({
      error: 'relative_without_document',
      source: 'a.png',
      status: 'error',
    });
  });

  it('normalizes entry names', () => {
    expect(packageEntryName('note.md')).toBe('note.md');
    expect(packageEntryName('note.mdown')).toBe('note.mdown');
    expect(packageEntryName('note.txt')).toBe('note.md');
    expect(packageEntryName(null)).toBe('untitled.md');
  });
});
