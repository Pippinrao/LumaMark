import { syntaxTree } from '@codemirror/language';
import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from '@codemirror/view';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { markdownWysiwygExtension } from '../../wysiwyg/markdownDecorations';
import {
  parseMarkdownTable,
  addTableRow,
  addTableColumn,
  deleteTableColumn,
  deleteTableRow,
  resizeTable,
  serializeMarkdownTable,
  setTableAlignment,
  updateTableCell,
  type MarkdownTableAlignment,
  type MarkdownTableModel,
  type TableCellLocation,
} from './markdownTableModel';
import { i18n } from '../../../shared/i18n';
import './table.css';

type DocumentRange = {
  from: number;
  to: number;
};

type TableBlock = MarkdownTableModel & {
  blockId: string;
};

type ActiveCell = TableCellLocation & {
  tableKey: string;
};

const activeCells = new Map<string, ActiveCell>();

export function tablePreviewExtension(): Extension {
  return tableDecorationsField;
}

export function collectTableBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): TableBlock[] {
  const blocks: TableBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Table') {
          return;
        }

        const source = state.doc.sliceString(node.from, node.to);
        const table = parseMarkdownTable(source, node.from);
        const blockId = `${table.from}:${table.to}`;

        if (seen.has(blockId)) {
          return;
        }

        seen.add(blockId);
        blocks.push({
          ...table,
          blockId,
        });
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
}

const tableDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state);
  },
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildTableDecorations(transaction.state);
    }

    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildTableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of collectTableBlocksInRanges(state, [
    {
      from: 0,
      to: state.doc.length,
    },
  ])) {
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        block: true,
        widget: new TableBlockWidget(block),
      }),
    );
  }

  return builder.finish();
}

class TableBlockWidget extends WidgetType {
  private inlineEditor: EditorView | null = null;
  private cellContentObserver: MutationObserver | null = null;
  private parentView: EditorView | null = null;
  private pendingCellValue: string | null = null;
  private syncTimer: number | null = null;

  constructor(private readonly block: TableBlock) {
    super();
  }

  eq(widget: TableBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.header.join('\u0000') === this.block.header.join('\u0000') &&
      widget.block.rows.flat().join('\u0000') === this.block.rows.flat().join('\u0000') &&
      widget.block.alignments.join('\u0000') === this.block.alignments.join('\u0000')
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('section');
    wrapper.className = 'lm-table-widget';
    wrapper.dataset.blockId = this.block.blockId;
    const toolbar = this.createToolbar(view, wrapper);
    toolbar.hidden = true;
    wrapper.appendChild(toolbar);
    wrapper.appendChild(this.createTable(view, wrapper, toolbar));

    const active = activeCells.get(activeCellKey(this.block));
    if (active) {
      window.setTimeout(() => {
        const cell = findCell(wrapper, active);
        if (cell) {
          this.activateCell(view, wrapper, toolbar, cell, active);
        }
      }, 0);
    }

    return wrapper;
  }

  destroy(): void {
    this.flushPendingCellValue({ defer: true });
    this.cellContentObserver?.disconnect();
    this.cellContentObserver = null;
    this.inlineEditor?.destroy();
    this.inlineEditor = null;
    this.parentView = null;
  }

  ignoreEvent(): boolean {
    return false;
  }

  private createTable(
    view: EditorView,
    wrapper: HTMLElement,
    toolbar: HTMLElement,
  ): HTMLTableElement {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const headerRow = document.createElement('tr');

    this.block.header.forEach((cell, columnIndex) => {
      const headerCell = document.createElement('th');
      configureCell(headerCell, {
        columnIndex,
        rowIndex: 0,
        section: 'header',
        table: this.block,
        value: cell,
        view,
        widget: this,
        wrapper,
        toolbar,
      });
      headerRow.appendChild(headerCell);
    });

    thead.appendChild(headerRow);

    this.block.rows.forEach((row, rowIndex) => {
      const tableRow = document.createElement('tr');

      row.forEach((cell, columnIndex) => {
        const bodyCell = document.createElement('td');
        configureCell(bodyCell, {
          columnIndex,
          rowIndex,
          section: 'body',
          table: this.block,
          value: cell,
          view,
          widget: this,
          wrapper,
          toolbar,
        });
        tableRow.appendChild(bodyCell);
      });

      tbody.appendChild(tableRow);
    });

    table.append(thead, tbody);

    return table;
  }

