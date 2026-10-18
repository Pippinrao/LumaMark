export const EXPORT_STAGE_CLASS = 'lm-export-stage';
export const EXPORT_PRINTING_CLASS = 'lm-export-printing';

const FONT_SANS =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", ui-sans-serif, system-ui, sans-serif';
const FONT_MONO =
  '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", ui-monospace, monospace';

/**
 * Styles embedded in the exported HTML. They are also used inside the print
 * stage shadow root, so the two outputs cannot drift.
 */
export const EXPORT_DOCUMENT_CSS = `
:root {
  color-scheme: light;
  --lm-export-text: #1f2328;
  --lm-export-muted: #59636e;
  --lm-export-border: #d0d7de;
  --lm-export-surface: #f6f8fa;
  --lm-export-accent: #0969da;
  --lm-export-mono: ${FONT_MONO};
}
/* The print stage lives in a shadow root, where :root and body do not match.
   Repeat the light document contract on the host so inherited app-theme colors
   can never leak into an exported PDF. */
:host {
  --lm-export-text: #1f2328;
  --lm-export-muted: #59636e;
  --lm-export-border: #d0d7de;
  --lm-export-surface: #f6f8fa;
  --lm-export-accent: #0969da;
  --lm-export-mono: ${FONT_MONO};
  background: #ffffff;
  color: var(--lm-export-text);
  color-scheme: light;
  display: block;
  font-family: ${FONT_SANS};
  font-size: 16px;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body {
  color: var(--lm-export-text);
  font-family: ${FONT_SANS};
  font-size: 16px;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.lm-export-document {
  width: 174mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  overflow-wrap: break-word;
  background: #ffffff;
  color: var(--lm-export-text);
  font-family: ${FONT_SANS};
  font-size: 16px;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.lm-export-document > :first-child { margin-top: 0; }
.lm-export-document > :last-child { margin-bottom: 0; }
h1, h2, h3, h4, h5, h6 {
  color: #111418;
  font-weight: 650;
  line-height: 1.3;
  margin: 1.6em 0 0.6em;
  break-after: avoid;
}
h1 { font-size: 2em; padding-bottom: 0.25em; border-bottom: 1px solid var(--lm-export-border); }
h2 { font-size: 1.55em; padding-bottom: 0.2em; border-bottom: 1px solid var(--lm-export-border); }
h3 { font-size: 1.3em; }
h4 { font-size: 1.15em; }
h5 { font-size: 1.05em; }
h6 { font-size: 1em; color: var(--lm-export-muted); }
p { margin: 0.75em 0; orphans: 3; widows: 3; }
a { color: var(--lm-export-accent); text-decoration: underline; text-underline-offset: 2px; }
strong { font-weight: 650; }
del { color: var(--lm-export-muted); }
ul, ol { margin: 0.75em 0; padding-left: 1.7em; }
li + li { margin-top: 0.25em; }
li > ul, li > ol { margin: 0.25em 0; }
blockquote {
  margin: 1em 0;
  padding: 0.1em 1em;
  color: var(--lm-export-muted);
  border-left: 4px solid var(--lm-export-border);
  break-inside: avoid;
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }
hr { height: 0; margin: 1.8em 0; border: 0; border-top: 1px solid var(--lm-export-border); }
img { max-width: 100%; height: auto; }
figure.lm-export-diagram {
  margin: 1.4em 0;
  text-align: center;
  break-inside: avoid;
}
figure.lm-export-diagram svg { max-width: 100%; height: auto; }
figure.lm-export-diagram figcaption {
  margin-top: 0.4em;
  color: var(--lm-export-muted);
  font-size: 0.85em;
}
.lm-export-diagram-error {
  margin: 1em 0;
  padding: 0.75em 1em;
  color: #7d2b20;
  background: #fff4f2;
  border: 1px solid #f3c4be;
  border-radius: 6px;
  break-inside: avoid;
}
.lm-export-diagram-error p { margin: 0 0 0.5em; font-size: 0.9em; }
.lm-export-diagram-error pre { margin: 0; background: transparent; border: 0; padding: 0; }
code, kbd, samp {
  font-family: var(--lm-export-mono);
  font-size: 0.9em;
}
:not(pre) > code {
  padding: 0.15em 0.35em;
  background: var(--lm-export-surface);
  border: 1px solid var(--lm-export-border);
  border-radius: 4px;
}
pre {
  margin: 1em 0;
  padding: 0.9em 1.1em;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--lm-export-surface);
  border: 1px solid var(--lm-export-border);
  border-radius: 6px;
  break-inside: avoid;
}
pre code { padding: 0; background: transparent; border: 0; font-size: 0.875em; line-height: 1.6; }
table {
  width: 100%;
  margin: 1.1em 0;
  border-collapse: collapse;
  break-inside: auto;
}
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td {
  padding: 0.4em 0.7em;
  text-align: left;
  vertical-align: top;
  border: 1px solid var(--lm-export-border);
}
th { background: var(--lm-export-surface); font-weight: 650; }
ul.contains-task-list { padding-left: 0.2em; list-style: none; }
li.task-list-item { list-style: none; }
li.task-list-item > .task-list-item-checkbox,
li.task-list-item > input[type="checkbox"] {
  width: 1em;
  height: 1em;
  margin: 0 0.5em 0 0;
  vertical-align: -0.12em;
}
mjx-container {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
mjx-container[display="true"] { margin: 0.9em 0; }
.lm-export-math-error {
  display: inline-block;
  padding: 0.1em 0.35em;
  color: #7d2b20;
  background: #fff4f2;
  border: 1px solid #f3c4be;
  border-radius: 4px;
  font-family: var(--lm-export-mono);
  font-size: 0.85em;
}
.hljs { color: #24292f; background: transparent; }
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-formula { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-attribute, .hljs-meta .hljs-string { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #0550ae; }
.hljs-title, .hljs-section, .hljs-selector-id, .hljs-selector-class, .hljs-function .hljs-title { color: #8250df; }
.hljs-type, .hljs-class .hljs-title, .hljs-built_in { color: #953800; }
.hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta { color: #0969da; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 650; }
@page { size: A4; margin: 18mm 18mm 20mm; }
@media print {
  html, body { background: #ffffff !important; }
  a { color: #0969da; }
  h1, h2, h3, h4 { break-after: avoid; }
  pre, blockquote, figure, tr, img { break-inside: avoid; }
  thead { display: table-header-group; }
}
`;

