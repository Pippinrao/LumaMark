import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { installResizeObserverStub } from '../../test/resizeObserverStub';
import { OutlinePanel } from './OutlinePanel';
import {
  OUTLINE_INDENT_WIDTH,
  measureOutlineContentWidth,
  measureOutlineLabel,
} from './outlineContentWidth';
import type { OutlineHeading } from './outlineParser';

function heading(
  text: string,
  level: OutlineHeading['level'],
): OutlineHeading {
  return {
    from: 0,
    id: text,
    level,
    line: 1,
    text,
    to: text.length,
  };
}

describe('OutlinePanel content width', () => {
  beforeEach(() => {
    installResizeObserverStub();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(260);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports heading labels plus indent using outline chrome, not file-tree chrome', async () => {
    const onContentWidthChange = vi.fn();
    const headings = [
      heading('Intro', 1),
      heading('A nested section with a long title', 3),
    ];

    render(
      <I18nProvider>
        <OutlinePanel
          headings={headings}
          onContentWidthChange={onContentWidthChange}
          onSelectHeading={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(onContentWidthChange).toHaveBeenCalled();
    });

    expect(onContentWidthChange).toHaveBeenLastCalledWith(
      measureOutlineContentWidth(headings, measureOutlineLabel),
    );
    expect(measureOutlineContentWidth(headings, measureOutlineLabel)).toBe(
      measureOutlineLabel('A nested section with a long title') +
        2 * OUTLINE_INDENT_WIDTH,
    );
  });
});
