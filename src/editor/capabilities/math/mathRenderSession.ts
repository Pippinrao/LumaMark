import type {
  MathDocumentRenderRequest,
  MathDocumentRenderResult,
  MathDocumentWorkerRequest,
  MathDocumentWorkerResponse,
  MathFormulaRenderResult,
} from './mathWorkerProtocol';
import { MATH_RENDER_ENGINE_VERSION } from './mathWorkerProtocol';

export interface MathWorkerLike {
  onerror: ((event: ErrorEvent) => unknown) | null;
  onmessage: ((event: MessageEvent<MathDocumentWorkerResponse>) => unknown) | null;
  onmessageerror: ((event: MessageEvent) => unknown) | null;
  postMessage(message: MathDocumentWorkerRequest): void;
  terminate(): void;
}

export type MathRenderSessionStatus = 'error' | 'idle' | 'pending' | 'success';

export type MathRenderSessionSnapshot = {
  readonly documentId: string | null;
  readonly error: string | null;
  readonly generation: number;
  readonly lastSuccessfulFormulas: ReadonlyMap<string, MathFormulaRenderResult>;
  readonly result: MathDocumentRenderResult | null;
  readonly status: MathRenderSessionStatus;
};

export type MathRenderSessionOptions = {
  readonly createWorker: () => MathWorkerLike;
  readonly debounceMs?: number;
  readonly onChange?: (snapshot: MathRenderSessionSnapshot) => void;
  readonly watchdogMs?: number;
};

type RenderRequestWithoutGeneration = Omit<
  MathDocumentRenderRequest,
  'generation'
>;

const DEFAULT_DEBOUNCE_MS = 120;
const DEFAULT_WATCHDOG_MS = 10_000;
export class MathRenderSession {
  private readonly createWorker: () => MathWorkerLike;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private generation = 0;
  private inFlightGeneration: number | null = null;
  private readonly onChange?: (snapshot: MathRenderSessionSnapshot) => void;
  private pendingRequest: MathDocumentRenderRequest | null = null;
  private previousFormulas: MathDocumentRenderRequest['formulas'] = [];
  private requestKey: string | null = null;
  private state: MathRenderSessionSnapshot = createIdleSnapshot();
  private readonly watchdogMs: number;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private worker: MathWorkerLike | null = null;

  constructor(options: MathRenderSessionOptions) {
    this.createWorker = options.createWorker;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onChange = options.onChange;
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  }

  get snapshot(): MathRenderSessionSnapshot {
    return this.state;
  }

