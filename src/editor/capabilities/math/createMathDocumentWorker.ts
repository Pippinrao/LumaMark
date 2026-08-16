export function createMathDocumentWorker(): Worker {
  return new Worker(new URL('./mathDocumentWorker.ts', import.meta.url), {
    name: 'lumamark-math-document-renderer',
    type: 'module',
  });
}
