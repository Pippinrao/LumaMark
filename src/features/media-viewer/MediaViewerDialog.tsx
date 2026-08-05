import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { EditorMediaPreviewRequest } from '../../editor/core/editorEvents';
import './mediaViewer.css';

type MediaViewerDialogProps = {
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  open: boolean;
  request: EditorMediaPreviewRequest;
  sessionId?: number;
};

export function MediaViewerDialog({
  onOpenChange,
  onReturnFocus,
  open,
  request,
  sessionId = 0,
}: MediaViewerDialogProps) {
  const { t } = useTranslation();

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
            maxScale={8}
            minScale={0.25}
          >
            {({ resetTransform, zoomIn, zoomOut }) => (
              <>
                <div className="lm-media-viewer-toolbar">
                  <button
                    aria-label={t('mediaViewer.zoomOut')}
                    className="lm-icon-button"
                    onClick={() => zoomOut()}
                    title={t('mediaViewer.zoomOut')}
                    type="button"
                  >
                    <ZoomOut aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label={t('mediaViewer.resetZoom')}
                    className="lm-icon-button"
                    onClick={() => resetTransform()}
                    title={t('mediaViewer.resetZoom')}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label={t('mediaViewer.zoomIn')}
                    className="lm-icon-button"
                    onClick={() => zoomIn()}
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
