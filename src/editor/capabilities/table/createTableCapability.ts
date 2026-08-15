import type { EditorCapability } from '../editorCapability';
import { tablePreviewExtension } from './tablePreviewExtension';

export function createTableCapability(renderLocked: boolean): EditorCapability {
  return {
    extensions: [tablePreviewExtension(renderLocked)],
    id: 'table',
  };
}

