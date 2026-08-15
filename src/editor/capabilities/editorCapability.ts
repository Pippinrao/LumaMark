import type { Extension } from '@codemirror/state';
import type { EditorInteractionRange } from '../interaction';

export type EditorCapabilityId = 'codeBlock' | 'image' | 'mermaid' | 'table';

export type EditorCapabilityCommands = {
  copyTable(range?: EditorInteractionRange): Promise<boolean>;
  deleteImageReference(range: { from: number; to: number }): boolean;
  deleteTable(range?: EditorInteractionRange): boolean;
  insertTable(): boolean;
  insertImages(
    images: readonly { alt: string; markdownSource: string }[],
    position?: { x: number; y: number },
  ): void;
  refreshImages(path: string): void;
  wrapCodeBlock(): boolean;
};

export type EditorCapability = {
  commands?: Partial<EditorCapabilityCommands>;
  extensions: Extension[];
  id: EditorCapabilityId;
};
