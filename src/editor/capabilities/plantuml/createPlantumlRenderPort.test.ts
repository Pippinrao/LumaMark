import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlantumlRenderPort,
  plantumlRenderFrameUrl,
  PLANTUML_RENDER_FRAME_PATH,
  PLANTUML_RENDER_FRAME_TITLE,
} from './createPlantumlRenderPort';

describe('createPlantumlRenderPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  });

  it('builds the renderer URL against the document base', () => {
    expect(plantumlRenderFrameUrl('http://127.0.0.1:1420/')).toBe(
      `http://127.0.0.1:1420/${PLANTUML_RENDER_FRAME_PATH}`,
    );
  });

  it('hosts rendering in a hidden iframe instead of a module Worker', () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);

    createPlantumlRenderPort();

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.title).toBe(PLANTUML_RENDER_FRAME_TITLE);
    expect(iframe?.getAttribute('aria-hidden')).toBe('true');
    expect(iframe?.src).toContain(PLANTUML_RENDER_FRAME_PATH);
    expect(worker).not.toHaveBeenCalled();
  });

  it('queues render requests until the iframe announces it is ready', () => {
    const port = createPlantumlRenderPort();
    const iframe = document.querySelector('iframe');
    const frameWindow = {
      postMessage: vi.fn(),
    };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    });

    port.postMessage({ id: 7, source: '@startuml\nA -> B\n@enduml' });
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { ready: true },
        source: frameWindow as unknown as Window,
      }),
    );

    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(frameWindow.postMessage.mock.calls[0]?.[0]).toEqual({
      id: 7,
      source: '@startuml\nA -> B\n@enduml',
    });
  });
});
