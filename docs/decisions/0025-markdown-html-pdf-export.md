> Language: **English** · [中文](../zh/decisions/0025-markdown-html-pdf-export.md)

# ADR 0025: Markdown HTML/PDF export with CLI and GUI entry points

Status: Accepted. Date: 2026-10-17.

## Background

LumaMark is a CodeMirror live-preview editor, so its DOM only contains the
viewport and cannot be printed as a complete document. Users need a
self-contained HTML export and an A4 PDF that match the Markdown source, and
other AI tools need a scriptable path without driving the desktop UI.

The app already ships the mature engines needed for export: MathJax CHTML, the
official Mermaid package, local PlantUML, DOMPurify, and the bundled hidden
WebView automation host. The export path must reuse those engines rather than
add another renderer or a bundled browser.

## Decision

## Shared renderer

- Markdown is rendered on a cold path with `markdown-it` plus
  `markdown-it-task-lists`; `highlight.js` provides code highlighting. Raw HTML
  stays disabled, matching the editor.
- Math uses the existing MathJax document Worker and CHTML output. The returned
  stylesheet is embedded with its referenced NewCM WOFF2 fonts as data URIs.
- Mermaid and PlantUML reuse the existing diagram adapters. The diagram
  renderer moved to `services/diagrams` so both automation and export use one
  implementation.
- The result is one standalone HTML document: inline CSS, inline SVG diagrams,
  data URI images, and data URI math fonts. It contains no scripts and no
  external font requests.
- Images are resolved through the existing asset service. Local and draft
  images are authorized and read by Rust; remote images use the existing public
  address/redirect/size protections. All images become data URIs.
- The renderer returns structured warnings for failed diagrams, math, or
  images. A failure becomes a visible placeholder and does not abort the rest of
  the document.

## GUI

- File menu and command palette expose “Export as HTML…” and “Export as PDF…”.
- The export dialog reports preparing/rendering/writing/printing, warnings,
  errors, and retry. Exporting does not modify the document, dirty state,
  selection, or undo history.
- GUI PDF renders the same HTML into an off-screen print-only Shadow DOM stage.
  Windows prints it silently through `ICoreWebView2_7::PrintToPdf` on the
  current window. macOS and Linux use the system print dialog in this version.

## CLI

- `LumaMark.exe export html|pdf <file|-> [--output <file>]` is part of the existing
  automation host and `--help` reference. The output defaults to the input
  file's directory. `--title`, `--force`, and `--json` are supported. Existing
  output files are never overwritten without `--force`.
- The CLI starts the same hidden WebView as the diagram tools. A dedicated
  `export-render.html` page pulls one job, runs the shared renderer, writes HTML
  through `export_write_html`, or prepares the print stage for Rust.
- JSON output uses a `schemaVersion: 1` export report with `ok`, `format`,
  `output`, `bytes`, `diagnostics`, and `warnings`. Human-readable warnings go
  to stderr. Exit codes stay 0/1/2.
- CLI defaults are deterministic: Pandoc math, no numbering, Physics off,
  PlantUML on, light theme, A4. It does not read user settings.

## Security

- Raw HTML is disabled; generated diagram SVG is sanitized with DOMPurify;
  MathJax keeps its Safe handler and TeX allowlist.
- Markdown link validation rejects `javascript:`, `file:`, and `data:` links.
  `data:image/*` is accepted only for image tokens.
- The hidden export page receives only the requested job. It has no new Tauri
  capability and never exposes export content to the main window.
- Sizes are bounded: 2 MiB Markdown input (automation limit), 12 MiB per image,
  64 MiB total assets, 64 MiB HTML.

## Rejected alternatives

- **Bundled Chromium/Playwright or wkhtmltopdf/WeasyPrint/Pandoc/LaTeX.** Adds a
  second runtime or installer weight; ADR 0024 already removed the bundled
  browser dependency.
- **Typst/printpdf as a second layout engine.** It would duplicate HTML/CSS
  layout, math, diagrams, and code highlighting, and drift from the editor.
- **jsPDF/html2canvas.** Raster output loses searchable text and font quality.
- **Capturing the live CodeMirror DOM.** It contains only viewport content and
  WYSIWYG decorations, not the complete document.
- **MCP export tool in this change.** The first iteration exposes CLI access for
  agents; adding an MCP file-writing tool needs a separate security decision.

## Impact

- New lazy frontend chunk (`renderExportDocument`) and two runtime dependencies
  (`markdown-it`, `markdown-it-task-lists`, `highlight.js`).
- Windows-only direct PDF printing; other platforms receive the system print
  dialog.
- `services/diagrams/diagramRenderer.ts` is the shared diagram renderer;
  `app/automation/diagramEngines.ts` remains a compatibility re-export.
- Version and help text move with the binary; `--help` remains the CLI reference.

## Review conditions

Revisit this decision if WebView2 PrintToPdf cannot print the hidden or
main-window stage reliably, if the export chunk breaks the web build budget, if
macOS/Linux need silent PDF output, or if an MCP export tool is requested.
