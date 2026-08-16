import type { MathInventoryFormula } from './mathInventory';
import type { MathRenderSessionSnapshot } from './mathRenderSession';

const SCOPED_EQUATION_HREF =
  /^#lm-math-[a-z0-9]+-mjx-eqn%3a\d+$/iu;

export function isScopedMathEquationHref(href: string): boolean {
  return SCOPED_EQUATION_HREF.test(href);
}

export function resolveMathRefPosition(
  href: string,
  snapshot: MathRenderSessionSnapshot,
  inventory: readonly MathInventoryFormula[],
): number | null {
  if (!isScopedMathEquationHref(href)) {
    return null;
  }

  const equationId = decodeURIComponent(href.slice(1));
  const renderedFormulas = snapshot.result?.formulas
    ?? [...snapshot.lastSuccessfulFormulas.values()];
  const rendered = renderedFormulas.find((formula) =>
    formula.chtml?.includes(`id="${equationId}"`),
  );
  if (!rendered) {
    return null;
  }

  const live = inventory.find((formula) => formula.id === rendered.id);
  return live?.from ?? null;
}