/**
 * Document-level rules used only while printing the current WebView. The app
 * shell is hidden and the off-screen stage is promoted to the printable page.
 */
export const EXPORT_PRINT_STAGE_CSS = `
@page { size: A4; margin: 18mm 18mm 20mm; }
/* WebView2 PrintToPdf prints the live page rather than a print-media-only
   layout. Promote the export stage on screen while the class is present so the
   PDF contains the document, not the dark app shell behind it. */
html.${EXPORT_PRINTING_CLASS},
html.${EXPORT_PRINTING_CLASS} body {
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
  background: #ffffff !important;
  color: #1f2328 !important;
  color-scheme: light !important;
}
html.${EXPORT_PRINTING_CLASS} body > *:not(.${EXPORT_STAGE_CLASS}) {
  display: none !important;
}
html.${EXPORT_PRINTING_CLASS} body > .${EXPORT_STAGE_CLASS} {
  position: static !important;
  left: auto !important;
  top: auto !important;
  display: block !important;
  width: auto !important;
  min-height: 100vh;
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  background: #ffffff !important;
  color: #1f2328 !important;
  color-scheme: light !important;
}
@media print {
  html, body {
    background: #ffffff !important;
    color: #1f2328 !important;
    color-scheme: light !important;
  }
  body > *:not(.${EXPORT_STAGE_CLASS}) { display: none !important; }
  body > .${EXPORT_STAGE_CLASS} {
    position: static !important;
    left: auto !important;
    top: auto !important;
    display: block !important;
    width: auto !important;
    min-height: 100vh;
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
    background: #ffffff !important;
    color: #1f2328 !important;
    color-scheme: light !important;
  }
}
`;
