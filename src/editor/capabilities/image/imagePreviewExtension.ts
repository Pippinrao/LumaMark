import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
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
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import {
  ImageBlockWidget,
  imageBlockGeometryKey,
  type ImagePreviewContext,
} from './ImageBlockWidget';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import { readEditorDocumentContext } from '../../core/editorDisplayMode';
import './image.css';

export { collectImageBlocksInRanges } from './imageBlockDetection';
export type { ImageBlock } from './imageBlockDetection';
export { resolveMarkdownImageSource } from './imagePathResolver';
export type { ImagePreviewContext } from './ImageBlockWidget';
export type { ResolvedImageSource } from './imagePathResolver';

type ImageDecorationState = {
  blocks: readonly ImageBlock[];
  decorations: DecorationSet;
};

export const refreshImagePreviews = StateEffect.define<string>();

export function imagePreviewExtension(
  context: ImagePreviewContext = { documentPath: null },
): Extension {
  return imageDecorationsField(context);
}

function imageDecorationsField(context: ImagePreviewContext): Extension {
  const geometryCache = new BlockWidgetGeometryCache();

  return StateField.define<ImageDecorationState>({
    create(state) {
      const previewContext = resolveImagePreviewContext(state, context);
      const blocks = discoverImageBlocks(state, previewContext);

      return {
        blocks,
        decorations: buildImageDecorations(
          state,
          previewContext,
          blocks,
          geometryCache,
        ),
      };
    },
    update(value, transaction) {
      const shouldRefresh = transaction.effects.some((effect) =>
        effect.is(refreshImagePreviews),
      );
      const renderLockChanged =
        isEditorRenderLocked(transaction.startState) !==
        isEditorRenderLocked(transaction.state);
      const previewContext = resolveImagePreviewContext(
        transaction.state,
        context,
      );
      const contextChanged = imagePreviewContextChanged(
        resolveImagePreviewContext(transaction.startState, context),
        previewContext,
      );

      if (transaction.docChanged) {
        if (changedRangesAffectImageBlocks(transaction)) {
          const blocks = discoverImageBlocks(transaction.state, previewContext);

          return {
            blocks,
            decorations: buildImageDecorations(
              transaction.state,
              previewContext,
              blocks,
              geometryCache,
            ),
          };
        }

        const blocks = mapImageBlocks(value.blocks, transaction.changes);
        const shouldRebuildDecorations =
          shouldRefresh ||
          renderLockChanged ||
          contextChanged ||
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
            ? buildImageDecorations(
                transaction.state,
                previewContext,
                blocks,
                geometryCache,
              )
            : value.decorations.map(transaction.changes),
        };
      }

      if (
        shouldRefresh ||
        renderLockChanged ||
        contextChanged ||
        imageSelectionStateChanged(
          transaction.startState,
          value.blocks,
          transaction.state,
          value.blocks,
        )
      ) {
        if (contextChanged) {
          syncLocalImageSources(previewContext, value.blocks);
        }

        return {
          blocks: value.blocks,
          decorations: buildImageDecorations(
            transaction.state,
            previewContext,
            value.blocks,
            geometryCache,
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
  geometryCache: BlockWidgetGeometryCache,
): DecorationSet {
  const keyedBlocks = blocks.map((block) => ({
    block,
    geometryKey: imageBlockGeometryKey(block),
  }));
  geometryCache.retain(keyedBlocks.map(({ geometryKey }) => geometryKey));
  const builder = new RangeSetBuilder<Decoration>();

  for (const { block, geometryKey } of keyedBlocks) {
    const revision =
      context.imageAssetResolver?.getLocalSourceRevision?.(block.source);
    const active =
      !isEditorRenderLocked(state) && selectionIntersectsBlock(state, block);
    const widget = new ImageBlockWidget(
      block,
      context,
      revision,
      geometryCache,
      geometryKey,
    );

    if (active) {
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

function resolveImagePreviewContext(
  state: EditorState,
  fallback: ImagePreviewContext,
): ImagePreviewContext {
  const context = readEditorDocumentContext(state);
  if (!context) {
    return fallback;
  }

  return {
    documentPath: context.path,
    imageAssetResolver:
      context.imageAssetResolver ?? fallback.imageAssetResolver,
    onMediaPreviewRequest:
      context.onMediaPreviewRequest ?? fallback.onMediaPreviewRequest,
  };
}

function imagePreviewContextChanged(
  current: ImagePreviewContext,
  next: ImagePreviewContext,
): boolean {
  return (
    current.documentPath !== next.documentPath ||
    current.imageAssetResolver !== next.imageAssetResolver ||
    current.onMediaPreviewRequest !== next.onMediaPreviewRequest
  );
}
