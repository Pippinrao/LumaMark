import { describe, expect, it } from 'vitest';
import type { CommandHandlerMap } from './commandTypes';
import { createCommandPaletteModels } from './createCommandModels';

describe('createCommandPaletteModels', () => {
  it('disables opening a file while another file is opening', () => {
    const commands = createCommandPaletteModels({
      fileOpening: true,
      handlers: {} as CommandHandlerMap,
      shortcuts: {
        copy: 'Ctrl Alt C',
        delete: 'Ctrl Alt Backspace',
        insert: 'Ctrl Alt T',
      },
      t: (key) => key,
    });

    expect(commands.find((command) => command.id === 'open-file')).toMatchObject({
      disabled: true,
    });
  });
});
