import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import mermaidPackage from 'mermaid/package.json';
import { i18n } from '../../../shared/i18n';
import {
  MermaidRenderScheduler,
  type MermaidRenderSchedulerOptions,
} from './mermaidRenderScheduler';
import { mermaidLanguageExtension } from './mermaidLanguageService';
import './mermaid.css';

type DocumentRange = {
  from: number;
  to: number;
};

type MarkdownSyntaxNode = {
  from: number;
  to: number;
  getChild: (type: string) => MarkdownSyntaxNode | null;
};

type MermaidBlock = {
  content: string;
  contentFrom: number;
  contentTo: number;
  fence: string;
  from: number;
  info: string;
  language: 'mermaid';
  to: number;
};

type AbsoluteMermaidBlock = MermaidBlock & {
  blockId: string;
};

type SafeMermaidConfig = Record<string, unknown> & {
  securityLevel: 'strict';
};

type IconNode = readonly [
  elementName: 'path',
  attributes: {
    d: string;
  },
][];

export type MermaidPreviewExtensionOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
  scheduler?: MermaidRenderScheduler;
};

const DEFAULT_MERMAID_VERSION = mermaidPackage.version;
const mermaidThemeChangedEffect = StateEffect.define();
const editingMermaidBlocks = new Set<number>();
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

let defaultScheduler: MermaidRenderScheduler | null = null;

export function mermaidPreviewExtension(
  options: MermaidPreviewExtensionOptions = {},
): Extension {
  return mermaidPreviewPlugin(options);
}

export function collectMermaidBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): AbsoluteMermaidBlock[] {
  const blocks: AbsoluteMermaidBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode') {
          return;
        }

        const block = mermaidBlockFromFencedCode(state, node.node);
        if (!block) {
          return;
        }

        const blockId = `${block.from}:${block.to}`;
        if (seen.has(blockId)) {
          return;
        }

        seen.add(blockId);
        blocks.push({
          ...block,
          blockId,
        });
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
}

function mermaidBlockFromFencedCode(
  state: EditorState,
  fencedCode: MarkdownSyntaxNode,
): MermaidBlock | null {
  const codeInfo = fencedCode.getChild('CodeInfo');
  const codeText = fencedCode.getChild('CodeText');

  if (!codeInfo || !codeText) {
    return null;
  }

  const info = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
  if (!isMermaidCodeInfo(info)) {
    return null;
  }

  const openingFence = fencedCode.getChild('CodeMark');

  return {
    content: state.doc.sliceString(codeText.from, codeText.to),
    contentFrom: codeText.from,
    contentTo: codeText.to,
    fence: openingFence
      ? state.doc.sliceString(openingFence.from, openingFence.to)
      : '',
    from: fencedCode.from,
    info,
    language: 'mermaid',
    to: fencedCode.to,
  };
}

function isMermaidCodeInfo(info: string): boolean {
  const normalizedInfo = info.toLowerCase();

  return normalizedInfo === 'mermaid' || normalizedInfo.startsWith('mermaid ');
}

function mermaidPreviewPlugin(options: MermaidPreviewExtensionOptions): Extension {
  const scheduler = options.scheduler ?? getDefaultScheduler();

  return [
    mermaidDecorationsField(scheduler, options),
    ViewPlugin.fromClass(
      class {
        private readonly themeObserver: MutationObserver;

        constructor(private readonly view: EditorView) {
          this.themeObserver = new MutationObserver(() => {
            queueMicrotask(() => {
              this.view.dispatch({
                effects: mermaidThemeChangedEffect.of(null),
              });
            });
          });
          this.themeObserver.observe(document.documentElement, {
            attributeFilter: ['data-theme'],
            attributes: true,
          });
        }

        destroy() {
          this.themeObserver.disconnect();
        }
      },
    ),
  ];
}

function mermaidDecorationsField(
  scheduler: MermaidRenderScheduler,
  options: MermaidPreviewExtensionOptions,
): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildMermaidDecorations(state, scheduler, options);
    },
    update(value, transaction) {
      if (
        transaction.docChanged ||
        transaction.selection ||
        transaction.effects.some((effect) => effect.is(mermaidThemeChangedEffect))
      ) {
        return buildMermaidDecorations(transaction.state, scheduler, options);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildMermaidDecorations(
  state: EditorState,
  scheduler: MermaidRenderScheduler,
  options: MermaidPreviewExtensionOptions,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const theme = currentMermaidTheme();

  for (const block of collectMermaidBlocksInRanges(
    state,
    [{ from: 0, to: state.doc.length }],
  )) {
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        block: true,
        widget: new MermaidBlockWidget(block, scheduler, options, theme),
      }),
    );
  }

  return builder.finish();
}

