import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type CodeRowMetrics = {
  height: number;
  marginBlockEnd: string;
  marginBlockStart: string;
  paddingBlockEnd: string;
  paddingBlockStart: string;
  paddingInlineEnd: number;
  paddingInlineStart: number;
  top: number;
};

type CodeBlockVisualMetrics = {
  backgroundColor: string;
  badge: {
    color: string;
    content: string;
  };
  bodyColor: string;
  boxShadow: string;
  pseudo: {
    end: PseudoMetrics;
    start: PseudoMetrics;
  };
  rows: CodeRowMetrics[];
  tokenColors: Record<string, string>;
};

type PseudoMetrics = {
  bottom: number;
  height: number;
  pointerEvents: string;
  position: string;
  top: number;
};

type CssColor = {
  alpha: number;
  channels: [number, number, number];
};

type ScreenshotClip = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const visualViewport = { height: 720, width: 1280 };
const syntaxTokens = [
  ['keyword', /^let$/],
  ['string', /^"hello"$/],
  ['number', /^42$/],
  ['comment', /^\/\/ note$/],
  ['property', /^property$/],
  ['function', /^named$/],
] as const;
const syntaxTokenClasses = syntaxTokens.map(([tokenClass]) => tokenClass);

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await openBlankDocument(page);
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();

  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
}

async function waitForSyntaxTokens(editor: Locator): Promise<void> {
  for (const [tokenClass, text] of syntaxTokens) {
    const token = editor.locator(`.lm-code-token-${tokenClass}`, {
      hasText: text,
    });

    await expect(token).toHaveCount(1);
    await expect(token).toBeVisible();
  }
}

async function readCodeSurfaceBackground(editor: Locator): Promise<string> {
  return editor.evaluate((content) => {
    const body = content.querySelector<HTMLElement>(
      '.lm-md-code-block-line:not(.lm-md-code-block-start):not(.lm-md-code-block-end)',
    );

    if (!body) {
      throw new Error('Expected a code block body row.');
    }

    return getComputedStyle(body, '::before').backgroundColor;
  });
}

async function readCodeBlockScreenshotClip(
  editor: Locator,
): Promise<ScreenshotClip> {
  return editor.evaluate((content) => {
    const lines = [...content.querySelectorAll<HTMLElement>('.cm-line')];
    const start = content.querySelector<HTMLElement>('.lm-md-code-block-start');
    const end = content.querySelector<HTMLElement>('.lm-md-code-block-end');

    if (!start || !end) {
      throw new Error('Expected complete code block cap rows.');
    }

    const startIndex = lines.indexOf(start);
    const endIndex = lines.indexOf(end);
    const before = lines[startIndex - 2];
    const after = lines[endIndex + 2];

    if (!before || !after) {
      throw new Error('Expected real before and after context lines.');
    }

    const surfaceBounds = start.getBoundingClientRect();
    const beforeBounds = before.getBoundingClientRect();
    const afterBounds = after.getBoundingClientRect();
    const x = Math.floor(surfaceBounds.left);
    const y = Math.floor(beforeBounds.top);

    return {
      height: Math.ceil(afterBounds.bottom) - y,
      width: Math.ceil(surfaceBounds.right) - x,
      x,
      y,
    };
  });
}

async function expectCodeBlockScreenshot(
  page: Page,
  name: string,
  clip: ScreenshotClip,
): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    clip,
    maxDiffPixelRatio: 0.005,
    threshold: 0.2,
  });
}

