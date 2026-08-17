> Language: **English** · [中文](../zh/product/COMPETITOR_STRATEGY.md)

# Competitor Strategy and Historical Debt

> **Current-stage update (2026-07-27):** Foundation / MarkText+ has already formed an Alpha technical baseline. The current focus is not stacking more topical P0 work, but converging Parity Reliability through a “thin core + representative slices” approach. Implementation order and exit gates are unified in the [Typora Parity Core Experience Improvement Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## Overall judgment

LumaMark’s competitor strategy is not simply copying existing tools. It absorbs mature experience and avoids historical debt.

Phase one benchmarks Typora’s core writing experience and aims to quickly surpass MarkText on fluency and trustworthiness.

## MarkText debt and pitfalls to avoid

MarkText’s direction proved demand for an open-source Typora-like Markdown editor, but it also exposed several long-term debts that must be avoided.

### 1. Document-model debt

Risk: if the document is frequently represented as a full string and repeatedly parsed, rendered, and serialized during editing, large documents create heavy CPU and memory pressure.

LumaMark strategy:

- Use CodeMirror 6 to manage the editing document and incremental updates.
- Do not process the full Markdown string on every keystroke.
- Derived data is computed asynchronously and must not block typing.

### 2. Source-fidelity debt

Risk: if the WYSIWYG internal representation is the primary data and Markdown is only stringified on save, problems such as rewrite-on-open, lost blank lines, indentation drift, and reformatting of unedited regions become likely.

LumaMark strategy:

- Markdown source files are the single source of truth.
- AST, outline, and Mermaid preview are derived data.
- Save logic must pass fixture round-trip tests.
- Unedited regions must not be rearranged.

### 3. Hand-rolled editor debt

Risk: a fully custom editor quickly consumes team energy across IME, caret, selection, undo, paste, drag-and-drop, accessibility, and large-document performance.

LumaMark strategy:

- Use CodeMirror 6 as the main editor core.
- Custom work concentrates on Typora-like Markdown behavior and performance scheduling.
- Do not hand-roll basic editing capabilities.

### 4. Parser-fork debt

Risk: forking a Markdown parser requires long-term pursuit of standards and ecosystem changes, with high maintenance cost.

LumaMark strategy:

- Prefer mature Markdown / syntax ecosystems.
- Do not casually fork parsers.
- If extension is required, write a decision record and tests first.

### 5. Large-document and complex-block stuttering

Risk: if expensive work such as Mermaid, math, code highlighting, outline, and search runs synchronously, typing and scrolling stutter.

LumaMark strategy:

- Mermaid is async, cancellable, and cacheable.
- Outline and search are incremental or background.
- React does not participate in per-character editing render.
- Establish large-document performance benchmarks.

## Typora baseline and surpassing strategy

Typora is LumaMark’s most important experience baseline in phase one.

**Behavioral detail** (syntax surface, reading/editing states, input paths, source persistence, alignment tables) is governed by the [Typora behavior baseline docs](typora-baseline/README.md). This file keeps only strategic judgment and pacing; it does not duplicate per-item behavior facts.

Typora strengths:

- Reading and writing feel unified.
- Markdown marker hiding feels natural.
- Single-document editing stays quiet.
- Common input actions are finely polished.
- UI is restrained.

LumaMark must first match:

- Common Markdown input experience.
- Headings, lists, quotes, code blocks, tables, images, links.
- Mermaid and math.
- Outline.
- Export.
- Shortcuts and settings.

Directions where LumaMark aims to surpass Typora:

- Smoother large documents.
- More transparent source fidelity.
- More modern workspace, search, and command palette.
- More stable async rendering.
- Multilingual built in from day one.
- Stronger AI-native quality system.

## Obsidian and Zettlr

Obsidian’s strength is knowledge bases, plugins, link networks, and ecosystem. LumaMark does not compete with that ecosystem head-on in phase one.

Zettlr’s strength is academic writing and publishing workflows. LumaMark does not compete with that academic suite head-on in phase one.

LumaMark’s first battlefield stays clear:

> Build the world’s smoothest, most beautiful, and most fidelity-preserving Typora-like Markdown editor.

## Competitive pacing

### Quickly surpass MarkText

Goals:

- Smoother.
- More modern.
- Less historical baggage.
- More trustworthy source saving.
- Clearer maintenance and testing process.

Key capabilities:

- CodeMirror 6 as the main editing core.
- Tauri lightweight desktop shell.
- Markdown round-trip tests.
- Async Mermaid rendering.
- Performance benchmarks.

### Match Typora

Goals:

- Typora users can migrate.
- No obvious gaps on common writing paths.
- Input actions feel natural.

Key capabilities:

- Complete Markdown basics.
- Table and image experience.
- Math.
- Export.
- Shortcuts and settings.
- Themes.

### Surpass Typora

Goals:

- Users choose LumaMark because it is better, not merely because it is a substitute.

Key capabilities:

- Large documents first.
- Source fidelity first.
- Async complex-block rendering first.
- Modern workspace experience.
- Quality and performance observability built in.
