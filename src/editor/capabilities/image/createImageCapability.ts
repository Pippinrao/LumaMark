import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import type { EditorCapability } from '../editorCapability';
import { imagePreviewExtension } from './imagePreviewExtension';

export function createImageCapability(
  context: EditorDocumentContext,
): EditorCapability {
  return {
    extensions: [imagePreviewExtension({ documentPath: context.path })],
    id: 'image',
  };
}

