import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { EditorDocumentContext } from '../core/editorDisplayMode';
import { markdownWysiwygExtension } from '../wysiwyg/markdownDecorations';
import type { EditorCapability, EditorCapabilityCommands } from './editorCapability';
import { createCodeBlockCapability } from './code-block/createCodeBlockCapability';
import { createCodeBlockCommands } from './code-block/codeBlockCommands';
import { createImageCapability } from './image/createImageCapability';
import { createImageCommands } from './image/imageCommands';
import { createMermaidCapability } from './mermaid/createMermaidCapability';
import { createTableCapability } from './table/createTableCapability';
import { createTableCommands } from './table/tableCommands';

export type {
  EditorCapability,
  EditorCapabilityCommands,
  EditorCapabilityId,
} from './editorCapability';

export function createLivePreviewCapabilities(
  context: EditorDocumentContext,
  renderLocked: boolean,
): EditorCapability[] {
  return [
    createCodeBlockCapability(),
    createImageCapability(context),
    createTableCapability(renderLocked),
    createMermaidCapability(context),
  ];
}

export function createLivePreviewExtensions(
  context: EditorDocumentContext,
  renderLocked: boolean,
): Extension[] {
  return [
    markdownWysiwygExtension(),
    ...createLivePreviewCapabilities(context, renderLocked).flatMap(
      (capability) => capability.extensions,
    ),
  ];
}

export function createEditorCapabilityCommands(
  view: EditorView,
  options: {
    writeClipboardText?: (text: string) => Promise<void>;
  } = {},
): EditorCapabilityCommands {
  return {
    ...createImageCommands(view),
    ...createTableCommands(view, options.writeClipboardText),
    ...createCodeBlockCommands(view),
  };
}
