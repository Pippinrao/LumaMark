import { isAbsolutePath } from '../../editor/capabilities/image/imagePathResolver';

export type PackageResourceKind = 'draft' | 'local' | 'remote';

export type PackageResourcePlan = {
  archivePath: string;
  source: string;
  kind: PackageResourceKind;
};

export type PackagePlanWarningCode =
  | 'package_blob_unsupported'
  | 'package_html_image_unsupported'
  | 'package_image_unsupported'
  | 'package_remote_skipped'
  | 'package_unsupported_source';

export type ImageDestinationPlan =
  | {
      destination: string;
      resource?: PackageResourcePlan;
      rewrite: boolean;
      status: 'planned';
    }
  | {
      destination: string;
      rewrite: false;
      status: 'warning';
      warning: PackagePlanWarningCode;
    }
  | {
      error: 'relative_without_document' | 'unsupported_source';
      status: 'error';
    };

export type PlanImageDestinationInput = {
  angleBracketed: boolean;
  documentPath: string | null;
  downloadRemoteImages: boolean;
  resolvedPath: string | null;
  source: string;
  used: Set<string>;
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

const REMOTE_OR_DRAFT_PREFIX = 'lumamark-assets/';

export function isPackageArchivePath(path: string): boolean {
  return /\.zip$/iu.test(path.trim());
}

export function planImageDestination(
  input: PlanImageDestinationInput,
): ImageDestinationPlan {
  const source = input.source.trim();
  if (!source) {
    return { error: 'unsupported_source', status: 'error' };
  }

  const original = input.angleBracketed ? `<${source}>` : source;

  if (/^data:/iu.test(source)) {
    return {
      destination: original,
      rewrite: false,
      status: 'planned',
    };
  }

  if (/^blob:/iu.test(source)) {
    return warning(original, 'package_blob_unsupported');
  }

  if (/^file:/iu.test(source)) {
    return { error: 'unsupported_source', status: 'error' };
  }

  if (/^lumamark-draft:/iu.test(source)) {
    const extension = imageExtension(source);
    if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return warning(original, 'package_image_unsupported');
    }
    const archivePath = generatedArchivePath(
      'draft',
      source,
      extension,
      input.used,
    );
    return {
      destination: renderImageDestination(archivePath, false),
      resource: { archivePath, source, kind: 'draft' },
      rewrite: true,
      status: 'planned',
    };
  }

  if (/^https?:/iu.test(source)) {
    if (!input.downloadRemoteImages) {
      return warning(original, 'package_remote_skipped');
    }
    const extension = imageExtension(source);
    if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return warning(original, 'package_image_unsupported');
    }
    const archivePath = generatedArchivePath(
      'remote',
      source,
      extension,
      input.used,
    );
    return {
      destination: renderImageDestination(archivePath, false),
      resource: { archivePath, source, kind: 'remote' },
      rewrite: true,
      status: 'planned',
    };
  }

  const absolute = isAbsolutePath(source);
  if (!absolute && !input.documentPath) {
    return { error: 'relative_without_document', status: 'error' };
  }
  if (!absolute && /^[a-z][a-z0-9+.-]*:\/\//iu.test(source)) {
    return { error: 'unsupported_source', status: 'error' };
  }
  if (!input.resolvedPath) {
    return { error: 'unsupported_source', status: 'error' };
  }

  const extension = imageExtension(source);
  const relative = absolute
    ? null
    : relativeArchivePath(input.documentPath!, input.resolvedPath);
  const problematic = /[#?%<>]/u.test(source);

  if (relative !== null && !problematic && !absolute) {
    const archivePath = relative;
    input.used.add(archivePath.toLowerCase());
    const normalized = source.replace(/\\/gu, '/');
    let destinationPath = normalized;
    if (firstSegmentHasColon(normalized)) {
      destinationPath = `./${normalized}`;
    }
    const destination = renderImageDestination(
      destinationPath,
      input.angleBracketed || needsAngleBrackets(destinationPath),
    );
    return {
      destination,
      resource: { archivePath, source, kind: 'local' },
      rewrite: destination !== original,
      status: 'planned',
    };
  }

  const archivePath = generatedArchivePath(
    'local',
    input.resolvedPath,
    extension,
    input.used,
  );
  return {
    destination: renderImageDestination(archivePath, false),
    resource: { archivePath, source, kind: 'local' },
    rewrite: true,
    status: 'planned',
  };
}

