import type { EditorView } from '@codemirror/view';
import type { EditorCapabilityCommands } from '../editorCapability';
import { insertImageReferences } from './imageInputExtension';
import { refreshImagePreviews } from './imagePreviewExtension';

export function deleteImageReference(
  view: EditorView,
  range: { from: number; to: number },
): boolean {
  if (view.state.readOnly) {
    return false;
  }

  const { from, to } = range;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > view.state.doc.length
  ) {
    return false;
  }

  view.dispatch({
    changes: {
      from,
      to,
    },
    userEvent: 'delete.imageReference',
  });

  return true;
}

export function createImageCommands(
  view: EditorView,
): Pick<
  EditorCapabilityCommands,
  'deleteImageReference' | 'insertImages' | 'refreshImages'
> {
  return {
    deleteImageReference: (range) => deleteImageReference(view, range),
    insertImages: (images, position) => {
      insertImageReferences(view, images, position);
    },
    refreshImages: (path) => {
      view.dispatch({ effects: refreshImagePreviews.of(path) });
    },
  };
}
