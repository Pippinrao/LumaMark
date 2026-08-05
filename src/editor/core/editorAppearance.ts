import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type EditorAppearance = {
  fontZoomPercent: number;
  pageWidthPx: number | null;
};

export type EditorZoomDirection = 'in' | 'out';
export type EditorZoomRequestedHandler = (direction: EditorZoomDirection) => void;

export const DEFAULT_EDITOR_APPEARANCE: EditorAppearance = {
  fontZoomPercent: 100,
  pageWidthPx: 810,
};

export const editorAppearanceCompartment = new Compartment();

export function editorAppearanceExtension(
  appearance: EditorAppearance,
): Extension {
  const fontScale = appearance.fontZoomPercent / 100;
  const pageWidth = appearance.pageWidthPx === null
    ? '100%'
    : `${appearance.pageWidthPx}px`;

  return EditorView.editorAttributes.of({
    style: [
      `--lm-editor-font-scale: ${fontScale}`,
      `--lm-editor-page-width: ${pageWidth}`,
    ].join('; '),
  });
}
