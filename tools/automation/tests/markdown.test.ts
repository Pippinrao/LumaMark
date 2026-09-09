import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDiagrams } from '../markdown.ts';

test('extracts nested fences without quote/list markers and preserves document lines', () => {
  const blocks = extractDiagrams([
    '# Heading', '', '> ```mermaid', '> flowchart TD', '> A --> B', '> ```', '',
    '- item', '', '  ~~~plantuml', '  @startuml', '  Alice -> Bob: hi', '  @enduml', '  ~~~',
  ].join('\r\n'));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source, 'flowchart TD\nA --> B');
  assert.deepEqual(blocks[0].sourceLines, [4, 5]);
  assert.equal(blocks[1].source, '@startuml\nAlice -> Bob: hi\n@enduml');
  assert.deepEqual(blocks[1].sourceLines, [11, 12, 13]);
});

test('retains empty and unclosed diagram fences for engine validation', () => {
  const blocks = extractDiagrams('```mermaid\n```\n\n```plantuml\n@startuml');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].source, '');
  assert.equal(blocks[1].source, '@startuml');
});

test('ignores diagram examples nested inside another code fence', () => {
  assert.equal(extractDiagrams('````markdown\n```mermaid\nbad\n```\n````').length, 0);
});

test('detects a first-line diagram fence in a UTF-8 BOM document', () => {
  const blocks = extractDiagrams('\uFEFF```mermaid\nflowchart TD\nA --> B\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].blockLine, 1);
});
