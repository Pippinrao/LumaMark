import { join } from 'node:path';

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'markdown');

export const markdownFixtureNames = [
  'basic.md',
  'headings.md',
  'emphasis.md',
  'lists.md',
  'task-list.md',
  'blockquote.md',
  'code-blocks.md',
  'links-images.md',
  'mermaid.md',
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
