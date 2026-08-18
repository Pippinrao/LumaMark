import { createPlantumlRenderWorker } from './createPlantumlRenderWorker';
import type { PlantumlRenderOptions } from './plantumlEngine';

type SchedulerLike = {
  postTask: (
    callback: () => void,
    options?: { priority?: string },
  ) => Promise<unknown>;
};

export type PlantumlOffThreadAdapter = {
  render: (source: string, options?: PlantumlRenderOptions) => Promise<string>;
};

let adapter: PlantumlOffThreadAdapter | null = null;
let defaultAdapter: PlantumlOffThreadAdapter | null = null;
let nextRequestId = 1;

export function yieldPlantumlRenderTurn(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (typeof scheduler?.postTask === 'function') {
    return Promise.resolve(scheduler.postTask(() => undefined, {
      priority: 'background',
    })).then(() => undefined);
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

export function setPlantumlOffThreadAdapter(
  next: PlantumlOffThreadAdapter | null,
): void {
  adapter = next;
}

export function getPlantumlOffThreadAdapter(): PlantumlOffThreadAdapter {
  if (adapter) {
    return adapter;
  }
  defaultAdapter ??= createWorkerPlantumlAdapter();
  return defaultAdapter;
}

export function renderPlantuml(
  source: string,
  options: PlantumlRenderOptions = {},
): Promise<string> {
  return getPlantumlOffThreadAdapter().render(source, options);
}

function createWorkerPlantumlAdapter(): PlantumlOffThreadAdapter {
  const pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (svg: string) => void;
    }
  >();
  const worker = createPlantumlRenderWorker();
  worker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { error?: string; id?: number; svg?: string };
    if (typeof data?.id !== 'number') {
      return;
    }
    const request = pending.get(data.id);
    if (!request) {
      return;
    }
    pending.delete(data.id);
    if (typeof data.error === 'string') {
      request.reject(new Error(data.error));
      return;
    }
    request.resolve(typeof data.svg === 'string' ? data.svg : '');
  });

  return {
    render(source, options = {}) {
      const id = nextRequestId++;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { reject, resolve });
        worker.postMessage({
          dark: options.dark === true,
          id,
          source,
        });
      });
    },
  };
}
