export const PLANTUML_RENDER_FRAME_PATH = 'plantuml-render-frame.html';
export const PLANTUML_RENDER_FRAME_TITLE = 'lumamark-plantuml-renderer';

export type PlantumlRenderPort = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
  postMessage(message: unknown): void;
};

type PlantumlFrameWindow = Window & {
  postMessage(message: unknown, targetOrigin: string): void;
};

/**
 * TeaVM PlantUML and viz-global.js need a document. Official @plantuml/core
 * therefore isolates rendering in a hidden iframe, not a module Worker.
 */
export function plantumlRenderFrameUrl(
  baseUrl: string = typeof document === 'undefined' ? '/' : document.baseURI,
): string {
  return new URL(PLANTUML_RENDER_FRAME_PATH, baseUrl).href;
}

export function createPlantumlRenderPort(
  doc: Document = document,
): PlantumlRenderPort {
  const iframe = doc.createElement('iframe');
  iframe.title = PLANTUML_RENDER_FRAME_TITLE;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  iframe.tabIndex = -1;

  const listeners = new Set<(event: MessageEvent) => void>();
  const queued: unknown[] = [];
  let ready = false;
  const frameUrl = plantumlRenderFrameUrl(doc.baseURI);
  const targetOrigin = new URL(frameUrl, doc.baseURI).origin;

  const flush = (frameWindow: PlantumlFrameWindow) => {
    while (queued.length > 0) {
      frameWindow.postMessage(queued.shift(), targetOrigin);
    }
  };

  const onHostMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) {
      return;
    }

    if (
      !ready &&
      event.data !== null &&
      typeof event.data === 'object' &&
      (event.data as { ready?: unknown }).ready === true
    ) {
      ready = true;
      const frameWindow = iframe.contentWindow as PlantumlFrameWindow | null;
      if (frameWindow) {
        flush(frameWindow);
      }
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  };

  doc.defaultView?.addEventListener('message', onHostMessage);
  iframe.src = frameUrl;
  (doc.body ?? doc.documentElement).appendChild(iframe);

  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    postMessage(message) {
      if (!ready) {
        queued.push(message);
        return;
      }

      const frameWindow = iframe.contentWindow as PlantumlFrameWindow | null;
      if (!frameWindow) {
        queued.push(message);
        return;
      }

      frameWindow.postMessage(message, targetOrigin);
    },
  };
}
