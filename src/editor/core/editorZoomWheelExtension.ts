import type { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { EditorZoomRequestedHandler } from './editorAppearance';

export const EDITOR_ZOOM_WHEEL_THROTTLE_MS = 80;

function hasPlatformZoomModifier(
  event: WheelEvent,
  isMacPlatform: boolean,
): boolean {
  const hasPrimaryModifier = isMacPlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return (
    hasPrimaryModifier &&
    !event.altKey &&
    !event.shiftKey &&
    !event.getModifierState('AltGraph')
  );
}

export function editorZoomWheelExtension(
  onZoomRequested: EditorZoomRequestedHandler,
  isMacPlatform = /Mac/i.test(navigator.userAgent),
): Extension {
  return ViewPlugin.define((view) => {
    let lastZoomRequestAt = Number.NEGATIVE_INFINITY;

    const handleWheel = (event: WheelEvent) => {
      if (
        !hasPlatformZoomModifier(event, isMacPlatform) ||
        event.deltaY === 0
      ) {
        return;
      }

      event.preventDefault();

      if (
        event.timeStamp - lastZoomRequestAt <
        EDITOR_ZOOM_WHEEL_THROTTLE_MS
      ) {
        return;
      }

      lastZoomRequestAt = event.timeStamp;
      onZoomRequested(event.deltaY < 0 ? 'in' : 'out');
    };

    view.scrollDOM.addEventListener('wheel', handleWheel, { passive: false });

    return {
      destroy() {
        view.scrollDOM.removeEventListener('wheel', handleWheel);
      },
    };
  });
}
