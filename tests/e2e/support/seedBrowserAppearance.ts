import type { Page } from '@playwright/test';

type SeededPageWidth = 'adaptive' | 'fluid' | 'narrow' | 'standard' | 'wide';

/**
 * Persist a page-width choice before the first navigation so visual and
 * scroll tests do not depend on the adaptive default.
 */
export async function seedBrowserPageWidth(
  page: Page,
  pageWidth: SeededPageWidth,
): Promise<void> {
  await page.addInitScript((width) => {
    window.localStorage.setItem(
      'lumamark.settings.v1',
      JSON.stringify({
        appearance: { pageWidth: width },
        version: 4,
      }),
    );
  }, pageWidth);
}
