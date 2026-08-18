export function createPlantumlRenderWorker(): Worker {
  return new Worker(new URL('./plantumlRender.worker.ts', import.meta.url), {
    name: 'lumamark-plantuml-renderer',
    type: 'module',
  });
}