export function relativeArchivePath(
  documentPath: string,
  resolvedPath: string,
): string | null {
  const directory = normalizePosix(directoryOf(documentPath));
  const resolved = normalizePosix(resolvedPath);
  if (!directory || !resolved) {
    return null;
  }

  const windowsStyle =
    isWindowsStyle(directory) || documentPath.trim().startsWith('//');
  const directoryKey = windowsStyle ? directory.toLowerCase() : directory;
  const resolvedKey = windowsStyle ? resolved.toLowerCase() : resolved;
  const prefix = directoryKey.endsWith('/')
    ? directoryKey
    : `${directoryKey}/`;

  if (!resolvedKey.startsWith(prefix)) {
    return null;
  }

  const relative = resolved.slice(prefix.length);
  if (!relative || relative.split('/').includes('..')) {
    return null;
  }

  return relative;
}

export function isPathInsideDirectory(root: string, path: string): boolean {
  const rawRoot = root.replace(/\\/gu, '/');
  const windowsStyle = isWindowsStyle(rawRoot) || rawRoot.startsWith('//');
  const rootKey = windowsStyle ? rawRoot.toLowerCase() : rawRoot;
  const pathKey = windowsStyle
    ? path.replace(/\\/gu, '/').toLowerCase()
    : path.replace(/\\/gu, '/');
  if (!rootKey) {
    return false;
  }
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}

export function generatedArchivePath(
  kind: PackageResourceKind,
  key: string,
  extension: string | null,
  used: Set<string>,
): string {
  const suffix = extension ? `.${extension}` : '';
  const stem =
    kind === 'local'
      ? `${sanitizeStem(fileNameFromPath(key))}-${hashString(key)}`
      : `${kind}-${hashString(key)}`;
  let candidate = `${REMOTE_OR_DRAFT_PREFIX}${stem}${suffix}`;
  let index = 2;

  while (used.has(candidate.toLowerCase())) {
    candidate = `${REMOTE_OR_DRAFT_PREFIX}${stem}-${index}${suffix}`;
    index += 1;
  }

  used.add(candidate.toLowerCase());
  return candidate;
}

export function renderImageDestination(
  destination: string,
  angleBracketed: boolean,
): string {
  if (!angleBracketed && !needsAngleBrackets(destination)) {
    return destination;
  }

  return `<${destination.replace(/</gu, '%3C').replace(/>/gu, '%3E')}>`;
}

export function imageExtension(source: string): string | null {
  const withoutQuery = source.split(/[?#]/u, 1)[0] ?? '';
  const fileName = fileNameFromPath(withoutQuery);
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return null;
  }
  const extension = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/u.test(extension) ? extension : null;
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function warning(
  destination: string,
  code: PackagePlanWarningCode,
): ImageDestinationPlan {
  return {
    destination,
    rewrite: false,
    status: 'warning',
    warning: code,
  };
}

function needsAngleBrackets(destination: string): boolean {
  return /[\s()]/u.test(destination);
}

function firstSegmentHasColon(source: string): boolean {
  const first = source.split('/')[0] ?? '';
  return first.includes(':');
}

function sanitizeStem(value: string): string {
  const stem = value.replace(/\.[^.]+$/u, '');
  const sanitized = stem
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[-._]+|[-._]+$/gu, '')
    .slice(0, 40);
  return sanitized || 'image';
}

function fileNameFromPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function directoryOf(value: string): string {
  const normalized = value.replace(/\\/gu, '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '' : normalized.slice(0, index);
}

function normalizePosix(value: string): string {
  return value.replace(/\\/gu, '/').replace(/\/+/gu, '/');
}

function isWindowsStyle(value: string): boolean {
  return /^[a-zA-Z]:\//u.test(value);
}
