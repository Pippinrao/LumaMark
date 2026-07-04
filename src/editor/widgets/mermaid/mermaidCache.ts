export type MermaidCacheKeyInput = {
  config: Record<string, unknown>;
  mermaidVersion: string;
  source: string;
  theme: string;
};

type MermaidRenderCacheOptions = {
  maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 64;

export class MermaidRenderCache {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(options: MermaidRenderCacheOptions = {}) {
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

export function createMermaidCacheKey(input: MermaidCacheKeyInput): string {
  return JSON.stringify({
    config: sortJsonValue(input.config),
    mermaidVersion: input.mermaidVersion,
    source: input.source,
    theme: input.theme,
  });
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
  );
}
