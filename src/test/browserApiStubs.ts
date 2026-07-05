if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

class TestResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

const windowWithObservers = globalThis.window as
  | (Window & typeof globalThis & { ResizeObserver?: typeof ResizeObserver })
  | undefined;

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
}

if (windowWithObservers && !windowWithObservers.ResizeObserver) {
  Object.defineProperty(windowWithObservers, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: globalThis.ResizeObserver,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
