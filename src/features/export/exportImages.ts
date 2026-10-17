import { embedExportImage } from '../../services/export/exportCommands';
import type { ExportImageWarningCode } from './exportTypes';

const IMAGE_WARNING_CODES = new Set<ExportImageWarningCode>([
  'export.image_relative_without_document',
  'export.image_read_failed',
  'export.image_too_large',
  'export.image_remote_failed',
  'export.image_unsupported',
]);

export async function embedImageForExport(
  source: string,
  documentPath: string | null,
): Promise<
  | { dataUri: string; kind: 'dataUri'; mimeType: string }
  | { kind: 'error'; message: string; reason: ExportImageWarningCode }
> {
  const result = await embedExportImage({ documentPath, source });
  if (result.ok) {
    return {
      dataUri: result.data.dataUri,
      kind: 'dataUri',
      mimeType: result.data.mimeType,
    };
  }

  return {
    kind: 'error',
    message: result.error.message,
    reason: warningCodeForError(result.error.code),
  };
}

function warningCodeForError(code: string): ExportImageWarningCode {
  switch (code) {
    case 'export.image_relative_without_document':
    case 'asset.image_relative_without_document':
      return 'export.image_relative_without_document';
    case 'export.image_too_large':
    case 'asset.image_too_large':
    case 'asset.remote_image_too_large':
      return 'export.image_too_large';
    case 'asset.remote_image_download_failed':
    case 'asset.remote_image_content_type_unsupported':
      return 'export.image_remote_failed';
    case 'asset.image_extension_unsupported':
    case 'asset.image_type_unsupported':
    case 'export.image_unsupported':
      return 'export.image_unsupported';
    default:
      if (IMAGE_WARNING_CODES.has(code as ExportImageWarningCode)) {
        return code as ExportImageWarningCode;
      }
      return 'export.image_read_failed';
  }
}
