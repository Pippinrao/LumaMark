import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import {
  measureOutlineContentWidth,
  measureOutlineLabel,
} from './outlineContentWidth';
import type { OutlineHeading } from './outlineParser';

type OutlinePanelProps = {
  headings: readonly OutlineHeading[];
  onContentWidthChange?: (contentWidth: number) => void;
  onSelectHeading: (heading: OutlineHeading) => void;
};

const OUTLINE_ITEM_HEIGHT_PX = 28;
const OUTLINE_OVERSCAN = 4;
const OUTLINE_INITIAL_RECT = {
  height: 520,
  width: 240,
};

export function OutlinePanel({
  headings,
  onContentWidthChange,
  onSelectHeading,
}: OutlinePanelProps) {
  const { t } = useTranslation();
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns scroll measurement state.
  const outlineVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: headings.length,
    estimateSize: () => OUTLINE_ITEM_HEIGHT_PX,
    getItemKey: (index) => {
      const heading = headings[index];

      return heading ? `${heading.from}:${heading.to}` : index;
    },
    getScrollElement: () => scrollParentRef.current,
    initialRect: OUTLINE_INITIAL_RECT,
    overscan: OUTLINE_OVERSCAN,
  });

  useEffect(() => {
    if (!onContentWidthChange) {
      return;
    }

    onContentWidthChange(
      measureOutlineContentWidth(headings, measureOutlineLabel),
    );
  }, [headings, onContentWidthChange]);

  return (
    <section className="lm-outline" aria-label={t('outline.title')}>
      <div className="lm-sidebar-section-header">
        <span>{t('outline.title')}</span>
      </div>
      {headings.length ? (
        <div
          ref={scrollParentRef}
          className="lm-outline-list"
          role="list"
          aria-label={t('outline.title')}
        >
          <div
            className="lm-outline-virtual-spacer"
            style={{ height: `${outlineVirtualizer.getTotalSize()}px` }}
          >
            {outlineVirtualizer.getVirtualItems().map((virtualItem) => {
              const heading = headings[virtualItem.index];

              if (!heading) {
                return null;
              }

              return (
                <div
                  key={String(virtualItem.key)}
                  className="lm-outline-row"
                  role="listitem"
                  aria-posinset={virtualItem.index + 1}
                  aria-setsize={headings.length}
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    className="lm-outline-item"
                    style={{
                      paddingLeft: `${(heading.level - 1) * 12 + 8}px`,
                    }}
                    onClick={() => {
                      onSelectHeading(heading);
                    }}
                  >
                    {heading.text}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="lm-sidebar-empty">{t('outline.empty')}</div>
      )}
    </section>
  );
}
