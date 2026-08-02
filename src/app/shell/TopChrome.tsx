import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import type {
  ShellMenuGroup,
  ShellMenuInvocation,
  TopChromeLabels,
  WindowControlsModel,
} from './shellTypes';
import { AppMenu } from './AppMenu';

type TopChromeProps = {
  groups: ShellMenuGroup[];
  labels: TopChromeLabels;
  onInvoke: (invocation: ShellMenuInvocation) => void;
  windowChrome: WindowControlsModel;
};

export function TopChrome({
  groups,
  labels,
  onInvoke,
  windowChrome,
}: TopChromeProps) {
  return (
    <header
      className="lm-top-chrome"
      data-tauri-drag-region
      onMouseDown={windowChrome.onChromeMouseDown}
    >
      <h1 className="lm-app-heading">{labels.appName}</h1>

      <AppMenu groups={groups} onInvoke={onInvoke} />

      <nav
        className="lm-window-controls"
        aria-label={labels.controls}
        data-lm-window-interactive="true"
      >
        <button
          className="lm-window-control"
          type="button"
          aria-label={labels.minimize}
          onClick={() => {
            windowChrome.onControl('minimize');
          }}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          className="lm-window-control"
          type="button"
          aria-label={
            windowChrome.maximized ? labels.restore : labels.maximize
          }
          onClick={() => {
            windowChrome.onControl('toggleMaximize');
          }}
        >
          {windowChrome.maximized ? (
            <Minimize2 size={13} aria-hidden="true" />
          ) : (
            <Maximize2 size={13} aria-hidden="true" />
          )}
        </button>
        <button
          className="lm-window-control lm-window-control-close"
          type="button"
          aria-label={labels.close}
          onClick={() => {
            windowChrome.onControl('close');
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </nav>
    </header>
  );
}
