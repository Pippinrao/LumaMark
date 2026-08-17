import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

type HorizontalBounds = {
  left: number;
  right: number;
  width: number;
};

type RootEditorContent = HTMLElement & {
  cmTile?: {
    root?: {
      view?: {
        focus(): void;
        state: { doc: { toString(): string } };
      };
    };
  };
};

const DESKTOP_SAFE_GUTTER_PX = 48;
const MOBILE_SAFE_GUTTER_PX = 18;
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function startDocument(page: Page): Promise<void> {
  await page.goto('/');
  await openBlankDocument(page);
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function horizontalBounds(locator: Locator): Promise<HorizontalBounds> {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Expected reading appearance geometry to be measurable.');
  }

  return {
    left: box.x,
    right: box.x + box.width,
    width: box.width,
  };
}

async function choosePageWidth(
  page: Page,
  label: '宽' | '标准' | '窄' | '适应窗口',
): Promise<void> {
  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('tab', { name: '外观' }).click();
  await page
    .getByRole('radiogroup', { name: '页面宽度' })
    .getByRole('radio', { name: label, exact: true })
    .click();
  await page.getByRole('button', { name: '关闭' }).click();
}

async function expectContentWidth(
  page: Page,
  expectedWidth: number,
): Promise<void> {
  await expect
    .poll(async () => (await horizontalBounds(page.locator('.cm-content'))).width)
    .toBeCloseTo(expectedWidth, 0);
}

async function readEditorSource(editor: Locator): Promise<string> {
  return editor.evaluate((content) => {
    const view = (content as RootEditorContent).cmTile?.root?.view;

    if (!view || typeof view.state?.doc?.toString !== 'function') {
      throw new Error('CodeMirror root view is unavailable.');
    }

    return view.state.doc.toString();
  });
}

async function readViewportAnchor(scroller: Locator): Promise<{
  text: string | null;
  top: number | null;
}> {
  return scroller.evaluate((element) => {
    const scrollerBounds = element.getBoundingClientRect();
    const firstVisibleLine = [
      ...element.querySelectorAll<HTMLElement>('.cm-line'),
    ].find((line) => line.getBoundingClientRect().bottom > scrollerBounds.top);

    if (!firstVisibleLine) {
      return { text: null, top: null };
    }

    return {
      text: firstVisibleLine.textContent,
      top: firstVisibleLine.getBoundingClientRect().top - scrollerBounds.top,
    };
  });
}

async function dispatchPrimaryWheelSteps(
  scroller: Locator,
  deltaY: number,
  count: number,
): Promise<void> {
  await scroller.evaluate(
    (element, options) => {
      const timestamps = element as HTMLElement & {
        dataset: DOMStringMap & { lmE2eWheelTime?: string };
      };
      let timeStamp = timestamps.dataset.lmE2eWheelTime
        ? Number(timestamps.dataset.lmE2eWheelTime) + 80
        : performance.now() + 1_000;

      for (let index = 0; index < options.count; index += 1) {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: options.primaryModifier === 'Control',
          deltaY: options.deltaY,
          metaKey: options.primaryModifier === 'Meta',
        });
        Object.defineProperty(event, 'timeStamp', { value: timeStamp });
        element.dispatchEvent(event);
        timeStamp += 80;
      }

      timestamps.dataset.lmE2eWheelTime = String(timeStamp - 80);
    },
    {
      count,
      deltaY,
      primaryModifier,
    },
  );
}

