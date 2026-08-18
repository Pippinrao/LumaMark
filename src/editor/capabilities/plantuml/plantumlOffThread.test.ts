import { afterEach, describe, expect, it, vi } from 'vitest';
import { yieldPlantumlRenderTurn } from './plantumlOffThread';

describe('yieldPlantumlRenderTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefers a background scheduler.postTask when the browser provides one', async () => {
    const postTask = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('scheduler', { postTask });

    await yieldPlantumlRenderTurn();

    expect(postTask).toHaveBeenCalledWith(expect.any(Function), {
      priority: 'background',
    });
  });
});

describe('plantuml off-thread adapter', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('posts PlantUML work through the off-thread adapter instead of TeaVM on the caller stack', async () => {
    const render = vi.fn(async () => '<svg data-off-thread="true"></svg>');
    const { renderWithPlantuml } = await import('./plantumlRenderAdapter');
    const { setPlantumlOffThreadAdapter } = await import('./plantumlOffThread');
    setPlantumlOffThreadAdapter({ render });

    await expect(
      renderWithPlantuml({
        cacheKey: 'off-thread',
        dark: false,
        source: '@startuml\nA -> B\n@enduml',
      }),
    ).resolves.toContain('data-off-thread="true"');
    expect(render).toHaveBeenCalled();
    setPlantumlOffThreadAdapter(null);
  });
});
