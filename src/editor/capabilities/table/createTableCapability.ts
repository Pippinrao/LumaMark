import type { EditorCapability } from '../editorCapability';
import { tablePreviewExtension } from './tablePreviewExtension';

export function createTableCapability(): EditorCapability {
  return {
    extensions: [tablePreviewExtension()],
    id: 'table',
  };
}

