import { describe, expect, it } from 'vitest';
import { PlantumlBlockWidget } from './PlantumlBlockWidget';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';

describe('PlantUML preview pointer ownership', () => {
  it('asks CodeMirror to ignore pointer events so a preview click cannot move the caret', () => {
    const widget = new PlantumlBlockWidget(
      {
        blockId: '0:40',
        content: '@startuml\nA -> B\n@enduml',
        contentFrom: 12,
        contentTo: 36,
        fence: '```',
        from: 0,
        info: 'plantuml',
        language: 'plantuml',
        to: 40,
      },
      new PlantumlRenderScheduler({
        debounceMs: 0,
        render: async () => '<svg></svg>',
      }),
      {},
      'default',
    );

    expect(widget.ignoreEvent()).toBe(true);
  });
});
