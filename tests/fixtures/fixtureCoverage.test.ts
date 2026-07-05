import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownFixtureManifest } from './markdownFixtureManifest';
import { requiredMermaidRenderSamples } from './mermaidSamples';

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'markdown');

const requiredTags = [
  'commonmark:heading',
  'commonmark:paragraph',
  'commonmark:emphasis',
  'commonmark:link',
  'commonmark:image',
  'commonmark:blockquote',
  'commonmark:list',
  'commonmark:code',
  'commonmark:html',
  'commonmark:thematic-break',
  'gfm:table',
  'gfm:task-list',
  'gfm:strikethrough',
  'gfm:autolink',
  'gfm:escaped-pipe-table',
  'i18n:mixed-chinese-english',
  'typora-like:live-preview',
  'mermaid:flowchart',
  'mermaid:sequenceDiagram',
  'mermaid:classDiagram',
  'mermaid:stateDiagram-v2',
  'mermaid:erDiagram',
  'mermaid:journey',
  'mermaid:gantt',
  'mermaid:pie',
  'mermaid:gitGraph',
  'mermaid:mindmap',
  'mermaid:timeline',
  'mermaid:quadrantChart',
  'mermaid:requirementDiagram',
  'mermaid:error',
  'mermaid:source-fidelity-only',
] as const;

describe('markdown fixture coverage manifest', () => {
  it('references fixture files that exist and are non-empty', async () => {
    for (const fixture of markdownFixtureManifest) {
      const path = join(fixtureDirectory, fixture.fileName);
      await expect(access(path)).resolves.toBeUndefined();
      await expect(readFile(path, 'utf8')).resolves.toSatisfy(
        (content: string) => content.trim().length > 0,
      );
    }
  });

  it('covers every required Markdown and Mermaid syntax tag', () => {
    const coveredTags = new Set(
      markdownFixtureManifest.flatMap((fixture) => fixture.tags),
    );

    expect(
      requiredTags.filter((tag) => !coveredTags.has(tag)),
    ).toEqual([]);
  });

  it('marks every required Mermaid render sample in the fixture manifest', () => {
    const coveredTags = new Set(
      markdownFixtureManifest.flatMap((fixture) => fixture.tags),
    );

    expect(
      requiredMermaidRenderSamples
        .map((sample) => sample.id)
        .filter((id) => !coveredTags.has(`mermaid:${id}`)),
    ).toEqual([]);
  });
});
