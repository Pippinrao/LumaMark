import type {
  EditorDisplayMode,
  EditorDocumentContext,
} from '../../core/editorDisplayMode';
import type { EditorCapability } from '../editorCapability';
import { mathPreviewExtension } from './mathPreviewExtension';

export function createMathCapability(
  context: EditorDocumentContext,
  mode: Exclude<EditorDisplayMode, 'source'>,
): EditorCapability {
  return {
    extensions: [
      mathPreviewExtension({
        documentId: context.documentId ?? context.path ?? 'document:unsaved',
        mode,
        revealPosition: context.revealPosition,
      }),
    ],
    id: 'math',
  };
}
