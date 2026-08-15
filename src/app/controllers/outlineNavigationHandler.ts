import type { OutlineHeading } from '../../features/outline/outlineParser';

type OutlineNavigationHandlerOptions = {
  isCurrentHeading: (heading: OutlineHeading) => boolean;
  revealPosition: (position: number) => void;
};

export function createOutlineNavigationHandler({
  isCurrentHeading,
  revealPosition,
}: OutlineNavigationHandlerOptions) {
  return (heading: OutlineHeading) => {
    if (isCurrentHeading(heading)) {
      revealPosition(heading.from);
    }
  };
}
