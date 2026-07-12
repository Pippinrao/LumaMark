import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { livePreviewRichMarkdown } from './fixtures/livePreviewData';

const REPORT_DIR = join(process.cwd(), 'artifacts', 'live-preview-report');
const REPORT_PATH = join(REPORT_DIR, 'index.html');

type ScreenshotItem = {
  label: string;
  path: string;
};

type LivePreviewMetric = {
  name: string;
  value: string;
};

test('generates a visual report for live preview rendering and editing states', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(livePreviewRichMarkdown);
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await mkdir(REPORT_DIR, { recursive: true });
  const screenshots: ScreenshotItem[] = [];

  await capture(page, screenshots, '01-preview.png', 'Initial live preview');

  const imageMetrics = await page.getByRole('img', {
    name: 'Inline SVG fixture',
  }).evaluate((element) => {
    const image = element as HTMLImageElement;

    return {
      complete: image.complete,
      naturalHeight: image.naturalHeight,
      naturalWidth: image.naturalWidth,
    };
  });
  expect(imageMetrics).toEqual({
    complete: true,
    naturalHeight: 90,
    naturalWidth: 160,
  });
  await expect(page.locator('.lm-code-token-keyword', { hasText: 'const' }))
    .toBeVisible();
  const codeLine = page.locator('.lm-md-code-block-line', {
    hasText: 'const value: number = 1',
  });
  await codeLine.click();
  await capture(page, screenshots, '02-code-focused.png', 'Code block focused');
  const codeKeywordTokenCount = await page.locator('.lm-code-token-keyword').count();

  const table = page.locator('.tbl-table-widget');
  const boldCell = table.locator('.tbl-data-cell').filter({ hasText: 'bold' });
  const boldSource = boldCell.locator('.tbl-cell-view');
  const boldPreview = boldCell.locator('.lm-table-inline-preview');

  await expect(boldPreview.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(
    table.locator('.lm-table-inline-preview a', { hasText: 'site' }),
  ).toBeVisible();
  await expect(
    table.locator('.lm-table-inline-preview code', { hasText: 'code' }),
  ).toBeVisible();

  await boldCell.hover();
  await expect(boldSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'source',
  );
  await capture(page, screenshots, '03-table-hover-source.png', 'Table hover source');

  await boldCell.click();
  const cellEditor = page.locator('.tbl-cell-editor .cm-content').first();
  await expect(cellEditor).toBeVisible();
  await expect(cellEditor).toContainText('**bold**');
  await capture(page, screenshots, '04-table-cell-editing.png', 'Table cell editing');

  await cellEditor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(cellEditor).toContainText('**bold**!');
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(boldPreview).toContainText('bold!');
  await capture(page, screenshots, '05-table-after-edit.png', 'Table after edit');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect(editor).toContainText('**bold**!');
  await expect(editor).toContainText('console.log(value)');

  const metrics: LivePreviewMetric[] = [
    {
      name: 'image natural size',
      value: `${imageMetrics.naturalWidth} x ${imageMetrics.naturalHeight}`,
    },
    {
      name: 'code keyword tokens',
      value: String(codeKeywordTokenCount),
    },
    {
      name: 'table source preserved',
      value: '**bold**! / [site](https://example.com) / `code`',
    },
  ];

  await writeFile(
    REPORT_PATH,
    renderLivePreviewReport({
      generatedAt: new Date().toISOString(),
      metrics,
      screenshots,
    }),
    'utf8',
  );

  await test.info().attach('live-preview-visual-report', {
    contentType: 'text/html',
    path: REPORT_PATH,
  });
});

async function capture(
  page: Page,
  screenshots: ScreenshotItem[],
  fileName: string,
  label: string,
): Promise<void> {
  const path = join(REPORT_DIR, fileName);
  await page.screenshot({ fullPage: true, path });
  screenshots.push({
    label,
    path: relative(dirname(REPORT_PATH), path).replaceAll('\\', '/'),
  });
}

function renderLivePreviewReport({
  generatedAt,
  metrics,
  screenshots,
}: {
  generatedAt: string;
  metrics: LivePreviewMetric[];
  screenshots: ScreenshotItem[];
}): string {
  const metricRows = metrics
    .map(
      (metric) => `
        <tr>
          <td>${escapeHtml(metric.name)}</td>
          <td>${escapeHtml(metric.value)}</td>
        </tr>`,
    )
    .join('');
  const screenshotCards = screenshots
    .map(
      (screenshot) => `
        <figure>
          <figcaption>${escapeHtml(screenshot.label)}</figcaption>
          <img src="${escapeHtml(screenshot.path)}" alt="${escapeHtml(
            screenshot.label,
          )}" />
        </figure>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LumaMark Live Preview Visual Report</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      background: #f5f6f2;
      color: #17211c;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1160px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    .meta {
      color: #607068;
      font-size: 14px;
      margin: 0 0 22px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #d9ded9;
      margin-bottom: 24px;
    }
    th,
    td {
      border-bottom: 1px solid #e5e9e5;
      font-size: 14px;
      padding: 10px 12px;
      text-align: left;
    }
    th {
      background: #eef3ef;
      font-weight: 650;
    }
    figure {
      margin: 0 0 28px;
      border: 1px solid #d9ded9;
      background: #fff;
    }
    figcaption {
      padding: 10px 12px;
      border-bottom: 1px solid #e5e9e5;
      font-weight: 650;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <main>
    <h1>LumaMark Live Preview Visual Report</h1>
    <p class="meta">Generated at ${escapeHtml(generatedAt)}. Captures rendering and editing states for images, code blocks, and table inline markdown.</p>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>${metricRows}</tbody>
    </table>
    ${screenshotCards}
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
