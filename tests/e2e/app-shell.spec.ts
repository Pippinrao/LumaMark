import { expect, test, type Locator, type Page } from '@playwright/test';

type SidebarTabAppearance = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: string;
  boxShadow: string;
  indicatorColor: string;
  indicatorContent: string;
  indicatorHeight: string;
  outlineColor: string;
  outlineWidth: string;
};

type RgbColor = readonly [number, number, number];

function parseRgbColor(value: string): RgbColor {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received: ${value}`);
  }

  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = parseRgbColor(color).map((channel) => {
      const value = channel / 255;

      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * (channels[0] ?? 0) +
      0.7152 * (channels[1] ?? 0) +
      0.0722 * (channels[2] ?? 0);
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

async function readSidebarTabAppearance(tab: Locator): Promise<SidebarTabAppearance> {
  return tab.evaluate((element) => {
    const style = getComputedStyle(element);
    const indicatorStyle = getComputedStyle(element, '::after');

    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      indicatorColor: indicatorStyle.backgroundColor,
      indicatorContent: indicatorStyle.content,
      indicatorHeight: indicatorStyle.height,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
    };
  });
}

async function expectDistinctActiveTab(
  active: Locator,
  inactive: Locator,
  track: Locator,
): Promise<void> {
  const [activeAppearance, inactiveAppearance] = await Promise.all([
    readSidebarTabAppearance(active),
    readSidebarTabAppearance(inactive),
  ]);
  const trackBackground = await track.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  expect(activeAppearance.borderWidth).toBe('1px');
  expect(activeAppearance.borderColor).not.toBe(inactiveAppearance.borderColor);
  expect(activeAppearance.backgroundColor).not.toBe(inactiveAppearance.backgroundColor);
  expect(activeAppearance.boxShadow).not.toBe(inactiveAppearance.boxShadow);
  expect(activeAppearance.indicatorContent).not.toBe('none');
  expect(Number.parseFloat(activeAppearance.indicatorHeight)).toBeGreaterThanOrEqual(2);
  expect(
    contrastRatio(activeAppearance.indicatorColor, trackBackground),
  ).toBeGreaterThanOrEqual(3);
}

async function expectVisibleSidebarTabFocus(
  page: Page,
  tab: Locator,
  track: Locator,
): Promise<void> {
  await tab.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const appearance = await readSidebarTabAppearance(tab);
  const trackBackground = await track.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  expect(appearance.outlineWidth).toBe('2px');
  expect(contrastRatio(appearance.outlineColor, trackBackground)).toBeGreaterThanOrEqual(3);
}

test('opens on an accessible start screen with primary actions', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('main', { name: '开始' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建文档' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开 Markdown 文件' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开工作区' })).toBeVisible();
  await expect(page.getByTestId('workspace-content')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.cm-content')).toHaveCount(1);
});

test('uses Typora-like two-pane shell with file and outline tabs in the left sidebar', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await expect(page.locator('.lm-top-chrome .lm-menu-trigger')).toHaveText([
    '文件',
    '编辑',
    '段落',
    '格式',
    '视图',
    '主题',
    '语言',
    '帮助',
  ]);
  await expect(page.getByRole('tab', { name: '文件' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '大纲' })).toBeVisible();
  await expect(page.locator('.lm-command-bar')).toHaveCount(0);
  await expect(page.locator('.lm-title-group')).toHaveCount(0);
  await expect(page.locator('.lm-outline-panel')).toHaveCount(0);
  await expect(page.locator('.lm-workspace-shell')).toBeVisible();
  await expect(page.locator('.lm-editor-pane')).toBeVisible();
  await expect(page.locator('.lm-editor-header')).toBeVisible();
  await expect(page.locator('.lm-editor-scroll')).toBeVisible();
  await expect(page.locator('.lm-editor-paper')).toBeVisible();

  const chromeBox = await page.locator('.lm-top-chrome').boundingBox();
  const fileMenuBox = await page.getByRole('menuitem', { name: '文件' }).boundingBox();

  if (!chromeBox || !fileMenuBox) {
    throw new Error('Expected top chrome and file menu to be measurable.');
  }

  expect(fileMenuBox.x - chromeBox.x).toBeLessThanOrEqual(18);

  await page.getByRole('tab', { name: '大纲' }).click();

  await expect(page.locator('.lm-outline')).toBeVisible();
  await expect(page.locator('.lm-outline-item')).toHaveCount(0);
  await expect(page.getByTestId('editor-host')).toBeVisible();
});

test('gives the active file or outline tab a distinct surface in both themes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const fileTab = page.getByRole('tab', { name: '文件' });
  const outlineTab = page.getByRole('tab', { name: '大纲' });
  const tabTrack = page.locator('.lm-sidebar-tabs-list');

  await expect(fileTab).toHaveAttribute('data-state', 'active');
  await expect(outlineTab).toHaveAttribute('data-state', 'inactive');
  await expectDistinctActiveTab(fileTab, outlineTab, tabTrack);
  await expectVisibleSidebarTabFocus(page, fileTab, tabTrack);

  await outlineTab.click();
  await page.getByRole('menuitem', { name: '主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(outlineTab).toHaveAttribute('data-state', 'active');
  await expect(fileTab).toHaveAttribute('data-state', 'inactive');
  await expectDistinctActiveTab(outlineTab, fileTab, tabTrack);
  await expectVisibleSidebarTabFocus(page, outlineTab, tabTrack);
});

test('matches the high fidelity editor gutter and sidebar sizing contract', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const sidebarBox = await page.locator('.lm-sidebar').boundingBox();
  const paperBox = await page.locator('.lm-editor-paper').boundingBox();
  const editorPaneBox = await page.locator('.lm-editor-pane').boundingBox();
  const treeBodyBox = await page.locator('.lm-file-tree-body').boundingBox();
  const tabPanelBox = await page.locator('.lm-sidebar-tab-panel[data-state="active"]').boundingBox();

  if (!sidebarBox || !paperBox || !editorPaneBox || !treeBodyBox || !tabPanelBox) {
    throw new Error('Expected high fidelity shell regions to be measurable.');
  }

  expect(sidebarBox.width).toBeGreaterThanOrEqual(196);
  expect(sidebarBox.width).toBeLessThanOrEqual(488);
  expect(paperBox.x).toBeCloseTo(editorPaneBox.x, 1);
  expect(paperBox.width).toBeCloseTo(editorPaneBox.width, 1);
  expect(treeBodyBox.height).toBeGreaterThan(360);
  expect(treeBodyBox.height / tabPanelBox.height).toBeGreaterThan(0.75);

  const scrollerBox = await page.locator('.cm-scroller').boundingBox();
  const contentBox = await page.locator('.cm-content').boundingBox();

  if (!scrollerBox || !contentBox) {
    throw new Error('Expected editor scroller and content to be measurable.');
  }

  expect(
    Math.abs(
      scrollerBox.x +
        scrollerBox.width -
        (editorPaneBox.x + editorPaneBox.width),
    ),
  ).toBeLessThanOrEqual(2);
  expect(contentBox.width).toBeLessThanOrEqual(860);
  expect(contentBox.x - editorPaneBox.x).toBeGreaterThanOrEqual(48);
  expect(editorPaneBox.x + editorPaneBox.width - (contentBox.x + contentBox.width)).toBeGreaterThanOrEqual(48);
});

for (const viewport of [
  { height: 720, width: 900 },
  { height: 1080, width: 1920 },
]) {
  test(`clamps the adaptive sidebar at ${viewport.width}px viewport width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: '新建文档' }).click();

    const sidebarBox = await page.locator('.lm-sidebar-panel').boundingBox();
    expect(sidebarBox?.width ?? 0).toBeGreaterThanOrEqual(199);
    expect(sidebarBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(481);
  });
}