  private createToolbar(view: EditorView, wrapper: HTMLElement): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'lm-table-toolbar';
    toolbar.append(
      createToolbarButton('align-left', i18n.t('table.alignLeft'), () => {
        this.setAlignmentFromToolbar(view, wrapper, 'left');
      }),
      createToolbarButton('align-center', i18n.t('table.alignCenter'), () => {
        this.setAlignmentFromToolbar(view, wrapper, 'center');
      }),
      createToolbarButton('align-right', i18n.t('table.alignRight'), () => {
        this.setAlignmentFromToolbar(view, wrapper, 'right');
      }),
      createToolbarButton('add-row', i18n.t('table.insertRowAfter'), () => {
        const location = activeCellLocation(wrapper);
        replaceTableBlock(
          view,
          this.block,
          addTableRow(this.block, location.rowIndex),
          'input.table-row',
        );
      }),
      createToolbarButton('add-column', i18n.t('table.insertColumnAfter'), () => {
        const location = activeCellLocation(wrapper);
        replaceTableBlock(
          view,
          this.block,
          addTableColumn(this.block, location.columnIndex),
          'input.table-column',
        );
      }),
      createToolbarButton('adjust-size', i18n.t('table.adjustSize'), () => {
        toggleSizePicker(toolbar);
      }),
      createToolbarButton('more', i18n.t('table.moreActions'), () => {
        toggleMoreMenu(toolbar);
      }),
    );
    toolbar.append(
      this.createSizePicker(view),
      this.createMoreMenu(view, wrapper),
    );

