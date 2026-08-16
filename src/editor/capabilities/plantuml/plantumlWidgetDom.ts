import { i18n } from '../../../shared/i18n';
import { createMediaPreviewButton } from '../mediaPreviewButton';

type IconNode = readonly [
  elementName: 'path',
  attributes: {
    d: string;
  },
][];

export type PlantumlWidgetDom = {
  expand: HTMLButtonElement | null;
  status: HTMLElement;
  svgContainer: HTMLElement;
  wrapper: HTMLElement;
};

const pencilIcon: IconNode = [
  [
    'path',
    {
      d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    },
  ],
  ['path', { d: 'm15 5 4 4' }],
];
const trashIcon: IconNode = [
  ['path', { d: 'M10 11v6' }],
  ['path', { d: 'M14 11v6' }],
  ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
  ['path', { d: 'M3 6h18' }],
  ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
];

export function createPlantumlWidgetDom({
  expandLabel,
  onDelete,
  onEdit,
  onExpand,
}: {
  expandLabel?: string;
  onDelete?: () => void;
  onEdit?: () => void;
  onExpand?: () => void;
}): PlantumlWidgetDom {
  const wrapper = document.createElement('section');
  wrapper.className = 'lm-plantuml-preview';
  wrapper.dataset.status = 'loading';
  wrapper.tabIndex = 0;

  const status = document.createElement('div');
  status.className = 'lm-plantuml-status';
  status.textContent = i18n.t('plantuml.loading');
  wrapper.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'lm-plantuml-actions';
  wrapper.appendChild(actions);

  const svgContainer = document.createElement('div');
  svgContainer.className = 'lm-plantuml-svg';
  wrapper.appendChild(svgContainer);

  const expand = onExpand
    ? createMediaPreviewButton(onExpand, expandLabel)
    : null;
  if (expand) {
    expand.hidden = true;
  }
  actions.replaceChildren(
    ...(expand ? [expand] : []),
    ...(onEdit ? [createEditButton(onEdit)] : []),
    ...(onDelete ? [createDeleteButton(onDelete)] : []),
  );

  return {
    expand,
    status,
    svgContainer,
    wrapper,
  };
}

function createEditButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-plantuml-edit-source';
  button.setAttribute('aria-label', i18n.t('plantuml.editSource'));
  button.title = i18n.t('plantuml.editSource');
  button.appendChild(createIconSvg(pencilIcon));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return button;
}

function createDeleteButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-plantuml-delete';
  button.setAttribute('aria-label', i18n.t('plantuml.delete'));
  button.title = i18n.t('plantuml.delete');
  button.appendChild(createIconSvg(trashIcon));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return button;
}

function createIconSvg(icon: IconNode): SVGSVGElement {
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

  for (const [elementName, attributes] of icon) {
    const element = document.createElementNS(
      'http://www.w3.org/2000/svg',
      elementName,
    );
    element.setAttribute('d', attributes.d);
    svg.appendChild(element);
  }

  return svg;
}
