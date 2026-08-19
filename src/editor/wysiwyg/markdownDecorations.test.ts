import {
  Compartment,
  EditorSelection,
  EditorState,
} from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  collectMarkdownDecorationRanges,
  markdownDecorationActiveIdentity,
  markdownDecorationsPlugin,
  markdownWysiwygExtension,
  selectMarkdownDecorationUpdateMode,
} from './markdownDecorations';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { toggleTaskListAtSelection } from './taskListCommands';
import {
  mermaidEditingStateField,
  setActiveMermaidBlockEffect,
} from '../capabilities/mermaid/mermaidEditingState';
import { createEditorApi } from '../core/editorApi';

function visibleLineTexts(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll('.cm-line')].map(
    (line) => line.textContent ?? '',
  );
}

describe('markdown WYSIWYG decorations', () => {
  it('marks heading lines with level-specific ranges', () => {
    const ranges = collectMarkdownDecorationRanges('# 标题\n\n### Deep\nbody');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-heading lm-md-heading-1',
          from: 0,
          kind: 'heading',
          to: 4,
        },
        {
          className: 'lm-md-heading lm-md-heading-3',
          from: 6,
          kind: 'heading',
          to: 14,
        },
      ]),
    );
  });

  it('marks bold italic and strikethrough inline ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      '**粗体** and *斜体* and ~~删除~~',
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-strong',
          from: 0,
          kind: 'strong',
          to: 6,
        },
        {
          className: 'lm-md-emphasis',
          from: 11,
          kind: 'emphasis',
          to: 15,
        },
        {
          className: 'lm-md-strikethrough',
          from: 20,
          kind: 'strikethrough',
          to: 26,
        },
      ]),
    );
  });

  it('marks underscore bold and italic inline ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      '__粗体__ and _斜体_',
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-strong',
          from: 0,
          kind: 'strong',
          to: 6,
        },
        {
          className: 'lm-md-emphasis',
          from: 11,
          kind: 'emphasis',
          to: 15,
        },
      ]),
    );
  });

  it('marks blockquotes lists tasks inline code links and horizontal rules', () => {
    const markdown = [
      '> quote',
      '- bullet',
      '1. ordered',
      '- [ ] task',
      '[Luma](https://example.com)',
      '',
      '---',
      'inline `code`',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n');

    const ranges = collectMarkdownDecorationRanges(markdown);

    expect(ranges.map((range) => range.kind)).toEqual(
      expect.arrayContaining([
        'blockquote',
        'unorderedList',
        'orderedList',
        'taskList',
        'inlineCode',
        'link',
        'horizontalRule',
      ]),
    );
    expect(ranges.some((range) => range.kind === 'codeBlock')).toBe(false);
  });

  it('marks links autolinks and horizontal rules from the markdown syntax tree', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '[Luma](https://example.com)',
        '',
        '<https://example.com>',
        '',
        '---',
      ].join('\n'),
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-link',
          from: 0,
          kind: 'link',
          to: 27,
        },
        {
          className: 'lm-md-link',
          from: 29,
          kind: 'link',
          to: 50,
        },
        {
          className: 'lm-md-horizontal-rule',
          from: 52,
          kind: 'horizontalRule',
          to: 55,
        },
      ]),
    );
  });

  it('keeps fenced code block surface styling out of generic WYSIWYG marks', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '~~~md',
        '# not a heading',
        '- [ ] not a task',
        '~~~',
      ].join('\n'),
    );

    expect(ranges.filter((range) => range.kind === 'codeBlock')).toEqual([]);
    expect(
      ranges.filter((range) =>
        ['heading', 'taskList', 'unorderedList'].includes(range.kind),
      ),
    ).toEqual([]);
  });

  it('marks only list markers for unordered and ordered lists', () => {
    const ranges = collectMarkdownDecorationRanges('- bullet\n\n12. ordered');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-list lm-md-unordered-list lm-md-list-marker',
          from: 0,
          kind: 'unorderedList',
          to: 1,
        },
        {
          className: 'lm-md-list lm-md-ordered-list lm-md-list-marker',
          from: 10,
          kind: 'orderedList',
          to: 13,
        },
      ]),
    );
  });

  it('marks ordered task list markers', () => {
    const ranges = collectMarkdownDecorationRanges('1. [ ] ordered task');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-list lm-md-task-list lm-md-list-marker',
          from: 0,
          kind: 'taskList',
          to: 6,
        },
      ]),
    );
  });

  it('marks GFM table blocks and cells with document-grade ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      ['| Name | Status |', '| --- | --- |', '| Luma | Ready |'].join('\n'),
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: 'lm-md-table',
          from: 0,
          kind: 'table',
        }),
        expect.objectContaining({
          className: 'lm-md-table-header',
          from: 0,
          kind: 'tableHeader',
        }),
        expect.objectContaining({
          className: 'lm-md-table-cell',
          kind: 'tableCell',
        }),
        expect.objectContaining({
          className: 'lm-md-table-delimiter',
          kind: 'tableDelimiter',
        }),
      ]),
    );
  });

  it('does not apply emphasis styling inside inline code or code blocks', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '`**literal**`',
        '```md',
        '**also literal**',
        '```',
      ].join('\n'),
    );

    expect(ranges.filter((range) => range.kind === 'strong')).toEqual([]);
  });

  it('does not apply block markdown styling inside code blocks', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '```md',
        '# not a heading',
        '- not a list',
        '> not a quote',
        '```',
      ].join('\n'),
    );

    expect(
      ranges.filter((range) =>
        ['blockquote', 'heading', 'unorderedList'].includes(range.kind),
      ),
    ).toEqual([]);
  });

});