    return toolbar;
  }

  private createSizePicker(view: EditorView): HTMLElement {
    const picker = document.createElement('div');
    picker.className = 'lm-table-size-picker';
    picker.hidden = true;

    const grid = document.createElement('div');
    grid.className = 'lm-table-size-grid';
    for (let rows = 1; rows <= 10; rows += 1) {
      for (let columns = 1; columns <= 10; columns += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lm-table-size-cell';
        button.dataset.sizeRows = String(rows);
        button.dataset.sizeColumns = String(columns);
        button.setAttribute(
          'aria-label',
          `${i18n.t('table.rows')} ${rows}, ${i18n.t('table.columns')} ${columns}`,
        );
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        button.addEventListener('click', (event) => {
          event.preventDefault();
          replaceTableBlock(
            view,
            this.block,
            resizeTable(this.block, { rows, columns }),
            'input.table-resize',
          );
        });
        grid.appendChild(button);
      }
    }

    const numeric = document.createElement('div');
    numeric.className = 'lm-table-size-inputs';
    const rowInput = createNumberInput(i18n.t('table.rows'), this.block.rows.length);
    const columnInput = createNumberInput(i18n.t('table.columns'), this.block.header.length);
    const applyButton = createToolbarButton('apply-size', i18n.t('table.adjustSize'), () => {
      replaceTableBlock(
        view,
        this.block,
        resizeTable(this.block, {
          columns: Number(columnInput.value),
          rows: Number(rowInput.value),
        }),
        'input.table-resize',
      );
    });
    numeric.append(rowInput, columnInput, applyButton);
    picker.append(grid, numeric);

    return picker;
  }

  private createMoreMenu(view: EditorView, wrapper: HTMLElement): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'lm-table-more-menu';
    menu.hidden = true;
    menu.append(
      createToolbarButton('delete-row', i18n.t('table.deleteCurrentRow'), () => {
        const location = activeCellLocation(wrapper);
        replaceTableBlock(
          view,
          this.block,
          deleteTableRow(this.block, location.rowIndex),
          'input.table-row',
        );
      }),
      createToolbarButton('delete-column', i18n.t('table.deleteCurrentColumn'), () => {
        const location = activeCellLocation(wrapper);
        replaceTableBlock(
          view,
          this.block,
          deleteTableColumn(this.block, location.columnIndex),
          'input.table-column',
        );
      }),
      createToolbarButton('clear-alignment', i18n.t('table.clearAlignment'), () => {
        this.setAlignmentFromToolbar(view, wrapper, 'none');
      }),
    );

    return menu;
  }

  private setAlignmentFromToolbar(
    view: EditorView,
    wrapper: HTMLElement,
    alignment: MarkdownTableAlignment,
  ): void {
    const location = activeCellLocation(wrapper);
    replaceTableBlock(
      view,
      this.block,
      setTableAlignment(this.block, location.columnIndex, alignment),
      'input.table-align',
    );
  }

  activateCell(
    view: EditorView,
    wrapper: HTMLElement,
    toolbar: HTMLElement,
    cell: HTMLTableCellElement,
    location: TableCellLocation,
  ): void {
    if (cell.dataset.active === 'true' && this.inlineEditor) {
      this.inlineEditor.focus();
      return;
    }

    this.flushPendingCellValue();
    this.cellContentObserver?.disconnect();
    this.cellContentObserver = null;
    this.inlineEditor?.destroy();
    this.inlineEditor = null;
    this.parentView = view;

    wrapper
      .querySelectorAll<HTMLElement>('.lm-table-cell[data-active="true"]')
      .forEach((activeCell) => {
        activeCell.dataset.active = 'false';
        activeCell.querySelector('.lm-table-cell-editor')?.remove();
        activeCell.querySelector('.lm-table-cell-preview')?.removeAttribute('hidden');
      });

    activeCells.set(activeCellKey(this.block), {
      ...location,
      tableKey: activeCellKey(this.block),
    });
    cell.dataset.active = 'true';
    toolbar.hidden = false;
    toolbar.querySelector<HTMLElement>('.lm-table-size-picker')!.hidden = true;
    toolbar.querySelector<HTMLElement>('.lm-table-more-menu')!.hidden = true;

    const preview = cell.querySelector<HTMLElement>('.lm-table-cell-preview');
    if (preview) {
      preview.hidden = true;
    }

    const editorHost = document.createElement('div');
    editorHost.className = 'lm-table-cell-editor';
    cell.appendChild(editorHost);
    this.inlineEditor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: cellMarkdownValue(this.block, location),
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          history(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            this.queueCellValueReplace(view, location, update.state.doc.toString());
          }),
          keymap.of([
            {
              key: 'Tab',
              run: () => {
                focusAdjacentCell(cell, 1);
                return true;
              },
            },
            {
              key: 'Shift-Tab',
              run: () => {
                focusAdjacentCell(cell, -1);
                return true;
              },
            },
            {
              key: 'Enter',
              run: () => {
                replaceTableBlock(
                  view,
                  this.block,
                  addTableRow(this.block, location.rowIndex),
                  'input.table-row',
                );
                return true;
              },
            },
            {
              key: 'Escape',
              run: () => {
                activeCells.delete(activeCellKey(this.block));
                toolbar.hidden = true;
                view.focus();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ],
      }),
    });
    this.inlineEditor.contentDOM.addEventListener('input', (event) => {
      const stateContent = this.inlineEditor?.state.doc.toString() ?? '';
      const domContent = this.inlineEditor?.contentDOM.textContent ?? '';
      const eventContent =
        event instanceof InputEvent && typeof event.data === 'string'
          ? event.data
          : '';
      this.queueCellValueReplace(
        view,
        location,
        domContent !== stateContent
          ? domContent
          : eventContent.length > 0
            ? eventContent
            : stateContent,
      );
    });
    this.cellContentObserver = new MutationObserver(() => {
      const domContent = this.inlineEditor?.contentDOM.textContent ?? '';
      if (domContent === cellMarkdownValue(this.block, location)) {
        return;
      }

      this.queueCellValueReplace(view, location, domContent);
    });
    this.cellContentObserver.observe(this.inlineEditor.contentDOM, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    this.inlineEditor.focus();
  }

  private queueCellValueReplace(
    parentView: EditorView,
    location: TableCellLocation,
    value: string,
  ): void {
    this.parentView = parentView;
    const nextValue = sanitizeCellEditorValue(value);
    if (nextValue === cellMarkdownValue(this.block, location)) {
      return;
    }

    this.pendingCellValue = nextValue;
    activeCells.set(activeCellKey(this.block), {
      ...location,
      tableKey: activeCellKey(this.block),
    });

    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
    }

    this.syncTimer = window.setTimeout(() => {
      this.flushPendingCellValue();
    }, 0);
  }

  private flushPendingCellValue(options: { defer?: boolean } = {}): void {
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.pendingCellValue === null || !this.parentView) {
      return;
    }

    const active = activeCells.get(activeCellKey(this.block));
    const value = this.pendingCellValue;
    const parentView = this.parentView;
    this.pendingCellValue = null;

    if (!active) {
      return;
    }

    const replace = () => {
      replaceTableBlock(
        parentView,
        this.block,
        updateTableCell(this.block, {
          columnIndex: active.columnIndex,
          rowIndex: active.rowIndex,
          section: active.section,
          value,
        }),
        'input.table-cell',
      );
    };

    if (options.defer) {
      queueMicrotask(replace);
      return;
    }

    replace();
  }
}

