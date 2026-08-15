import { EditorState, Facet, type Extension } from '@codemirror/state';

const editorRenderLockFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

export function editorRenderLockExtension(locked: boolean): Extension {
  return editorRenderLockFacet.of(locked);
}

export function isEditorRenderLocked(state: EditorState): boolean {
  return state.readOnly || state.facet(editorRenderLockFacet);
}
