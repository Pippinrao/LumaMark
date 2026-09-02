import type { Page } from '@playwright/test';

type SeededPageWidth = 'adaptive' | 'fluid' | 'narrow' | 'standard' | 'wide';

const PAGE_WIDTH_CSS: Record<SeededPageWidth, string> = {
  adaptive: 'clamp(720px, 70%, 1100px)',
  fluid: '100%',
  narrow: '680px',
  standard: '810px',
  wide: '1040px',
};

/**
 * Persist a complete, valid settings document before the first navigation so
 * visual and scroll tests do not depend on the fluid default, and so the
 * loader does not treat the seed as invalid-field recovery.
 */
export async function seedBrowserPageWidth(
  page: Page,
  pageWidth: SeededPageWidth,
): Promise<void> {
  await page.addInitScript(
    ({ width }) => {
      window.localStorage.setItem(
        'lumamark.settings.v1',
        JSON.stringify({
          appearance: {
            fontZoomPercent: 100,
            pageWidth: width,
            sidebarOpenOnStartup: true,
            theme: 'light',
          },
          editor: {
            autosaveEnabled: false,
            defaultDisplayMode: 'livePreview',
            focusModeOnStartup: false,
          },
          general: {
            language: 'zh-CN',
            openWindowMode: 'multiWindow',
            startupBehavior: 'home',
          },
          images: { copyImagesToAssets: false },
          markdown: {
            math: {
              equationNumbering: 'none',
              physicsEnabled: false,
              syntaxMode: 'pandoc',
            },
            plantuml: { enabled: true },
          },
          updates: { autoCheckOnStartup: true },
          version: 5,
        }),
      );
      window.localStorage.setItem(
        'lumamark.reading-appearance.v1',
        JSON.stringify({
          state: { pageWidth: width },
          version: 1,
        }),
      );
    },
    { width: pageWidth },
  );
}

export async function waitForEditorPageWidthCss(
  page: Page,
  pageWidth: SeededPageWidth,
): Promise<void> {
  const expectedCss = PAGE_WIDTH_CSS[pageWidth];
  await page.waitForFunction((css) => {
    const editor = document.querySelector('.cm-editor');
    return (
      editor instanceof HTMLElement &&
      getComputedStyle(editor)
        .getPropertyValue('--lm-editor-page-width')
        .trim() === css
    );
  }, expectedCss);
}
