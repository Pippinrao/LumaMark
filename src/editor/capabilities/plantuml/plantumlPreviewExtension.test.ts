import { EditorSelection, EditorState } from '@codemirror/state';
import { type DecorationSet, EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import { PlantumlBlockWidget, plantumlBlockGeometryKey } from './PlantumlBlockWidget';
import { plantumlPreviewExtension } from './plantumlPreviewExtension';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';

const collectPlantumlBlocksSpy = vi.hoisted(() => vi.fn());

vi.mock('./plantumlBlockDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plantumlBlockDetection')>();

  return {
    ...actual,
    collectPlantumlBlocksInRanges: (
      ...args: Parameters<typeof actual.collectPlantumlBlocksInRanges>
    ) => {
      collectPlantumlBlocksSpy(...args);
      return actual.collectPlantumlBlocksInRanges(...args);
    },
  };
});

function createView(doc: string, scheduler: PlantumlRenderScheduler) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        plantumlPreviewExtension({ scheduler }),
      ],
      selection: EditorSelection.cursor(doc.length),
    }),
  });

  return { parent, view };
}

function plantumlDecorationSet(view: EditorView): DecorationSet {
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === 'function' ? source(view) : source;
    let includesPlantumlWidget = false;

    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof PlantumlBlockWidget) {
        includesPlantumlWidget = true;
      }
    });

    if (includesPlantumlWidget) {
      return decorations;
    }
  }

  throw new Error('Expected a PlantUML decoration set.');
}

function plantumlWidgets(view: EditorView): PlantumlBlockWidget[] {
  const widgets: PlantumlBlockWidget[] = [];

  plantumlDecorationSet(view).between(
    0,
    view.state.doc.length,
    (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof PlantumlBlockWidget) {
        widgets.push(decoration.spec.widget);
      }
    },
  );

  return widgets;
}

describe('plantumlPreviewExtension hot path', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('does not recollect or recreate PlantUML widgets for a selection-only transaction', () => {
    const doc = [
      '```plantuml',
      '@startuml',
      'A -> B',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n');
    const scheduler = new PlantumlRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    const initialDecorations = plantumlDecorationSet(view);
    const initialWidget = plantumlWidgets(view)[0];
    collectPlantumlBlocksSpy.mockClear();

    view.dispatch({ selection: EditorSelection.cursor(0) });

    expect(collectPlantumlBlocksSpy).not.toHaveBeenCalled();
    expect(plantumlDecorationSet(view)).toBe(initialDecorations);
    expect(plantumlWidgets(view)[0]).toBe(initialWidget);

    view.destroy();
    parent.remove();
  });

  it('maps existing widgets without recollecting after a non-plantuml edit at the document end', () => {
    const tail = Array.from({ length: 2_000 }, (_, index) => `plain ${index}`).join(
      '\n',
    );
    const doc = [
      '```plantuml',
      '@startuml',
      'A -> B',
      '@enduml',
      '```',
      '',
      tail,
    ].join('\n');
    const scheduler = new PlantumlRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    const initialWidget = plantumlWidgets(view)[0];
    collectPlantumlBlocksSpy.mockClear();

    view.dispatch({
      changes: { from: doc.length, insert: '!' },
    });

    expect(collectPlantumlBlocksSpy.mock.calls).toHaveLength(1);
    expect(collectPlantumlBlocksSpy.mock.calls[0]?.[1]).toEqual([
      { from: doc.length, to: doc.length + 1 },
    ]);
    expect(plantumlWidgets(view)[0]).toBe(initialWidget);

    view.destroy();
    parent.remove();
  });

  it('keeps the cached estimated height while a PlantUML render is in flight', () => {
    const block = {
      blockId: '0:40',
      content: '@startuml\nA -> B\n@enduml',
      contentFrom: 12,
      contentTo: 36,
      fence: '```',
      from: 0,
      info: 'plantuml',
      language: 'plantuml' as const,
      to: 40,
    };
    const geometryKey = plantumlBlockGeometryKey(block);
    const cache = new BlockWidgetGeometryCache();
    cache.record(geometryKey, 144, 48);

    const widget = new PlantumlBlockWidget(
      block,
      new PlantumlRenderScheduler({
        debounceMs: 0,
        render: () => new Promise<string>(() => {}),
      }),
      {},
      'default',
      false,
      cache,
      geometryKey,
    );

    expect(widget.estimatedHeight).toBe(144);
  });
});
