export type PackageOpenResult = {
  entryName: string;
  entryPath: string;
  resourceCount: number;
  reusedSession: boolean;
  sessionDir: string;
  zipPath: string;
};

export type PackageExtractResult = {
  entryPath: string;
  outputDirectory: string;
};

export type PackageResourceWarning = {
  reason: string;
  source: string;
};

export type PackageExportResult = {
  entryName: string;
  outputPath: string;
  resourceCount: number;
  totalBytes: number;
  warnings: PackageResourceWarning[];
};

export type PackageResourceKind = 'draft' | 'local' | 'remote';

export type PackageExportResourceInput = {
  archivePath: string;
  kind: PackageResourceKind;
  source: string;
};

export type PackageExportInput = {
  documentPath: string | null;
  entryName: string;
  entryText: string;
  outputPath: string;
  resources: readonly PackageExportResourceInput[];
};
