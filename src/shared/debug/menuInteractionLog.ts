import { appendDebugLogLine } from '../../services/debug/debugLogClient';

const ENABLED_KEY = 'lumamark.debug-log';

function resolveMenuDebugStorage(): Storage | null {
  if (
    (globalThis.navigator?.userAgent.toLowerCase() ?? '').includes('jsdom')
  ) {
    return null;
  }

  return globalThis.document?.defaultView?.localStorage ?? null;
}

function nowStamp(): string {
  const date = new Date();
  return `${date.toLocaleTimeString('zh-CN', { hour12: false })}.${String(
    date.getMilliseconds(),
  ).padStart(3, '0')}`;
}

/** Opt-in only: localStorage lumamark.debug-log=1 (default off, no HUD). */
export function isMenuDebugEnabled(): boolean {
  try {
    return resolveMenuDebugStorage()?.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMenuDebugEnabled(enabled: boolean): void {
  try {
    resolveMenuDebugStorage()?.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}

let domCaptureInstalled = false;

/** Install menu pointer capture when debug logging is enabled (no UI). */
export function ensureMenuDebugDomCapture(): void {
  if (!isMenuDebugEnabled() || domCaptureInstalled || typeof document === 'undefined') {
    return;
  }

  domCaptureInstalled = true;

  const onPointer = (event: PointerEvent) => {
    if (!isMenuDebugEnabled()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const item = target.closest(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .lm-menu-content, .lm-menu-trigger',
    );
    if (!item) {
      return;
    }

    const role = item.getAttribute('role') ?? item.className;
    const label = (item.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    logMenuInteraction(
      `DOM ${event.type} pointerType=${event.pointerType} role=${role} label="${label}" prevented=${event.defaultPrevented}`,
    );
  };

  for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
    document.addEventListener(type, onPointer, true);
  }
}

function ensureDomCapture(): void {
  ensureMenuDebugDomCapture();
}

export function logMenuInteraction(message: string): void {
  if (!isMenuDebugEnabled()) {
    return;
  }

  ensureDomCapture();

  const stamp = nowStamp();
  const line = `${stamp} ${message}`;
  console.info(`[LumaMark:menu] ${line}`);
  void appendDebugLogLine(line);
}
