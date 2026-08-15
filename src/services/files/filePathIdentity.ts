function normalizeSeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

function canonicalWindowsPath(path: string): string | null {
  const normalized = normalizeSeparators(path);

  const extendedUnc = /^\/\/\?\/unc\/([^/]+)\/([^/]+)(\/.*)?$/i.exec(
    normalized,
  );
  if (extendedUnc) {
    return `//${extendedUnc[1]}/${extendedUnc[2]}${extendedUnc[3] ?? ''}`.toLowerCase();
  }

  const extendedDrive = /^\/\/\?\/([a-z]:)(\/.*)?$/i.exec(normalized);
  if (extendedDrive) {
    return `${extendedDrive[1]}${extendedDrive[2] ?? ''}`.toLowerCase();
  }

  if (/^\/\/[?.](?:\/|$)/.test(normalized)) {
    return null;
  }

  if (/^\/\/[^/]+\/[^/]+(?:\/|$)/.test(normalized)) {
    return normalized.toLowerCase();
  }

  if (/^[a-z]:\//i.test(normalized)) {
    return normalized.toLowerCase();
  }

  return null;
}

export function areFilePathsEqual(left: string, right: string): boolean {
  const canonicalLeft = canonicalWindowsPath(left);
  const canonicalRight = canonicalWindowsPath(right);

  if (canonicalLeft !== null || canonicalRight !== null) {
    return (
      canonicalLeft !== null &&
      canonicalRight !== null &&
      canonicalLeft === canonicalRight
    );
  }

  return left === right;
}
