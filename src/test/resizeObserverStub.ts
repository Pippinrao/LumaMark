export class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

export function installResizeObserverStub(): void {
  globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;
}
