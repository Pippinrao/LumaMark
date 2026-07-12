import {
  createMermaidCacheKey,
  MermaidRenderCache,
  type MermaidCacheKeyInput,
} from './mermaidCache';

type RenderJobResult<T> = {
  cacheKey: string;
  value: T;
};

export type MermaidRenderRequest = MermaidCacheKeyInput & {
  blockId: string;
  onError?: (error: unknown) => void;
  onLoading?: () => void;
  onSuccess: (result: MermaidRenderResult) => void;
};

export type MermaidRenderResult = RenderJobResult<string> & {
  svg: string;
};

export type MermaidRenderContext = MermaidCacheKeyInput & {
  cacheKey: string;
};

export type MermaidRenderSchedulerOptions = {
  cache?: MermaidRenderCache;
  debounceMs?: number;
  render: (context: MermaidRenderContext) => Promise<string>;
};

type PendingJob = {
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export class MermaidRenderScheduler {
  private readonly cache: MermaidRenderCache;
  private readonly debounceMs: number;
  private readonly jobs = new Map<string, PendingJob>();
  private readonly nextGenerationByBlockId = new Map<string, number>();
  private readonly render: (context: MermaidRenderContext) => Promise<string>;

  constructor(options: MermaidRenderSchedulerOptions) {
    this.cache = options.cache ?? new MermaidRenderCache();
    this.debounceMs = options.debounceMs ?? 120;
    this.render = options.render;
  }

  request(request: MermaidRenderRequest): { cancel: () => void } {
    const cacheKey = createMermaidCacheKey(request);
    const previousJob = this.jobs.get(request.blockId);
    const generation = this.nextGeneration(request.blockId);

    if (previousJob?.timer) {
      clearTimeout(previousJob.timer);
    }

    this.jobs.delete(request.blockId);

    const cachedSvg = this.cache.get(cacheKey);

    if (cachedSvg) {
      request.onSuccess({
        cacheKey,
        svg: cachedSvg,
        value: cachedSvg,
      });
      return { cancel: () => undefined };
    }
    request.onLoading?.();

    const timer = setTimeout(() => {
      void this.runRender(request, cacheKey, generation);
    }, this.debounceMs);

    this.jobs.set(request.blockId, {
      generation,
      timer,
    });

    return {
      cancel: () => this.cancel(request.blockId, generation),
    };
  }

  private nextGeneration(blockId: string): number {
    const generation = (this.nextGenerationByBlockId.get(blockId) ?? 0) + 1;
    this.nextGenerationByBlockId.set(blockId, generation);

    return generation;
  }

  private cancel(blockId: string, generation: number): void {
    const job = this.jobs.get(blockId);

    if (!job || job.generation !== generation) {
      return;
    }

    if (job.timer) {
      clearTimeout(job.timer);
    }

    this.jobs.delete(blockId);
  }

  private async runRender(
    request: MermaidRenderRequest,
    cacheKey: string,
    generation: number,
  ): Promise<void> {
    try {
      const svg = await this.render({
        cacheKey,
        config: request.config,
        mermaidVersion: request.mermaidVersion,
        source: request.source,
        theme: request.theme,
      });
      const activeJob = this.jobs.get(request.blockId);

      if (!activeJob || activeJob.generation !== generation) {
        return;
      }

      this.cache.set(cacheKey, svg);
      this.jobs.delete(request.blockId);
      request.onSuccess({
        cacheKey,
        svg,
        value: svg,
      });
    } catch (error) {
      const activeJob = this.jobs.get(request.blockId);

      if (!activeJob || activeJob.generation !== generation) {
        return;
      }

      this.jobs.delete(request.blockId);
      request.onError?.(error);
    }
  }
}
