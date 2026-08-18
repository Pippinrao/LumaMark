import { afterEach, describe, expect, it, vi } from 'vitest';

describe('plantumlEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@plantuml/core');
    vi.unstubAllGlobals();
  });

  it('forwards dark rendering to the TeaVM engine on the dedicated thread helper', async () => {
    const renderToString = vi.fn(
      (
        _lines: readonly string[],
        onSuccess: (svg: string) => void,
        _onError: (message: string) => void,
        options?: { dark?: boolean },
      ) => {
        onSuccess(`<svg data-dark="${String(options?.dark === true)}"></svg>`);
      },
    );
    vi.doMock('@plantuml/core', () => ({ renderToString }));
    stubVizGlobalLoad();

    const { renderPlantumlOnThread } = await import('./plantumlEngine');
    await expect(
      renderPlantumlOnThread('@startuml\nA -> B\n@enduml', { dark: true }),
    ).resolves.toBe('<svg data-dark="true"></svg>');
    expect(renderToString.mock.calls[0]?.[3]).toEqual({ dark: true });
  });

  it('does not run TeaVM renderToString on the caller microtask after the engine is warm', async () => {
    const renderToString = vi.fn(
      (
        _lines: readonly string[],
        onSuccess: (svg: string) => void,
      ) => {
        const started = performance.now();
        while (performance.now() - started < 80) {
          // Simulate a TeaVM render occupying the main thread.
        }
        onSuccess('<svg></svg>');
      },
    );
    const posted: unknown[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        addEventListener(_type: string, _listener: (event: MessageEvent) => void) {}
        postMessage(message: unknown) {
          posted.push(message);
        }
        terminate() {}
      },
    );
    vi.doMock('@plantuml/core', () => ({ renderToString }));
    stubVizGlobalLoad();

    const { getPlantumlEngine, renderPlantuml } = await import('./plantumlEngine');
    await getPlantumlEngine();

    const started = performance.now();
    const pending = renderPlantuml('@startuml\nA -> B\n@enduml');
    await Promise.resolve();
    await Promise.resolve();
    expect(performance.now() - started).toBeLessThan(8);
    expect(renderToString).not.toHaveBeenCalled();
    expect(posted.length).toBeGreaterThan(0);
    pending.catch(() => undefined);
  });

  it('keeps a failed engine promise sticky instead of injecting Graphviz again', async () => {
    const createElement = stubVizGlobalLoad('error');
    const { getPlantumlEngine } = await import('./plantumlEngine');
    const first = getPlantumlEngine();
    const second = getPlantumlEngine();

    await expect(first).rejects.toThrow('PlantUML Graphviz engine failed to load.');
    await expect(second).rejects.toThrow('PlantUML Graphviz engine failed to load.');
    expect(second).toBe(first);
    expect(createElement).toHaveBeenCalledTimes(1);
  });
});

function stubVizGlobalLoad(result: 'load' | 'error' = 'load') {
  return vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
    const element = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      String(tagName),
    );
    queueMicrotask(() => {
      const script = element as HTMLScriptElement;
      if (result === 'load') {
        script.onload?.(new Event('load'));
      } else {
        script.onerror?.(new Event('error'));
      }
    });
    return element as HTMLElement;
  });
}
