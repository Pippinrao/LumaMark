import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export type EditorAppearance = {
  fontZoomPercent: number;
  pageWidthCss: string;
};

export type EditorZoomDirection = 'in' | 'out';
export type EditorZoomRequestedHandler = (direction: EditorZoomDirection) => void;

export const ADAPTIVE_PAGE_WIDTH_CSS = 'clamp(720px, 70%, 1100px)';

export const DEFAULT_EDITOR_APPEARANCE: EditorAppearance = {
  fontZoomPercent: 100,
  pageWidthCss: '100%',
};

export const editorAppearanceCompartment = new Compartment();

export function editorAppearanceExtension(
  appearance: EditorAppearance,
): Extension {
  const fontScale = appearance.fontZoomPercent / 100;

  return EditorView.editorAttributes.of({
    style: [
      `--lm-editor-font-scale: ${fontScale}`,
      `--lm-editor-page-width: ${appearance.pageWidthCss}`,
    ].join('; '),
  });
}