class MermaidBlockWidget extends WidgetType {
  private cancelRender: (() => void) | null = null;
  private inlineEditor: EditorView | null = null;
  private parentView: EditorView | null = null;
  private pendingContent: string | null = null;

  constructor(
    private readonly block: AbsoluteMermaidBlock,
    private readonly scheduler: MermaidRenderScheduler,
    private readonly options: MermaidPreviewExtensionOptions,
    private readonly theme: 'dark' | 'default',
  ) {
    super();
  }

  eq(widget: MermaidBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.content === this.block.content &&
      widget.theme === this.theme &&
      widget.options.mermaidVersion === this.options.mermaidVersion
    );
  }

  toDOM(view: EditorView): HTMLElement {
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
    actions.replaceChildren(
      createEditButton(() => {
        editingMermaidBlocks.add(this.block.from);
        this.openInlineEditor(
          view,
          wrapper,
          editorHost,
          status,
          svgContainer,
          { focus: true },
        );
      }),
      createDeleteButton(view, this.block),
    );
    wrapper.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;

      window.setTimeout(() => {
        if (nextTarget instanceof Node) {
          if (wrapper.contains(nextTarget)) {
            return;
          }
        } else if (wrapper.contains(document.activeElement)) {
          return;
        }

        if (wrapper.dataset.status === 'error') {
          return;
        }

        this.closeInlineEditor(wrapper, editorHost);
      }, 0);
    });

    this.requestPreviewRender({
      editorHost,
      parentView: view,
      source: this.block.content,
      status,
      svgContainer,
      wrapper,
    });

    if (editingMermaidBlocks.has(this.block.from)) {
      window.setTimeout(() => {
        this.openInlineEditor(
          view,
          wrapper,
          editorHost,
          status,
          svgContainer,
          { focus: true },
        );
      }, 0);
    }

    return wrapper;
  }

  destroy(): void {
    this.flushPendingContent({ defer: true });
    this.cancelRender?.();
    this.cancelRender = null;
    this.inlineEditor?.destroy();
    this.inlineEditor = null;
    this.parentView = null;
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      event.target.closest('.lm-mermaid-editor') !== null
    );
  }

  private openInlineEditor(
    parentView: EditorView,
    wrapper: HTMLElement,
    editorHost: HTMLElement,
    status: HTMLElement,
    svgContainer: HTMLElement,
    options: { focus: boolean },
  ): void {
    if (this.inlineEditor) {
      if (options.focus) {
        this.inlineEditor.focus();
      }
      return;
    }

    editorHost.hidden = false;
    wrapper.classList.add('lm-mermaid-preview-editing');
    this.parentView = parentView;
    this.inlineEditor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: this.block.content,
        extensions: [
          history(),
          EditorView.lineWrapping,
          mermaidLanguageExtension(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            this.queueContentUpdate({
              content: update.state.doc.toString(),
              editorHost,
              parentView,
              status,
              svgContainer,
              wrapper,
            });
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
        ],
      }),
    });
    this.inlineEditor.dom.addEventListener('focusin', () => {
      editingMermaidBlocks.add(this.block.from);
    });
    this.inlineEditor.dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      this.closeInlineEditor(wrapper, editorHost);
      parentView.focus();
    });
    this.inlineEditor.contentDOM.addEventListener('input', () => {
      const stateContent = this.inlineEditor?.state.doc.toString();
      this.queueContentUpdate({
        content:
          stateContent && stateContent !== this.block.content
            ? stateContent
            : this.inlineEditor?.contentDOM.textContent ?? '',
        editorHost,
        parentView,
        status,
        svgContainer,
        wrapper,
      });
    });
    if (options.focus) {
      this.inlineEditor.focus();
    }
  }

  private closeInlineEditor(
    wrapper: HTMLElement,
    editorHost: HTMLElement,
  ): void {
    if (!this.inlineEditor) {
      return;
    }

    const editor = this.inlineEditor;
    editingMermaidBlocks.delete(this.block.from);
    this.inlineEditor = null;
    this.flushPendingContent();
    editor.destroy();
    editorHost.hidden = true;
    wrapper.classList.remove('lm-mermaid-preview-editing');
  }

  private queueContentUpdate({
    content,
    editorHost,
    parentView,
    status,
    svgContainer,
    wrapper,
  }: {
    content: string;
    editorHost: HTMLElement;
    parentView: EditorView;
    status: HTMLElement;
    svgContainer: HTMLElement;
    wrapper: HTMLElement;
  }): void {
    this.parentView = parentView;
    this.pendingContent = content;
    this.requestPreviewRender({
      editorHost,
      parentView,
      source: content,
      status,
      svgContainer,
      wrapper,
    });
  }

  private requestPreviewRender({
    editorHost,
    parentView,
    source,
    status,
    svgContainer,
    wrapper,
  }: {
    editorHost: HTMLElement;
    parentView: EditorView;
    source: string;
    status: HTMLElement;
    svgContainer: HTMLElement;
    wrapper: HTMLElement;
  }): void {
    this.cancelRender?.();
    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      config: safeMermaidConfig(this.options.config),
      mermaidVersion: this.options.mermaidVersion ?? DEFAULT_MERMAID_VERSION,
      onError: () => {
        this.withInlineSelectionPreserved(() => {
          wrapper.classList.add('lm-mermaid-preview-error');
          wrapper.dataset.status = 'error';
          status.hidden = false;
          status.className = 'lm-mermaid-error';
          status.textContent = i18n.t('mermaid.renderFailed');
          this.openInlineEditor(
            parentView,
            wrapper,
            editorHost,
            status,
            svgContainer,
            { focus: false },
          );
        });
      },
      onLoading: () => {
        this.withInlineSelectionPreserved(() => {
          wrapper.classList.remove('lm-mermaid-preview-error');
          wrapper.dataset.status = 'loading';
          status.hidden = false;
          status.className = 'lm-mermaid-status';
          status.textContent = i18n.t('mermaid.loading');
          svgContainer.replaceChildren();
        });
      },
      onSuccess: ({ svg }) => {
        this.withInlineSelectionPreserved(() => {
          wrapper.classList.remove('lm-mermaid-preview-error');
          wrapper.dataset.status = 'success';
          status.hidden = true;
          status.textContent = '';
          svgContainer.innerHTML = svg;
        });
      },
      source,
      theme: this.theme,
    }).cancel;
  }

  private withInlineSelectionPreserved(updatePreview: () => void): void {
    const editor = this.inlineEditor;
    const selection = editor?.state.selection;
    const hadEditorFocus = editor
      ? editor.dom.contains(document.activeElement)
      : false;

    updatePreview();

    if (
      !editor ||
      this.inlineEditor !== editor ||
      !selection ||
      !hadEditorFocus
    ) {
      return;
    }

    if (!editor.state.selection.eq(selection)) {
      editor.dispatch({ selection });
    }

    if (!editor.composing) {
      editor.focus();
    }
  }

  private flushPendingContent(options: { defer?: boolean } = {}): void {
    if (this.pendingContent === null || !this.parentView) {
      return;
    }

    const content = this.pendingContent;
    const parentView = this.parentView;
    this.pendingContent = null;
    if (options.defer) {
      queueMicrotask(() => {
        replaceMermaidContent(parentView, this.block, content);
      });
      return;
    }

    replaceMermaidContent(parentView, this.block, content);
  }
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

