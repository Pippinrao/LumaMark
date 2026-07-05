export type WindowControlHandle = {
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  minimize: () => Promise<void>;
  startDragging: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
};

export type WindowControlResolver = () => Promise<WindowControlHandle | null>;

export type WindowControls = {
  close: () => Promise<boolean>;
  isMaximized: () => Promise<boolean | null>;
  minimize: () => Promise<boolean>;
  startDragging: () => Promise<boolean>;
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
  action: 'close' | 'minimize' | 'startDragging' | 'toggleMaximize',
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
    isMaximized: () => readWindowMaximized(resolveWindow),
    minimize: () => runWindowAction(resolveWindow, 'minimize'),
    startDragging: () => runWindowAction(resolveWindow, 'startDragging'),
    toggleMaximize: () => runWindowAction(resolveWindow, 'toggleMaximize'),
  };
}

export const windowControls = createWindowControls();
