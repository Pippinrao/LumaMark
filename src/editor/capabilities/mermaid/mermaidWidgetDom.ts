import { i18n } from '../../../shared/i18n';

type IconNode = readonly [
  elementName: 'path',
  attributes: {
    d: string;
  },
][];

export type MermaidWidgetDom = {
  editorHost: HTMLElement;
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

export function createMermaidWidgetDom({
  onDelete,
  onEdit,
}: {
  onDelete: () => void;
  onEdit: () => void;
}): MermaidWidgetDom {
  const wrapper = document.createElement('section');
  wrapper.className = 'lm-mermaid-preview';
  wrapper.dataset.status = 'loading';
  wrapper.tabIndex = 0;

  const status = document.createElement('div');
  status.className = 'lm-mermaid-status';
  status.textContent = i18n.t('mermaid.loading');
  wrapper.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'lm-mermaid-actions';
  wrapper.appendChild(actions);

  const editorHost = document.createElement('div');
  editorHost.className = 'lm-mermaid-editor';
  editorHost.hidden = true;
  wrapper.appendChild(editorHost);

  const svgContainer = document.createElement('div');
  svgContainer.className = 'lm-mermaid-svg';
  wrapper.appendChild(svgContainer);

  actions.replaceChildren(createEditButton(onEdit), createDeleteButton(onDelete));

  return {
    editorHost,
    status,
    svgContainer,
    wrapper,
  };
}

function createEditButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-mermaid-edit-source';
  button.setAttribute('aria-label', i18n.t('mermaid.editSource'));
  button.title = i18n.t('mermaid.editSource');
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
  button.className = 'lm-mermaid-delete';
  button.setAttribute('aria-label', i18n.t('mermaid.delete'));
  button.title = i18n.t('mermaid.delete');
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
