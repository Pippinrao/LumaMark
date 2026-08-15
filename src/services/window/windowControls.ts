export type WindowControlHandle = {
  close: () => Promise<void>;
  destroy: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  minimize: () => Promise<void>;
  onResized: (listener: () => void) => Promise<() => void>;
  onCloseRequested: (
    listener: (event: WindowCloseRequestedEvent) => void | Promise<void>,
  ) => Promise<() => void>;
  toggleMaximize: () => Promise<void>;
};

export type WindowCloseRequestedEvent = {
  preventDefault: () => void;
};

export type WindowControlErrorCode =
  | 'window.close_listener_failed'
  | 'window.destroy_failed';

export type WindowControlResolver = () => Promise<WindowControlHandle | null>;

export type WindowControls = {
  close: () => Promise<boolean>;
  destroy: () => Promise<boolean>;
  isMaximized: () => Promise<boolean | null>;
  minimize: () => Promise<boolean>;
  onResized: (listener: () => void) => Promise<(() => void) | null>;
  onCloseRequested: (
    listener: (event: WindowCloseRequestedEvent) => void | Promise<void>,
  ) => Promise<(() => void) | null>;
  toggleMaximize: () => Promise<boolean>;
};

async function resolveTauriWindow(): Promise<WindowControlHandle | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');

    return getCurrentWindow();
  } catch {
    return null;
  }
}

async function runWindowAction(
  resolveWindow: WindowControlResolver,
  action: 'close' | 'destroy' | 'minimize' | 'toggleMaximize',
): Promise<boolean> {
  const currentWindow = await resolveWindow();

  if (!currentWindow) {
    return false;
  }

  try {
    await currentWindow[action]();

    return true;
  } catch {
    return false;
  }
}

async function subscribeToWindowResize(
  resolveWindow: WindowControlResolver,
  listener: () => void,
): Promise<(() => void) | null> {
  const currentWindow = await resolveWindow();

  if (!currentWindow) {
    return null;
  }

  try {
    return await currentWindow.onResized(listener);
  } catch {
    return null;
  }
}

async function listenForCloseRequests(
  resolveWindow: WindowControlResolver,
  listener: (event: WindowCloseRequestedEvent) => void | Promise<void>,
): Promise<(() => void) | null> {
  const currentWindow = await resolveWindow();

  if (!currentWindow) {
    return null;
  }

  try {
    return await currentWindow.onCloseRequested(listener);
  } catch (error) {
    throw createWindowControlError(
      'window.close_listener_failed',
      'Unable to register the native window close listener.',
      error,
    );
  }
}

async function readWindowMaximized(
  resolveWindow: WindowControlResolver,
): Promise<boolean | null> {
  const currentWindow = await resolveWindow();

  if (!currentWindow) {
    return null;
  }

  try {
    return await currentWindow.isMaximized();
  } catch {
    return null;
  }
}

export function createWindowControls(
  resolveWindow: WindowControlResolver = resolveTauriWindow,
): WindowControls {
  return {
    close: () => runWindowAction(resolveWindow, 'close'),
    destroy: () => runWindowAction(resolveWindow, 'destroy'),
    isMaximized: () => readWindowMaximized(resolveWindow),
    minimize: () => runWindowAction(resolveWindow, 'minimize'),
    onResized: (listener) => subscribeToWindowResize(resolveWindow, listener),
    onCloseRequested: (listener) =>
      listenForCloseRequests(resolveWindow, listener),
    toggleMaximize: () => runWindowAction(resolveWindow, 'toggleMaximize'),
  };
}

export const windowControls = createWindowControls();

export function createWindowControlError(
  code: WindowControlErrorCode,
  message: string,
  cause?: unknown,
): Error & { code: WindowControlErrorCode; cause?: unknown } {
  return Object.assign(new Error(message), { cause, code });
}
