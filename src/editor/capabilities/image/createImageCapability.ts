import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import type { EditorCapability } from '../editorCapability';
import { imagePreviewExtension } from './imagePreviewExtension';
import { imageInputExtension } from './imageInputExtension';

export function createImageCapability(
  context: EditorDocumentContext,
): EditorCapability {
  return {
    extensions: [
      imageInputExtension(
        context.imageImportHandler,
        context.path,
        context.imageImportErrorHandler,
      ),
      imagePreviewExtension({
        documentPath: context.path,
        imageAssetResolver: context.imageAssetResolver,
      }),
    ],
    id: 'image',
  };
}
