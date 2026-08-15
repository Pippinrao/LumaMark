import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type {
  ImageAssetResolution,
  ImageAssetResolver,
} from '../../core/editorDisplayMode';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import {
  BlockWidgetGeometryCache,
  BlockWidgetGeometryTracker,
  blockWidgetGeometryKey,
} from '../blockWidgetGeometry';
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
  private readonly geometry: BlockWidgetGeometryTracker;

  constructor(
    private readonly block: ImageBlock,
    private readonly context: ImagePreviewContext,
    private readonly revision: number | undefined,
    geometryCache = new BlockWidgetGeometryCache(),
    geometryKey = imageBlockGeometryKey(block),
  ) {
    super();
    this.geometry = new BlockWidgetGeometryTracker(
      geometryCache,
      geometryKey,
    );
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

  get estimatedHeight(): number {
    return this.geometry.estimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('figure');
    const getExpandLabel = () => getMediaPreviewButtonLabel(view.state);
    wrapper.className = 'lm-image-preview';
    this.geometry.mount(view, wrapper);
    wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(
          Math.min(this.block.from + 2, this.block.to - 1),
        ),
        scrollIntoView: true,
      });
      view.focus();
    });

    const syncHeight = () => this.geometry.sync();

    if (
      this.context.imageAssetResolver &&
      !/^(?:data:|blob:)/i.test(this.block.source)
    ) {
      return this.renderRemotePlaceholder(wrapper, getExpandLabel, syncHeight);
    }

    const resolved = resolveMarkdownImageSource({
      documentPath: this.context.documentPath,
      source: this.block.source,
    });

    if (resolved.kind === 'error') {
      wrapper.classList.add('lm-image-preview-error');
      wrapper.appendChild(createCaption(i18n.t('image.relativePathUnavailable')));
      queueMicrotask(syncHeight);
      return wrapper;
    }

    renderResolvedImage(
      wrapper,
      this.block.alt,
      resolved.src,
      getExpandLabel,
      this.context.onMediaPreviewRequest,
      syncHeight,
    );
    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    this.geometry.unmount(dom);
  }

  private renderRemotePlaceholder(
    wrapper: HTMLElement,
    getExpandLabel: () => string,
    syncHeight: () => void,
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
      queueMicrotask(syncHeight);
      return wrapper;
    }

    wrapper.appendChild(createCaption(i18n.t('image.downloading')));
    queueMicrotask(syncHeight);
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
          syncHeight,
        );
      })
      .catch(() => {
        renderRemoteResolution(
          wrapper,
          this.block.alt,
          { kind: 'error', reason: 'remote_cache_failed' },
          getExpandLabel,
          this.context.onMediaPreviewRequest,
          syncHeight,
        );
      });

    return wrapper;
  }
}

export function imageBlockGeometryKey(block: ImageBlock): string {
  return blockWidgetGeometryKey('image', [block.alt, block.source]);
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
  onMediaPreviewRequest: EditorMediaPreviewRequestHandler | undefined,
  syncHeight: () => void,
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
    queueMicrotask(syncHeight);
    return;
  }

  wrapper.classList.remove('lm-image-preview-error');
  renderResolvedImage(
    wrapper,
    alt,
    resolution.src,
    getExpandLabel,
    onMediaPreviewRequest,
    syncHeight,
  );
}

function renderResolvedImage(
  wrapper: HTMLElement,
  alt: string,
  src: string,
  getExpandLabel: () => string,
  onMediaPreviewRequest: EditorMediaPreviewRequestHandler | undefined,
  syncHeight: () => void,
): void {
  const media = document.createElement('span');
  media.className = 'lm-image-preview-media';
  const image = document.createElement('img');
  image.alt = alt;
  image.loading = 'lazy';
  attachImagePreviewAction(
    media,
    image,
    alt,
    getExpandLabel,
    onMediaPreviewRequest,
  );
  image.addEventListener('load', () => {
    wrapper.classList.remove('lm-image-preview-error');
    wrapper.querySelector('.lm-image-error')?.remove();
    syncHeight();
  });
  image.addEventListener('error', () => {
    wrapper.classList.add('lm-image-preview-error');
    if (!wrapper.querySelector('.lm-image-error')) {
      const error = createCaption(i18n.t('image.loadFailed'));
      error.classList.add('lm-image-error');
      wrapper.appendChild(error);
    }
    syncHeight();
  });
  media.appendChild(image);
  wrapper.appendChild(media);

  if (alt.trim()) {
    wrapper.appendChild(createCaption(alt));
  }

  image.src = src;

  queueMicrotask(() => {
    if (image.complete) {
      syncHeight();
    }
  });
}

function attachImagePreviewAction(
  media: HTMLElement,
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
    media.appendChild(button);
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
