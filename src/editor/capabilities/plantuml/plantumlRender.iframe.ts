import { renderPlantumlOnThread } from './plantumlEngine';
import type { PlantumlRenderOptions } from './plantumlEngine';

type PlantumlFrameRequest = {
  dark?: boolean;
  id: number;
  source: string;
};

const parentWindow = window.parent;
const parentOrigin = window.location.origin;

window.addEventListener(
  'message',
  (event: MessageEvent<PlantumlFrameRequest>) => {
    if (event.source !== parentWindow) {
      return;
    }

    const { dark, id, source } = event.data ?? {};
    if (typeof id !== 'number' || typeof source !== 'string') {
      return;
    }

    const options: PlantumlRenderOptions = dark ? { dark: true } : {};
    void renderPlantumlOnThread(source, options)
      .then((svg) => {
        parentWindow.postMessage({ id, svg }, parentOrigin);
      })
      .catch((error) => {
        parentWindow.postMessage(
          {
            error: error instanceof Error ? error.message : String(error),
            id,
          },
          parentOrigin,
        );
      });
  },
);

parentWindow.postMessage({ ready: true }, parentOrigin);