async function readCodeBlockVisualMetrics(
  editor: Locator,
): Promise<CodeBlockVisualMetrics> {
  return editor.evaluate((content, tokenClasses) => {
    const rows = [
      ...content.querySelectorAll<HTMLElement>('.lm-md-code-block-line'),
    ];

    if (rows.length < 3) {
      throw new Error('Expected a multi-line TypeScript code block.');
    }

    const readPseudo = (row: HTMLElement): PseudoMetrics => {
      const style = getComputedStyle(row, '::before');
      const top = Number.parseFloat(style.top);
      const height = Number.parseFloat(style.height);

      return {
        bottom: row.getBoundingClientRect().height - top - height,
        height,
        pointerEvents: style.pointerEvents,
        position: style.position,
        top,
      };
    };
    const tokenColors = Object.fromEntries(
      tokenClasses.map((tokenClass) => {
        const token = content.querySelector<HTMLElement>(
          `.lm-code-token-${tokenClass}`,
        );

        if (!token) {
          throw new Error(`Expected a ${tokenClass} syntax token.`);
        }

        return [tokenClass, getComputedStyle(token).color];
      }),
    );
    const bodyStyle = getComputedStyle(rows[1]);
    const codeSurfaceStyle = getComputedStyle(rows[1], '::before');
    const languageBadgeStyle = getComputedStyle(rows[0], '::after');

    return {
      backgroundColor: codeSurfaceStyle.backgroundColor,
      badge: {
        color: languageBadgeStyle.color,
        content: languageBadgeStyle.content,
      },
      bodyColor: bodyStyle.color,
      boxShadow: codeSurfaceStyle.boxShadow,
      pseudo: {
        end: readPseudo(rows.at(-1)!),
        start: readPseudo(rows[0]),
      },
      rows: rows.map((row) => {
        const bounds = row.getBoundingClientRect();
        const style = getComputedStyle(row);

        return {
          height: bounds.height,
          marginBlockEnd: style.marginBlockEnd,
          marginBlockStart: style.marginBlockStart,
          paddingBlockEnd: style.paddingBlockEnd,
          paddingBlockStart: style.paddingBlockStart,
          paddingInlineEnd: Number.parseFloat(style.paddingInlineEnd),
          paddingInlineStart: Number.parseFloat(style.paddingInlineStart),
          top: bounds.top,
        };
      }),
      tokenColors,
    };
  }, syntaxTokenClasses);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseCssColor(foreground);
  const backgroundColor = parseCssColor(background);

  if (backgroundColor.alpha < 1) {
    throw new Error(
      `Code surface must be opaque before contrast is measured: ${background}`,
    );
  }

  const compositeForeground = foregroundColor.channels.map(
    (channel, index) =>
      channel * foregroundColor.alpha +
      backgroundColor.channels[index] * (1 - foregroundColor.alpha),
  ) as [number, number, number];
  const luminance = (channels: [number, number, number]) => {
    const linearChannels = channels.map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

    return (
      linearChannels[0] * 0.2126 +
      linearChannels[1] * 0.7152 +
      linearChannels[2] * 0.0722
    );
  };
  const foregroundLuminance = luminance(compositeForeground);
  const backgroundLuminance = luminance(backgroundColor.channels);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function parseCssColor(color: string): CssColor {
  const normalized = color.trim();
  const srgbMatch = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i.exec(
    normalized,
  );

  if (srgbMatch) {
    return {
      alpha: Number(srgbMatch[4] ?? 1),
      channels: [
        Number(srgbMatch[1]),
        Number(srgbMatch[2]),
        Number(srgbMatch[3]),
      ],
    };
  }

  const match = /^rgba?\((.*)\)$/i.exec(normalized);

  if (!match) {
    throw new Error(`Expected an rgb/rgba computed color: ${color}`);
  }

  const values = match[1].match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number);

  if (!values || (values.length !== 3 && values.length !== 4)) {
    throw new Error(`Unsupported rgb/rgba computed color: ${color}`);
  }

  const [red, green, blue, alpha = 1] = values;

  if (
    [red, green, blue].some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
    ) ||
    !Number.isFinite(alpha) ||
    alpha < 0 ||
    alpha > 1
  ) {
    throw new Error(`Out-of-range rgb/rgba computed color: ${color}`);
  }

  return {
    alpha,
    channels: [red / 255, green / 255, blue / 255],
  };
}

function isOpaqueRgbColor(color: string): boolean {
  try {
    return parseCssColor(color).alpha === 1;
  } catch {
    return false;
  }
}

function expectStableRowGeometry(
  before: CodeRowMetrics[],
  after: CodeRowMetrics[],
): void {
  expect(after).toHaveLength(before.length);

  for (const [index, row] of after.entries()) {
    const previous = before[index];

    expect(Math.abs(row.top - previous.top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.height - previous.height)).toBeLessThanOrEqual(0.5);
    expect(row.paddingBlockStart).toBe(previous.paddingBlockStart);
    expect(row.paddingBlockEnd).toBe(previous.paddingBlockEnd);
    expect(row.marginBlockStart).toBe(previous.marginBlockStart);
    expect(row.marginBlockEnd).toBe(previous.marginBlockEnd);
    expect(row.paddingInlineEnd).toBeCloseTo(previous.paddingInlineEnd, 3);
    expect(row.paddingInlineStart).toBeCloseTo(previous.paddingInlineStart, 3);
  }
}

