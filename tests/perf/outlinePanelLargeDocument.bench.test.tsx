import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from '../../src/features/outline/OutlinePanel';
import { parseMarkdownOutline } from '../../src/features/outline/outlineParser';
import { i18n } from '../../src/shared/i18n';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';

const outlineRenderBudgetsMs: Record<string, number> = {
  'large-1mb.md': 60,
  'large-5mb.md': 60,
  'large-10mb.md': 60,
};

const maxInitialRenderedOutlineItems = 64;
const outlinePanelTestRect = {
  height: 520,
  width: 240,
};

let originalOffsetHeight:
  | PropertyDescriptor
  | undefined;
let originalOffsetWidth:
  | PropertyDescriptor
  | undefined;

describe('large Markdown outline panel render baseline', () => {
  beforeAll(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight',
    );
    originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth',
    );

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains('lm-outline-list')) {
          return outlinePanelTestRect.height;
        }

        return originalOffsetHeight?.get?.call(this) ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains('lm-outline-list')) {
          return outlinePanelTestRect.width;
        }

        return originalOffsetWidth?.get?.call(this) ?? 0;
      },
    });
  });

  afterAll(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    }

    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetWidth',
        originalOffsetWidth,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
    }
  });

  afterEach(() => {
    cleanup();
  });

  it.each(largeMarkdownFixturePaths)(
    'renders $name outline headings without freezing',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
      const headings = parseMarkdownOutline(source);
      const onSelectHeading = vi.fn();

      const startedAt = performance.now();
      const { container } = render(
        <I18nextProvider i18n={i18n}>
          <OutlinePanel headings={headings} onSelectHeading={onSelectHeading} />
        </I18nextProvider>,
      );
      await waitFor(() => {
        expect(container.querySelectorAll('.lm-outline-item').length).toBeGreaterThan(
          0,
        );
      });
      const renderDurationMs = performance.now() - startedAt;
      const renderedItemCount =
        container.querySelectorAll('.lm-outline-item').length;

      process.stdout.write(
        `[perf:outline-panel] ${name}: render ${renderedItemCount}/${headings.length} headings in ${renderDurationMs.toFixed(2)} ms\n`,
      );

      expect(headings.length).toBeGreaterThan(0);
      expect(renderedItemCount).toBeGreaterThan(0);
      expect(renderedItemCount).toBeLessThan(headings.length);
      expect(renderedItemCount).toBeLessThanOrEqual(maxInitialRenderedOutlineItems);
      fireEvent.click(screen.getByRole('button', { name: headings[0].text }));
      expect(onSelectHeading).toHaveBeenCalledWith(headings[0]);
      expect(renderDurationMs).toBeLessThan(outlineRenderBudgetsMs[name]);
    },
  );
});
