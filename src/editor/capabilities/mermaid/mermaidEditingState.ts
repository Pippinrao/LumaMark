const editingMermaidBlocks = new Set<number>();

export function rememberEditingMermaidBlock(from: number): void {
  editingMermaidBlocks.add(from);
}

export function forgetEditingMermaidBlock(from: number): void {
  editingMermaidBlocks.delete(from);
}

export function isEditingMermaidBlock(from: number): boolean {
  return editingMermaidBlocks.has(from);
}
