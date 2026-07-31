import {
  EditorSelection,
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type {
  ImageAssetResolution,
  ImageAssetResolver,
} from '../../core/editorDisplayMode';
import {
  collectImageBlocksInRanges,
  type ImageBlock,
} from './imageBlockDetection';
import {
  changedRangesAffectImageBlocks,
  imageBlockPositionsChanged,
  imageSelectionStateChanged,
  mapImageBlocks,
  selectionIntersectsBlock,
} from './imageChangeDetection';
import './image.css';

export { collectImageBlocksInRanges } from './imageBlockDetection';
export type { ImageBlock } from './imageBlockDetection';

export type ImagePreviewContext = {
  documentPath: string | null;
  imageAssetResolver?: ImageAssetResolver;
};

type ImageDecorationState = {
  blocks: readonly ImageBlock[];
  decorations: DecorationSet;
};

export type ResolvedImageSource =
  | { kind: 'error'; reason: 'relative_without_document' }
  | { kind: 'resolved'; src: string };

export const refreshImagePreviews = StateEffect.define<string>();

export function imagePreviewExtension(
  context: ImagePreviewContext = { documentPath: null },
): Extension {
  return imageDecorationsField(context);
}

export function resolveMarkdownImageSource({
  documentPath,
  source,
}: {
  documentPath: string | null;
  source: string;
}): ResolvedImageSource {
  if (/^(?:https?:|data:|blob:)/i.test(source)) {
    return { kind: 'resolved', src: source };
  }

  if (isAbsolutePath(source)) {
    return { kind: 'resolved', src: toAssetUrl(source) };
  }

  if (!documentPath) {
    return { kind: 'error', reason: 'relative_without_document' };
  }

  return {
    kind: 'resolved',
    src: toAssetUrl(resolveRelativePath(documentPath, source)),
  };
}

function imageDecorationsField(context: ImagePreviewContext): Extension {
  return StateField.define<ImageDecorationState>({
    create(state) {
      const blocks = discoverImageBlocks(state, context);

      return {
        blocks,
        decorations: buildImageDecorations(state, context, blocks),
      };
    },
    update(value, transaction) {
      const shouldRefresh = transaction.effects.some((effect) =>
        effect.is(refreshImagePreviews),
      );

      if (transaction.docChanged) {
        if (changedRangesAffectImageBlocks(transaction)) {
          const blocks = discoverImageBlocks(transaction.state, context);

          return {
            blocks,
            decorations: buildImageDecorations(
              transaction.state,
              context,
              blocks,
            ),
          };
        }

        const blocks = mapImageBlocks(value.blocks, transaction.changes);
        const shouldRebuildDecorations =
          shouldRefresh ||
          imageBlockPositionsChanged(value.blocks, blocks) ||
          imageSelectionStateChanged(
            transaction.startState,
            value.blocks,
            transaction.state,
            blocks,
          );

        return {
          blocks,
          decorations: shouldRebuildDecorations
            ? buildImageDecorations(transaction.state, context, blocks)
            : value.decorations.map(transaction.changes),
        };
      }

      if (
        shouldRefresh ||
        imageSelectionStateChanged(
          transaction.startState,
          value.blocks,
          transaction.state,
          value.blocks,
        )
      ) {
        return {
          blocks: value.blocks,
          decorations: buildImageDecorations(
            transaction.state,
            context,
            value.blocks,
          ),
        };
      }

      return value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
}

function buildImageDecorations(
  state: EditorState,
  context: ImagePreviewContext,
  blocks: readonly ImageBlock[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    const revision =
      context.imageAssetResolver?.getLocalSourceRevision?.(block.source);
    const widget = new ImageBlockWidget(block, context, revision);

    if (selectionIntersectsBlock(state, block)) {
      builder.add(
        block.to,
        block.to,
        Decoration.widget({
          block: true,
          side: 1,
          widget,
        }),
      );
      continue;
    }

    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        block: true,
        widget,
      }),
    );
  }

  return builder.finish();
}

function discoverImageBlocks(
  state: EditorState,
  context: ImagePreviewContext,
): readonly ImageBlock[] {
  const blocks = collectImageBlocksInRanges(state, [
    { from: 0, to: state.doc.length },
  ]);
  syncLocalImageSources(context, blocks);

  return blocks;
}

class ImageBlockWidget extends WidgetType {
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
      widget.revision === this.revision
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('figure');
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
      return this.renderRemotePlaceholder(wrapper);
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

    const image = document.createElement('img');
    image.alt = this.block.alt;
    image.src = resolved.src;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      wrapper.classList.add('lm-image-preview-error');
      if (!wrapper.querySelector('.lm-image-error')) {
        const error = createCaption(i18n.t('image.loadFailed'));
        error.classList.add('lm-image-error');
        wrapper.appendChild(error);
      }
    });
    wrapper.appendChild(image);

    if (this.block.alt.trim()) {
      wrapper.appendChild(createCaption(this.block.alt));
    }

    return wrapper;
  }

  private renderRemotePlaceholder(wrapper: HTMLElement): HTMLElement {
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
        renderRemoteResolution(wrapper, this.block.alt, resolution);
      })
      .catch(() => {
        renderRemoteResolution(wrapper, this.block.alt, {
          kind: 'error',
          reason: 'remote_cache_failed',
        });
      });

    return wrapper;
  }
}

function syncLocalImageSources(
  context: ImagePreviewContext,
  blocks: readonly ImageBlock[],
): void {
  const sync = context.imageAssetResolver?.syncLocalSources;

  if (!sync) {
    return;
  }

  const sources = blocks
    .map((block) => block.source)
    .filter(isWatchableLocalImageSource);
  void Promise.resolve(
    sync({
      documentPath: context.documentPath,
      sources: [...new Set(sources)],
    }),
  ).catch(() => undefined);
}

function isWatchableLocalImageSource(source: string): boolean {
  return !/^(?:https?:|data:|blob:|lumamark-draft:)/i.test(source);
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
  const image = document.createElement('img');
  image.alt = alt;
  image.loading = 'lazy';
  image.src = resolution.src;
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

function isAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\');
}

function isDraftImageSource(source: string): boolean {
  return source.startsWith('lumamark-draft://');
}

function resolveRelativePath(documentPath: string, source: string): string {
  const separator = documentPath.includes('\\') ? '\\' : '/';
  const directory = documentPath.replace(/[\\/][^\\/]*$/, '');
  const parts = `${directory}${separator}${source}`.split(/[\\/]+/);
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  if (/^[a-z]:$/i.test(resolved[0] ?? '')) {
    return `${resolved[0]}\\${resolved.slice(1).join('\\')}`;
  }

  return `${documentPath.startsWith('/') ? '/' : ''}${resolved.join(separator)}`;
}

function toAssetUrl(path: string): string {
  const tauriInternals = (
    globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (filePath: string, protocol?: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;

  return tauriInternals?.convertFileSrc
    ? tauriInternals.convertFileSrc(path)
    : `asset://localhost/${encodeURIComponent(path)}`;
}
