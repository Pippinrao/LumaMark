import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import './image.css';

type DocumentRange = {
  from: number;
  to: number;
};

type MarkdownSyntaxNode = {
  from: number;
  to: number;
  getChild: (type: string) => MarkdownSyntaxNode | null;
};

export type ImageBlock = {
  alt: string;
  blockId: string;
  from: number;
  source: string;
  to: number;
};

export type ImagePreviewContext = {
  documentPath: string | null;
};

export type ResolvedImageSource =
  | { kind: 'error'; reason: 'relative_without_document' }
  | { kind: 'resolved'; src: string };

export function imagePreviewExtension(
  context: ImagePreviewContext = { documentPath: null },
): Extension {
  return imageDecorationsField(context);
}

export function collectImageBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Image') {
          return;
        }

        const block = imageBlockFromNode(state, node.node);
        if (!block || seen.has(block.blockId)) {
          return;
        }

        seen.add(block.blockId);
        blocks.push(block);
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
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

function imageBlockFromNode(
  state: EditorState,
  node: MarkdownSyntaxNode,
): ImageBlock | null {
  const sourceNode = node.getChild('URL');

  if (!sourceNode) {
    return null;
  }

  const raw = state.doc.sliceString(node.from, node.to);
  const line = state.doc.lineAt(node.from);
  const lineText = state.doc.sliceString(line.from, line.to);

  if (lineText.trim() !== raw || node.to > line.to) {
    return null;
  }

  const altMatch = raw.match(/^!\[(?<alt>[^\]]*)\]/);
  const source = state.doc.sliceString(sourceNode.from, sourceNode.to).trim();

  return {
    alt: altMatch?.groups?.alt ?? '',
    blockId: `${line.from}:${line.to}`,
    from: line.from,
    source,
    to: line.to,
  };
}

function imageDecorationsField(context: ImagePreviewContext): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildImageDecorations(state, context);
    },
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildImageDecorations(transaction.state, context);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildImageDecorations(
  state: EditorState,
  context: ImagePreviewContext,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of collectImageBlocksInRanges(state, [
    { from: 0, to: state.doc.length },
  ])) {
    if (selectionIntersectsBlock(state, block)) {
      continue;
    }

    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        block: true,
        widget: new ImageBlockWidget(block, context),
      }),
    );
  }

  return builder.finish();
}

function selectionIntersectsBlock(state: EditorState, block: ImageBlock): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= block.from && range.from <= block.to;
    }

    return range.from < block.to && range.to > block.from;
  });
}

class ImageBlockWidget extends WidgetType {
  constructor(
    private readonly block: ImageBlock,
    private readonly context: ImagePreviewContext,
  ) {
    super();
  }

  eq(widget: ImageBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.alt === this.block.alt &&
      widget.block.source === this.block.source &&
      widget.context.documentPath === this.context.documentPath
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('figure');
    wrapper.className = 'lm-image-preview';
    const resolved = resolveMarkdownImageSource({
      documentPath: this.context.documentPath,
      source: this.block.source,
    });

    if (resolved.kind === 'error') {
      wrapper.classList.add('lm-image-preview-error');
      const message = document.createElement('figcaption');
      message.className = 'lm-image-caption';
      message.textContent = i18n.t('image.relativePathUnavailable');
      wrapper.appendChild(message);
      return wrapper;
    }

    const image = document.createElement('img');
    image.alt = this.block.alt;
    image.src = resolved.src;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      wrapper.classList.add('lm-image-preview-error');
      if (!wrapper.querySelector('.lm-image-error')) {
        const error = document.createElement('figcaption');
        error.className = 'lm-image-caption lm-image-error';
        error.textContent = i18n.t('image.loadFailed');
        wrapper.appendChild(error);
      }
    });
    wrapper.appendChild(image);

    if (this.block.alt.trim()) {
      const caption = document.createElement('figcaption');
      caption.className = 'lm-image-caption';
      caption.textContent = this.block.alt;
      wrapper.appendChild(caption);
    }

    return wrapper;
  }
}

function isAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\');
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