function createDeleteButton(
  view: EditorView,
  block: AbsoluteMermaidBlock,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-mermaid-delete';
  button.setAttribute('aria-label', i18n.t('mermaid.delete'));
  button.title = i18n.t('mermaid.delete');
  button.appendChild(createIconSvg(trashIcon));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    editingMermaidBlocks.delete(block.from);
    const range = deletionRangeForBlock(view.state, block);
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
      },
      userEvent: 'delete.mermaid',
    });
    view.focus();
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

function replaceMermaidContent(
  view: EditorView,
  block: AbsoluteMermaidBlock,
  content: string,
): void {
  view.dispatch({
    changes: {
      from: block.contentFrom,
      insert: content,
      to: block.contentTo,
    },
    userEvent: 'input.mermaid',
  });
}

function deletionRangeForBlock(
  state: EditorState,
  block: AbsoluteMermaidBlock,
): { from: number; to: number } {
  const before = block.from > 0
    ? state.doc.sliceString(block.from - 1, block.from)
    : '';
  const after = block.to < state.doc.length
    ? state.doc.sliceString(block.to, block.to + 1)
    : '';

  if (before === '\n') {
    return { from: block.from - 1, to: block.to };
  }

  if (after === '\n') {
    return { from: block.from, to: block.to + 1 };
  }

  return { from: block.from, to: block.to };
}

function getDefaultScheduler(): MermaidRenderScheduler {
  defaultScheduler ??= new MermaidRenderScheduler({
    debounceMs: 120,
    render: renderWithMermaid,
  });

  return defaultScheduler;
}

async function renderWithMermaid({
  config,
  source,
  theme,
}: Parameters<MermaidRenderSchedulerOptions['render']>[0]): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  const mermaidTheme = theme === 'dark' ? 'dark' : 'default';
  mermaid.initialize({
    ...safeMermaidConfig(config),
    startOnLoad: false,
    theme: mermaidTheme,
  });
  const result = await mermaid.render(
    `lm-mermaid-${crypto.randomUUID()}`,
    source,
  );

  return result.svg;
}

function safeMermaidConfig(
  config: Record<string, unknown> | undefined,
): SafeMermaidConfig {
  return {
    ...config,
    securityLevel: 'strict',
  };
}

function currentMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'default';
}
