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

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  const usesBackslash = currentDocumentPath.includes('\\');
  const normalizedDoc = currentDocumentPath.replace(/\\/g, '/');
  const slash = normalizedDoc.lastIndexOf('/');
  const baseDir = slash >= 0 ? normalizedDoc.slice(0, slash) : '';
  const absoluteRoot = normalizedDoc.startsWith('/');
  const hrefPath = decodedPath.replace(/\\/g, '/');
  const joinedBase = hrefPath.startsWith('/')
    ? hrefPath
    : baseDir
      ? `${baseDir}/${hrefPath}`
      : hrefPath;
  const segments = joinedBase.split('/');
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '') {
      continue;
    }
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  let joined = resolved.join('/');
  if (absoluteRoot || hrefPath.startsWith('/')) {
    joined = `/${joined}`;
  }

  return usesBackslash ? joined.replace(/\//g, '\\') : joined;
}
