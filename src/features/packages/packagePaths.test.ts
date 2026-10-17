import { describe, expect, it } from 'vitest';
import {
  generatedArchivePath,
  imageExtension,
  isPackageArchivePath,
  isPathInsideDirectory,
  planImageDestination,
  relativeArchivePath,
  renderImageDestination,
} from './packagePaths';

describe('package paths', () => {
  it('recognizes zip archives case-insensitively', () => {
    expect(isPackageArchivePath('E:/notes/bundle.zip')).toBe(true);
    expect(isPackageArchivePath('bundle.ZIP')).toBe(true);
    expect(isPackageArchivePath('bundle.md')).toBe(false);
  });

  it('computes document-relative resource paths without escaping', () => {
    expect(
      relativeArchivePath(
        'E:\\notes\\note.md',
        'E:\\notes\\note.assets\\image-001.png',
      ),
    ).toBe('note.assets/image-001.png');
    expect(
      relativeArchivePath('E:\\notes\\note.md', 'E:\\shared\\a.png'),
    ).toBeNull();
    expect(
      relativeArchivePath('/home/me/note.md', '/home/me/a.png'),
    ).toBe('a.png');
  });

  it('checks directory containment with Windows case folding', () => {
    expect(
      isPathInsideDirectory('E:\\notes\\out', 'E:\\Notes\\out\\note.md'),
    ).toBe(true);
    expect(
      isPathInsideDirectory('E:\\notes\\out', 'E:\\notes\\other\\note.md'),
    ).toBe(false);
  });

  it('keeps document-relative destinations unchanged', () => {
    const used = new Set<string>();
    const plan = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\notes\\note.assets\\a.png',
      source: 'note.assets/a.png',
      used,
    });

    expect(plan).toMatchObject({
      destination: 'note.assets/a.png',
      rewrite: false,
      status: 'planned',
      resource: {
        archivePath: 'note.assets/a.png',
        kind: 'local',
        source: 'note.assets/a.png',
      },
    });
  });

  it('normalizes backslashes and brackets spaces', () => {
    const used = new Set<string>();
    const backslashes = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\notes\\my\\pic.png',
      source: 'my\\pic.png',
      used,
    });
    expect(backslashes).toMatchObject({
      destination: 'my/pic.png',
      rewrite: true,
      status: 'planned',
    });

    const spaces = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\notes\\my pic.png',
      source: 'my pic.png',
      used: new Set<string>(),
    });
    expect(spaces).toMatchObject({
      destination: '<my pic.png>',
      rewrite: true,
      status: 'planned',
    });
  });

  it('maps absolute and escaping sources into package assets', () => {
    const used = new Set<string>();
    const absolute = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\pics\\photo.png',
      source: 'E:\\pics\\photo.png',
      used,
    });
    expect(absolute.status).toBe('planned');
    if (absolute.status !== 'planned') {
      throw new Error('expected a plan');
    }
    expect(absolute.rewrite).toBe(true);
    expect(absolute.destination).toMatch(/^lumamark-assets\/photo-[0-9a-f]{8}\.png$/u);
    expect(absolute.resource?.kind).toBe('local');

    const escaping = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\shared\\photo.png',
      source: '../shared/photo.png',
      used,
    });
    expect(escaping.status).toBe('planned');
    if (escaping.status !== 'planned') {
      throw new Error('expected a plan');
    }
    expect(escaping.rewrite).toBe(true);
  });

  it('rewrites sources whose characters make URL parsing ambiguous', () => {
    const plan = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\notes\\a#b.png',
      source: 'a#b.png',
      used: new Set<string>(),
    });

    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') {
      throw new Error('expected a plan');
    }
    expect(plan.rewrite).toBe(true);
    expect(plan.destination).toMatch(/^lumamark-assets\//u);
  });

  it('prefixes relative sources whose first segment contains a colon', () => {
    const plan = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: 'E:\\notes\\a:b.png',
      source: 'a:b.png',
      used: new Set<string>(),
    });

    expect(plan).toMatchObject({
      destination: './a:b.png',
      rewrite: true,
      status: 'planned',
    });
  });

  it('skips remote images unless downloading is enabled', () => {
    const skipped = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: null,
      source: 'https://example.com/a.png',
      used: new Set<string>(),
    });
    expect(skipped).toMatchObject({
      status: 'warning',
      warning: 'package_remote_skipped',
    });

    const downloaded = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: true,
      resolvedPath: null,
      source: 'https://example.com/a.png',
      used: new Set<string>(),
    });
    expect(downloaded.status).toBe('planned');
    if (downloaded.status !== 'planned') {
      throw new Error('expected a plan');
    }
    expect(downloaded.resource?.kind).toBe('remote');
    expect(downloaded.destination).toMatch(/^lumamark-assets\/remote-[0-9a-f]{8}\.png$/u);
  });

  it('plans draft images and rejects unsupported remote extensions', () => {
    const draft = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: false,
      resolvedPath: null,
      source: 'lumamark-draft://draft-1/image-001.png',
      used: new Set<string>(),
    });
    expect(draft.status).toBe('planned');
    if (draft.status !== 'planned') {
      throw new Error('expected a plan');
    }
    expect(draft.resource?.kind).toBe('draft');

    const unsupported = planImageDestination({
      angleBracketed: false,
      documentPath: 'E:\\notes\\note.md',
      downloadRemoteImages: true,
      resolvedPath: null,
      source: 'https://example.com/a.bin',
      used: new Set<string>(),
    });
    expect(unsupported).toMatchObject({
      status: 'warning',
      warning: 'package_image_unsupported',
    });
  });

  it('leaves data URIs inline and warns for blob and file sources', () => {
    expect(
      planImageDestination({
        angleBracketed: false,
        documentPath: null,
        downloadRemoteImages: false,
        resolvedPath: null,
        source: 'data:image/png;base64,AAAA',
        used: new Set<string>(),
      }),
    ).toMatchObject({
      destination: 'data:image/png;base64,AAAA',
      rewrite: false,
      status: 'planned',
    });
    expect(
      planImageDestination({
        angleBracketed: false,
        documentPath: null,
        downloadRemoteImages: false,
        resolvedPath: null,
        source: 'blob:https://example.com/1',
        used: new Set<string>(),
      }),
    ).toMatchObject({ status: 'warning', warning: 'package_blob_unsupported' });
    expect(
      planImageDestination({
        angleBracketed: false,
        documentPath: null,
        downloadRemoteImages: false,
        resolvedPath: null,
        source: 'file:///C:/a.png',
        used: new Set<string>(),
      }),
    ).toEqual({ error: 'unsupported_source', status: 'error' });
  });

  it('errors when a relative image has no document path', () => {
    expect(
      planImageDestination({
        angleBracketed: false,
        documentPath: null,
        downloadRemoteImages: false,
        resolvedPath: null,
        source: 'a.png',
        used: new Set<string>(),
      }),
    ).toEqual({ error: 'relative_without_document', status: 'error' });
  });

  it('generates unique archive paths on collision', () => {
    const used = new Set<string>([`lumamark-assets/photo-${hash('E:/a/photo.png')}.png`]);
    const archivePath = generatedArchivePath(
      'local',
      'E:/a/photo.png',
      'png',
      used,
    );
    expect(archivePath).toMatch(/^lumamark-assets\/photo-[0-9a-f]{8}-2\.png$/u);
  });

  it('renders safe destinations and extensions', () => {
    expect(renderImageDestination('a.png', false)).toBe('a.png');
    expect(renderImageDestination('my pic.png', false)).toBe('<my pic.png>');
    expect(renderImageDestination('a.png', true)).toBe('<a.png>');
    expect(imageExtension('https://example.com/a.PNG?x=1')).toBe('png');
    expect(imageExtension('no-extension')).toBeNull();
  });
});

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}
