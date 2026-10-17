import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const executable = resolve(
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'lumamark.exe' : 'lumamark',
);

if (process.platform !== 'win32') {
  process.stderr.write(
    '[cli-export] This acceptance script currently targets Windows WebView2.\n',
  );
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), 'lumamark-cli-export-'));
const markdownPath = join(directory, 'note.md');
const imagePath = join(directory, 'pic.png');
const htmlPath = join(directory, 'note.html');
const pdfPath = join(directory, 'note.pdf');

const markdown = [
  '# Export Test',
  '',
  'Hello **world**.',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- [x] done',
  '',
  'Inline $a+b$ math.',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '![pixel](pic.png)',
  '',
].join('\n');

try {
  await writeFile(markdownPath, markdown, 'utf8');
  await writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4xQAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  const html = await run(['export', 'html', markdownPath, '--output', htmlPath, '--json']);
  assert(html.code === 0, `HTML export exit code ${html.code}: ${html.stderr}`);
  const htmlReport = JSON.parse(html.stdout.trim());
  assert(htmlReport.ok === true, 'HTML report must be ok');
  assert(htmlReport.format === 'html', 'HTML report format');
  assert(htmlReport.output === htmlPath, 'HTML report output path');
  const htmlText = await readFile(htmlPath, 'utf8');
  for (const marker of [
    '<h1>Export Test</h1>',
    '<strong>world</strong>',
    '<table>',
    'task-list-item-checkbox',
    '<mjx-container',
    'class="lm-export-diagram"',
    'data:image/png;base64,',
    'data:font/woff2;base64,',
  ]) {
    assert(htmlText.includes(marker), `HTML is missing ${marker}`);
  }
  assert(!htmlText.includes('<script'), 'HTML must not contain scripts');

  const duplicate = await run([
    'export',
    'html',
    markdownPath,
    '--output',
    htmlPath,
    '--json',
  ]);
  assert(duplicate.code === 1, 'Existing output must fail without --force');
  assert(
    duplicate.stdout.includes('"code":"output.exists"'),
    'Existing output must report output.exists',
  );

  const defaultInput = join(directory, 'default-note.md');
  const defaultOutput = join(directory, 'default-note.html');
  await writeFile(defaultInput, '# Default output\n', 'utf8');
  const defaultExport = await run(['export', 'html', defaultInput, '--json']);
  assert(defaultExport.code === 0, `Default output export failed: ${defaultExport.stderr}`);
  assert(
    JSON.parse(defaultExport.stdout.trim()).output === defaultOutput,
    'Default output must be written beside the input file',
  );
  assert(
    (await readFile(defaultOutput, 'utf8')).includes('<h1>Default output</h1>'),
    'Default output file content',
  );

  const forced = await run([
    'export',
    'html',
    markdownPath,
    '--output',
    htmlPath,
    '--force',
    '--json',
  ]);
  assert(forced.code === 0, `--force export failed: ${forced.stderr}`);

  const pdf = await run(['export', 'pdf', markdownPath, '--output', pdfPath, '--json']);
  assert(pdf.code === 0, `PDF export exit code ${pdf.code}: ${pdf.stderr}`);
  const pdfReport = JSON.parse(pdf.stdout.trim());
  assert(pdfReport.ok === true, 'PDF report must be ok');
  assert(pdfReport.bytes > 0, 'PDF report must include bytes');
  const pdfBytes = await readFile(pdfPath);
  assert(pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF header');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useWorkerFetch: false,
  }).promise;
  assert(document.numPages > 0, 'PDF must contain pages');
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  assert(
    Math.abs(viewport.width - 595.28) < 2 && Math.abs(viewport.height - 841.89) < 2,
    `PDF page must be A4, got ${viewport.width}x${viewport.height}`,
  );
  const text = (await page.getTextContent()).items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
  assert(text.includes('Export Test'), 'PDF must contain the exported text');

  process.stdout.write(`${JSON.stringify({ html: htmlReport, pdf: pdfReport })}\n`);
} finally {
  await rm(directory, { force: true, recursive: true });
}

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stderr, stdout }));
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
