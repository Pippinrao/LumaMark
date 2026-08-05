const BLOCK_SOURCE_MARK_NAMES = new Set([
  'CodeInfo',
  'HeaderMark',
  'ListMark',
  'QuoteMark',
  'TaskMarker',
]);

const INLINE_SOURCE_MARK_NAMES = new Set([
  'EmphasisMark',
  'LinkMark',
  'LinkTitle',
  'StrikethroughMark',
]);

export function markdownSourceMarkClassName(
  name: string,
  parentName?: string,
): string | undefined {
  if (
    BLOCK_SOURCE_MARK_NAMES.has(name) ||
    (name === 'CodeMark' && parentName !== 'InlineCode')
  ) {
    return 'lm-md-source-mark lm-md-source-mark-block';
  }

  if (
    INLINE_SOURCE_MARK_NAMES.has(name) ||
    (name === 'CodeMark' && parentName === 'InlineCode') ||
    (name === 'URL' && (parentName === 'Image' || parentName === 'Link'))
  ) {
    return 'lm-md-source-mark lm-md-source-mark-inline';
  }

  return undefined;
}

export function isReplaceableMarkdownSourceMark(
  name: string,
  parentName?: string,
): boolean {
  return (
    name !== 'ListMark' &&
    name !== 'TaskMarker' &&
    markdownSourceMarkClassName(name, parentName) !== undefined
  );
}
