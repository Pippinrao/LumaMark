export function resolveRelativeLinkPath(
  href: string,
  currentDocumentPath: string | null,
): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  if (!currentDocumentPath) {
    return null;
  }

  const encodedPath = trimmed.split(/[?#]/, 1)[0] ?? '';
  if (!encodedPath) {
    return null;
  }
  if (/%(?:2f|5c)/i.test(encodedPath)) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (
    containsControlCharacter(decodedPath) ||
    /^(?:[\\/]|[a-zA-Z]:[\\/])/.test(decodedPath)
  ) {
    return null;
  }

  const parsedDocument = parseAbsoluteDocumentPath(currentDocumentPath);
  if (!parsedDocument) {
    return null;
  }
  const resolved = parsedDocument.directorySegments.slice();
  for (const segment of decodedPath.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (resolved.length === 0) {
        return null;
      }
      resolved.pop();
      continue;
    }
    if (segment.includes(':')) {
      return null;
    }
    resolved.push(segment);
  }

  const normalized = `${parsedDocument.root}${resolved.join('/')}`;
  return parsedDocument.usesBackslash
    ? normalized.replace(/\//g, '\\')
    : normalized;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

type ParsedDocumentPath = {
  directorySegments: string[];
  root: string;
  usesBackslash: boolean;
};

function parseAbsoluteDocumentPath(path: string): ParsedDocumentPath | null {
  const usesBackslash = path.includes('\\');
  const normalized = path.replace(/\\/g, '/');
  let root: string;
  let remainder: string;

  if (/^\/\/\.\//.test(normalized)) {
    return null;
  }

  const extendedUnc = /^\/\/\?\/(unc)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(
    normalized,
  );
  if (extendedUnc) {
    root = `//?/${extendedUnc[1]}/${extendedUnc[2]}/${extendedUnc[3]}/`;
    remainder = extendedUnc[4];
  } else {
    const extendedDrive = /^\/\/\?\/([a-zA-Z]:)\/(.+)$/.exec(normalized);
    if (extendedDrive) {
      root = `//?/${extendedDrive[1]}/`;
      remainder = extendedDrive[2];
    } else if (/^\/\/\?\//.test(normalized)) {
      return null;
    } else {
      const unc = /^\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(normalized);
      if (unc) {
        root = `//${unc[1]}/${unc[2]}/`;
        remainder = unc[3];
      } else {
        const drive = /^([a-zA-Z]:)\/(.+)$/.exec(normalized);
        if (drive) {
          root = `${drive[1]}/`;
          remainder = drive[2];
        } else if (normalized.startsWith('/') && normalized.length > 1) {
          root = '/';
          remainder = normalized.slice(1);
        } else {
          return null;
        }
      }
    }
  }

  const documentSegments = remainder.split('/').filter(Boolean);
  if (documentSegments.length === 0) {
    return null;
  }
  documentSegments.pop();
  return {
    directorySegments: documentSegments,
    root,
    usesBackslash,
  };
}
