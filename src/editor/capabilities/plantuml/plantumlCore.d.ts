declare module '@plantuml/core' {
  export function render(
    lines: readonly string[],
    targetId: string,
    options?: { dark?: boolean },
  ): void;

  export function renderToString(
    lines: readonly string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark?: boolean },
  ): void;
}