type ConfigureCellOptions = {
  columnIndex: number;
  rowIndex: number;
  section: 'body' | 'header';
  table: TableBlock;
  toolbar: HTMLElement;
  value: string;
  view: EditorView;
  widget: TableBlockWidget;
  wrapper: HTMLElement;
};

function configureCell(
  cell: HTMLTableCellElement,
  options: ConfigureCellOptions,
): void {
  cell.className = 'lm-table-cell';
  cell.tabIndex = 0;
  cell.dataset.columnIndex = String(options.columnIndex);
  cell.dataset.rowIndex = String(options.rowIndex);
  cell.dataset.section = options.section;
  cell.setAttribute('aria-label', i18n.t('table.editCell'));
  const preview = document.createElement('span');
  preview.className = 'lm-table-cell-preview';
  preview.replaceChildren(...renderInlineMarkdown(options.value));
  cell.replaceChildren(preview);
  cell.style.textAlign = alignmentToTextAlign(
    options.table.alignments[options.columnIndex],
  );
  const location = {
    columnIndex: options.columnIndex,
    rowIndex: options.rowIndex,
    section: options.section,
  };
  cell.addEventListener('click', () => {
    options.widget.activateCell(
      options.view,
      options.wrapper,
      options.toolbar,
      cell,
      location,
    );
  });
  cell.addEventListener('focusin', () => {
    options.widget.activateCell(
      options.view,
      options.wrapper,
      options.toolbar,
      cell,
      location,
    );
  });
  cell.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      focusAdjacentCell(cell, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (options.section === 'body') {
        const updated = addTableRow(options.table, options.rowIndex);
        replaceTableBlock(options.view, options.table, updated, 'input.table-row');
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      activeCells.delete(activeCellKey(options.table));
      options.toolbar.hidden = true;
      options.view.focus();
    }
  });
}

function alignmentToTextAlign(
  alignment: MarkdownTableAlignment | undefined,
): 'center' | 'left' | 'right' {
  if (alignment === 'center' || alignment === 'right') {
    return alignment;
  }

  return 'left';
}

function replaceTableBlock(
  view: EditorView,
  current: TableBlock,
  next: MarkdownTableModel,
  userEvent: string,
): void {
  view.dispatch({
    changes: {
      from: current.from,
      insert: serializeMarkdownTable(next),
      to: current.to,
    },
    userEvent,
  });
}

function cellMarkdownValue(table: TableBlock, location: TableCellLocation): string {
  if (location.section === 'header') {
    return table.header[location.columnIndex] ?? '';
  }

  return table.rows[location.rowIndex]?.[location.columnIndex] ?? '';
}

function activeCellKey(table: Pick<TableBlock, 'from'>): string {
  return String(table.from);
}

