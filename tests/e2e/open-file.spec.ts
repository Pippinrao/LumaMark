import { expect, test } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const fixturePath = 'E:/lumamark-fixtures/long-open.md';
type OpenFileTestWindow = Window & {
  __LUMAMARK_E2E_RELEASE_OPEN__?: () => void;
};

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

function parseCssColor(value: string): Rgba {
  const components = value.match(/[\d.]+/g)?.map(Number);
  if (!components || components.length < 3) {
    throw new Error(`Unsupported CSS color: ${value}`);
  }

  const srgbColor = value.startsWith('color(srgb');
  const scale = srgbColor ? 255 : 1;
  return [
    components[0] * scale,
    components[1] * scale,
    components[2] * scale,
    components[3] ?? 1,
  ];
}

function relativeLuminance([red, green, blue]: Rgba): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [red, green, blue, alpha] = parseCssColor(foreground);
  const [backgroundRed, backgroundGreen, backgroundBlue] =
    parseCssColor(background);
  const composited: Rgba = [
    red * alpha + backgroundRed * (1 - alpha),
    green * alpha + backgroundGreen * (1 - alpha),
    blue * alpha + backgroundBlue * (1 - alpha),
    1,
  ];
  const foregroundLuminance = relativeLuminance(composited);
  const backgroundLuminance = relativeLuminance([
    backgroundRed,
    backgroundGreen,
    backgroundBlue,
    1,
  ]);

  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test('opens long markdown with feedback and keeps the viewport at the document start', async ({
  page,
}) => {
  const longMarkdown = [
    '# File Start',
    '',
    'The first paragraph should stay visible after opening.',
    '',
    ...Array.from({ length: 120 }, (_, index) =>
      [`## Section ${index + 1}`, '', `Body ${index + 1}`].join('\n'),
    ),
    '# File End',
  ].join('\n\n');

  await page.addInitScript(
    ({ path, text }) => {
      let resolveRead: (() => void) | null = null;
      const readGate = new Promise<void>((resolve) => {
        resolveRead = resolve;
      });

      window.__LUMAMARK_E2E_STATE__ = {
        files: {
          [path]: text,
        },
        lastWrite: null,
      };
      (window as OpenFileTestWindow).__LUMAMARK_E2E_RELEASE_OPEN__ = () => {
        resolveRead?.();
      };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (filePath: string) => {
          await readGate;

          const source =
            window.__LUMAMARK_E2E_STATE__?.files[filePath] ?? '';

          return {
            ok: true,
            data: {
              byteLength: new TextEncoder().encode(source).length,
              path: filePath,
              text: source,
            },
          };
        },
        showOpenDialog: async () => ({
          ok: true,
          data: path,
        }),
        showSaveDialog: async () => ({
          ok: true,
          data: null,
        }),
        writeText: async (filePath: string, source: string) => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(source).length,
            path: filePath,
          },
        }),
      };
    },
    {
      path: fixturePath,
      text: longMarkdown,
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '打开文件' }).click();

  await expect(page.getByRole('status')).toHaveText('正在打开');

  await page.evaluate(() => {
    (window as OpenFileTestWindow).__LUMAMARK_E2E_RELEASE_OPEN__?.();
  });

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('File Start');
  await expect(page.getByRole('status')).toHaveText('已打开');
  await expect
    .poll(() => page.locator('.cm-scroller').evaluate((node) => node.scrollTop))
    .toBe(0);

  const visibleText = await page.locator('.cm-scroller').innerText();
  expect(visibleText).toContain('File Start');
  expect(visibleText).not.toContain('File End');

  await editor.click();
  await page.keyboard.press(`${primaryModifier}+Home`);
  const heading = page.locator('.lm-md-heading-1').first();
  const sourceMarker = heading.locator('.lm-md-source-mark-block');
  await expect(sourceMarker).toHaveText('#');
  const markerTypography = await sourceMarker.evaluate((element) => {
    const markerStyle = getComputedStyle(element);
    const headingStyle = getComputedStyle(element.parentElement as HTMLElement);

    return {
      headingFontSize: Number.parseFloat(headingStyle.fontSize),
      headingFontWeight: Number.parseInt(headingStyle.fontWeight, 10),
      markerFontSize: Number.parseFloat(markerStyle.fontSize),
      markerFontWeight: Number.parseInt(markerStyle.fontWeight, 10),
    };
  });
  expect(markerTypography.markerFontSize).toBeLessThan(
    markerTypography.headingFontSize,
  );
  expect(markerTypography.markerFontWeight).toBeLessThan(
    markerTypography.headingFontWeight,
  );

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;
    }, theme);
    const colors = await sourceMarker.evaluate((element) => ({
      background: getComputedStyle(
        element.closest('.lm-editor-pane') as HTMLElement,
      ).backgroundColor,
      foreground: getComputedStyle(element).color,
    }));

    expect(
      contrastRatio(colors.foreground, colors.background),
      `${theme} source marker contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