test('lets dragging take the sidebar below the former 240 pixel floor', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const sidebar = page.locator('.lm-sidebar-panel');
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);

  const handleBox = await page.locator('.lm-resize-handle').boundingBox();

  if (!handleBox) {
    throw new Error('Expected the sidebar resize handle to be measurable.');
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(150, handleBox.y + handleBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeLessThan(200);
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(120);
});

test('collapses, restores, and persists an accessible sidebar state from the view menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const sidebar = page.locator('.lm-sidebar-panel');
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(199);

  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitemcheckbox', { name: /^切换侧边栏/ }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeLessThan(2);
  await expect(page.getByTestId('sidebar-content')).toHaveAttribute(
    'aria-hidden',
    'true',
  );

  await page.reload();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeLessThan(2);
  await expect(page.getByTestId('sidebar-content')).toHaveAttribute(
    'aria-hidden',
    'true',
  );

  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitemcheckbox', { name: /^切换侧边栏/ }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(199);
  await expect(page.getByTestId('sidebar-content')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
});

test('persists page width across reloads while resetting modified-wheel zoom', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-editor');
  const readEditorVariable = (name: string) =>
    editor.evaluate((element, propertyName) =>
      getComputedStyle(element).getPropertyValue(propertyName).trim(), name);

  await expect.poll(() => readEditorVariable('--lm-editor-page-width')).toBe(
    '810px',
  );
  await expect.poll(() => readEditorVariable('--lm-editor-font-scale')).toBe('1');

  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  const widthGroup = page.getByRole('group', { name: '页面宽度' });
  await widthGroup.getByRole('button', { name: '宽', exact: true }).click();

  await expect.poll(() => readEditorVariable('--lm-editor-page-width')).toBe(
    '1040px',
  );

  await page.locator('.cm-content').dispatchEvent('wheel', {
    ctrlKey: true,
    deltaY: -100,
  });
  await expect.poll(() => readEditorVariable('--lm-editor-font-scale')).toBe(
    '1.1',
  );

  await page.reload();

  await expect.poll(() => readEditorVariable('--lm-editor-page-width')).toBe(
    '1040px',
  );
  await expect.poll(() => readEditorVariable('--lm-editor-font-scale')).toBe('1');
});