function sanitizeCellEditorValue(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function createToolbarButton(
  action: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-table-toolbar-button';
  button.dataset.action = action;
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return button;
}

function createNumberInput(label: string, value: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.value = String(value);
  input.className = 'lm-table-size-input';
  input.setAttribute('aria-label', label);

  return input;
}

function toggleSizePicker(toolbar: HTMLElement): void {
  const picker = toolbar.querySelector<HTMLElement>('.lm-table-size-picker');
  const moreMenu = toolbar.querySelector<HTMLElement>('.lm-table-more-menu');
  if (!picker) {
    return;
  }

  picker.hidden = !picker.hidden;
  if (!picker.hidden && moreMenu) {
    moreMenu.hidden = true;
  }
}

function toggleMoreMenu(toolbar: HTMLElement): void {
  const menu = toolbar.querySelector<HTMLElement>('.lm-table-more-menu');
  const picker = toolbar.querySelector<HTMLElement>('.lm-table-size-picker');
  if (!menu) {
    return;
  }

  menu.hidden = !menu.hidden;
  if (!menu.hidden && picker) {
    picker.hidden = true;
  }
}

function activeCellLocation(widget: HTMLElement): {
  columnIndex: number;
  rowIndex: number;
} {
  const cell =
    widget.querySelector<HTMLElement>('.lm-table-cell[data-active="true"]') ??
    widget.querySelector<HTMLElement>('.lm-table-cell:focus') ??
    widget.querySelector<HTMLElement>('[data-section="body"]') ??
    widget.querySelector<HTMLElement>('.lm-table-cell');

  return {
    columnIndex: Number(cell?.dataset.columnIndex ?? 0),
    rowIndex: Number(cell?.dataset.rowIndex ?? 0),
  };
}

function findCell(
  wrapper: HTMLElement,
  location: Pick<TableCellLocation, 'columnIndex' | 'rowIndex' | 'section'>,
): HTMLTableCellElement | null {
  const selector = [
    '.lm-table-cell',
    `[data-section="${location.section}"]`,
    `[data-row-index="${location.rowIndex}"]`,
    `[data-column-index="${location.columnIndex}"]`,
  ].join('');

  return wrapper.querySelector<HTMLTableCellElement>(selector);
}

function focusAdjacentCell(cell: HTMLElement, direction: -1 | 1): void {
  const widget = cell.closest('.lm-table-widget');
  const cells = Array.from(
    widget?.querySelectorAll<HTMLElement>('.lm-table-cell') ?? [],
  );
  const index = cells.indexOf(cell);

  if (index === -1) {
    return;
  }

  const nextIndex = Math.min(Math.max(index + direction, 0), cells.length - 1);
  cells[nextIndex]?.click();
}

function renderInlineMarkdown(source: string): Node[] {
  const nodes: Node[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);
    const match =
      /^`([^`]+)`/.exec(rest) ??
      /^\*\*([^*]+)\*\*/.exec(rest) ??
      /^~~([^~]+)~~/.exec(rest) ??
      /^\*([^*]+)\*/.exec(rest) ??
      /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);

    if (!match) {
      const nextSpecial = findNextInlineSpecial(source, index + 1);
      nodes.push(document.createTextNode(source.slice(index, nextSpecial)));
      index = nextSpecial;
      continue;
    }

    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(createInlineElement('code', match[1] ?? ''));
    } else if (token.startsWith('**')) {
      nodes.push(createInlineElement('strong', match[1] ?? ''));
    } else if (token.startsWith('~~')) {
      nodes.push(createInlineElement('s', match[1] ?? ''));
    } else if (token.startsWith('*')) {
      nodes.push(createInlineElement('em', match[1] ?? ''));
    } else {
      const link = createInlineElement('a', match[1] ?? '') as HTMLAnchorElement;
      link.href = match[2] ?? '';
      link.rel = 'noreferrer';
      nodes.push(link);
    }
    index += token.length;
  }

  return nodes.length > 0 ? nodes : [document.createTextNode('')];
}

function findNextInlineSpecial(source: string, from: number): number {
  const candidates = ['`', '*', '~', '[']
    .map((character) => source.indexOf(character, from))
    .filter((position) => position !== -1);

  return candidates.length > 0 ? Math.min(...candidates) : source.length;
}

function createInlineElement(tagName: string, text: string): HTMLElement {
  const element = document.createElement(tagName);
  element.textContent = text;

  return element;
}