describe('markdown WYSIWYG extension', () => {
  it('installs ordinary paragraph editing in the live-preview extension', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'plain',
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(5),
      }),
    });

    expect(
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Enter' }),
        'editor',
      ),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe('plain\n\n');

    view.destroy();
    parent.remove();
  });

  it('keeps the decoration identity when the caret stays in the same unprotected paragraph', () => {
    const doc = 'hello **bold** world';
    const start = EditorState.create({
      doc,
      extensions: [markdownLanguage(), markdownWysiwygExtension()],
      selection: EditorSelection.cursor(doc.length),
    });
    const moved = start.update({
      selection: EditorSelection.cursor(doc.length - 1),
    }).state;

    expect(markdownDecorationActiveIdentity(moved, false)).toBe(
      markdownDecorationActiveIdentity(start, false),
    );
  });

  it('changes the decoration identity when the caret enters an inline owner', () => {
    const doc = 'hello **bold** world';
    const start = EditorState.create({
      doc,
      extensions: [markdownLanguage(), markdownWysiwygExtension()],
      selection: EditorSelection.cursor(doc.length),
    });
    const insideBold = start.update({
      selection: EditorSelection.cursor(doc.indexOf('bold') + 1),
    }).state;

    expect(markdownDecorationActiveIdentity(insideBold, false)).not.toBe(
      markdownDecorationActiveIdentity(start, false),
    );
  });

  it('maps decorations on selection-only updates unless the active span or block changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = 'hello **bold** world';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.length),
      }),
    });
    const plugin = view.plugin(markdownDecorationsPlugin);
    if (!plugin) {
      throw new Error('Expected markdown decorations plugin.');
    }
    const decorations = plugin.decorations;

    view.dispatch({ selection: EditorSelection.cursor(doc.length - 1) });
    expect(view.plugin(markdownDecorationsPlugin)?.decorations).toBe(decorations);

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('bold') + 1),
    });
    expect(view.plugin(markdownDecorationsPlugin)?.decorations).not.toBe(
      decorations,
    );

    view.destroy();
    parent.remove();
  });

  it('maps decorations throughout composition and rebuilds on settlement', () => {
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: true,
        requiresRebuild: true,
        wasComposing: false,
      }),
    ).toBe('map');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: true,
        requiresRebuild: false,
        wasComposing: true,
      }),
    ).toBe('map');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        requiresRebuild: false,
        wasComposing: true,
      }),
    ).toBe('rebuild');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        requiresRebuild: true,
        wasComposing: false,
      }),
    ).toBe('rebuild');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        requiresRebuild: false,
        wasComposing: false,
      }),
    ).toBe('keep');
  });

  it('freezes layout-changing markers for the entire pointer gesture', () => {
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        documentChanged: false,
        gestureActive: true,
        requiresRebuild: true,
        wasComposing: false,
      }),
    ).toBe('keep');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        documentChanged: true,
        gestureActive: true,
        requiresRebuild: true,
        wasComposing: false,
      }),
    ).toBe('map');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        documentChanged: false,
        gestureActive: false,
        requiresRebuild: true,
        wasComposing: false,
      }),
    ).toBe('rebuild');
  });

  it('rebuilds from a scheduled preview pass instead of a viewport-only update', () => {
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        documentChanged: false,
        gestureActive: false,
        previewPass: false,
        requiresRebuild: false,
        wasComposing: false,
      }),
    ).toBe('keep');
    expect(
      selectMarkdownDecorationUpdateMode({
        compositionStarted: false,
        documentChanged: false,
        gestureActive: false,
        previewPass: true,
        requiresRebuild: false,
        wasComposing: false,
      }),
    ).toBe('rebuild');
  });

  it('removes document gesture listeners when the editor is destroyed', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'plain',
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });
    let viewDestroyed = false;

    try {
      const documentCallStart = documentAdd.mock.calls.length;
      const windowCallStart = windowAdd.mock.calls.length;
      view.contentDOM.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          detail: 1,
        }),
      );

      const documentGestureListeners = documentAdd.mock.calls
        .slice(documentCallStart)
        .filter(([, , options]) => options === true);
      const windowGestureListeners = windowAdd.mock.calls
        .slice(windowCallStart)
        .filter(([, , options]) => options === true);
      expect(documentGestureListeners.map(([type]) => type)).toEqual([
        'mouseup',
        'pointercancel',
        'touchend',
        'touchcancel',
      ]);
      expect(windowGestureListeners.map(([type]) => type)).toEqual(['blur']);

      view.destroy();
      viewDestroyed = true;
      for (const listener of documentGestureListeners) {
        expect(documentRemove).toHaveBeenCalledWith(...listener);
      }
      for (const listener of windowGestureListeners) {
        expect(windowRemove).toHaveBeenCalledWith(...listener);
      }
    } finally {
      if (!viewDestroyed) {
        view.destroy();
      }
      documentAdd.mockRestore();
      documentRemove.mockRestore();
      windowAdd.mockRestore();
      windowRemove.mockRestore();
      parent.remove();
    }
  });

  it('reveals only the inline owner touched by the caret on the same line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**first** and **second**';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('first') + 1),
      }),
    });

    expect(parent.textContent).toContain('**first**');
    expect(parent.textContent).not.toContain('**second**');
    expect(parent.textContent).toContain('second');

    view.destroy();
    parent.remove();
  });

  it('reveals only the innermost nested inline owner for a collapsed caret', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**outer *中文* tail** and ``code`span`` and *other*';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('中文') + 1),
      }),
    });

    expect(parent.textContent).toContain('outer *中文* tail');
    expect(parent.textContent).not.toContain('**outer');
    expect(parent.textContent).not.toContain('``code`span``');
    expect(parent.textContent).not.toContain('*other*');
    expect(
      [...parent.querySelectorAll('.lm-md-source-mark-inline')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['*', '*']);

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('code') + 1),
    });
    expect(parent.textContent).toContain('``code`span``');
    expect(parent.textContent).not.toContain('**outer *中文* tail**');

    view.destroy();
    parent.remove();
  });

  it('reveals only the active line marker in a multi-line blockquote', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '> first\n> second\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('second') + 1),
      }),
    });

    expect(visibleLineTexts(parent)).toEqual([
      ' first',
      '> second',
      '',
      'plain',
    ]);

    view.destroy();
    parent.remove();
  });

  it('keeps adjacent owners hidden at their shared caret boundary', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**a**_b_';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(5),
      }),
    });

    expect(parent.textContent).toBe('ab');

    view.destroy();
    parent.remove();
  });

  it('reveals link destination and title only for the active link owner', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '[first](one.test "one") and [second](two.test "two")';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('one.test') + 1),
      }),
    });

    expect(parent.textContent).toContain('[first](one.test "one")');
    expect(parent.textContent).not.toContain('two.test');
    expect(parent.textContent).not.toContain('"two"');

    view.destroy();
    parent.remove();
  });

  it('merges active inline owners from multiple selections', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**first** plain *second* plain ~~third~~';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          markdownLanguage(),
          markdownWysiwygExtension(),
        ],
        selection: EditorSelection.create([
          EditorSelection.cursor(doc.indexOf('first') + 1),
          EditorSelection.cursor(doc.indexOf('second') + 1),
        ]),
      }),
    });

    expect(parent.textContent).toContain('**first**');
    expect(parent.textContent).toContain('*second*');
    expect(parent.textContent).not.toContain('~~third~~');

    view.destroy();
    parent.remove();
  });

  it('reveals all delimiters owned by the current multi-line structure', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const cases = [
      {
        cursor: 'Title',
        doc: 'Title\n---\n\nplain',
        expected: ['Title', '---'],
      },
      {
        cursor: 'continuation',
        doc: '- item\n  continuation\n\nplain',
        expected: ['- item'],
      },
      {
        cursor: 'second',
        doc: '> first\n> second\n\nplain',
        expected: ['> second'],
      },
    ] as const;

    for (const item of cases) {
      const host = document.createElement('div');
      parent.appendChild(host);
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: item.doc,
          extensions: [markdownLanguage(), markdownWysiwygExtension()],
          selection: EditorSelection.cursor(
            item.doc.indexOf(item.cursor) + 1,
          ),
        }),
      });

      expect(visibleLineTexts(host)).toEqual(
        expect.arrayContaining([...item.expected]),
      );
      view.destroy();
      host.remove();
    }

    parent.remove();
  });

  it('keeps fenced-code boundaries hidden while editing content and reveals only the active boundary', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '```ts\nconst x = 1\n```\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('const') + 1),
      }),
    });

    expect(visibleLineTexts(parent)).toEqual(['', 'const x = 1', '', '', 'plain']);

    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(visibleLineTexts(parent)).toEqual(['```ts', 'const x = 1', '', '', 'plain']);

    view.dispatch({
      selection: EditorSelection.cursor(doc.lastIndexOf('```') + 1),
    });
    expect(visibleLineTexts(parent)).toEqual(['', 'const x = 1', '```', '', 'plain']);

    view.destroy();
    parent.remove();
  });

  it.each([
    {
      cursor: 'nested',
      doc: '> > nested',
      expectedLine: '> > nested',
      name: 'nested blockquote',
    },
    {
      cursor: 'quoted task',
      doc: '> - [ ] quoted task',
      expectedLine: '> - [ ] quoted task',
      name: 'task list inside a blockquote',
    },
  ] as const)(
    'reveals the complete structural marker path for $name',
    ({ cursor, doc, expectedLine }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [markdownLanguage(), markdownWysiwygExtension()],
          selection: EditorSelection.cursor(doc.indexOf(cursor) + 1),
        }),
      });

      expect(visibleLineTexts(parent)).toContain(expectedLine);

      view.destroy();
      parent.remove();
    },
  );

  it('reveals only the current quote path inside an active fenced code block', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '> ```ts\n> code\n> ```';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('code') + 1),
      }),
    });

    expect(visibleLineTexts(parent)).toEqual([' ', '> code', ' ']);

    view.destroy();
    parent.remove();
  });

  it('keeps both Mermaid fences and info visible for the active block', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const mermaidSource = '```mermaid\ngraph TD\n```';
    const doc = `${mermaidSource}\n\noutside`;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          mermaidEditingStateField,
        ],
        selection: EditorSelection.create([
          EditorSelection.range(
            doc.indexOf('graph') + 1,
            doc.indexOf('outside') + 1,
          ),
        ]),
      }),
    });

    view.dispatch({
      effects: setActiveMermaidBlockEffect.of({
        from: 0,
        to: mermaidSource.length,
      }),
    });

    expect(visibleLineTexts(parent)).toEqual(
      expect.arrayContaining(mermaidSource.split('\n')),
    );

    view.destroy();
    parent.remove();
  });

  it.each([
    {
      doc: '---\ntitle: LumaMark\n---\n# Heading\n\nplain',
      forbiddenSelector:
        '.lm-md-horizontal-rule, .lm-md-heading-2',
      name: 'YAML front matter',
      protectedSource: '---\ntitle: LumaMark\n---',
    },
    {
      doc: '[^note]: source\ntext[^note]\n\nplain',
      forbiddenSelector: '.lm-md-link',
      name: 'footnotes',
      protectedSource: '[^note]: source\ntext[^note]',
    },
    {
      doc: '[toc]\n\nplain',
      forbiddenSelector: '.lm-md-link',
      name: 'a standalone TOC marker',
      protectedSource: '[toc]',
    },
    {
      doc: '> [!NOTE]\n> source remains visible\n\nplain',
      forbiddenSelector: '.lm-md-blockquote, .lm-md-link',
      name: 'a callout',
      protectedSource: '> [!NOTE]\n> source remains visible',
    },
  ])(
    'keeps protected source visible without generic decoration for $name',
    ({ doc, forbiddenSelector, protectedSource }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [markdownLanguage(), markdownWysiwygExtension()],
          selection: EditorSelection.cursor(doc.indexOf('plain')),
        }),
      });

      expect(visibleLineTexts(parent)).toEqual(
        expect.arrayContaining(protectedSource.split('\n')),
      );
      expect(parent.querySelector(forbiddenSelector)).toBeNull();

      view.destroy();
      parent.remove();
    },
  );

  it('rehides markdown marks when the cursor leaves the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['# Title', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(1),
      }),
    });

    expect(parent.querySelector('.lm-md-hidden-mark')).toBeNull();

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('plain')),
    });

    expect(parent.querySelector('.lm-md-hidden-mark')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('weakens an active heading marker without changing source or selection', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '# Title\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(0),
      }),
    });
    const selectionBefore = view.state.selection.toJSON();

    const marker = parent.querySelector('.lm-md-source-mark-block');

    expect(marker?.textContent).toBe('#');
    expect(marker?.closest('.lm-md-heading-1')).not.toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.toJSON()).toEqual(selectionBefore);

    view.destroy();
    parent.remove();
  });

  it('weakens active list and task source markers', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- item', '- [ ] task', '1. ordered', '', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('item')),
      }),
    });
    const visibleSourceMarks = () =>
      [...parent.querySelectorAll('.lm-md-source-mark-block')].map(
        (element) => element.textContent,
      );

    expect(visibleSourceMarks()).toEqual(['-']);

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });
    expect(visibleSourceMarks()).toEqual(['-', '[ ]']);

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('ordered')),
    });
    expect(visibleSourceMarks()).toEqual(['1.']);

    view.destroy();
    parent.remove();
  });

  it.each([
    ['active unordered', ['-']],
    ['active ordered', ['9)']],
    ['active task', ['-', '[ ]']],
    ['active ordered task', ['7.', '[x]']],
    ['nested unordered', ['-']],
    ['nested ordered', ['3)']],
    ['nested task', ['-', '[ ]']],
    ['nested ordered task', ['4.', '[x]']],
  ] as const)(
    'locks every list marker while reading from %s and restores its live context',
    (activeText, expectedLiveMarks) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const doc = [
        '- active unordered',
        '',
        '9) active ordered',
        '',
        '- [ ] active task',
        '',
        '7. [x] active ordered task',
        '',
        '- parent unordered',
        '  - nested unordered',
        '',
        '1. parent ordered',
        '   3) nested ordered',
        '',
        '- parent task',
        '  - [ ] nested task',
        '',
        '1. parent ordered task',
        '   4. [x] nested ordered task',
        '',
        '**active strong**',
      ].join('\n');
      const editor = createEditorApi({ doc, parent });
      editor.view.dispatch({
        selection: EditorSelection.cursor(doc.indexOf(activeText)),
      });

      editor.setDisplayMode('reading');

      expect(parent.querySelector('.lm-md-source-mark')).toBeNull();
      const listBullets = [
        ...parent.querySelectorAll<HTMLElement>('.lm-md-list-bullet'),
      ];
      expect(listBullets).toHaveLength(4);
      for (const bullet of listBullets) {
        expect(bullet.getAttribute('aria-hidden')).toBeNull();
      }
      expect(
        [...parent.querySelectorAll('.lm-md-list-order')].map(
          (marker) => marker.textContent,
        ),
      ).toEqual(['9)', '7.', '1.', '3)', '1.', '4.']);
      const taskLines = [
        ...parent.querySelectorAll<HTMLElement>('.lm-md-task-list-line'),
      ];
      expect(taskLines).toHaveLength(4);
      for (const taskLine of taskLines) {
        expect(taskLine.querySelector('.lm-md-source-mark')).toBeNull();
        expect(
          taskLine.querySelector<HTMLInputElement>('.lm-md-task-checkbox')
            ?.disabled,
        ).toBe(true);
      }
      for (const taskLine of [taskLines[0], taskLines[2]]) {
        expect(taskLine.querySelector('.lm-md-list-order')).toBeNull();
        expect(taskLine.textContent).not.toMatch(/^\s*-\s/);
      }
      expect(
        taskLines[1].querySelector('.lm-md-list-order')?.textContent,
      ).toBe('7.');
      expect(
        taskLines[3].querySelector('.lm-md-list-order')?.textContent,
      ).toBe('4.');

      editor.setDisplayMode('livePreview');

      const activeLine = [...parent.querySelectorAll<HTMLElement>('.cm-line')].find(
        (line) => line.textContent?.includes(activeText),
      );
      expect(
        [...(activeLine?.querySelectorAll('.lm-md-source-mark') ?? [])].map(
          (marker) => marker.textContent,
        ),
      ).toEqual([...expectedLiveMarks]);

      editor.destroy();
      parent.remove();
    },
  );

  it('keeps ordinary active source marks hidden only while reading', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**active strong**';
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('strong')),
    });

    expect(parent.querySelectorAll('.lm-md-source-mark-inline')).toHaveLength(2);

    editor.setDisplayMode('reading');

    expect(parent.querySelector('.lm-md-source-mark')).toBeNull();
    expect(parent.textContent).toContain('active strong');

    editor.setDisplayMode('livePreview');

    expect(parent.querySelectorAll('.lm-md-source-mark-inline')).toHaveLength(2);
    expect(editor.getDocumentText()).toBe(doc);

    editor.destroy();
    parent.remove();
  });

  it('adds stable line classes for unordered and task list preview rows', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- item', '- [ ] task', '', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.querySelector('.lm-md-unordered-list-line')).not.toBeNull();
    expect(parent.querySelector('.lm-md-task-list-line')).not.toBeNull();
    expect(parent.querySelector('.lm-md-list-bullet')).not.toBeNull();
    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders task checkbox widgets without changing source text', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('exposes task checkboxes to assistive technology and keyboard input', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    expect(checkbox).not.toBeNull();
    expect(checkbox?.type).toBe('checkbox');
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.tabIndex).toBe(0);
    expect(checkbox?.getAttribute('aria-label')).toBe(
      'Toggle task completion',
    );

    checkbox?.focus();
    expect(document.activeElement).toBe(checkbox);
    checkbox?.click();
    expect(view.state.doc.toString()).toBe('- [x] task\n\nplain');

    const checkedCheckbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );
    expect(checkedCheckbox?.checked).toBe(true);
    checkedCheckbox?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }),
    );
    expect(view.state.doc.toString()).toBe('- [ ] task\n\nplain');

    view.destroy();
    parent.remove();
  });

  it('keeps the task checkbox DOM and focus across repeated toggles', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    checkbox.focus();
    checkbox.click();

    expect(view.state.doc.toString()).toBe('- [x] task\n\nplain');
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.checked).toBe(true);

    checkbox.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }),
    );

    expect(view.state.doc.toString()).toBe('- [ ] task\n\nplain');
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.checked).toBe(false);

    checkbox.click();

    expect(view.state.doc.toString()).toBe('- [x] task\n\nplain');
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    expect(document.activeElement).toBe(checkbox);

    view.destroy();
    parent.remove();
  });

  it('dispatches one task checkbox state-character change without moving selection', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const documentChanges: {
      fromA: number;
      fromB: number;
      inserted: string;
      toA: number;
      toB: number;
    }[][] = [];
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            const changes: (typeof documentChanges)[number] = [];
            update.changes.iterChanges(
              (fromA, toA, fromB, toB, inserted) => {
                changes.push({
                  fromA,
                  fromB,
                  inserted: inserted.toString(),
                  toA,
                  toB,
                });
              },
            );
            documentChanges.push(changes);
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const selectionBefore = view.state.selection.toJSON();

    parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    )?.click();

    expect(documentChanges).toEqual([
      [
        {
          fromA: 3,
          fromB: 3,
          inserted: 'x',
          toA: 4,
          toB: 4,
        },
      ],
    ]);
    expect(view.state.selection.toJSON()).toEqual(selectionBefore);

    view.destroy();
    parent.remove();
  });

  it('disables task checkbox widgets in read-only editors', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          EditorState.readOnly.of(true),
        ],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    expect(checkbox?.disabled).toBe(true);
    checkbox?.click();
    expect(view.state.doc.toString()).toBe(doc);
    expect(checkbox?.checked).toBe(false);

    view.destroy();
    parent.remove();
  });

  it('keeps markdown syntax hidden under the caret while read-only', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '**first** and **second**';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          EditorState.readOnly.of(true),
        ],
        selection: EditorSelection.cursor(doc.indexOf('first') + 1),
      }),
    });

    expect(parent.textContent).not.toContain('**first**');
    expect(parent.textContent).toContain('first');
    expect(parent.textContent).toContain('second');

    view.destroy();
    parent.remove();
  });

  it('re-hides revealed syntax when the editor becomes read-only', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const readOnly = new Compartment();
    const doc = '**first** and **second**';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          readOnly.of(EditorState.readOnly.of(false)),
        ],
        selection: EditorSelection.cursor(doc.indexOf('first') + 1),
      }),
    });

    expect(parent.textContent).toContain('**first**');

    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(true)),
    });

    expect(parent.textContent).not.toContain('**first**');
    expect(parent.textContent).toContain('first');

    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(false)),
    });

    expect(parent.textContent).toContain('**first**');

    view.destroy();
    parent.remove();
  });

  it('updates a task checkbox when read-only is reconfigured', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const readOnly = new Compartment();
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          readOnly.of(EditorState.readOnly.of(false)),
        ],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(true)),
    });

    expect(checkbox.disabled).toBe(true);
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);

    view.dispatch({
      effects: readOnly.reconfigure(EditorState.readOnly.of(false)),
    });

    expect(checkbox.disabled).toBe(false);
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);

    view.destroy();
    parent.remove();
  });

  it('updates a task checkbox aria-label after phrases are reconfigured', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const phrases = new Compartment();
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          phrases.of(
            EditorState.phrases.of({
              'Toggle task completion': 'Toggle completion',
            }),
          ),
        ],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    checkbox.focus();
    view.dispatch({
      effects: phrases.reconfigure(
        EditorState.phrases.of({
          'Toggle task completion': '切换任务完成状态',
        }),
      ),
    });
    await Promise.resolve();

    expect(checkbox.getAttribute('aria-label')).toBe('切换任务完成状态');
    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    expect(document.activeElement).toBe(checkbox);

    view.destroy();
    parent.remove();
  });

  it('restores task checkbox recycle focus without a later focus decision', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    checkbox.focus();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('plain')),
    });

    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    await Promise.resolve();
    expect(document.activeElement).toBe(checkbox);

    view.destroy();
    parent.remove();
  });

  it('does not steal a later focus decision during task checkbox recycle', async () => {
    const parent = document.createElement('div');
    const button = document.createElement('button');
    document.body.append(parent, button);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    checkbox.focus();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('plain')),
    });

    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    button.focus();
    expect(document.activeElement).toBe(button);

    await Promise.resolve();

    expect(document.activeElement).toBe(button);

    view.destroy();
    parent.remove();
    button.remove();
  });

  it('does not restore task checkbox recycle focus over an existing control focus', async () => {
    const parent = document.createElement('div');
    const button = document.createElement('button');
    document.body.append(parent, button);
    const doc = '- [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const checkbox = parent.querySelector<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    );

    if (!checkbox) {
      throw new Error('Expected a task checkbox widget.');
    }

    checkbox.focus();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });
    button.focus();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('plain')),
    });

    expect(parent.querySelector('input.lm-md-task-checkbox')).toBe(checkbox);
    expect(document.activeElement).toBe(button);

    await Promise.resolve();

    expect(document.activeElement).toBe(button);

    view.destroy();
    parent.remove();
    button.remove();
  });

  it('keeps a mapped task checkbox bound to its current marker position', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- [ ] first', '- [ ] second', '', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });
    const secondCheckbox = parent.querySelectorAll<HTMLInputElement>(
      'input.lm-md-task-checkbox',
    )[1];

    if (!secondCheckbox) {
      throw new Error('Expected the second task checkbox widget.');
    }

    view.dispatch({
      changes: { from: 0, insert: 'intro\n' },
    });

    expect(
      parent.querySelectorAll<HTMLInputElement>(
        'input.lm-md-task-checkbox',
      )[1],
    ).toBe(secondCheckbox);

    secondCheckbox.click();

    expect(view.state.doc.toString()).toBe(
      ['intro', '- [ ] first', '- [x] second', '', 'plain'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('replaces an inactive task marker once and restores source for its active list item', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '- [ ] task\n\nplain';
    const taskPosition = doc.indexOf('task');
    const plainPosition = doc.indexOf('plain');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(plainPosition),
      }),
    });

    const taskLine = parent.querySelector('.lm-md-task-list-line');
    expect(taskLine?.textContent).not.toContain('[ ]');
    expect(
      taskLine?.querySelectorAll('input.lm-md-task-checkbox'),
    ).toHaveLength(1);

    view.dispatch({
      selection: EditorSelection.cursor(taskPosition),
    });

    expect(
      parent.querySelector('.lm-md-task-list-line')?.textContent,
    ).toContain('- [ ] task');
    expect(
      parent.querySelector('.lm-md-task-checkbox'),
    ).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders ordered task checkbox widgets', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '1. [ ] task\n\nplain';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('does not render task checkbox widgets inside fenced code blocks', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ['```md', '- [ ] literal task', '```'].join('\n'),
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });

    expect(parent.querySelector('.lm-md-task-checkbox')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders nested unordered list markers as preview bullets off the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- top', '  - nested', '', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.querySelectorAll('.lm-md-list-bullet')).toHaveLength(2);
    expect(parent.querySelector('.lm-md-unordered-list-line')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps source markers visible on the active list quote and code lines', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- item', '> quote', '```ts', 'const x = 1', '```'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(1),
      }),
    });

    expect(parent.querySelector('.lm-md-list-bullet')).toBeNull();
    expect(parent.textContent).toContain('- item');

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('quote')),
    });
    expect(parent.textContent).toContain('> quote');

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('```ts')),
    });
    expect(parent.textContent).toContain('```ts');

    view.destroy();
    parent.remove();
  });

  it('hides link quote and fenced code markdown marks away from the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = [
      '> quote',
      '[Luma](https://example.com)',
      '```ts',
      'const x = 1',
      '```',
      'plain',
    ].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.textContent).toContain('quote');
    expect(parent.textContent).toContain('Luma');
    expect(parent.textContent).toContain('const x = 1');
    expect(parent.textContent).not.toContain('> quote');
    expect(parent.textContent).not.toContain('[Luma]');
    expect(parent.textContent).not.toContain('https://example.com');
    expect(parent.textContent).not.toContain('```');

    view.destroy();
    parent.remove();
  });
});

describe('task list commands', () => {
  it('toggles an unchecked task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '- [ ] task',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(3),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected unchecked task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('- [x] task');
  });

  it('toggles a checked task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '- [x] task',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(4),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected checked task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('- [ ] task');
  });

  it('toggles an ordered task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '1. [ ] task',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(5),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected ordered task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('1. [x] task');
  });

  it('does not toggle bracket text that is not a task list marker', () => {
    const state = EditorState.create({
      doc: 'plain [ ] text',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(7),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });

  it('does not toggle a task marker without a following space', () => {
    const state = EditorState.create({
      doc: '- [ ]literal',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(3),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });

  it('does not toggle task-like text inside fenced code blocks', () => {
    const state = EditorState.create({
      doc: ['```md', '- [ ] literal task', '```'].join('\n'),
      extensions: [markdownLanguage(), markdownWysiwygExtension()],
      selection: EditorSelection.cursor(9),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });
});
