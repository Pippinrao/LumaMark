import { afterEach, describe, expect, it, vi } from 'vitest';

describe('plantumlEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@plantuml/core');
  });

  it('forwards dark rendering to the TeaVM engine', async () => {
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

    const { renderPlantuml } = await import('./plantumlEngine');
    await expect(
      renderPlantuml('@startuml\nA -> B\n@enduml', { dark: true }),
    ).resolves.toBe('<svg data-dark="true"></svg>');
    expect(renderToString.mock.calls[0]?.[3]).toEqual({ dark: true });
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
