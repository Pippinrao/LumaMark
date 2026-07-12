import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { markdownLanguage as codemirrorMarkdownLanguage } from '@codemirror/lang-markdown';
import { searchKeymap } from '@codemirror/search';
import { type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  markdownTableAutocompleter,
  markdownTables,
  TableStyle,
  TableTheme,
} from 'codemirror-markdown-tables';
import { Strikethrough } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import { markdownSyntaxHighlighting } from '../../markdown/markdownLanguage';
import { tableKeymap } from './tableCommands';
import './table.css';

const inlineMarkdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: false,
});

export function tablePreviewExtension(): Extension {
  return [
    codemirrorMarkdownLanguage.data.of({
      autocomplete: markdownTableAutocompleter({
        options: [
          { cols: 2, rows: 2 },
          { cols: 3, rows: 3 },
          { cols: 4, rows: 4 },
        ],
      }),
    }),
    markdownTables({
      globalKeyBindings: [...tableKeymap, ...historyKeymap, ...searchKeymap],
      handlePosition: 'outside',
      lineWrapping: 'wrap',
      markdownConfig: {
        extensions: [Strikethrough],
      },
      selectionType: 'native',
      extensions: [
        EditorView.lineWrapping,
        markdownSyntaxHighlighting(),
        keymap.of(defaultKeymap),
      ],
      style: TableStyle.default.with({
        '--tbl-style-default-header-alignment': 'left',
        '--tbl-style-font-family': 'var(--lm-font-editor)',
        '--tbl-style-font-size': '0.94em',
        '--tbl-style-menu-font-family': 'var(--lm-font-ui, var(--lm-font-sans))',
        '--tbl-style-menu-font-size': '12px',
      }),
      theme: {
        dark: TableTheme.dark.with({
          '--tbl-theme-border-active-color': 'var(--lm-color-accent-strong)',
          '--tbl-theme-border-color': 'var(--lm-color-border-subtle)',
          '--tbl-theme-border-hover-color': 'var(--lm-color-accent)',
          '--tbl-theme-even-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-header-row-background': 'var(--lm-color-surface-muted)',
          '--tbl-theme-menu-background': 'var(--lm-color-surface)',
          '--tbl-theme-menu-border-color': 'var(--lm-color-border-subtle)',
          '--tbl-theme-menu-hover-background': 'var(--lm-color-accent-strong)',
          '--tbl-theme-menu-hover-text-color': 'var(--lm-color-bg)',
          '--tbl-theme-menu-text-color': 'var(--lm-color-text)',
          '--tbl-theme-odd-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-outline-color': 'var(--lm-color-accent-strong)',
          '--tbl-theme-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-text-color': 'var(--lm-color-text)',
        }),
        light: TableTheme.light.with({
          '--tbl-theme-border-active-color': 'var(--lm-color-accent-strong)',
          '--tbl-theme-border-color': 'var(--lm-color-border-subtle)',
          '--tbl-theme-border-hover-color': 'var(--lm-color-accent)',
          '--tbl-theme-even-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-header-row-background': 'var(--lm-color-surface-muted)',
          '--tbl-theme-menu-background': 'var(--lm-color-surface)',
          '--tbl-theme-menu-border-color': 'var(--lm-color-border-subtle)',
          '--tbl-theme-menu-hover-background': 'var(--lm-color-accent-strong)',
          '--tbl-theme-menu-hover-text-color': 'var(--lm-color-bg)',
          '--tbl-theme-menu-text-color': 'var(--lm-color-text)',
          '--tbl-theme-odd-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-outline-color': 'var(--lm-color-accent-strong)',
          '--tbl-theme-row-background': 'var(--lm-color-surface)',
          '--tbl-theme-text-color': 'var(--lm-color-text)',
        }),
      },
    }),
    tableInlineMarkdownExtension(),
  ];
}

function tableInlineMarkdownExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private renderHandle: ReturnType<typeof setTimeout> | null = null;
      private readonly handleDocumentPointerDown = (event: PointerEvent) => {
        if (
          event.target instanceof Element &&
          this.view.dom.contains(event.target) &&
          !event.target.closest('.tbl-cell')
        ) {
          this.scheduleRender();
        }
      };

      constructor(private readonly view: EditorView) {
        view.dom.ownerDocument.addEventListener(
          'pointerdown',
          this.handleDocumentPointerDown,
          true,
        );
        this.scheduleRender();
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.scheduleRender();
        }
      }

      destroy() {
        if (this.renderHandle) {
          clearTimeout(this.renderHandle);
        }
        this.view.dom.ownerDocument.removeEventListener(
          'pointerdown',
          this.handleDocumentPointerDown,
          true,
        );
      }

      private scheduleRender() {
        if (this.renderHandle) {
          clearTimeout(this.renderHandle);
        }

        this.renderHandle = setTimeout(() => {
          this.renderHandle = null;
          renderTableInlineMarkdown(this.view);
        }, 0);
      }
    },
  );
}

function renderTableInlineMarkdown(view: EditorView): void {
  const widgets = [
    ...view.dom.querySelectorAll<HTMLElement>('.tbl-table-widget'),
  ];

  widgets.forEach((widget) => {
    for (const cell of widget.querySelectorAll<HTMLElement>('.tbl-cell')) {
      const cellView = cell.querySelector<HTMLElement>('.tbl-cell-view');

      if (!cellView) {
        continue;
      }

      const overlay = ensureCellPreviewOverlay(cell);

      if (cellView.hasAttribute('data-hidden')) {
        overlay.hidden = true;
        continue;
      }

      attachInlineMarkdownCellHandlers(cell);

      const source = readCellSource(cellView);

      if (
        cellView.dataset.lmInlineMarkdownSource === source &&
        cellView.dataset.lmInlineMarkdownMode === 'preview'
      ) {
        overlay.hidden = false;
        continue;
      }

      renderCellPreview(cellView, overlay, source);
    }
  });
}

function attachInlineMarkdownCellHandlers(cell: HTMLElement): void {
  if (cell.dataset.lmInlineMarkdownHandlers === 'true') {
    return;
  }

  cell.dataset.lmInlineMarkdownHandlers = 'true';
  cell.addEventListener('mouseenter', handleCellSourceReveal);
  cell.addEventListener('focus', handleCellSourceReveal);
  cell.addEventListener('mouseleave', handleCellPreviewRestore);
  cell.addEventListener('blur', handleCellPreviewRestore);
}

function handleCellSourceReveal(event: Event): void {
  const cell = event.currentTarget;

  if (!(cell instanceof HTMLElement)) {
    return;
  }

  revealCellSource(cell);
}

function handleCellPreviewRestore(event: Event): void {
  const cell = event.currentTarget;

  if (!(cell instanceof HTMLElement)) {
    return;
  }

  const cellView = cell.querySelector<HTMLElement>('.tbl-cell-view');
  const overlay = cell.querySelector<HTMLElement>('.lm-table-inline-preview');
  const source = cellView?.dataset.lmInlineMarkdownSource;

  if (!cellView || !overlay || !source || cellView.hasAttribute('data-hidden')) {
    return;
  }

  renderCellPreview(cellView, overlay, source);
}

function readCellSource(cell: HTMLElement): string {
  return cell.textContent ?? '';
}

function revealCellSource(cell: HTMLElement): void {
  const cellView = cell.querySelector<HTMLElement>('.tbl-cell-view');
  const overlay = cell.querySelector<HTMLElement>('.lm-table-inline-preview');

  if (!cellView || !overlay || cellView.hasAttribute('data-hidden')) {
    return;
  }

  cellView.dataset.lmInlineMarkdownMode = 'source';
  overlay.hidden = true;
}

function renderCellPreview(
  cellView: HTMLElement,
  overlay: HTMLElement,
  source: string,
): void {
  cellView.dataset.lmInlineMarkdownSource = source;
  cellView.dataset.lmInlineMarkdownMode = 'preview';
  overlay.hidden = false;
  overlay.innerHTML = inlineMarkdown.renderInline(source);
  for (const anchor of overlay.querySelectorAll<HTMLAnchorElement>('a')) {
    anchor.rel = 'noreferrer';
    anchor.target = '_blank';
  }
}

function ensureCellPreviewOverlay(cell: HTMLElement): HTMLElement {
  const existing = cell.querySelector<HTMLElement>(':scope > .lm-table-inline-preview');

  if (existing) {
    return existing;
  }

  const overlay = document.createElement('div');
  overlay.className = 'lm-table-inline-preview';
  overlay.setAttribute('aria-hidden', 'true');
  cell.appendChild(overlay);

  return overlay;
}
