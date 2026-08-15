import { describe, expect, it } from 'vitest';
import { classifyLinkUrl } from './linkUrlClassification';

describe('classifyLinkUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1',
    'mailto:user@example.com',
    'HTTPS://EXAMPLE.COM',
  ])('allows absolute URL %s', (href) => {
    expect(classifyLinkUrl(href)).toEqual({
      href,
      kind: 'absoluteAllowed',
    });
  });

  it.each([
    './note.md',
    '../docs/readme.md',
    'folder/file.md',
    'note.md',
    '#heading',
  ])('treats %s as a relative document path', (href) => {
    expect(classifyLinkUrl(href)).toEqual({
      href,
      kind: 'relative',
    });
  });

  it.each([
    '/absolute/local.md',
    '\\\\server\\share\\note.md',
    'C:/Windows/note.md',
    'C:\\Windows\\note.md',
  ])('rejects rooted local target %s', (href) => {
    expect(classifyLinkUrl(href)).toEqual({
      code: 'link.protocol_file',
      href,
      kind: 'rejected',
    });
  });

  it.each([
    {
      code: 'link.protocol_javascript',
      href: 'javascript:alert(1)',
    },
    {
      code: 'link.protocol_data',
      href: 'data:text/html,hi',
    },
    {
      code: 'link.protocol_file',
      href: 'file:///C:/temp/note.md',
    },
    {
      code: 'link.protocol_rejected',
      href: 'ftp://example.com/file',
    },
  ])('rejects $href with $code', ({ code, href }) => {
    expect(classifyLinkUrl(href)).toEqual({
      code,
      href,
      kind: 'rejected',
    });
  });

  it('rejects blank href', () => {
    expect(classifyLinkUrl('   ')).toEqual({
      code: 'link.empty',
      href: '   ',
      kind: 'rejected',
    });
  });
});
