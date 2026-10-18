import {
  EXPORT_PRINTING_CLASS,
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
    'position:absolute;left:-10000px;top:0;width:174mm;pointer-events:none;background:#ffffff;color:#1f2328;color-scheme:light;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${css}</style>${body}`;

  const printStyle = document.createElement('style');
  printStyle.id = PRINT_STYLE_ID;
  printStyle.textContent = EXPORT_PRINT_STAGE_CSS;

  document.body.append(host);
  document.head.append(printStyle);

  let cleaned = false;
  let promoted = false;
  let previousRootStyle = '';
  let previousBodyStyle = '';
  const hiddenSiblings = new Map<HTMLElement, string>();

  function promoteForPrint(): void {
    const root = document.documentElement;
    const bodyElement = document.body;
    previousRootStyle = root.style.cssText;
    previousBodyStyle = bodyElement.style.cssText;
    promoted = true;

    root.classList.add(EXPORT_PRINTING_CLASS);
    root.style.setProperty('background', '#ffffff', 'important');
    root.style.setProperty('color-scheme', 'light', 'important');
    root.style.setProperty('height', 'auto', 'important');
    root.style.setProperty('overflow', 'visible', 'important');

    bodyElement.style.setProperty('background', '#ffffff', 'important');
    bodyElement.style.setProperty('color', '#1f2328', 'important');
    bodyElement.style.setProperty('color-scheme', 'light', 'important');
    bodyElement.style.setProperty('height', 'auto', 'important');
    bodyElement.style.setProperty('min-height', '0', 'important');
    bodyElement.style.setProperty('overflow', 'visible', 'important');

    for (const child of Array.from(bodyElement.children)) {
      if (child === host || !(child instanceof HTMLElement)) {
        continue;
      }
      hiddenSiblings.set(child, child.style.display);
      child.style.setProperty('display', 'none', 'important');
    }

    host.style.cssText =
      'position:static;left:auto;top:auto;display:block;width:auto;min-height:100vh;background:#ffffff;color:#1f2328;color-scheme:light;pointer-events:auto;';
  }

  function cleanup(): void {
    if (cleaned) {
      return;
    }
    cleaned = true;
    host.remove();
    printStyle.remove();
    document.documentElement.classList.remove(EXPORT_PRINTING_CLASS);

    if (promoted) {
      document.documentElement.style.cssText = previousRootStyle;
      document.body.style.cssText = previousBodyStyle;
      for (const [child, display] of hiddenSiblings) {
        if (display) {
          child.style.display = display;
        } else {
          child.style.removeProperty('display');
        }
      }
    }
  }

  try {
    await waitForPrintContent(host);
  } catch {
    cleanup();
    throw new Error('Export preview could not be prepared.');
  }

  promoteForPrint();
  // WebView2 PrintToPdf can capture the last painted frame. Let the promoted
  // stage and white page paint before the shell hands control to the printer.
  await nextAnimationFrame();
  await nextAnimationFrame();

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
