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
