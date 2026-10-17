import type { EditorState } from '@codemirror/state';
import { scanDocumentImageReferences } from '../../editor/capabilities/image/documentImageReferences';
import {
  isAbsolutePath,
  resolveImageFilesystemPath,
} from '../../editor/capabilities/image/imagePathResolver';
import { rewriteDocumentImageDestinations } from './documentImageRewriter';
import {
  planImageDestination,
  relativeArchivePath,
  type PackagePlanWarningCode,
  type PackageResourceKind,
  type PackageResourcePlan,
} from './packagePaths';

export type PackageExportResource = {
  archivePath: string;
  source: string;
  kind: PackageResourceKind;
};

export type PackageExportPlanWarning = {
  code: PackagePlanWarningCode;
  source: string;
};

export type PackageExportPlan =
  | {
      entryName: string;
      entryText: string;
      resources: PackageExportResource[];
      status: 'ok';
      warnings: PackageExportPlanWarning[];
    }
  | {
      error: 'image_resolution_failed' | 'relative_without_document' | 'unsupported_source';
      source: string;
      status: 'error';
    };

export type BuildPackageExportPlanInput = {
  documentPath: string | null;
  downloadRemoteImages: boolean;
  entryName: string;
  state: EditorState;
};

const PACKAGE_MANIFEST_NAME = 'lumamark-package.json';

export function buildPackageExportPlan(
  input: BuildPackageExportPlanInput,
): PackageExportPlan {
  const scan = scanDocumentImageReferences(input.state);
  const used = new Set<string>([
    PACKAGE_MANIFEST_NAME.toLowerCase(),
    input.entryName.toLowerCase(),
  ]);
  const resolvedSources = new Map<string, string | null>();

  for (const image of scan.images) {
    const source = image.source.trim();
    if (!isLocalCandidate(source)) {
      continue;
    }
    const resolved = resolveImageFilesystemPath({
      documentPath: input.documentPath,
      source,
    });
    const resolvedPath = resolved.kind === 'local' ? resolved.path : null;
    resolvedSources.set(source, resolvedPath);

    if (
      resolvedPath &&
      !isAbsolutePath(source) &&
      input.documentPath &&
      !hasAmbiguousCharacters(source)
    ) {
      const relative = relativeArchivePath(input.documentPath, resolvedPath);
      if (relative) {
        used.add(relative.toLowerCase());
      }
    }
  }

  const warnings: PackageExportPlanWarning[] = [];
  const resources = new Map<string, PackageExportResource>();
  const plannedByKey = new Map<
    string,
    { destination: string; resource?: PackageResourcePlan }
  >();
  const replacements: {
    destination: string;
    from: number;
    to: number;
  }[] = [];

  for (const image of scan.images) {
    const source = image.source.trim();
    const original = image.angleBracketed ? `<${source}>` : source;
    const key = sourceKey(source, resolvedSources.get(source));
    const cached = key ? plannedByKey.get(key) : undefined;

    if (cached) {
      if (cached.destination !== original) {
        replacements.push({
          destination: cached.destination,
          from: image.destination.from,
          to: image.destination.to,
        });
      }
      if (cached.resource) {
        addResource(resources, cached.resource);
      }
      continue;
    }

    const plan = planImageDestination({
      angleBracketed: image.angleBracketed,
      documentPath: input.documentPath,
      downloadRemoteImages: input.downloadRemoteImages,
      resolvedPath: resolvedSources.get(source) ?? null,
      source,
      used,
    });

    if (plan.status === 'error') {
      return { error: plan.error, source, status: 'error' };
    }
    if (plan.status === 'warning') {
      warnings.push({ code: plan.warning, source });
      continue;
    }

    if (key) {
      plannedByKey.set(key, {
        destination: plan.destination,
        resource: plan.resource,
      });
    }
    if (plan.resource) {
      addResource(resources, plan.resource);
    }
    if (plan.rewrite || plan.destination !== original) {
      replacements.push({
        destination: plan.destination,
        from: image.destination.from,
        to: image.destination.to,
      });
    }
  }

  const allWarnings = dedupeWarnings([
    ...warnings,
    ...(scan.htmlImageCount > 0
      ? [
          {
            code: 'package_html_image_unsupported' as const,
            source: 'HTML <img>',
          },
        ]
      : []),
  ]);

  return {
    entryName: input.entryName,
    entryText: rewriteDocumentImageDestinations(input.state, replacements),
    resources: [...resources.values()].sort((left, right) =>
      left.archivePath < right.archivePath ? -1 : left.archivePath > right.archivePath ? 1 : 0,
    ),
    status: 'ok',
    warnings: allWarnings,
  };
}

export function packageEntryName(fileName: string | null | undefined): string {
  const name = fileName?.trim();
  if (!name) {
    return 'untitled.md';
  }
  if (/\.(?:md|markdown|mdown)$/iu.test(name)) {
    return name;
  }
  const stem = name.replace(/\.[^.]+$/u, '') || 'untitled';
  return `${stem}.md`;
}

function sourceKey(source: string, resolvedPath: string | null | undefined): string | null {
  if (/^lumamark-draft:/iu.test(source)) {
    return `draft:${source}`;
  }
  if (/^https?:/iu.test(source)) {
    return `remote:${source}`;
  }
  if (isLocalCandidate(source) && resolvedPath) {
    return `local:${resolvedPath.toLowerCase()}`;
  }
  return null;
}

function addResource(
  resources: Map<string, PackageExportResource>,
  resource: PackageResourcePlan,
): void {
  const key = resource.archivePath.toLowerCase();
  if (!resources.has(key)) {
    resources.set(key, resource);
  }
}

function dedupeWarnings(
  warnings: readonly PackageExportPlanWarning[],
): PackageExportPlanWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isLocalCandidate(source: string): boolean {
  return !/^(?:data|blob|file|lumamark-draft|https?):/iu.test(source);
}

function hasAmbiguousCharacters(source: string): boolean {
  return /[#?%<>]/u.test(source);
}
