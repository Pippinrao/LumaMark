import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { markdownLanguage as codemirrorMarkdownLanguage } from '@codemirror/lang-markdown';
import { searchKeymap } from '@codemirror/search';
import {
  type Annotation,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import {
  markdownTableAutocompleter,
  markdownTables,
  TableStyle,
  TableTheme,
} from 'codemirror-markdown-tables';
import { Strikethrough } from '@lezer/markdown';
import { markdownSyntaxHighlighting } from '../../markdown/markdownLanguage';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import { selectionCaretVisibilityExtension } from '../../wysiwyg/selectionCaretVisibility';
import {
  tableCellClickSyncNestedExtension,
  tableCellClickSyncRootExtension,
} from './tableCellClickSync';
import { tableCellEditingExtension } from './tableCellEditing';
import {
  createTableCellRenderLockScope,
  tableCellRenderLockNestedExtension,
  tableCellRenderLockScopeExtension,
} from './tableCellRenderLock';
import './table.css';

export function tablePreviewExtension(renderLocked: boolean): Extension {
  const renderLockScope = createTableCellRenderLockScope(renderLocked);

  return [
    tableCellRenderLockScopeExtension(renderLockScope),
    tableCellClickSyncRootExtension(),
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
      globalKeyBindings: [...historyKeymap, ...searchKeymap],
      handlePosition: 'outside',
      lineWrapping: 'wrap',
      markdownConfig: {
        extensions: [Strikethrough],
      },
      selectionType: 'native',
      extensions: [
        EditorView.lineWrapping,
        markdownSyntaxHighlighting(),
        selectionCaretVisibilityExtension,
        tableCellEditingExtension(),
        tableCellRenderLockNestedExtension(renderLockScope),
        tableCellClickSyncNestedExtension(),
        keymap.of(defaultKeymap),
      ],
      style: TableStyle.default.with({
        '--tbl-style-default-header-alignment': 'left',
        '--tbl-style-font-family': 'var(--lm-font-editor)',
        '--tbl-style-font-size':
          'calc(15.5px * var(--lm-editor-font-scale, 1))',
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
    Prec.highest(preservePassiveTableSourceFormatting()),
    ...blockLockedTableLibraryWriteback(),
  ];
}

function preservePassiveTableSourceFormatting(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    const formatAnnotation = getRuntimeTableFormatAnnotation(transaction);

    return formatAnnotation
      ? {
          annotations: [formatAnnotation, Transaction.addToHistory.of(false)],
        }
      : transaction;
  });
}

function getRuntimeTableFormatAnnotation(
  transaction: Transaction,
): Annotation<unknown> | undefined {
  return getRuntimeTableLibraryAnnotation(transaction, (value) => value === 'table.format');
}

const clearLockedTableWritebackGuard = StateEffect.define<null>();
const lockedTableWritebackGuard = StateField.define<boolean>({
  create: () => false,
  update(suppress, transaction) {
    const locked = isEditorRenderLocked(transaction.state);
    const wasLocked = isEditorRenderLocked(transaction.startState);
    if (transaction.effects.some((effect) => effect.is(clearLockedTableWritebackGuard))) {
      return false;
    }
    if (!locked && wasLocked) {
      return true;
    }
    if (locked) {
      return false;
    }
    if (
      suppress &&
      !getRuntimeTableLibraryAnnotation(
        transaction,
        isMutatingTableLibraryAnnotation,
      )
    ) {
      return false;
    }
    return suppress;
  },
});

function blockLockedTableLibraryWriteback(): Extension[] {
  return [
    lockedTableWritebackGuard,
    Prec.highest(
      EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) {
        return transaction;
      }

      const tableAnnotation = getRuntimeTableLibraryAnnotation(
        transaction,
        isMutatingTableLibraryAnnotation,
      );
      if (!tableAnnotation) {
        return transaction;
      }

      const dropLatentWriteback =
        isEditorRenderLocked(transaction.startState) ||
        transaction.startState.field(lockedTableWritebackGuard, false) === true;
      if (!dropLatentWriteback) {
        return transaction;
      }

      return {
        annotations: [tableAnnotation, Transaction.addToHistory.of(false)],
        effects: clearLockedTableWritebackGuard.of(null),
      };
      }),
    ),
  ];
}

function isMutatingTableLibraryAnnotation(value: unknown): boolean {
  return value === 'table.edit' || value === 'table.delete' || value === 'table.correct';
}

function getRuntimeTableLibraryAnnotation(
  transaction: Transaction,
  matches: (value: unknown) => boolean,
): Annotation<unknown> | undefined {
  // codemirror-markdown-tables@1.0.0 still has no public autoformat opt-out.
  // The patched library mounts valid GFM tables without a document-changing
  // table.format rewrite. Keep dropping format document changes so a future
  // upstream format dispatch cannot rewrite source; widgets no longer depend
  // on that rewrite succeeding.
  const annotations = (
    transaction as unknown as {
      readonly annotations?: readonly { readonly value?: unknown }[];
    }
  ).annotations;
  const tableAnnotation = annotations?.find((annotation) =>
    matches(annotation.value),
  );

  return tableAnnotation as Annotation<unknown> | undefined;
}
