import { createMathDocumentWorker } from '../../editor/capabilities/math/createMathDocumentWorker';
import type {
  MathDocumentWorkerResponse,
} from '../../editor/capabilities/math/mathWorkerProtocol';
import type {
  ExportMathFormula,
  ExportMathPreferences,
} from './exportTypes';

const MATH_TIMEOUT_MS = 60_000;
const EXPORT_CONTAINER_WIDTH = 657.6;
const inlinedFontUrls = new Map<string, string>();

export async function renderMathFormulas(
  formulas: readonly ExportMathFormula[],
  preferences: ExportMathPreferences,
): Promise<
  | {
      formulas: ReadonlyMap<string, string>;
      kind: 'rendered';
      stylesheet: string;
    }
  | { kind: 'failed'; message: string }
> {
  if (formulas.length === 0) {
    return { formulas: new Map(), kind: 'rendered', stylesheet: '' };
  }

  const worker = createMathDocumentWorker();
  try {
    const response = await withTimeout(
      new Promise<MathDocumentWorkerResponse>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<MathDocumentWorkerResponse>) => {
          resolve(event.data);
        };
        worker.onerror = (event) => {
          reject(new Error(event.message || 'Math worker failed.'));
        };
        worker.onmessageerror = () => {
          reject(new Error('Math worker message could not be decoded.'));
        };
        worker.postMessage({
          request: {
            documentId: 'export',
            formulas: formulas.map((formula) => ({
              display: formula.display,
              id: formula.id,
              source: formula.source,
            })),
            generation: 1,
            layoutMetrics: {
              containerWidth: EXPORT_CONTAINER_WIDTH,
              em: 16,
              ex: 8,
            },
            preferences: {
              numbering: preferences.numbering,
              physics: preferences.physics,
            },
          },
          type: 'render',
        });
      }),
      MATH_TIMEOUT_MS,
    );

    if (response.type === 'render-fatal') {
      return { kind: 'failed', message: response.error };
    }

    const rendered = new Map<string, string>();
    for (const formula of response.result.formulas) {
      if (formula.chtml) {
        rendered.set(formula.id, formula.chtml);
      }
    }

    return {
      formulas: rendered,
      kind: 'rendered',
      stylesheet: await inlineFontUrls(response.result.stylesheet),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    worker.terminate();
  }
}

async function inlineFontUrls(stylesheet: string): Promise<string> {
  if (typeof fetch !== 'function') {
    return stylesheet;
  }

  const urls = new Set<string>();
  for (const match of stylesheet.matchAll(/url\((["']?)([^"')]+)\1\)/gu)) {
    const value = match[2]?.trim();
    if (value && !value.startsWith('data:')) {
      urls.add(value);
    }
  }
  if (urls.size === 0) {
    return stylesheet;
  }

  await Promise.all(
    Array.from(urls).map(async (url) => {
      const dataUri = await fontDataUri(url);
      if (dataUri) {
        inlinedFontUrls.set(url, dataUri);
      }
    }),
  );

  return stylesheet.replace(
    /url\((["']?)([^"')]+)\1\)/gu,
    (match, quote: string, url: string) => {
      const dataUri = inlinedFontUrls.get(url.trim());
      return dataUri ? `url("${dataUri}")` : match;
    },
  );
}

async function fontDataUri(url: string): Promise<string | null> {
  const cached = inlinedFontUrls.get(url);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    return `data:font/woff2;base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    let binary = '';
    for (const byte of slice) {
      binary += String.fromCharCode(byte);
    }
    chunks.push(binary);
  }
  return btoa(chunks.join(''));
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Math rendering timed out.')),
      timeoutMs,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
