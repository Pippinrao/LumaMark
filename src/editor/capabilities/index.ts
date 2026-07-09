import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { EditorDocumentContext } from '../core/editorDisplayMode';
import { markdownWysiwygExtension } from '../wysiwyg/markdownDecorations';
import type { EditorCapability, EditorCapabilityCommands } from './editorCapability';
import { createCodeBlockCapability } from './code-block/createCodeBlockCapability';
import { createCodeBlockCommands } from './code-block/codeBlockCommands';
import { createImageCapability } from './image/createImageCapability';
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
): EditorCapability[] {
  return [
    createCodeBlockCapability(),
    createImageCapability(context),
    createTableCapability(),
    createMermaidCapability(),
  ];
}

export function createLivePreviewExtensions(
  context: EditorDocumentContext,
): Extension[] {
  return [
    markdownWysiwygExtension(),
    ...createLivePreviewCapabilities(context).flatMap(
      (capability) => capability.extensions,
    ),
  ];
}

export function createEditorCapabilityCommands(
  view: EditorView,
): EditorCapabilityCommands {
  return {
    ...createTableCommands(view),
    ...createCodeBlockCommands(view),
  };
}