test('enforces real page-width caps and safe gutters across viewport sizes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await startDocument(page);

  const sidebar = page.locator('.lm-sidebar-panel');
  const pane = page.locator('.lm-editor-pane');
  const editor = page.locator('.cm-editor');
  const scroller = page.locator('.cm-scroller');
  const content = page.locator('.cm-content');

  const assertContainedGeometry = async (expectedContentWidth: number) => {
    const [sidebarBounds, paneBounds, editorBounds, scrollerBounds, contentBounds] =
      await Promise.all([
        horizontalBounds(sidebar),
        horizontalBounds(pane),
        horizontalBounds(editor),
        horizontalBounds(scroller),
        horizontalBounds(content),
      ]);

    expect(sidebarBounds.right).toBeLessThanOrEqual(paneBounds.left + 1);
    expect(editorBounds.left).toBeGreaterThanOrEqual(paneBounds.left - 1);
    expect(editorBounds.right).toBeLessThanOrEqual(paneBounds.right + 1);
    expect(scrollerBounds.left).toBeGreaterThanOrEqual(editorBounds.left - 1);
    expect(scrollerBounds.right).toBeLessThanOrEqual(editorBounds.right + 1);
    expect(contentBounds.left - scrollerBounds.left).toBeGreaterThanOrEqual(
      DESKTOP_SAFE_GUTTER_PX - 1,
    );
    expect(scrollerBounds.right - contentBounds.right).toBeGreaterThanOrEqual(
      DESKTOP_SAFE_GUTTER_PX - 1,
    );
    expect(contentBounds.width).toBeCloseTo(expectedContentWidth, 0);
  };

  await choosePageWidth(page, '窄');
  await assertContainedGeometry(680);

  await choosePageWidth(page, '标准');
  await assertContainedGeometry(810);

  await choosePageWidth(page, '宽');
  await assertContainedGeometry(1040);

  await choosePageWidth(page, '适应窗口');
  const fluidScroller = await horizontalBounds(scroller);
  await assertContainedGeometry(
    fluidScroller.width - DESKTOP_SAFE_GUTTER_PX * 2,
  );

  await choosePageWidth(page, '宽');
  await page.reload();
  await expectContentWidth(page, 1040);
  await openBlankDocument(page);
  await expect(content).toBeVisible();

  await page.setViewportSize({ width: 1100, height: 760 });
  for (const [label, cap] of [
    ['窄', 680],
    ['标准', 810],
    ['宽', 1040],
  ] as const) {
    await choosePageWidth(page, label);
    const availableWidth =
      (await horizontalBounds(scroller)).width - DESKTOP_SAFE_GUTTER_PX * 2;
    await assertContainedGeometry(Math.min(cap, availableWidth));
  }

  await choosePageWidth(page, '适应窗口');
  await assertContainedGeometry(
    (await horizontalBounds(scroller)).width - DESKTOP_SAFE_GUTTER_PX * 2,
  );

  for (const viewport of [
    { height: 760, width: 720 },
    { height: 720, width: 480 },
  ]) {
    await page.setViewportSize(viewport);
    const [paneBounds, editorBounds, scrollerBounds, contentBounds] =
      await Promise.all([
        horizontalBounds(pane),
        horizontalBounds(editor),
        horizontalBounds(scroller),
        horizontalBounds(content),
      ]);

    await expect(page.locator('.lm-sidebar')).toBeHidden();
    expect(paneBounds.left).toBeGreaterThanOrEqual(-1);
    expect(paneBounds.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(editorBounds.left).toBeGreaterThanOrEqual(paneBounds.left - 1);
    expect(editorBounds.right).toBeLessThanOrEqual(paneBounds.right + 1);
    expect(scrollerBounds.left).toBeGreaterThanOrEqual(editorBounds.left - 1);
    expect(scrollerBounds.right).toBeLessThanOrEqual(editorBounds.right + 1);
    expect(contentBounds.left - scrollerBounds.left).toBeCloseTo(
      MOBILE_SAFE_GUTTER_PX,
      0,
    );
    expect(scrollerBounds.right - contentBounds.right).toBeCloseTo(
      MOBILE_SAFE_GUTTER_PX,
      0,
    );
    expect(contentBounds.width).toBeCloseTo(
      scrollerBounds.width - MOBILE_SAFE_GUTTER_PX * 2,
      0,
    );
  }

  const longLine = 'unbroken-mobile-content-'.repeat(120);
  await content.fill(Array.from({ length: 24 }, () => longLine).join('\n'));
  const overflow = await page.evaluate(() => {
    const contentElement = document.querySelector<HTMLElement>('.cm-content');
    const scrollerElement = document.querySelector<HTMLElement>('.cm-scroller');

    if (!contentElement || !scrollerElement) {
      throw new Error('Expected mobile editor overflow metrics.');
    }

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      contentClientWidth: contentElement.clientWidth,
      contentScrollWidth: contentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      scrollerClientWidth: scrollerElement.clientWidth,
      scrollerScrollWidth: scrollerElement.scrollWidth,
    };
  });

  expect(overflow.contentScrollWidth).toBeLessThanOrEqual(
    overflow.contentClientWidth + 1,
  );
  expect(overflow.scrollerScrollWidth).toBeLessThanOrEqual(
    overflow.scrollerClientWidth + 1,
  );
  expect(overflow.bodyScrollWidth).toBe(overflow.bodyClientWidth);
  expect(overflow.documentScrollWidth).toBe(overflow.documentClientWidth);

  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(scroller).toHaveJSProperty('scrollTop', 0);
  const mobileScrollerBounds = await scroller.boundingBox();
  if (!mobileScrollerBounds) {
    throw new Error('Expected mobile editor scrolling geometry.');
  }
  await page.mouse.move(
    mobileScrollerBounds.x + mobileScrollerBounds.width / 2,
    mobileScrollerBounds.y + mobileScrollerBounds.height / 2,
  );
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({
    x: 0,
    y: 0,
  });
});

