import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';
import { seedBrowserPageWidth } from './support/seedBrowserAppearance';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';
import {
  createManyTablesDocument,
  MANY_TABLES_OPEN_COUNT,
} from '../fixtures/manyTablesDocument';

const MANY_TABLES_OPEN_BUDGET_MS = 800;

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await openBlankDocument(page);
}

test.describe('many-table file open', () => {
  for (const pageWidth of ['adaptive', 'standard'] as const) {
    test(`loads ${MANY_TABLES_OPEN_COUNT} tables at ${pageWidth} width without a long main-thread stall`, async ({
      page,
    }) => {
      await seedBrowserPageWidth(page, pageWidth);
      await openNewDocument(page);

      const editor = page.locator('.cm-content').first();
      await editor.click();
      await installRootEditorViewTestBridge(editor);

      const source = createManyTablesDocument();
      const durationMs = await editor.evaluate((content, markdown) => {
        const bridge = content as RootEditorContentTestBridge;
        const view = bridge.resolveRootEditorViewForTest();
        const startedAt = performance.now();
        view.dispatch({
          changes: {
            from: 0,
            insert: markdown,
            to: view.state.doc.length,
          },
          selection: { anchor: 0 },
        });
        return performance.now() - startedAt;
      }, source);

      await expect(page.locator('.tbl-table-widget').first()).toBeVisible();
      expect(
        durationMs,
        `${pageWidth} many-table dispatch took ${durationMs.toFixed(1)} ms`,
      ).toBeLessThan(MANY_TABLES_OPEN_BUDGET_MS);
    });
  }
});
