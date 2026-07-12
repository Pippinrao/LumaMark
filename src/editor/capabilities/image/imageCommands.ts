import type { EditorView } from '@codemirror/view';
import type { EditorCapabilityCommands } from '../editorCapability';
import { insertImageReferences } from './imageInputExtension';
import { refreshImagePreviews } from './imagePreviewExtension';

export function createImageCommands(
  view: EditorView,
): Pick<EditorCapabilityCommands, 'insertImages' | 'refreshImages'> {
  return {
    insertImages: (images, position) => {
      insertImageReferences(view, images, position);
    },
    refreshImages: (path) => {
      view.dispatch({ effects: refreshImagePreviews.of(path) });
    },
  };
}
