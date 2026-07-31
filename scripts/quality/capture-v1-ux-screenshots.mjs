import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 4180;
const baseUrl = `http://${host}:${port}`;
const prototypePath = '/docs/product/prototypes/v1-apple-file-mode/';
const screenshotDir = 'test-results/v1-ux-screenshots';
const viteCliPath = fileURLToPath(
  new URL('./bin/vite.js', import.meta.resolve('vite/package.json')),
);

const states = [
  {
    name: '01-light-files',
    viewport: { height: 960, width: 1440 },
  },
  {
    name: '02-light-outline',
    viewport: { height: 960, width: 1440 },
    setup: async (page) => {
      await page.getByRole('tab', { name: '大纲' }).click();
    },
  },
  {
    name: '03-dark-files',
    viewport: { height: 960, width: 1440 },
    setup: async (page) => {
      await page.getByRole('button', { name: '切换到暗色' }).click();
    },
  },
  {
    name: '04-dark-source',
    viewport: { height: 960, width: 1440 },
    setup: async (page) => {
      await page.getByRole('button', { name: '切换到暗色' }).click();
      await page.getByRole('button', { name: '切换源码模式' }).click();
    },
  },
  {
    name: '05-light-sidebar-collapsed',
    viewport: { height: 960, width: 1440 },
    setup: async (page) => {
      await page.getByRole('button', { name: '折叠侧栏' }).click();
    },
  },
  {
    name: '06-compact-editor',
    viewport: { height: 900, width: 760 },
  },
];

await mkdir(screenshotDir, { recursive: true });

const server = await startServer();
const browser = await chromium.launch();

try {
  for (const state of states) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: state.viewport,
    });
    await page.goto(`${baseUrl}${prototypePath}`, {
      waitUntil: 'networkidle',
    });
    await state.setup?.(page);
    await page.screenshot({
      fullPage: true,
      path: `${screenshotDir}/${state.name}.png`,
    });
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

console.log(`Captured ${states.length} screenshots in ${screenshotDir}`);

async function startServer() {
  if (await isServerReady()) {
    return null;
  }

  const child = spawn(
    process.execPath,
    [viteCliPath, '--host', host, '--port', String(port)],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReady()) {
      return child;
    }
    await delay(500);
  }

  child.kill();
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function isServerReady() {
  try {
    const response = await fetch(`${baseUrl}${prototypePath}`, {
      method: 'HEAD',
    });

    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
