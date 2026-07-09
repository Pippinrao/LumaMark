import type { EditorCapability } from '../editorCapability';

export function createCodeBlockCapability(): EditorCapability {
  return {
    extensions: [],
    id: 'codeBlock',
  };
}

