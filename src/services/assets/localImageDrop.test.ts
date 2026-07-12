import { describe, expect, it, vi } from 'vitest';
import { subscribeToLocalImageDrops } from './localImageDrop';

describe('local image drop service', () => {
  it('forwards supported native image paths in order with the drop position', async () => {
    let listener:
      | ((event: {
          payload:
            | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
            | { type: 'over'; position: { x: number; y: number } };
        }) => void)
      | undefined;
    const unlisten = vi.fn();
    const listen = vi.fn(async (handler: typeof listener) => {
      listener = handler;
      return unlisten;
    });
    const onDrop = vi.fn();

    const dispose = await subscribeToLocalImageDrops(onDrop, { listen });
    listener?.({
      payload: {
        paths: [
          'C:\\Pictures\\first.PNG',
          'C:\\Pictures\\notes.txt',
          'C:\\Pictures\\second.webp',
        ],
        position: { x: 120, y: 240 },
        type: 'drop',
      },
    });

    expect(onDrop).toHaveBeenCalledWith({
      paths: ['C:\\Pictures\\first.PNG', 'C:\\Pictures\\second.webp'],
      position: { x: 120, y: 240 },
    });
    dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('converts Tauri physical drop coordinates to CSS logical coordinates', async () => {
    let listener:
      | ((event: {
          payload: {
            type: 'drop';
            paths: string[];
            position: { x: number; y: number };
          };
        }) => void)
      | undefined;
    const listen = vi.fn(async (handler: typeof listener) => {
      listener = handler;
      return () => undefined;
    });
    const onDrop = vi.fn();

    await subscribeToLocalImageDrops(onDrop, { listen, scaleFactor: 1.5 });
    listener?.({
      payload: {
        paths: ['C:\\Pictures\\scaled.png'],
        position: { x: 300, y: 150 },
        type: 'drop',
      },
    });

    expect(onDrop).toHaveBeenCalledWith({
      paths: ['C:\\Pictures\\scaled.png'],
      position: { x: 200, y: 100 },
    });
  });

  it('uses the latest scale factor after moving between monitors', async () => {
    let listener:
      | ((event: {
          payload: {
            type: 'drop';
            paths: string[];
            position: { x: number; y: number };
          };
        }) => void)
      | undefined;
    let updateScaleFactor: ((scaleFactor: number) => void) | undefined;
    const onDrop = vi.fn();

    await subscribeToLocalImageDrops(onDrop, {
      listen: async (handler) => {
        listener = handler;
        return () => undefined;
      },
      scaleFactor: 1,
      watchScaleFactor: async (handler) => {
        updateScaleFactor = handler;
        return () => undefined;
      },
    });
    updateScaleFactor?.(2);
    listener?.({
      payload: {
        paths: ['C:\\Pictures\\scaled.png'],
        position: { x: 300, y: 150 },
        type: 'drop',
      },
    });

    expect(onDrop).toHaveBeenCalledWith({
      paths: ['C:\\Pictures\\scaled.png'],
      position: { x: 150, y: 75 },
    });
  });
});
