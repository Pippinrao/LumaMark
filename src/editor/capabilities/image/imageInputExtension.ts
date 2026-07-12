import {
  EditorSelection,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { ImageImportHandler } from '../../core/editorDisplayMode';
import type { ImageImportErrorHandler } from '../../core/editorDisplayMode';

type PendingImageImport = {
  from: number;
  id: number;
  to: number;
};

const addPendingImageImport = StateEffect.define<PendingImageImport>();
const removePendingImageImport = StateEffect.define<number>();
export const invalidatePendingImageImports = StateEffect.define<null>();
let nextPendingImageImportId = 0;

export const imageInputTrackingExtension = StateField.define<
  readonly PendingImageImport[]
>({
  create: () => [],
  update(value, transaction) {
    let next = value.map((pending) => {
      const from = transaction.changes.mapPos(pending.from, -1);
      return {
        ...pending,
        from,
        to:
          pending.from === pending.to
            ? from
            : transaction.changes.mapPos(pending.to, 1),
      };
    });

    for (const effect of transaction.effects) {
      if (effect.is(addPendingImageImport)) {
        next = [...next, effect.value];
      } else if (effect.is(removePendingImageImport)) {
        next = next.filter((pending) => pending.id !== effect.value);
      } else if (effect.is(invalidatePendingImageImports)) {
        next = [];
      }
    }

    return next;
  },
});

function imageFilesFromItems(items: DataTransferItemList | null): File[] {
  if (!items) {
    return [];
  }

  return Array.from(items).flatMap((item) => {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file?.type.startsWith('image/') ? [file] : [];
  });
}

function imageFilesFromList(files: FileList | null): File[] {
  return files ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
}

export function imageMarkdown(
  images: readonly { alt: string; markdownSource: string }[],
): string {
  return images
    .map(
      (image) =>
        `![${escapeMarkdownAlt(image.alt)}](${markdownDestination(image.markdownSource)})`,
    )
    .join('\n');
}

function escapeMarkdownAlt(alt: string): string {
  return alt
    .replace(/\\/g, '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

function markdownDestination(source: string): string {
  if (!/[\s()<>]/.test(source)) {
    return source;
  }

  return `<${source
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')}>`;
}

export function insertImageReferences(
  view: EditorView,
  images: readonly { alt: string; markdownSource: string }[],
  position?: { x: number; y: number },
  selectionOverride?: { from: number; to: number },
): void {
  if (position) {
    const bounds = view.dom.getBoundingClientRect();

    if (
      position.x < bounds.left ||
      position.x > bounds.right ||
      position.y < bounds.top ||
      position.y > bounds.bottom
    ) {
      return;
    }
  }

  const dropPosition = position ? view.posAtCoords(position) : null;

  if (position && dropPosition === null) {
    return;
  }

  const selection =
    selectionOverride ?? (dropPosition === null
      ? view.state.selection.main
      : EditorSelection.cursor(dropPosition));
  const text = imageMarkdown(images);

  view.dispatch({
    changes: { from: selection.from, insert: text, to: selection.to },
    selection: EditorSelection.cursor(selection.from + text.length),
    userEvent: 'input.paste',
  });
  view.focus();
}

export async function importFiles(
  view: EditorView,
  files: readonly File[],
  handler: ImageImportHandler,
  documentPath: string | null,
): Promise<void> {
  const initialSelection = view.state.selection.main;
  const pendingId = nextPendingImageImportId++;
  const inserted: { alt: string; markdownSource: string }[] = [];

  view.dispatch({
    effects: addPendingImageImport.of({
      from: initialSelection.from,
      id: pendingId,
      to: initialSelection.to,
    }),
  });

  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await handler({ bytes, documentPath, mimeType: file.type });
      inserted.push({
        alt: file.name || 'image',
        markdownSource: result.markdownSource,
      });
    }

    const pending = view.state
      .field(imageInputTrackingExtension, false)
      ?.find((candidate) => candidate.id === pendingId);
    if (!pending) {
      return;
    }

    insertImageReferences(view, inserted, undefined, pending);
  } finally {
    if (view.state.field(imageInputTrackingExtension, false)) {
      view.dispatch({ effects: removePendingImageImport.of(pendingId) });
    }
  }
}

export function imageInputExtension(
  handler: ImageImportHandler | undefined,
  documentPath: string | null,
  onError?: ImageImportErrorHandler,
): Extension {
  if (!handler) {
    return [];
  }

  return [imageInputTrackingExtension, EditorView.domEventHandlers({
    dragover(event) {
      if (imageFilesFromItems(event.dataTransfer?.items ?? null).length === 0) {
        return false;
      }

      event.preventDefault();
      return true;
    },
    drop(event, view) {
      const files = imageFilesFromList(event.dataTransfer?.files ?? null);
      if (files.length === 0) {
        return false;
      }

      event.preventDefault();
      void importFiles(view, files, handler, documentPath).catch(onError);
      return true;
    },
    paste(event, view) {
      const files = imageFilesFromItems(event.clipboardData?.items ?? null);
      if (files.length === 0) {
        return false;
      }

      event.preventDefault();
      void importFiles(view, files, handler, documentPath).catch(onError);
      return true;
    },
  })];
}
