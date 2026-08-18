import vizGlobalUrl from '@plantuml/core/viz-global.js?url';

type PlantumlCoreModule = {
  renderToString: (
    lines: readonly string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark?: boolean },
  ) => void;
};

export type PlantumlRenderOptions = {
  dark?: boolean;
};

let enginePromise: Promise<PlantumlCoreModule> | null = null;
let renderQueue: Promise<void> = Promise.resolve();

export { renderPlantuml } from './plantumlOffThread';

/**
 * TeaVM render path. Call only from the PlantUML worker/iframe, where the
 * runtime's process-wide mutable state can stay serial and off the input stack.
 */
export function renderPlantumlOnThread(
  source: string,
  options: PlantumlRenderOptions = {},
): Promise<string> {
  const result = renderQueue.then(async () => {
    const engine = await getPlantumlEngine();
    const lines = source.split(/\r\n|\r|\n/);

    return new Promise<string>((resolve, reject) => {
      engine.renderToString(
        lines,
        (svg) => resolve(svg),
        (message) => reject(new Error(message)),
        options.dark ? { dark: true } : undefined,
      );
    });
  });

  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}

export function getPlantumlEngine(): Promise<PlantumlCoreModule> {
  enginePromise ??= loadPlantumlEngine();
  return enginePromise;
}

async function loadPlantumlEngine(): Promise<PlantumlCoreModule> {
  await loadVizGlobalScript();
  return import('@plantuml/core');
}

function loadVizGlobalScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return import(/* @vite-ignore */ vizGlobalUrl).then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = vizGlobalUrl;
    script.onload = () => resolve();
    script.onerror = () => {
      reject(new Error('PlantUML Graphviz engine failed to load.'));
    };
    document.head.appendChild(script);
  });
}
