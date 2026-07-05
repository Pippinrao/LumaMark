import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { type Diagnostic, linter } from '@codemirror/lint';

const diagramTypes = [
  'flowchart TD',
  'flowchart LR',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'journey',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
] as const;

const keywords = [
  'participant',
  'actor',
  'loop',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'end',
  'subgraph',
  'direction',
  'classDef',
  'style',
] as const;

export const mermaidSnippets: readonly Completion[] = [
  snippetCompletion(
    ['flowchart TD', '  ${1:A}[${2:Start}] --> ${3:B}{${4:Decision}}', '  ${3:B} --> ${5:C}[${6:Done}]'].join('\n'),
    {
      label: 'flowchart with decision',
      type: 'function',
    },
  ),
  snippetCompletion(
    ['sequenceDiagram', '  participant ${1:A}', '  participant ${2:B}', '  ${1:A}->>${2:B}: ${3:Message}'].join('\n'),
    {
      label: 'sequence with participants',
      type: 'function',
    },
  ),
];

const completionOptions: readonly Completion[] = [
  ...diagramTypes.map<Completion>((label) => ({
    detail: 'diagram',
    label,
    type: 'keyword',
  })),
  ...keywords.map<Completion>((label) => ({
    detail: 'keyword',
    label,
    type: 'keyword',
  })),
  ...mermaidSnippets,
];

export function mermaidLanguageExtension(): Extension {
  return [
    autocompletion({
      activateOnTyping: true,
      override: [mermaidCompletionSource],
    }),
    linter((view) => getMermaidDiagnostics(view.state.doc.toString()), {
      delay: 250,
    }),
  ];
}

export function getMermaidCompletions(
  text: string,
  position = text.length,
): CompletionResult {
  const word = text.slice(0, position).match(/[\w-]*$/);

  return {
    from: position - (word?.[0].length ?? 0),
    options: completionOptions,
    validFor: /^[\w-]*$/,
  };
}

export function getMermaidDiagnostics(source: string): Diagnostic[] {
  const trimmed = source.trim();

  if (!trimmed) {
    return [
      {
        from: 0,
        message: 'Add a Mermaid diagram type.',
        severity: 'warning',
        to: 0,
      },
    ];
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const hasKnownDiagramType = diagramTypes.some((type) => {
    const root = type.split(/\s+/, 1)[0];

    return firstLine === root || firstLine.startsWith(`${root} `);
  });

  if (!hasKnownDiagramType) {
    return [
      {
        from: 0,
        message: 'Start with a Mermaid diagram type.',
        severity: 'error',
        to: Math.max(firstLine.length, 1),
      },
    ];
  }

  const diagnostics: Diagnostic[] = [];
  const openBlocks = source.match(/^\s*(?:loop|alt|opt|par|critical|break)\b/gm)?.length ?? 0;
  const closedBlocks = source.match(/^\s*end\s*$/gm)?.length ?? 0;

  if (openBlocks > closedBlocks) {
    diagnostics.push({
      from: Math.max(source.length - 1, 0),
      message: 'Add an end line for the open Mermaid block.',
      severity: 'warning',
      to: source.length,
    });
  }

  return diagnostics;
}

function mermaidCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const before = context.matchBefore(/[\w-]*$/);

  if (!context.explicit && (!before || before.from === before.to)) {
    return null;
  }

  return getMermaidCompletions(
    context.state.doc.toString(),
    context.pos,
  );
}