function expectCodeBlockVisualContract(metrics: CodeBlockVisualMetrics): void {
  const [start, body] = metrics.rows;
  const end = metrics.rows.at(-1)!;

  for (const row of metrics.rows) {
    expect(row.paddingInlineEnd).toBeGreaterThanOrEqual(10);
    expect(row.paddingInlineEnd).toBeLessThanOrEqual(16);
    expect(row.paddingInlineEnd).toBeCloseTo(body.paddingInlineEnd, 3);
    expect(row.paddingInlineStart).toBeGreaterThanOrEqual(10);
    expect(row.paddingInlineStart).toBeLessThanOrEqual(16);
    expect(row.paddingInlineStart).toBeCloseTo(body.paddingInlineStart, 3);
  }

  for (const pseudo of [metrics.pseudo.start, metrics.pseudo.end]) {
    expect(pseudo.position).toBe('absolute');
    expect(pseudo.pointerEvents).toBe('none');
    expect(pseudo.height / body.height).toBeGreaterThanOrEqual(0.45);
    expect(pseudo.height / body.height).toBeLessThanOrEqual(0.55);
  }
  expect(metrics.pseudo.start.top / start.height).toBeGreaterThanOrEqual(0.45);
  expect(metrics.pseudo.start.top / start.height).toBeLessThanOrEqual(0.55);
  expect(metrics.pseudo.start.top + metrics.pseudo.start.height).toBeLessThanOrEqual(
    start.height + 0.5,
  );
  expect(metrics.pseudo.end.top).toBeGreaterThanOrEqual(-0.5);
  expect(metrics.pseudo.end.top).toBeLessThanOrEqual(0.5);
  expect(metrics.pseudo.end.bottom / end.height).toBeGreaterThanOrEqual(0.45);
  expect(metrics.pseudo.end.bottom / end.height).toBeLessThanOrEqual(0.55);
  expect(metrics.pseudo.end.top + metrics.pseudo.end.height).toBeLessThanOrEqual(
    end.height + 0.5,
  );

  for (const color of Object.values(metrics.tokenColors)) {
    expect(color).not.toBe(metrics.bodyColor);
    expect(contrastRatio(color, metrics.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  }
}

function expectFocusedCodeBlockVisualContract(
  inactive: CodeBlockVisualMetrics,
  active: CodeBlockVisualMetrics,
): void {
  expect(active.backgroundColor).not.toBe(inactive.backgroundColor);
  expect(active.boxShadow).not.toBe(inactive.boxShadow);
  expect(active.badge.content.replaceAll('"', '')).toBe('TypeScript');
  expect(contrastRatio(active.badge.color, active.backgroundColor)).toBeGreaterThanOrEqual(
    4.5,
  );
}

test('renders syntax-highlighted code blocks with stable inset geometry in both themes', async ({
  page,
}) => {
  await page.setViewportSize(visualViewport);
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '```ts',
      'let value = "hello";',
      'object.property = 42;',
      '// note',
      'named(value);',
      '```',
      '',
      'after',
    ].join('\n'),
  );

  const editor = page.locator('.cm-content').first();
  const codeBody = editor.locator('.lm-md-code-block-line', {
    hasText: 'let value',
  });

  await expect(codeBody).toBeVisible();
  await waitForSyntaxTokens(editor);
  const screenshotClip = await readCodeBlockScreenshotClip(editor);
  await expect(editor.locator('.lm-md-code-block-active')).toHaveCount(0);
  const beforeFocus = await readCodeBlockVisualMetrics(editor);
  expectCodeBlockVisualContract(beforeFocus);
  await expectCodeBlockScreenshot(
    page,
    'code-block-light-inactive.png',
    screenshotClip,
  );
  await codeBody.click();
  await expect(editor.locator('.lm-md-code-block-active')).toHaveCount(6);
  const light = await readCodeBlockVisualMetrics(editor);

  expectStableRowGeometry(beforeFocus.rows, light.rows);
  expectCodeBlockVisualContract(light);
  expectFocusedCodeBlockVisualContract(beforeFocus, light);
  await expectCodeBlockScreenshot(
    page,
    'code-block-light-active.png',
    screenshotClip,
  );

  await page
    .getByRole('menuitem', { exact: true, name: /^(?:Theme|主题)$/ })
    .click();
  await page.getByRole('menuitemradio', { name: /^(?:Dark|暗色)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await waitForSyntaxTokens(editor);
  await editor.locator('.cm-line', { hasText: 'after' }).click();
  await expect(editor.locator('.lm-md-code-block-active')).toHaveCount(0);
  const darkInactive = await readCodeBlockVisualMetrics(editor);
  await expect
    .poll(async () => {
      const backgroundColor = await readCodeSurfaceBackground(editor);

      return {
        changed: backgroundColor !== light.backgroundColor,
        opaque: isOpaqueRgbColor(backgroundColor),
      };
    })
    .toEqual({ changed: true, opaque: true });
  await expectCodeBlockScreenshot(
    page,
    'code-block-dark-inactive.png',
    screenshotClip,
  );
  await codeBody.click();
  await expect(editor.locator('.lm-md-code-block-active')).toHaveCount(6);
  const dark = await readCodeBlockVisualMetrics(editor);

  expectStableRowGeometry(light.rows, darkInactive.rows);
  expectStableRowGeometry(darkInactive.rows, dark.rows);
  expectCodeBlockVisualContract(dark);
  expectFocusedCodeBlockVisualContract(darkInactive, dark);
  await expectCodeBlockScreenshot(
    page,
    'code-block-dark-active.png',
    screenshotClip,
  );
});

test('keeps a non-empty code selection visible above the opaque code surface', async ({
  page,
}) => {
  await page.setViewportSize(visualViewport);
  await openNewDocument(page);
  const source = [
    'before',
    '',
    '```ts',
    'let value = "hello";',
    'object.property = 42;',
    '// note',
    '```',
    '',
    'after',
  ].join('\n');
  await replaceEditorSource(page, source);

  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  const selectionFrom = source.indexOf('value');
  const selectionTo = source.indexOf('42') + 2;

  await editor.evaluate((content, { from, to }) => {
    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest();

    view.dispatch({ selection: { anchor: from, head: to } });
    view.focus();
  }, { from: selectionFrom, to: selectionTo });
  await expect
    .poll(() =>
      editor.evaluate((content) => {
        const selection = (content as RootEditorContentTestBridge)
          .resolveRootEditorViewForTest().state.selection.main;

        return { from: selection.from, to: selection.to };
      }),
    )
    .toEqual({ from: selectionFrom, to: selectionTo });
  const screenshotClip = await readCodeBlockScreenshotClip(editor);

  const layers = await editor.evaluate((content) => {
    const line = content.querySelector<HTMLElement>(
      '.lm-md-code-block-line:not(.lm-md-code-block-start):not(.lm-md-code-block-end)',
    );
    const nativeSelection = window.getSelection();

    if (!line) {
      throw new Error('Expected a code block body row.');
    }

    return {
      nativeSelection: {
        background: getComputedStyle(line, '::selection').backgroundColor,
        rangeCount: nativeSelection?.rangeCount ?? 0,
        text: nativeSelection?.toString() ?? '',
      },
      surface: {
        background: getComputedStyle(line, '::before').backgroundColor,
      },
    };
  });

  await expectCodeBlockScreenshot(
    page,
    'code-block-selection-light.png',
    screenshotClip,
  );
  expect(layers.nativeSelection.rangeCount).toBe(1);
  expect(layers.nativeSelection.text).toContain('value = "hello";');
  expect(layers.nativeSelection.text).toContain('object.property = 42');
  expect(parseCssColor(layers.nativeSelection.background).alpha).toBeGreaterThan(
    0,
  );
  expect(parseCssColor(layers.surface.background).alpha).toBe(1);
});

test('keeps the final code row fully surfaced when its fence is unclosed', async ({
  page,
}) => {
  await page.setViewportSize(visualViewport);
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    ['```ts', 'const first = 1;', 'const final = 2;'].join('\n'),
  );

  const editor = page.locator('.cm-content').first();
  const finalRow = editor.locator('.lm-md-code-block-line', {
    hasText: 'const final',
  });

  await expect(finalRow).toBeVisible();
  await expect(finalRow).not.toHaveClass(/lm-md-code-block-end/);
  const surface = await finalRow.evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    const style = getComputedStyle(row, '::before');
    const top = Number.parseFloat(style.top);
    const height = Number.parseFloat(style.height);

    return {
      background: style.backgroundColor,
      bottom: bounds.height - top - height,
      height,
      rowHeight: bounds.height,
      top,
    };
  });

  expect(surface.top).toBeGreaterThanOrEqual(-0.5);
  expect(surface.top).toBeLessThanOrEqual(0.5);
  expect(surface.height).toBeCloseTo(surface.rowHeight, 0);
  expect(surface.bottom).toBeGreaterThanOrEqual(-0.5);
  expect(surface.bottom).toBeLessThanOrEqual(0.5);
  expect(parseCssColor(surface.background).alpha).toBe(1);
});
