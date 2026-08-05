import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import type { EditorMediaPreviewRequest } from '../../editor/core/editorEvents';
import './mediaViewer.css';

type MediaViewerDialogProps = {
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  open: boolean;
  request: EditorMediaPreviewRequest;
  sessionId?: number;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const SCALE_STEP = 0.5;

export function MediaViewerDialog({
  onOpenChange,
  onReturnFocus,
  open,
  request,
  sessionId = 0,
}: MediaViewerDialogProps) {
  const { t } = useTranslation();
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [scale, setScale] = useState(1);

  const zoomIn = () => {
    if (scale < MAX_SCALE) {
      transformRef.current?.zoomIn(SCALE_STEP, 0);
    }
  };
  const zoomOut = () => {
    if (scale > MIN_SCALE) {
      transformRef.current?.zoomOut(SCALE_STEP, 0);
    }
  };
  const resetZoom = () => transformRef.current?.resetTransform(0);

  return (
    <Dialog.Root
      onOpenChange={onOpenChange}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="lm-media-viewer-overlay" />
        <Dialog.Content
          className="lm-media-viewer-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) {
              return;
            }

            if (event.key === '+' || event.key === '=') {
              event.preventDefault();
              zoomIn();
            } else if (event.key === '-') {
              event.preventDefault();
              zoomOut();
            } else if (event.key === '0') {
              event.preventDefault();
              resetZoom();
            }
          }}
        >
          <Dialog.Title className="lm-media-viewer-visually-hidden">
            {t('mediaViewer.title')}
          </Dialog.Title>
          <Dialog.Description className="lm-media-viewer-visually-hidden">
            {t('mediaViewer.description')}
          </Dialog.Description>
          <TransformWrapper
            centerOnInit
            key={sessionId}
            maxScale={MAX_SCALE}
            minScale={MIN_SCALE}
            onInit={({ state }) => setScale(state.scale)}
            onTransform={(_ref, state) => setScale(state.scale)}
            ref={transformRef}
            smooth={false}
          >
            {() => (
              <>
                <div className="lm-media-viewer-toolbar">
                  <button
                    aria-keyshortcuts="-"
                    aria-label={t('mediaViewer.zoomOut')}
                    aria-disabled={scale <= MIN_SCALE}
                    className="lm-icon-button"
                    onClick={zoomOut}
                    title={t('mediaViewer.zoomOut')}
                    type="button"
                  >
                    <ZoomOut aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-keyshortcuts="0"
                    aria-label={t('mediaViewer.resetZoom')}
                    className="lm-icon-button"
                    onClick={resetZoom}
                    title={t('mediaViewer.resetZoom')}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-keyshortcuts="+"
                    aria-label={t('mediaViewer.zoomIn')}
                    aria-disabled={scale >= MAX_SCALE}
                    className="lm-icon-button"
                    onClick={zoomIn}
                    title={t('mediaViewer.zoomIn')}
                    type="button"
                  >
                    <ZoomIn aria-hidden="true" size={18} />
                  </button>
                  <Dialog.Close
                    aria-label={t('dialog.close')}
                    className="lm-icon-button"
                    title={t('dialog.close')}
                  >
                    <X aria-hidden="true" size={18} />
                  </Dialog.Close>
                  <output
                    aria-label={t('mediaViewer.zoomLevel')}
                    aria-live="polite"
                    className="lm-media-viewer-scale"
                  >
                    {Math.round(scale * 100)}%
                  </output>
                </div>
                <TransformComponent
                  contentClass="lm-media-viewer-transform-content"
                  wrapperClass="lm-media-viewer-transform"
                >
                  {request.kind === 'image' ? (
                    <img alt={request.alt} src={request.src} />
                  ) : (
                    <div
                      className="lm-media-viewer-mermaid"
                      dangerouslySetInnerHTML={{ __html: request.svg }}
                    />
                  )}
                </TransformComponent>
              </>
            )}
          </TransformWrapper>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
