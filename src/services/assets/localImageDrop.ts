import { isTauri } from '@tauri-apps/api/core';

export type LocalImageDrop = {
  paths: string[];
  position: { x: number; y: number };
};

type NativeDropEvent = {
  payload:
    | {
        paths: string[];
        position: { x: number; y: number };
        type: 'drop';
      }
    | {
        paths: string[];
        position: { x: number; y: number };
        type: 'enter';
      }
    | { position: { x: number; y: number }; type: 'over' }
    | { type: 'leave' };
};

type NativeDropListener = (
  handler: (event: NativeDropEvent) => void,
) => Promise<() => void>;
type ScaleFactorWatcher = (
  handler: (scaleFactor: number) => void,
) => Promise<() => void>;

const IMAGE_PATH_PATTERN = /\.(?:gif|jpe?g|png|svg|webp)$/i;
const noOp = () => undefined;

export async function subscribeToLocalImageDrops(
  onDrop: (drop: LocalImageDrop) => void,
  options: {
    listen?: NativeDropListener;
    scaleFactor?: number;
    watchScaleFactor?: ScaleFactorWatcher;
  } = {},
): Promise<() => void> {
  if (!options.listen && !isTauri()) {
    return noOp;
  }

  const listen =
    options.listen ??
    (async (handler) => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');

      return getCurrentWebview().onDragDropEvent(
        handler as Parameters<
          ReturnType<typeof getCurrentWebview>['onDragDropEvent']
        >[0],
      );
    });
  let scaleFactor = options.scaleFactor ?? 1;
  let watchScaleFactor = options.watchScaleFactor;

  if (!options.listen && options.scaleFactor === undefined) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    scaleFactor = await window.scaleFactor();
    watchScaleFactor = async (handler) =>
      window.onScaleChanged(({ payload }) => handler(payload.scaleFactor));
  }

  const unlistenScaleFactor = watchScaleFactor
    ? await watchScaleFactor((nextScaleFactor) => {
        scaleFactor = nextScaleFactor;
      })
    : noOp;

  const unlistenDrop = await listen((event) => {
    if (event.payload.type !== 'drop') {
      return;
    }

    const paths = event.payload.paths.filter((path) =>
      IMAGE_PATH_PATTERN.test(path),
    );

    if (paths.length > 0) {
      onDrop({
        paths,
        position: {
          x: event.payload.position.x / scaleFactor,
          y: event.payload.position.y / scaleFactor,
        },
      });
    }
  });

  return () => {
    unlistenDrop();
    unlistenScaleFactor();
  };
}
