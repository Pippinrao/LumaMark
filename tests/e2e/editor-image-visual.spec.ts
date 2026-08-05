import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { expect, test } from '@playwright/test';
import { tinySvgDataUrl } from './fixtures/livePreviewData';

const REPORT_DIR = join(process.cwd(), 'artifacts', 'image-preview-report');
const SCREENSHOT_PATH = join(REPORT_DIR, 'image-preview.png');
const REPORT_PATH = join(REPORT_DIR, 'index.html');

type ImageMetric = {
  alt: string;
  boxHeight: number;
  boxWidth: number;
  complete: boolean;
  naturalHeight: number;
  naturalWidth: number;
  srcKind: string;
};

test('generates an HTML visual report for rendered image previews', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const markdown = [
    '# Image preview visual report',
    '',
    `![Inline SVG fixture](${tinySvgDataUrl})`,
    '',
    'plain',
  ].join('\n');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(markdown);
  await page.locator('.cm-line', { hasText: 'plain' }).click();

  const image = page.getByRole('img', { name: 'Inline SVG fixture' });
  await expect(image).toBeVisible();
  await expect
    .poll(async () =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;

        return {
          complete: img.complete,
          naturalHeight: img.naturalHeight,
          naturalWidth: img.naturalWidth,
        };
      }),
    )
    .toEqual({
      complete: true,
      naturalHeight: 90,
      naturalWidth: 160,
    });

  await mkdir(REPORT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: SCREENSHOT_PATH });

  const metrics = await page.evaluate<ImageMetric[]>(() =>
    [...document.querySelectorAll('.lm-image-preview img')].map((element) => {
      const img = element as HTMLImageElement;
      const box = img.getBoundingClientRect();

      return {
        alt: img.alt,
        boxHeight: Math.round(box.height),
        boxWidth: Math.round(box.width),
        complete: img.complete,
        naturalHeight: img.naturalHeight,
        naturalWidth: img.naturalWidth,
        srcKind: img.src.startsWith('data:')
          ? 'data'
          : img.src.startsWith('asset:')
            ? 'asset'
            : 'other',
      };
    }),
  );

  await writeFile(
    REPORT_PATH,
    renderImageReport({
      generatedAt: new Date().toISOString(),
      metrics,
      screenshotPath: relative(dirname(REPORT_PATH), SCREENSHOT_PATH).replaceAll(
        '\\',
        '/',
      ),
    }),
    'utf8',
  );

  await test.info().attach('image-preview-visual-report', {
    contentType: 'text/html',
    path: REPORT_PATH,
  });

  expect(metrics).toEqual([
    {
      alt: 'Inline SVG fixture',
      boxHeight: 90,
      boxWidth: 160,
      complete: true,
      naturalHeight: 90,
      naturalWidth: 160,
      srcKind: 'data',
    },
  ]);
});

function renderImageReport({
  generatedAt,
  metrics,
  screenshotPath,
}: {
  generatedAt: string;
  metrics: ImageMetric[];
  screenshotPath: string;
}): string {
  const rows = metrics
    .map(
      (metric) => `
        <tr>
          <td>${escapeHtml(metric.alt)}</td>
          <td>${escapeHtml(metric.srcKind)}</td>
          <td>${String(metric.complete)}</td>
          <td>${metric.naturalWidth} x ${metric.naturalHeight}</td>
          <td>${metric.boxWidth} x ${metric.boxHeight}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LumaMark Image Preview Visual Report</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      background: #f7f8f6;
      color: #17211c;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1040px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    .meta {
      margin: 0 0 24px;
      color: #607068;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 24px;
      background: #fff;
      border: 1px solid #d9ded9;
    }
    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #e5e9e5;
      text-align: left;
      font-size: 14px;
    }
    th {
      background: #eef3ef;
      font-weight: 650;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid #d9ded9;
      background: #fff;
    }
  </style>
</head>
<body>
  <main>
    <h1>LumaMark Image Preview Visual Report</h1>
    <p class="meta">Generated at ${escapeHtml(generatedAt)}. This report fails the test when rendered images do not produce non-zero natural dimensions.</p>
    <table>
      <thead>
        <tr>
          <th>Alt</th>
          <th>Source kind</th>
          <th>Complete</th>
          <th>Natural size</th>
          <th>Rendered box</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <img src="${escapeHtml(screenshotPath)}" alt="Image preview screenshot" />
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
