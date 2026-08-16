import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { MathFormulaInput } from './mathWorkerProtocol';

export type MathSourceRange = {
  readonly from: number;
  readonly to: number;
};

export type MathInventoryFormula = MathFormulaInput & {
  readonly contentRanges: readonly MathSourceRange[];
  readonly delimiterRanges: readonly MathSourceRange[];
  readonly from: number;
  readonly to: number;
};

type MarkdownSyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>['resolveInner']
>;

export function collectMathInventory(
  state: EditorState,
): MathInventoryFormula[] {
  const formulas: MathInventoryFormula[] = [];

  syntaxTree(state).iterate({
    enter(cursor) {
      if (cursor.name === 'MathBlock') {
        const formula = formulaFromBlock(state, cursor.node);
        if (formula) {
          formulas.push(formula);
        }
        return false;
      }

      if (cursor.name === 'InlineMath') {
        const formula = formulaFromInline(state, cursor.node);
        if (formula) {
          formulas.push(formula);
        }
        return false;
      }
    },
  });

  return formulas
    .sort((left, right) => left.from - right.from)
    .map((formula, index) => ({
      ...formula,
      id: `math:${formula.display ? 'block' : 'inline'}:${index}`,
    }));
}

function formulaFromBlock(
  state: EditorState,
  node: MarkdownSyntaxNode,
): MathInventoryFormula | null {
  const delimiterRanges: MathSourceRange[] = [];
  const contentRanges: MathSourceRange[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'MathMark') {
      delimiterRanges.push({ from: child.from, to: child.to });
    } else if (child.name === 'MathText') {
      contentRanges.push({ from: child.from, to: child.to });
    }
  }

  if (delimiterRanges.length !== 2) {
    return null;
  }

  return {
    contentRanges,
    delimiterRanges,
    display: true,
    from: node.from,
    id: `math:block:${node.from}`,
    source: contentRanges
      .map(({ from, to }) => state.doc.sliceString(from, to))
      .join('\n'),
    to: node.to,
  };
}

function formulaFromInline(
  state: EditorState,
  node: MarkdownSyntaxNode,
): MathInventoryFormula | null {
  const delimiterRanges: MathSourceRange[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'MathMark') {
      delimiterRanges.push({ from: child.from, to: child.to });
    }
  }

  if (delimiterRanges.length !== 2) {
    return null;
  }

  const contentRanges = [{
    from: delimiterRanges[0].to,
    to: delimiterRanges[1].from,
  }];

  return {
    contentRanges,
    delimiterRanges,
    display: false,
    from: node.from,
    id: `math:inline:${node.from}`,
    source: state.doc.sliceString(contentRanges[0].from, contentRanges[0].to),
    to: node.to,
  };
}
