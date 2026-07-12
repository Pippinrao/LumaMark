import type { OutlineHeading } from './outlineParser';

export function getActiveOutlineHeadingFrom(
  headings: readonly OutlineHeading[],
  position: number,
): number | null {
  let activeHeadingFrom: number | null = null;

  for (const heading of headings) {
    if (heading.from > position) {
      break;
    }

    activeHeadingFrom = heading.from;
  }

  return activeHeadingFrom;
}
