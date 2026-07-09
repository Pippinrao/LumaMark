import type { Extension } from '@codemirror/state';

export type EditorCapabilityId = 'codeBlock' | 'image' | 'mermaid' | 'table';

export type EditorCapabilityCommands = {
  copyTable(): Promise<boolean>;
  deleteTable(): boolean;
  insertTable(): boolean;
  wrapCodeBlock(): boolean;
};

export type EditorCapability = {
  commands?: Partial<EditorCapabilityCommands>;
  extensions: Extension[];
  id: EditorCapabilityId;
};
