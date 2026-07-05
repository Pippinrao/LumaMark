import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntaxTree } from '@codemirror/language';
import {
  markdown,
  markdownLanguage as gfmMarkdownLanguage,
} from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { markdownFixtureManifest } from '../../tests/fixtures/markdownFixtureManifest.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(
  await readFile(
    join(repoRoot, 'scripts', 'quality', 'markdown-corpus-manifest.json'),
    'utf8',
  ),
);
const cacheDirectory = join(repoRoot, manifest.cacheDirectory);
const index = JSON.parse(
  await readFile(join(cacheDirectory, 'index.json'), 'utf8').catch(() => {
    throw new Error(
      'Markdown corpus cache is missing. Run `pnpm download:markdown-corpus` first.',
    );
  }),
);

if (index.files.length < manifest.minimumSampleCount) {
  throw new Error(
    `Expected at least ${manifest.minimumSampleCount} corpus samples, found ${index.files.length}.`,
  );
}

const aggregateNodeCounts = new Map();
let totalBytes = 0;

for (const file of index.files) {
  const text = await readFile(join(cacheDirectory, file.fileName), 'utf8');
  const byteLength = Buffer.byteLength(text, 'utf8');

  if (byteLength !== file.byteLength) {
    throw new Error(`Byte length mismatch for ${file.id}.`);
  }

  const state = EditorState.create({
    doc: text,
    extensions: [
      markdown({
        base: gfmMarkdownLanguage,
      }),
    ],
  });
  let nodeCount = 0;

  syntaxTree(state).iterate({
    enter(node) {
      nodeCount += 1;
      aggregateNodeCounts.set(
        node.name,
        (aggregateNodeCounts.get(node.name) ?? 0) + 1,
      );
    },
  });

  if (state.doc.toString() !== text) {
    throw new Error(`Source fidelity changed while parsing ${file.id}.`);
  }

  if (nodeCount <= 1) {
    throw new Error(`Lezer produced no meaningful Markdown nodes for ${file.id}.`);
  }

  totalBytes += byteLength;
}

for (const fixture of markdownFixtureManifest) {
  const text = await readFile(
    join(repoRoot, 'tests/fixtures/markdown', fixture.fileName),
    'utf8',
  );
  parseMarkdownAndCountNodes(text, aggregateNodeCounts);
}

if (totalBytes < manifest.minimumTotalBytes) {
  throw new Error(
    `Expected at least ${manifest.minimumTotalBytes} corpus bytes, found ${totalBytes}.`,
  );
}

const requiredNodes = [
  'ATXHeading1',
  'Autolink',
  'Blockquote',
  'BulletList',
  'Emphasis',
  'FencedCode',
  'HardBreak',
  'HTMLBlock',
  'InlineCode',
  'Link',
  'OrderedList',
  'Strikethrough',
  'Table',
  'Task',
  'URL',
];
const missingNodes = requiredNodes.filter(
  (nodeName) => !aggregateNodeCounts.has(nodeName),
);

if (missingNodes.length > 0) {
  throw new Error(
    `Markdown corpus did not cover required syntax nodes: ${missingNodes.join(', ')}.`,
  );
}

console.log(
  `Parsed ${index.files.length} Markdown corpus files (${totalBytes} bytes).`,
);
console.log(
  `Covered nodes: ${requiredNodes
    .map((nodeName) => `${nodeName}=${aggregateNodeCounts.get(nodeName)}`)
    .join(', ')}`,
);

function parseMarkdownAndCountNodes(text, nodeCounts) {
  const state = EditorState.create({
    doc: text,
    extensions: [
      markdown({
        base: gfmMarkdownLanguage,
      }),
    ],
  });
  let nodeCount = 0;

  syntaxTree(state).iterate({
    enter(node) {
      nodeCount += 1;
      nodeCounts.set(node.name, (nodeCounts.get(node.name) ?? 0) + 1);
    },
  });

  if (state.doc.toString() !== text) {
    throw new Error('Source fidelity changed while parsing Markdown text.');
  }

  if (nodeCount <= 1) {
    throw new Error('Lezer produced no meaningful Markdown nodes.');
  }
}
