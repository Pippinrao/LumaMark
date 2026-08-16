export type PlantumlCacheKeyInput = {
  dark: boolean;
  source: string;
};

type PlantumlRenderCacheOptions = {
  maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 64;

export class PlantumlRenderCache {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(options: PlantumlRenderCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(key: string): string | undefined {
    return this.entries.get(key);
  }

  set(key: string, svg: string): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, svg);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }
}

export function createPlantumlCacheKey(input: PlantumlCacheKeyInput): string {
  return JSON.stringify({
    dark: input.dark,
    source: input.source,
  });
}
