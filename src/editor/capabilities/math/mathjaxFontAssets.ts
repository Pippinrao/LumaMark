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

const preloadedNewcmFontBlobUrls = new Map<string, string>();
let bundledNewcmFontPreload: Promise<void> | undefined;

export function rewriteNewcmFontUrls(stylesheet: string): string {
  return rewriteStylesheetUrls(stylesheet, (fileName) =>
    bundledNewcmFontUrls[fileName],
  );
}

export function applyPreloadedNewcmFontUrls(stylesheet: string): string {
  if (preloadedNewcmFontBlobUrls.size === 0) {
    return stylesheet;
  }

  return rewriteStylesheetUrls(
    stylesheet,
    (fileName) => preloadedNewcmFontBlobUrls.get(fileName),
  );
}

export function preloadBundledNewcmFonts(): Promise<void> {
  bundledNewcmFontPreload ??= (async () => {
    if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
      return;
    }

    await Promise.all(
      Object.entries(bundledNewcmFontUrls).map(async ([fileName, url]) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to preload NewCM font: ${url}`);
        }
        const buffer = await response.arrayBuffer();
        preloadedNewcmFontBlobUrls.set(
          fileName,
          URL.createObjectURL(new Blob([buffer], { type: 'font/woff2' })),
        );
      }),
    );
  })();
  return bundledNewcmFontPreload;
}

function rewriteStylesheetUrls(
  stylesheet: string,
  resolveUrl: (fileName: string) => string | undefined,
): string {
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
    const fileName = unquotedUrl
      .slice(separator + 1)
      .replace(/[?#].*$/u, '');
    const resolvedUrl = resolveUrl(fileName);

    rewritten += resolvedUrl
      ? `url("${resolvedUrl}")`
      : stylesheet.slice(start, end + 1);
    cursor = end + 1;
  }

  return rewritten;
}
