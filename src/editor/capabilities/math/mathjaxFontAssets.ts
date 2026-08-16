const fontModules = import.meta.glob<string>(
  '../../../../node_modules/@mathjax/mathjax-newcm-font/chtml/woff2/*.woff2',
  {
    eager: true,
    import: 'default',
    query: '?url&no-inline',
  },
);

export const bundledNewcmFontUrls: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(fontModules).map(([modulePath, url]) => [
      modulePath.slice(modulePath.lastIndexOf('/') + 1),
      url,
    ]),
  );

export function rewriteNewcmFontUrls(stylesheet: string): string {
  let cursor = 0;
  let rewritten = '';

  while (cursor < stylesheet.length) {
    const start = stylesheet.indexOf('url(', cursor);
    if (start === -1) {
      rewritten += stylesheet.slice(cursor);
      break;
    }

    const end = stylesheet.indexOf(')', start + 4);
    if (end === -1) {
      rewritten += stylesheet.slice(cursor);
      break;
    }

    rewritten += stylesheet.slice(cursor, start);
    const rawUrl = stylesheet.slice(start + 4, end).trim();
    const firstCharacter = rawUrl.at(0);
    const unquotedUrl =
      (firstCharacter === '"' || firstCharacter === "'") &&
      rawUrl.at(-1) === firstCharacter
        ? rawUrl.slice(1, -1)
        : rawUrl;
    const separator = Math.max(
      unquotedUrl.lastIndexOf('/'),
      unquotedUrl.lastIndexOf('\\'),
    );
    const fileName = unquotedUrl.slice(separator + 1);
    const bundledUrl = bundledNewcmFontUrls[fileName];

    rewritten += bundledUrl
      ? `url("${bundledUrl}")`
      : stylesheet.slice(start, end + 1);
    cursor = end + 1;
  }

  return rewritten;
}
