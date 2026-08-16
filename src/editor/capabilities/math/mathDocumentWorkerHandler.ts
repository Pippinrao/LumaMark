import { renderMathDocument } from './mathDocumentRenderer';
import type {
  MathDocumentWorkerRequest,
  MathDocumentWorkerResponse,
} from './mathWorkerProtocol';

export async function handleMathDocumentWorkerRequest(
  message: MathDocumentWorkerRequest,
): Promise<MathDocumentWorkerResponse> {
  try {
    return {
      result: await renderMathDocument(message.request),
      type: 'render-result',
    };
  } catch (error) {
    return {
      documentId: message.request.documentId,
      error: error instanceof Error ? error.message : String(error),
      generation: message.request.generation,
      type: 'render-fatal',
    };
  }
}
