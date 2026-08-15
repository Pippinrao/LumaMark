import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { markdownLanguage as codemirrorMarkdownLanguage } from '@codemirror/lang-markdown';
import { searchKeymap } from '@codemirror/search';
import {
  type Annotation,
  EditorState,
  Prec,
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
import {
  tableCellClickSyncNestedExtension,
  tableCellClickSyncRootExtension,
} from './tableCellClickSync';
import { tableCellEditingExtension } from './tableCellEditing';
import './table.css';

export function tablePreviewExtension(): Extension {
  return [
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
        tableCellEditingExtension(),
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
  // codemirror-markdown-tables@1.0.0 has no public autoformat opt-out. Keep
  // this compatibility cast at the library boundary and review it whenever
  // the dependency changes. The original annotation is preserved so the
  // library observes its own format transaction without dispatching forever.
  const annotations = (
    transaction as unknown as {
      readonly annotations?: readonly { readonly value?: unknown }[];
    }
  ).annotations;
  const formatAnnotation = annotations?.find(
    (annotation) => annotation.value === 'table.format',
  );

  return formatAnnotation as Annotation<unknown> | undefined;
}
