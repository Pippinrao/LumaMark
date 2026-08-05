import { lazy, Suspense, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import type { EditorApi } from '../../editor/core/editorApi';
import type {
  EditorAppearance,
  EditorZoomRequestedHandler,
} from '../../editor/core/editorAppearance';
import type {
  EditorDocumentChangedHandler,
  EditorMediaPreviewRequestHandler,
} from '../../editor/core/editorEvents';
import type {
  ImageAssetResolver,
  ImageImportErrorHandler,
  ImageImportHandler,
} from '../../editor/core/editorDisplayMode';
import type { AppLanguage } from '../../shared/i18n';
import type {
  ShellActionId,
  ShellContextMenuItem,
} from './shellTypes';

const LazyEditorViewHost = lazy(() =>
  import('../../editor/core/EditorViewHost').then((module) => ({
    default: module.EditorViewHost,
  })),
);

type EditorPaneProps = {
  accessibleTitle: string;
  appearance: EditorAppearance;
  ariaLabel: string;
  getContextMenuItems: (target: EventTarget) => ShellContextMenuItem[];
  onAction: (action: ShellActionId) => void;
  onDocumentChanged: EditorDocumentChangedHandler;
  onEditorReady: (editor: EditorApi) => void;
  onZoomRequested: EditorZoomRequestedHandler;
  onMediaPreviewRequest: EditorMediaPreviewRequestHandler;
  imageAssetResolver?: ImageAssetResolver;
  imageImportErrorHandler?: ImageImportErrorHandler;
  imageImportHandler?: ImageImportHandler;
  language: AppLanguage;
  visibleDocumentTitle: string;
};

export function EditorPane({
  accessibleTitle,
  appearance,
  ariaLabel,
  getContextMenuItems,
  onAction,
  onDocumentChanged,
  onEditorReady,
  onZoomRequested,
  onMediaPreviewRequest,
  imageAssetResolver,
  imageImportErrorHandler,
  imageImportHandler,
  language,
  visibleDocumentTitle,
}: EditorPaneProps) {
  const [contextMenuItems, setContextMenuItems] = useState<ShellContextMenuItem[]>([]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <main
          className="lm-editor-pane"
          data-testid="editor-host"
          aria-label={ariaLabel}
          onContextMenuCapture={(event) => {
            setContextMenuItems(getContextMenuItems(event.target));
          }}
        >
          <div className="lm-editor-header">
            <span className="lm-editor-title">{visibleDocumentTitle}</span>
          </div>
          <div className="lm-editor-scroll">
            <div className="lm-editor-paper">
              <Suspense fallback={null}>
                <LazyEditorViewHost
                  accessibleTitle={accessibleTitle}
                  appearance={appearance}
                  ariaLabel={ariaLabel}
                  initialDoc=""
                  imageAssetResolver={imageAssetResolver}
                  imageImportErrorHandler={imageImportErrorHandler}
                  imageImportHandler={imageImportHandler}
                  language={language}
                  onDocumentChanged={onDocumentChanged}
                  onEditorReady={onEditorReady}
                  onZoomRequested={onZoomRequested}
                  onMediaPreviewRequest={onMediaPreviewRequest}
                />
              </Suspense>
            </div>
          </div>
        </main>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="lm-menu-content lm-context-menu-content">
          {contextMenuItems.map((item) => (
            <ContextMenu.Item
              className="lm-menu-item lm-context-menu-item"
              key={item.label}
              onSelect={() => {
                onAction(item.action);
              }}
            >
              <span>{item.label}</span>
              <kbd className="lm-menu-shortcut">{item.shortcut}</kbd>
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
