export type CommandShortcutLabels = ReturnType<
  typeof createCommandShortcutLabels
>;

export function createCommandShortcutLabels(userAgent: string) {
  const isMac = isMacUserAgent(userAgent);
  const primary = isMac ? 'Cmd' : 'Ctrl';

  return {
    bold: `${primary}+B`,
    codeBlock: `${primary}+Shift+K`,
    commandPalette: `${primary}+K`,
    copyTable: `${primary}+Alt+C`,
    deleteTable: `${primary}+Alt+Backspace`,
    find: `${primary}+F`,
    focusMode: `${primary}+Shift+F`,
    heading1: `${primary}+1`,
    heading2: `${primary}+2`,
    heading3: `${primary}+3`,
    heading4: `${primary}+4`,
    heading5: `${primary}+5`,
    heading6: `${primary}+6`,
    image: `${primary}+Shift+I`,
    italic: `${primary}+I`,
    newDocument: `${primary}+N`,
    normalParagraph: `${primary}+0`,
    openFile: `${primary}+O`,
    redo: isMac ? `${primary}+Shift+Z` : `${primary}+Y`,
    save: `${primary}+S`,
    saveAs: `${primary}+Shift+S`,
    sidebar: `${primary}+\\`,
    sourceMode: `${primary}+/`,
    table: `${primary}+T`,
    undo: `${primary}+Z`,
  } as const;
}

export function isMacUserAgent(userAgent: string): boolean {
  return /Mac/i.test(userAgent);
}