test('uses real primary-modifier wheel input and exposes an accessible 100% reset', async ({
  page,
}) => {
  await startDocument(page);

  const editor = page.locator('.cm-content');
  const scroller = page.locator('.cm-scroller');
  const readFontScale = () =>
    page.locator('.cm-editor').evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--lm-editor-font-scale').trim(),
    );
  const markdown = Array.from(
    { length: 120 },
    (_, index) => `paragraph ${index + 1} ${'reading text '.repeat(6)}`,
  ).join('\n');

  await editor.fill(markdown);
  await editor.focus();
  await scroller.evaluate((element) => {
    element.scrollTop = 640;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const scrollerBox = await scroller.boundingBox();
  if (!scrollerBox) {
    throw new Error('Expected the editor scroller to receive real wheel input.');
  }
  await page.mouse.move(
    scrollerBox.x + scrollerBox.width / 2,
    scrollerBox.y + scrollerBox.height / 2,
  );

  const plainScrollTop = await scroller.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    plainScrollTop,
  );
  await expect.poll(readFontScale).toBe('1');

  const anchorBeforeZoom = await readViewportAnchor(scroller);
  await page.keyboard.down(primaryModifier);
  try {
    await page.mouse.wheel(0, -120);
  } finally {
    await page.keyboard.up(primaryModifier);
  }

  await expect.poll(readFontScale).toBe('1.1');
  await expect(editor).toBeFocused();
  const anchorAfterZoom = await readViewportAnchor(scroller);
  expect(anchorAfterZoom.text).toBe(anchorBeforeZoom.text);
  expect(
    Math.abs((anchorAfterZoom.top ?? 0) - (anchorBeforeZoom.top ?? 0)),
  ).toBeLessThanOrEqual(8);
  expect(await readEditorSource(editor)).toBe(markdown);

  await page.getByRole('menuitem', { name: '视图' }).click();
  const resetZoom = page.getByRole('menuitem', { name: '重置缩放（100%）' });
  await expect(resetZoom).toBeVisible();
  await resetZoom.click();

  await expect.poll(readFontScale).toBe('1');
  await expect(editor).toBeFocused();
  expect(await readEditorSource(editor)).toBe(markdown);

  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect.poll(() => readEditorSource(editor)).toBe(markdown);

  await dispatchPrimaryWheelSteps(scroller, 120, 8);
  await expect.poll(readFontScale).toBe('0.5');
  await dispatchPrimaryWheelSteps(scroller, 120, 1);
  await expect.poll(readFontScale).toBe('0.5');

  await dispatchPrimaryWheelSteps(scroller, -120, 28);
  await expect.poll(readFontScale).toBe('2.5');
  await dispatchPrimaryWheelSteps(scroller, -120, 1);
  await expect.poll(readFontScale).toBe('2.5');
  expect(await readEditorSource(editor)).toBe(markdown);

  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitem', { name: '重置缩放（100%）' }).click();
  await expect.poll(readFontScale).toBe('1');
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem('lumamark.settings.v1');
    return Boolean(raw?.includes('"fontZoomPercent":100'));
  });

  await page.reload();
  await expect.poll(readFontScale).toBe('1');
});
