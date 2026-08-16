import { handleMathDocumentWorkerRequest } from './mathDocumentWorkerHandler';
import type { MathDocumentWorkerRequest } from './mathWorkerProtocol';

type MathDocumentWorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<MathDocumentWorkerRequest>) => void,
  ) => void;
  postMessage: (message: unknown) => void;
};

const workerScope = globalThis as unknown as MathDocumentWorkerScope;

workerScope.addEventListener(
  'message',
  (event: MessageEvent<MathDocumentWorkerRequest>) => {
    void handleMathDocumentWorkerRequest(event.data)
      .then((response) => {
        workerScope.postMessage(response);
      })
      .catch((error) => {
        workerScope.postMessage({
          documentId: event.data.request.documentId,
          error: error instanceof Error ? error.message : String(error),
          generation: event.data.request.generation,
          type: 'render-fatal',
        });
      });
  },
);

export {};
