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
import { ImageBlockWidget, type ImagePreviewContext } from './ImageBlockWidget';
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