test('moves focus into the editor when a sidebar shortcut collapses it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  const sidebar = page.locator('.lm-sidebar-panel');

  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(199);
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByRole('tab', { name: '文件' }).focus();
  await page.keyboard.press('Control+\\');

  await expect(page.getByTestId('sidebar-content')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('enters and exits a distraction-free focus mode without changing the editor document', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await page.locator('.cm-content').fill('# Focus document');

  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitemcheckbox', { name: /^专注模式/ }).click();

  const shell = page.getByTestId('app-shell');
  await expect(shell).toHaveClass(/lm-focus-mode/);
  await expect(page.locator('.lm-top-chrome')).toBeHidden();
  await expect(page.locator('.lm-status-bar')).toBeHidden();
  await expect(page.locator('.lm-sidebar-panel')).toHaveCSS('width', '0px');
  await expect(page.getByRole('button', { name: '退出专注模式' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('# Focus document');

  await page.getByRole('button', { name: '退出专注模式' }).click();

  await expect(shell).not.toHaveClass(/lm-focus-mode/);
  await expect(page.locator('.lm-top-chrome')).toBeVisible();
  await expect(page.locator('.lm-status-bar')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('.lm-sidebar-panel').boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(199);
  await expect(page.locator('.cm-content')).toContainText('# Focus document');
});

test('toggles focus mode with the writing shortcut', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await page.locator('.cm-content').focus();

  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('app-shell')).toHaveClass(/lm-focus-mode/);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('app-shell')).not.toHaveClass(/lm-focus-mode/);
});

test('updates low-distraction document statistics after editing Chinese and English text', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const statusBar = page.locator('.lm-status-bar');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('中文 text\nmore');

  await expect(statusBar).toContainText('2 行 · 4 词 · 10 个字符');
});

test('keeps the document title in the editor header without pushing the menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const title = page.locator('.lm-editor-title');
  const titleBox = await title.boundingBox();
  const titleStyles = await title.evaluate((node) => {
    const style = getComputedStyle(node);

    return {
      backgroundColor: style.backgroundColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });
  const editorPaneBox = await page.locator('.lm-editor-pane').boundingBox();
  const chromeBox = await page.locator('.lm-top-chrome').boundingBox();
  const fileMenuBox = await page.getByRole('menuitem', { name: '文件' }).boundingBox();

  if (!titleBox || !editorPaneBox || !chromeBox || !fileMenuBox) {
    throw new Error('Expected editor title, menu, and editor pane to be measurable.');
  }

  const titleCenter = titleBox.x + titleBox.width / 2;
  const editorCenter = editorPaneBox.x + editorPaneBox.width / 2;

  expect(Math.abs(titleCenter - editorCenter)).toBeLessThanOrEqual(2);
  expect(fileMenuBox.x - chromeBox.x).toBeLessThanOrEqual(18);
  expect(titleBox.y).toBeGreaterThanOrEqual(editorPaneBox.y);
  expect(titleBox.y).toBeLessThan(editorPaneBox.y + 48);
  expect(chromeBox.x).toBeLessThan(editorPaneBox.x);
  expect(titleStyles.borderStyle).toBe('none');
  expect(titleStyles.borderWidth).toBe('0px');
  expect(titleStyles.borderRadius).toBe('0px');
  expect(titleStyles.boxShadow).toBe('none');
  expect(titleStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.lm-top-chrome .lm-document-title')).toHaveCount(0);
  await page.getByRole('menuitem', { name: '文件' }).click();
  await expect(page.getByRole('menuitem', { name: '打开文件' })).toBeVisible();
});

test('places native window controls on the outer chrome', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const chromeBox = await page.locator('.lm-top-chrome').boundingBox();
  const controlsBox = await page.locator('.lm-window-controls').boundingBox();

  if (!chromeBox || !controlsBox) {
    throw new Error('Expected chrome and window controls to be measurable.');
  }

  await expect(page.getByRole('button', { name: '最小化窗口' })).toBeVisible();
  await expect(page.getByRole('button', { name: '最大化窗口' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭窗口' })).toBeVisible();
  expect(chromeBox.x + chromeBox.width - (controlsBox.x + controlsBox.width)).toBeLessThanOrEqual(14);
  expect(controlsBox.y).toBeGreaterThanOrEqual(chromeBox.y);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(chromeBox.y + chromeBox.height);
});

test('opens top menu popovers below the chrome without clipping', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.locator('.lm-menu-content').evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished)),
  );
  const chromeBox = await page.locator('.lm-top-chrome').boundingBox();
  const menuBox = await page.locator('.lm-menu-content').boundingBox();
  const zIndexes = await page.evaluate(() => ({
    chrome: Number.parseInt(
      getComputedStyle(document.querySelector('.lm-top-chrome')!).zIndex,
      10,
    ),
    menu: Number.parseInt(
      getComputedStyle(document.querySelector('.lm-menu-content')!).zIndex,
      10,
    ),
  }));

  if (!chromeBox || !menuBox) {
    throw new Error('Expected chrome and menu content to be measurable.');
  }

  expect(menuBox.y).toBeGreaterThanOrEqual(chromeBox.y + chromeBox.height + 4);
  expect(zIndexes.menu).toBeGreaterThan(zIndexes.chrome);
  await expect(page.getByRole('menuitem', { name: '打开文件' })).toBeVisible();
});

