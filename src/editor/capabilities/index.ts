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
import { createMathCapability } from './math/createMathCapability';
import { createMathCommands } from './math/mathCommands';
import { createPlantumlCapability } from './plantuml/createPlantumlCapability';
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
  const capabilities: EditorCapability[] = [
    createCodeBlockCapability(),
    createImageCapability(context),
    createTableCapability(renderLocked),
    createMermaidCapability(context),
    createMathCapability(context, renderLocked ? 'reading' : 'livePreview'),
  ];

  if (context.plantuml?.enabled !== false) {
    capabilities.push(createPlantumlCapability(context));
  }

  return capabilities;
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
    ...createMathCommands(view),
  };
}
