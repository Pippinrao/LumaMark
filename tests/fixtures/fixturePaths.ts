import { join } from 'node:path';

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'markdown');

export const markdownFixtureNames = [
  'basic.md',
  'headings.md',
  'emphasis.md',
  'lists.md',
  'task-list.md',
  'blockquote.md',
  'table.md',
  'code-blocks.md',
  'links-images.md',
  'remote-images.md',
  'live-preview-rich.md',
  'mermaid.md',
  'comprehensive.md',
  'gfm-edge-cases.md',
  'mermaid-gallery.md',
  'mermaid-edge-cases.md',
  'math.md',
  'mixed-chinese-english.md',
  'large-1mb.md',
  'large-5mb.md',
  'large-10mb.md',
] as const;

export const markdownFixturePaths = markdownFixtureNames.map((name) => ({
  name,
  path: join(fixtureDirectory, name),
}));

export const largeMarkdownFixtureNames = [
  'large-1mb.md',
  'large-5mb.md',
  'large-10mb.md',
] as const;

export const largeMarkdownFixturePaths = largeMarkdownFixtureNames.map((name) => ({
  name,
  path: join(fixtureDirectory, name),
}));