test('keeps sidebar and editor on independent scroll boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const markdown = Array.from({ length: 160 }, (_, index) =>
    [`# Heading ${index + 1}`, '', `Paragraph ${index + 1}`].join('\n'),
  ).join('\n\n');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(markdown);
  await page.getByRole('tab', { name: '大纲' }).click();
  await expect(page.locator('.lm-outline-item')).not.toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.lm-outline-list')
        .evaluate((node) => node.scrollHeight > node.clientHeight),
    )
    .toBe(true);
  const outlineMetrics = await page.locator('.lm-outline-list').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(outlineMetrics.scrollHeight).toBeGreaterThan(outlineMetrics.clientHeight);

  const bodyMetrics = await page.evaluate(() => ({
    bodyClientHeight: document.body.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    documentClientHeight: document.documentElement.clientHeight,
    documentScrollHeight: document.documentElement.scrollHeight,
    windowScrollY: window.scrollY,
  }));
  expect(bodyMetrics.windowScrollY).toBe(0);
  expect(bodyMetrics.bodyScrollHeight).toBe(bodyMetrics.bodyClientHeight);
  expect(bodyMetrics.documentScrollHeight).toBe(bodyMetrics.documentClientHeight);

  const outlineList = page.locator('.lm-outline-list');
  const editorScroller = page.locator('.cm-scroller');
  await editorScroller.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(editorScroller).toHaveJSProperty('scrollTop', 0);
  await outlineList.evaluate((node) => {
    node.scrollTop = 720;
  });
  await expect
    .poll(() => outlineList.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect(editorScroller).toHaveJSProperty('scrollTop', 0);

  const outlineScrollTop = await outlineList.evaluate((node) => node.scrollTop);
  await editorScroller.evaluate((node) => {
    node.scrollTop = 720;
  });
  await expect
    .poll(() => editorScroller.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect(outlineList).toHaveJSProperty('scrollTop', outlineScrollTop);
});

test('opens the command palette and triggers save', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await expect(page.getByRole('menuitem', { name: '文件' })).toBeVisible();
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await expect(palette).toBeVisible();

  await palette.getByPlaceholder('搜索命令').fill('保存');
  await palette.getByText('保存', { exact: true }).click();

  await expect(palette).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('保存失败');
});
