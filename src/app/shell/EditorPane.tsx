import {
  lazy,
  Suspense,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
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
  PlantumlDocumentSettings,
} from '../../editor/core/editorDisplayMode';
import type { EditorLinkNavigationRequestHandler } from '../../editor/core/editorLinkNavigationExtension';
import {
  deriveInteractionAtPosition,
  deriveTableInteractionAtPosition,
  type EditorContextTarget,
} from '../../editor/interaction';
import type { AppLanguage } from '../../shared/i18n';
import type { EditorMathPreferences } from '../../editor/capabilities/math/mathPreferences';
import { ContextMenuSurface } from './ContextMenuSurface';
import type {
  EditorPaneContextMenuHandlers,
  ShellMenuInvocation,
  ShellMenuNode,
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
  closeContextMenu: EditorPaneContextMenuHandlers['closeContextMenu'];
  getContextMenuNodes: (target: EditorContextTarget) => ShellMenuNode[];
  onDocumentChanged: EditorDocumentChangedHandler;
  onEditorReady: (editor: EditorApi) => void;
  onInvoke: (invocation: ShellMenuInvocation) => void;
  onLinkNavigationRequest: EditorLinkNavigationRequestHandler;
  onZoomRequested: EditorZoomRequestedHandler;
  onMediaPreviewRequest: EditorMediaPreviewRequestHandler;
  onReadOnlyEditAttempt?: () => void;
  prepareContextMenu: EditorPaneContextMenuHandlers['prepareContextMenu'];
  imageAssetResolver?: ImageAssetResolver;
  imageImportErrorHandler?: ImageImportErrorHandler;
  imageImportHandler?: ImageImportHandler;
  language: AppLanguage;
  mathPreferences: EditorMathPreferences;
  plantuml?: PlantumlDocumentSettings;
  visibleDocumentTitle: string;
};

function resolveContextTarget(
  editor: EditorApi,
  event: MouseEvent<HTMLElement>,
): EditorContextTarget {
  const { view } = editor;
  const widgetTableTarget = resolveWidgetTableTarget(editor, event.target);
  if (widgetTableTarget) {
    return widgetTableTarget;
  }

  const position = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  if (position == null) {
    return { at: view.state.selection.main.head, kind: 'plain' };
  }

  return deriveInteractionAtPosition(view.state, position);
}

function resolveWidgetTableTarget(
  editor: EditorApi,
  eventTarget: EventTarget,
): Extract<EditorContextTarget, { kind: 'table' }> | null {
  if (!(eventTarget instanceof Element)) {
    return null;
  }

  const widget = eventTarget.closest('.tbl-table-widget');
  if (!widget || !editor.view.dom.contains(widget)) {
    return null;
  }

  try {
    const position = editor.view.posAtDOM(widget);
    return deriveTableInteractionAtPosition(editor.view.state, position);
  } catch {
    return null;
  }
}

function isContextMenuKeyboardGesture(
  event: KeyboardEvent<HTMLElement>,
): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

function resolveKeyboardContextTarget(
  editor: EditorApi,
  eventTarget: EventTarget,
): EditorContextTarget {
  const widgetTableTarget = resolveWidgetTableTarget(editor, eventTarget);
  if (widgetTableTarget) {
    return widgetTableTarget;
  }

  const { main } = editor.view.state.selection;
  return main.empty
    ? deriveInteractionAtPosition(editor.view.state, main.head)
    : { from: main.from, kind: 'selection', to: main.to };
}

export function EditorPane({
  accessibleTitle,
  appearance,
  ariaLabel,
  closeContextMenu,
  getContextMenuNodes,
  onDocumentChanged,
  onEditorReady,
  onInvoke,
  onLinkNavigationRequest,
  onZoomRequested,
  onMediaPreviewRequest,
  onReadOnlyEditAttempt,
  prepareContextMenu,
  imageAssetResolver,
  imageImportErrorHandler,
  imageImportHandler,
  language,
  mathPreferences,
  plantuml,
  visibleDocumentTitle,
}: EditorPaneProps) {
  const [contextMenuNodes, setContextMenuNodes] = useState<ShellMenuNode[]>([]);
  const editorRef = useRef<EditorApi | null>(null);
  const keyboardContextTargetRef = useRef<EditorContextTarget | null>(null);

  return (
    <ContextMenu.Root>
      <main
        className="lm-editor-pane"
        data-testid="editor-host"
        aria-label={ariaLabel}
      >
        <div className="lm-editor-header">
          <span className="lm-editor-title">{visibleDocumentTitle}</span>
        </div>
        <div className="lm-editor-scroll">
          <ContextMenu.Trigger asChild>
            <div
              className="lm-editor-paper"
              onContextMenu={(event) => {
                const editor = editorRef.current;
                if (!editor) {
                  return;
                }

                // Capture the outer Markdown target before preparing the command
                // session, since pointer preparation may update the active view's
                // selection. Keep this in the Trigger's composed bubble handler: a
                // capture-phase state update can replace the Radix trigger.
                const keyboardTarget = keyboardContextTargetRef.current;
                keyboardContextTargetRef.current = null;
                const target =
                  keyboardTarget ?? resolveContextTarget(editor, event);
                if (!keyboardTarget) {
                  prepareContextMenu(
                    event.target,
                    { x: event.clientX, y: event.clientY },
                    'pointer',
                  );
                }
                setContextMenuNodes(getContextMenuNodes(target));
              }}
              onKeyDownCapture={(event) => {
                const editor = editorRef.current;
                if (!isContextMenuKeyboardGesture(event) || !editor) {
                  return;
                }

                event.preventDefault();
                const caret = editor.view.state.selection.main.head;
                const caretRect = editor.view.coordsAtPos(caret);
                const contentRect =
                  editor.view.contentDOM.getBoundingClientRect();
                keyboardContextTargetRef.current =
                  resolveKeyboardContextTarget(editor, event.target);
                prepareContextMenu(event.target, undefined, 'keyboard');
                try {
                  event.currentTarget.dispatchEvent(
                    new MouseEvent('contextmenu', {
                      bubbles: true,
                      cancelable: true,
                      clientX: caretRect?.left ?? contentRect.left,
                      clientY: caretRect?.bottom ?? contentRect.top,
                    }),
                  );
                } finally {
                  keyboardContextTargetRef.current = null;
                }
              }}
            >
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
                  mathPreferences={mathPreferences}
                  plantuml={plantuml}
                  onDocumentChanged={onDocumentChanged}
                  onEditorReady={(editor) => {
                    editorRef.current = editor;
                    onEditorReady(editor);
                  }}
                  onLinkNavigationRequest={onLinkNavigationRequest}
                  onZoomRequested={onZoomRequested}
                  onMediaPreviewRequest={onMediaPreviewRequest}
                  onReadOnlyEditAttempt={onReadOnlyEditAttempt}
                />
              </Suspense>
            </div>
          </ContextMenu.Trigger>
        </div>
      </main>
      <ContextMenu.Portal>
        <ContextMenuSurface
          nodes={contextMenuNodes}
          onClose={closeContextMenu}
          onInvoke={onInvoke}
        />
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
