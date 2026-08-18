import { renderPlantumlOnThread } from './plantumlEngine';
import type { PlantumlRenderOptions } from './plantumlEngine';

type PlantumlWorkerRequest = {
  dark?: boolean;
  id: number;
  source: string;
};

type PlantumlWorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<PlantumlWorkerRequest>) => void,
  ) => void;
  postMessage: (message: unknown) => void;
};

const workerScope = globalThis as unknown as PlantumlWorkerScope;

workerScope.addEventListener(
  'message',
  (event: MessageEvent<PlantumlWorkerRequest>) => {
    const { dark, id, source } = event.data;
    const options: PlantumlRenderOptions = dark ? { dark: true } : {};
    void renderPlantumlOnThread(source, options)
      .then((svg) => {
        workerScope.postMessage({ id, svg });
      })
      .catch((error) => {
        workerScope.postMessage({
          error: error instanceof Error ? error.message : String(error),
          id,
        });
      });
  },
);

export {};
