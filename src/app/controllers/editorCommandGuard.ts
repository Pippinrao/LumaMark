export function guardEditorCommand<TArgs extends unknown[]>(
  editorAvailable: boolean,
  command: (...args: TArgs) => void,
) {
  return (...args: TArgs) => {
    if (editorAvailable) {
      command(...args);
    }
  };
}
