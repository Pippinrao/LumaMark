import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import * as Menubar from '@radix-ui/react-menubar';
import type {
  ShellActionId,
  ShellMenuGroup,
  TopChromeLabels,
  WindowControlsModel,
} from './shellTypes';

type TopChromeProps = {
  groups: ShellMenuGroup[];
  labels: TopChromeLabels;
  onAction: (action: ShellActionId) => void;
  windowChrome: WindowControlsModel;
};

export function TopChrome({
  groups,
  labels,
  onAction,
  windowChrome,
}: TopChromeProps) {
  return (
    <header
      className="lm-top-chrome"
      data-tauri-drag-region
      onMouseDown={windowChrome.onChromeMouseDown}
    >
      <h1 className="lm-app-heading">{labels.appName}</h1>

      <Menubar.Root
        className="lm-menu-bar"
        data-lm-window-interactive="true"
      >
        {groups.map((group) => (
          <Menubar.Menu key={group.label}>
            <Menubar.Trigger className="lm-menu-trigger">
              {group.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content
                className="lm-menu-content"
                align="start"
                sideOffset={12}
              >
                {group.items.map((item) => (
                  <Menubar.Item
                    className="lm-menu-item"
                    disabled={item.disabled}
                    key={item.label}
                    onSelect={() => {
                      if (item.action) {
                        onAction(item.action);
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut ? (
                      <kbd className="lm-menu-shortcut">{item.shortcut}</kbd>
                    ) : null}
                  </Menubar.Item>
                ))}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>

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
