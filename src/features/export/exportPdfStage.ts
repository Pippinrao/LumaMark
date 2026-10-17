import {
  EXPORT_PRINT_STAGE_CSS,
  EXPORT_STAGE_CLASS,
} from './exportStyles';

const PRINT_STYLE_ID = 'lm-export-print-style';

export async function mountExportPdfStage(html: string): Promise<() => void> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const css = Array.from(parsed.head.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const body = parsed.body.innerHTML;

  const host = document.createElement('div');
  host.className = EXPORT_STAGE_CLASS;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;left:-10000px;top:0;width:174mm;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${css}</style>${body}`;

  const printStyle = document.createElement('style');
  printStyle.id = PRINT_STYLE_ID;
  printStyle.textContent = EXPORT_PRINT_STAGE_CSS;

  document.body.append(host);
  document.head.append(printStyle);

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) {
      return;
    }
    cleaned = true;
    host.remove();
    printStyle.remove();
  }

  try {
    await waitForPrintContent(host);
  } catch {
    cleanup();
    throw new Error('Export preview could not be prepared.');
  }

  return cleanup;
}

async function waitForPrintContent(host: HTMLElement): Promise<void> {
  const fonts = document.fonts?.ready;
  if (fonts) {
    await fonts;
  }

  const images = Array.from(
    host.shadowRoot?.querySelectorAll('img') ?? [],
  );
  await Promise.all(
    images.map((image) =>
      typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : Promise.resolve(),
    ),
  );

  await nextAnimationFrame();
  await nextAnimationFrame();
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

export function printWithSystemDialog(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.removeEventListener('afterprint', finish);
      resolve();
    };

    globalThis.addEventListener('afterprint', finish, { once: true });
    setTimeout(finish, 1_500);
    window.print();
  });
}
