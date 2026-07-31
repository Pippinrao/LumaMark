import { chromium, type FullConfig } from '@playwright/test';

const VITE_DEV_WARM_UP_TIMEOUT_MS = 60_000;

interface WarmUpDiagnostic {
  elapsedMs: number;
  event: string;
  detail?: string;
}

function remainingWarmUpTime(deadline: number): number {
  const remaining = deadline - Date.now();

  if (remaining <= 0) {
    throw new Error(
      `Vite dev transform warm-up exceeded ${VITE_DEV_WARM_UP_TIMEOUT_MS}ms.`,
    );
  }

  return remaining;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;

  if (typeof baseURL !== 'string') {
    throw new Error('Playwright global setup requires a string baseURL.');
  }

  // This only warms Vite's on-demand dev transforms before parallel Web E2E.
  // Production bundle and packaged WebView cold-start checks do not use this setup.
  const startedAt = Date.now();
  const deadline = startedAt + VITE_DEV_WARM_UP_TIMEOUT_MS;
  const diagnostics: WarmUpDiagnostic[] = [];
  const record = (event: string, detail?: string): void => {
    diagnostics.push({ elapsedMs: Date.now() - startedAt, event, detail });
  };

  record('browser.launch:start');
  const browser = await chromium.launch({
    timeout: remainingWarmUpTime(deadline),
  });
  record('browser.launch:complete');

  try {
    const context = await browser.newContext();
    record('context.create:complete');

    try {
      const page = await context.newPage();
      page.on('console', (message) => {
        record(`console.${message.type()}`, message.text());
      });
      page.on('pageerror', (error) => {
        record('pageerror', error.stack ?? error.message);
      });
      page.on('requestfailed', (request) => {
        record(
          'requestfailed',
          `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown failure'}`,
        );
      });
      page.on('response', (response) => {
        if (!response.ok()) {
          record('response.error', `${response.status()} ${response.url()}`);
        }
      });

      record('page.create:complete');

      try {
        record('page.goto:start', baseURL);
        const response = await page.goto(baseURL, {
          timeout: remainingWarmUpTime(deadline),
        });
        record(
          'page.goto:complete',
          response === null ? 'no response' : `${response.status()} ${response.url()}`,
        );

        const readinessTimeout = remainingWarmUpTime(deadline);
        record('readiness.wait:start', `budget=${readinessTimeout}ms`);
        await Promise.all([
          page.getByTestId('app-shell').waitFor({
            state: 'visible',
            timeout: readinessTimeout,
          }),
          page.getByTestId('editor-host').waitFor({
            state: 'visible',
            timeout: readinessTimeout,
          }),
        ]);
        record('readiness.wait:complete');
        console.log(
          diagnostics
            .map(
              ({ elapsedMs, event, detail }) =>
                `[vite-warm-up +${elapsedMs}ms] ${event}${detail === undefined ? '' : `: ${detail}`}`,
            )
            .join('\n'),
        );
      } catch (error) {
        try {
          const snapshot = await page.evaluate(() => {
            const resources = performance
              .getEntriesByType('resource')
              .filter(
                (entry): entry is PerformanceResourceTiming =>
                  entry.entryType === 'resource' && 'responseEnd' in entry,
              )
              .map((entry) => ({
                name: entry.name,
                durationMs: Math.round(entry.duration),
                responseEndMs: Math.round(entry.responseEnd),
              }))
              .sort((left, right) => left.responseEndMs - right.responseEndMs);

            return {
              bodyText: document.body?.innerText.slice(0, 500) ?? '',
              bodyHtmlLength: document.body?.innerHTML.length ?? 0,
              resourceCount: resources.length,
              lastResources: resources.slice(-20),
            };
          });
          record('page.snapshot', JSON.stringify(snapshot));
        } catch (snapshotError) {
          record(
            'page.snapshot:failed',
            snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
          );
        }
        record('warm-up:failed', error instanceof Error ? error.stack : String(error));
        const timeline = diagnostics
          .map(
            ({ elapsedMs, event, detail }) =>
              `[+${elapsedMs}ms] ${event}${detail === undefined ? '' : `: ${detail}`}`,
          )
          .join('\n');

        throw new Error(`Vite dev transform warm-up failed.\n${timeline}`, {
          cause: error,
        });
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
