import type { EditorCapability } from '../editorCapability';
import { mermaidPreviewExtension } from './mermaidPreviewExtension';

export function createMermaidCapability(): EditorCapability {
  return {
    extensions: [mermaidPreviewExtension()],
    id: 'mermaid',
  };
}