  request(request: RenderRequestWithoutGeneration): void {
    if (this.destroyed) {
      return;
    }

    const switchingDocument =
      this.state.documentId !== null &&
      this.state.documentId !== request.documentId;
    if (switchingDocument) {
      this.clearTimers();
      this.terminateWorker();
      this.state = createIdleSnapshot(request.documentId, this.generation);
      this.requestKey = null;
      this.previousFormulas = [];
    }

    const requestKey = orderedRequestKey(request);
    if (requestKey === this.requestKey) {
      return;
    }
    this.requestKey = requestKey;

    const generation = ++this.generation;
    const lastSuccessfulFormulas = retainMatchingSuccesses(
      this.state.lastSuccessfulFormulas,
      this.previousFormulas,
      request.formulas,
    );
    this.previousFormulas = request.formulas;
    this.pendingRequest = { ...request, generation };
    if (this.inFlightGeneration !== null) {
      this.terminateWorker();
    }
    this.clearDebounceTimer();
    this.clearWatchdogTimer();

    if (request.formulas.length === 0) {
      this.pendingRequest = null;
      this.publish({
        documentId: request.documentId,
        error: null,
        generation,
        lastSuccessfulFormulas: new Map(),
        result: null,
        status: 'idle',
      });
      return;
    }

    this.publish({
      ...this.state,
      documentId: request.documentId,
      error: null,
      generation,
      lastSuccessfulFormulas,
      result: null,
      status: 'pending',
    });
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPendingRequest(generation);
    }, this.debounceMs);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.pendingRequest = null;
    this.previousFormulas = [];
    this.requestKey = null;
    this.clearTimers();
    this.terminateWorker();
    this.state = createIdleSnapshot(null, this.generation);
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearDebounceTimer();
    this.clearWatchdogTimer();
  }

  private clearWatchdogTimer(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private ensureWorker(): MathWorkerLike {
    if (this.worker) {
      return this.worker;
    }

    const worker = this.createWorker();
    worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    worker.onerror = (event) => {
      this.handleWorkerFailure(event.message || 'Math rendering worker failed.');
    };
    worker.onmessageerror = () => {
      this.handleWorkerFailure('Math rendering worker returned an invalid message.');
    };
    this.worker = worker;
    return worker;
  }

  private flushPendingRequest(generation: number): void {
    const request = this.pendingRequest;
    if (
      this.destroyed ||
      !request ||
      request.generation !== generation ||
      this.state.generation !== generation
    ) {
      return;
    }

    this.inFlightGeneration = generation;
    try {
      this.ensureWorker().postMessage({ request, type: 'render' });
    } catch (error) {
      this.handleWorkerFailure(
        error instanceof Error ? error.message : 'Math rendering worker failed.',
      );
      return;
    }
    this.watchdogTimer = setTimeout(() => {
      if (this.state.generation === generation && this.state.status === 'pending') {
        this.handleWorkerFailure('Math rendering timed out.');
      }
    }, this.watchdogMs);
  }

  private handleWorkerFailure(message: string): void {
    if (this.destroyed || this.state.status !== 'pending') {
      return;
    }

    this.pendingRequest = null;
    this.requestKey = null;
    this.clearWatchdogTimer();
    this.terminateWorker();
    this.publish({
      ...this.state,
      error: message,
      result: null,
      status: 'error',
    });
  }

  private handleWorkerMessage(response: MathDocumentWorkerResponse): void {
    if (this.destroyed) {
      return;
    }

    if (response.type === 'render-fatal') {
      if (
        response.generation === this.state.generation &&
        response.documentId === this.state.documentId
      ) {
        this.handleWorkerFailure(response.error);
      }
      return;
    }

    const result = response.result;
    if (
      result.generation !== this.state.generation ||
      result.documentId !== this.state.documentId
    ) {
      return;
    }

    this.pendingRequest = null;
    this.inFlightGeneration = null;
    this.clearWatchdogTimer();
    const lastSuccessfulFormulas = new Map(this.state.lastSuccessfulFormulas);
    for (const formula of result.formulas) {
      if (formula.chtml !== undefined && formula.error === undefined) {
        lastSuccessfulFormulas.set(formula.id, formula);
      }
    }

    this.publish({
      documentId: result.documentId,
      error: null,
      generation: result.generation,
      lastSuccessfulFormulas,
      result,
      status: 'success',
    });
  }

  private publish(snapshot: MathRenderSessionSnapshot): void {
    this.state = snapshot;
    this.onChange?.(snapshot);
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.inFlightGeneration = null;
    if (!worker) {
      return;
    }

    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

function retainMatchingSuccesses(
  successes: ReadonlyMap<string, MathFormulaRenderResult>,
  previousFormulas: MathDocumentRenderRequest['formulas'],
  currentFormulas: MathDocumentRenderRequest['formulas'],
): ReadonlyMap<string, MathFormulaRenderResult> {
  const retained = new Map<string, MathFormulaRenderResult>();
  const changedIndexes = currentFormulas.flatMap((formula, index) =>
    formulaFingerprint(formula) === formulaFingerprint(previousFormulas[index])
      ? []
      : [index],
  );
  const oneFormulaEditedInPlace =
    previousFormulas.length === currentFormulas.length &&
    changedIndexes.length === 1;
  const orderedMatches =
    previousFormulas.length === currentFormulas.length &&
    changedIndexes.length <= 1
      ? currentFormulas.flatMap((formula, index) =>
          formulaFingerprint(formula) === formulaFingerprint(previousFormulas[index])
            ? [[index, index] as const]
            : [],
        )
      : orderedFormulaMatches(previousFormulas, currentFormulas);

  for (const [previousIndex, currentIndex] of orderedMatches) {
    const current = currentFormulas[currentIndex];
    const previous = previousFormulas[previousIndex];
    if (!current || !previous) {
      continue;
    }
    const exact = successes.get(previous.id);
    if (
      exact &&
      (exact.sourceFingerprint === undefined ||
        exact.sourceFingerprint === formulaFingerprint(previous))
    ) {
      retained.set(current.id, { ...exact, id: current.id });
    }
  }

  if (oneFormulaEditedInPlace) {
    const index = changedIndexes[0] as number;
    const formula = currentFormulas[index];
    const previousFormula = previousFormulas[index];
    const previous = successes.get(previousFormula?.id ?? '');
    if (formula && previous && previousFormula?.display === formula.display) {
      retained.set(formula.id, { ...previous, id: formula.id });
    }
  }
  return retained;
}

function orderedFormulaMatches(
  previousFormulas: MathDocumentRenderRequest['formulas'],
  currentFormulas: MathDocumentRenderRequest['formulas'],
): ReadonlyArray<readonly [number, number]> {
  const previous = previousFormulas.map(formulaFingerprint);
  const current = currentFormulas.map(formulaFingerprint);
  const width = current.length + 1;
  const lengths = new Uint16Array((previous.length + 1) * width);

  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
      const offset = previousIndex * width + currentIndex;
      lengths[offset] = previous[previousIndex] === current[currentIndex]
        ? (lengths[(previousIndex + 1) * width + currentIndex + 1] ?? 0) + 1
        : Math.max(
            lengths[(previousIndex + 1) * width + currentIndex] ?? 0,
            lengths[previousIndex * width + currentIndex + 1] ?? 0,
          );
    }
  }

  const matches: Array<readonly [number, number]> = [];
  let previousIndex = 0;
  let currentIndex = 0;
  while (previousIndex < previous.length && currentIndex < current.length) {
    if (previous[previousIndex] === current[currentIndex]) {
      matches.push([previousIndex, currentIndex]);
      previousIndex += 1;
      currentIndex += 1;
    } else if (
      (lengths[(previousIndex + 1) * width + currentIndex] ?? 0) >
      (lengths[previousIndex * width + currentIndex + 1] ?? 0)
    ) {
      previousIndex += 1;
    } else {
      currentIndex += 1;
    }
  }

  return matches;
}

function formulaFingerprint(
  formula: MathDocumentRenderRequest['formulas'][number] | undefined,
): string {
  return formula
    ? JSON.stringify([formula.display, formula.source])
    : '';
}

function orderedRequestKey(request: RenderRequestWithoutGeneration): string {
  return JSON.stringify([
    MATH_RENDER_ENGINE_VERSION,
    request.documentId,
    request.formulas,
    request.preferences,
    request.layoutMetrics,
  ]);
}

function createIdleSnapshot(
  documentId: string | null = null,
  generation = 0,
): MathRenderSessionSnapshot {
  return {
    documentId,
    error: null,
    generation,
    lastSuccessfulFormulas: new Map(),
    result: null,
    status: 'idle',
  };
}
