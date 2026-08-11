import type { EditorCapability } from '../editorCapability';
import { codeBlockPreviewExtension } from './codeBlockDecorations';
import { codeBlockInputExtension } from './codeBlockInput';

export function createCodeBlockCapability(): EditorCapability {
  return {
    extensions: [
      codeBlockPreviewExtension(),
      codeBlockInputExtension(),
    ],
    id: 'codeBlock',
  };
}
