import type { MathLayoutMetrics } from './mathWorkerProtocol';

/** Typical overlay scrollbar widths sit in this band and must not retrigger MathJax. */
export const MATH_LAYOUT_SCROLLBAR_WIDTH_PX = 20;

export function sameLayoutMetrics(
  left: MathLayoutMetrics,
  right: MathLayoutMetrics,
): boolean {
  return (
    left.em === right.em &&
    left.ex === right.ex &&
    Math.abs(left.containerWidth - right.containerWidth) <=
      MATH_LAYOUT_SCROLLBAR_WIDTH_PX
  );
}

export function quantizeLayoutMetrics(
  metrics: MathLayoutMetrics,
  previous?: MathLayoutMetrics,
): MathLayoutMetrics {
  if (previous && sameLayoutMetrics(previous, metrics)) {
    return previous;
  }

  return metrics;
}
