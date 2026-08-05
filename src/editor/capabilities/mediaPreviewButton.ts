import type { EditorState } from '@codemirror/state';
import { i18n } from '../../shared/i18n';
import type { AppLanguage } from '../../shared/i18n';

const MEDIA_PREVIEW_PHRASE = 'Expand media preview';

export function createMediaPreviewButton(
  onActivate: () => void,
  label = i18n.t('mediaViewer.expand'),
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-media-preview-expand';
  button.dataset.lmMediaPreviewButton = '';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(createExpandIcon());
  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onActivate();
  });
  return button;
}

export function getMediaPreviewButtonLabel(state: EditorState): string {
  const label = state.phrase(MEDIA_PREVIEW_PHRASE);
  return label === MEDIA_PREVIEW_PHRASE
    ? i18n.t('mediaViewer.expand')
    : label;
}

export function relabelMediaPreviewButtons(
  root: ParentNode,
  language: AppLanguage,
): void {
  const label = i18n.t('mediaViewer.expand', { lng: language });
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-lm-media-preview-button]',
  )) {
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

function createExpandIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('height', '16');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');

  for (const pathData of ['M15 3h6v6', 'm21 3-7 7', 'M9 21H3v-6', 'm3 21 7-7']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
  }

  return svg;
}
