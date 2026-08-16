import {
  createPlantumlCacheKey,
  PlantumlRenderCache,
  type PlantumlCacheKeyInput,
} from './PlantumlRenderCache';

type RenderJobResult<T> = {
  cacheKey: string;
  value: T;
};

export type PlantumlRenderRequest = PlantumlCacheKeyInput & {
  blockId: string;
  jobOwner: object;
  onError?: (error: unknown) => void;
  onLoading?: () => void;
  onSuccess: (result: PlantumlRenderResult) => void;
};

export type PlantumlRenderResult = RenderJobResult<string> & {
  svg: string;
};

export type PlantumlRenderContext = PlantumlCacheKeyInput & {
  cacheKey: string;
};

export type PlantumlRenderSchedulerOptions = {
  cache?: PlantumlRenderCache;
  debounceMs?: number;
  render: (context: PlantumlRenderContext) => Promise<string>;
};

type PendingJob = {
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type OwnerJobState = {
  jobs: Map<string, PendingJob>;
  nextGenerationByBlockId: Map<string, number>;
};

export class PlantumlRenderScheduler {
  private readonly cache: PlantumlRenderCache;
  private readonly debounceMs: number;
  private readonly ownerJobStates = new WeakMap<object, OwnerJobState>();
  private readonly render: (context: PlantumlRenderContext) => Promise<string>;

  constructor(options: PlantumlRenderSchedulerOptions) {
    this.cache = options.cache ?? new PlantumlRenderCache();
    this.debounceMs = options.debounceMs ?? 200;
    this.render = options.render;
  }

  request(request: PlantumlRenderRequest): { cancel: () => void } {
    const cacheKey = createPlantumlCacheKey(request);
    const ownerState = this.getOwnerJobState(request.jobOwner);
    const previousJob = ownerState.jobs.get(request.blockId);
    const generation = this.nextGeneration(ownerState, request.blockId);

    if (previousJob?.timer) {
      clearTimeout(previousJob.timer);
    }

    ownerState.jobs.delete(request.blockId);

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
      void this.runRender(request, cacheKey, generation, ownerState);
    }, this.debounceMs);

    ownerState.jobs.set(request.blockId, {
      generation,
      timer,
    });

    return {
      cancel: () => this.cancel(ownerState, request.blockId, generation),
    };
  }

  private getOwnerJobState(owner: object): OwnerJobState {
    let ownerState = this.ownerJobStates.get(owner);

    if (!ownerState) {
      ownerState = {
        jobs: new Map(),
        nextGenerationByBlockId: new Map(),
      };
      this.ownerJobStates.set(owner, ownerState);
    }

    return ownerState;
  }

  private nextGeneration(ownerState: OwnerJobState, blockId: string): number {
    const generation =
      (ownerState.nextGenerationByBlockId.get(blockId) ?? 0) + 1;
    ownerState.nextGenerationByBlockId.set(blockId, generation);

    return generation;
  }

  private cancel(
    ownerState: OwnerJobState,
    blockId: string,
    generation: number,
  ): void {
    const job = ownerState.jobs.get(blockId);

    if (!job || job.generation !== generation) {
      return;
    }

    if (job.timer) {
      clearTimeout(job.timer);
    }

    ownerState.jobs.delete(blockId);
  }

  private async runRender(
    request: PlantumlRenderRequest,
    cacheKey: string,
    generation: number,
    ownerState: OwnerJobState,
  ): Promise<void> {
    try {
      const svg = await this.render({
        cacheKey,
        dark: request.dark,
        source: request.source,
      });
      const activeJob = ownerState.jobs.get(request.blockId);

      if (!activeJob || activeJob.generation !== generation) {
        return;
      }

      this.cache.set(cacheKey, svg);
      ownerState.jobs.delete(request.blockId);
      request.onSuccess({
        cacheKey,
        svg,
        value: svg,
      });
    } catch (error) {
      const activeJob = ownerState.jobs.get(request.blockId);

      if (!activeJob || activeJob.generation !== generation) {
        return;
      }

      ownerState.jobs.delete(request.blockId);
      request.onError?.(error);
    }
  }
}
