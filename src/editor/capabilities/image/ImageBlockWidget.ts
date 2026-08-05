import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type {
  ImageAssetResolution,
  ImageAssetResolver,
} from '../../core/editorDisplayMode';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import {
  createMediaPreviewButton,
  getMediaPreviewButtonLabel,
} from '../mediaPreviewButton';
import type { ImageBlock } from './imageBlockDetection';
import {
  isAbsolutePath,
  isDraftImageSource,
  resolveMarkdownImageSource,
} from './imagePathResolver';

export type ImagePreviewContext = {
  documentPath: string | null;
  imageAssetResolver?: ImageAssetResolver;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

export class ImageBlockWidget extends WidgetType {
  constructor(
    private readonly block: ImageBlock,
    private readonly context: ImagePreviewContext,
    private readonly revision: number | undefined,
  ) {
    super();
  }

  eq(widget: ImageBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.alt === this.block.alt &&
      widget.block.source === this.block.source &&
      widget.context.documentPath === this.context.documentPath &&
      widget.context.onMediaPreviewRequest === this.context.onMediaPreviewRequest &&
      widget.revision === this.revision
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('figure');
    const getExpandLabel = () => getMediaPreviewButtonLabel(view.state);
    wrapper.className = 'lm-image-preview';
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(
          Math.min(this.block.from + 2, this.block.to - 1),
        ),
        scrollIntoView: true,
      });
      view.focus();
    });

    if (
      this.context.imageAssetResolver &&
      !/^(?:data:|blob:)/i.test(this.block.source)
    ) {
      return this.renderRemotePlaceholder(wrapper, getExpandLabel);
    }

    const resolved = resolveMarkdownImageSource({
      documentPath: this.context.documentPath,
      source: this.block.source,
    });

    if (resolved.kind === 'error') {
      wrapper.classList.add('lm-image-preview-error');
      wrapper.appendChild(createCaption(i18n.t('image.relativePathUnavailable')));
      return wrapper;
    }

    renderResolvedImage(
      wrapper,
      this.block.alt,
      resolved.src,
      getExpandLabel,
      this.context.onMediaPreviewRequest,
    );
    return wrapper;
  }

  private renderRemotePlaceholder(
    wrapper: HTMLElement,
    getExpandLabel: () => string,
  ): HTMLElement {
    if (
      !this.context.documentPath &&
      !isDraftImageSource(this.block.source) &&
      !isAbsolutePath(this.block.source)
    ) {
      wrapper.classList.add('lm-image-preview-error');
      wrapper.appendChild(
        createCaption(i18n.t('image.unsavedRemoteCacheUnavailable')),
      );
      return wrapper;
    }

    wrapper.appendChild(createCaption(i18n.t('image.downloading')));
    void this.context
      .imageAssetResolver?.({
        documentPath: this.context.documentPath,
        source: this.block.source,
      })
      .then((resolution) => {
        renderRemoteResolution(
          wrapper,
          this.block.alt,
          resolution,
          getExpandLabel,
          this.context.onMediaPreviewRequest,
        );
      })
      .catch(() => {
        renderRemoteResolution(
          wrapper,
          this.block.alt,
          { kind: 'error', reason: 'remote_cache_failed' },
          getExpandLabel,
          this.context.onMediaPreviewRequest,
        );
      });

    return wrapper;
  }
}

function createCaption(text: string): HTMLElement {
  const caption = document.createElement('figcaption');
  caption.className = 'lm-image-caption';
  caption.textContent = text;
  return caption;
}

function renderRemoteResolution(
  wrapper: HTMLElement,
  alt: string,
  resolution: ImageAssetResolution,
  getExpandLabel: () => string,
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler,
): void {
  wrapper.textContent = '';

  if (resolution.kind === 'error') {
    wrapper.classList.add('lm-image-preview-error');
    wrapper.appendChild(
      createCaption(
        i18n.t(
          resolution.reason === 'local_authorization_failed'
            ? 'image.loadFailed'
            : 'image.remoteCacheFailed',
        ),
      ),
    );
    return;
  }

  wrapper.classList.remove('lm-image-preview-error');
  renderResolvedImage(
    wrapper,
    alt,
    resolution.src,
    getExpandLabel,
    onMediaPreviewRequest,
  );
}

function renderResolvedImage(
  wrapper: HTMLElement,
  alt: string,
  src: string,
  getExpandLabel: () => string,
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler,
): void {
  const image = document.createElement('img');
  image.alt = alt;
  image.loading = 'lazy';
  attachImagePreviewAction(
    wrapper,
    image,
    alt,
    getExpandLabel,
    onMediaPreviewRequest,
  );
  image.src = src;
  image.addEventListener('error', () => {
    wrapper.classList.add('lm-image-preview-error');
    if (!wrapper.querySelector('.lm-image-error')) {
      const error = createCaption(i18n.t('image.loadFailed'));
      error.classList.add('lm-image-error');
      wrapper.appendChild(error);
    }
  });
  wrapper.appendChild(image);

  if (alt.trim()) {
    wrapper.appendChild(createCaption(alt));
  }
}

function attachImagePreviewAction(
  wrapper: HTMLElement,
  image: HTMLImageElement,
  alt: string,
  getExpandLabel: () => string,
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler,
): void {
  if (!onMediaPreviewRequest) {
    return;
  }

  let button: HTMLButtonElement | null = null;
  const showExpandAction = () => {
    button ??= createMediaPreviewButton(
      () => {
        onMediaPreviewRequest({
          alt,
          kind: 'image',
          src: image.currentSrc || image.src,
        });
      },
      getExpandLabel(),
    );
    wrapper.appendChild(button);
  };
  image.addEventListener('load', showExpandAction);
  image.addEventListener('error', () => {
    button?.remove();
  });
  queueMicrotask(() => {
    if (image.complete && image.naturalWidth > 0) {
      showExpandAction();
    }
  });
}
