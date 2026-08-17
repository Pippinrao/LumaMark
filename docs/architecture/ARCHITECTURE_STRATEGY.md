> Language: **English** · [中文](../zh/architecture/ARCHITECTURE_STRATEGY.md)

# Architecture Strategy

For detailed module boundaries, data flows, and technology choices, see [Detailed Architecture Design and Technology Selection](DETAILED_ARCHITECTURE.md). This document keeps only high-level principles. Shared interaction, source format, and single primary editor contracts for Parity Reliability are in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md).

## Architecture Goals

LumaMark’s architecture must serve three goals at once:

1. High performance.
2. A modern, polished UI.
3. A light, fluid experience.

These goals must not trade off against each other. Architectural choices must make them hold by design, not by later patches.

## Overall Architecture

```text
Tauri desktop shell
├─ React App Shell: layout, sidebar, settings, command palette, file tree
├─ CodeMirror 6 Editor: Markdown source text, input, selection, undo, WYSIWYG decorations
├─ Async Render Layer: Mermaid, math, images, export preview, cache
├─ Rust Core: file IO, search, index, cache, system integration, heavy-task scheduling
└─ i18n / Theme / Settings: built in from day one
```

Core principle:

> React owns the application shell, CodeMirror 6 exclusively owns the editing hot path, Rust owns system and heavy work, and mature component libraries own UI behavior.

## Technology Choices

### Tauri

Choose Tauri as the desktop shell.

Reasons:

- Lightweight.
- Uses the system WebView.
- Rust fits system capabilities and heavy work.
- Naturally supports Windows, macOS, and Linux.
- Combines simply with modern frontend frameworks.

Boundaries:

- Do not move all logic into Rust.
- Rust only takes work with clear benefit.
- Frontend and Rust communicate through clear command boundaries.

### React + TypeScript

Choose React to build the application shell.

Responsibilities:

- Layout.
- Panels.
- Settings.
- File tree.
- Outline.
- Command palette.
- Theme.
- i18n.

Boundaries:

- React does not participate in per-character input.
- Shell render components only consume view models, labels, callbacks, and slots; they must not call business workflows, stores, services, or editor commands directly.
- Business behavior goes into feature workflows, app controllers, or service facades — not into JSX components.
- Do not turn every Markdown block into a React component.
- Do not sync every keystroke into global React state and re-render.
- React only subscribes to necessary lightweight state, such as current file, dirty status, outline, and selection summary.

### CodeMirror 6

Choose CodeMirror 6 as the primary editor core.

Reasons:

- High-performance text model.
- Suitable for large documents.
- Supports incremental parsing.
- Supports decorations/widgets.
- Can implement a Typora-like Markdown visual layer.
- Markdown source can remain the primary data.

Responsibilities:

- Text document.
- Input.
- Caret.
- Selection.
- Undo and redo.
- Basic syntax highlighting.
- Markdown WYSIWYG decorations.
- Mount points for Mermaid and other block-level widgets.
- Editor state that maps in sync with body text, such as `EditorInteractionContext` and `DocumentSourceFormat`.

Boundaries:

- Do not use a rich-text AST as primary storage.
- Do not bypass CodeMirror to implement caret, selection, and input yourself.
- Do not wrap CodeMirror with an outer virtual-scroll layer.
- Do not create a second `EditorView` for Mermaid or other complex blocks that holds pending body text, selection, or an independent undo stack.

### Rust Core

Rust owns system capabilities and performance-sensitive background work.

Good fits for Rust:

- File read/write.
- File watching.
- Workspace indexing.
- Full-text search.
- Cache management.
- Export pipelines.
- Large-file preprocessing.
- Performance-sensitive parsing or scheduling.

Poor fits for Rust:

- Ordinary UI state.
- Simple component interaction.
- Lightweight logic with no performance pressure.
- Features migrated only to feel “more low-level.”

## WYSIWYG Strategy

LumaMark does not take the “rich-text AST as primary storage → stringify Markdown on save” path.

Default strategy:

- The Markdown source file is the source of truth.
- The CodeMirror text model holds the source.
- CodeMirror normalizes `Text` internally while mapping BOM, trailing newline, and per-line newline formats; the save boundary serializes exactly.
- The Lezer/Markdown parser produces syntax information.
- Decorations hide or soften Markdown markers.
- Widgets render Mermaid, math, image previews, and other complex blocks.
- Save is based directly on the editor snapshot; controlled transforms may produce only necessary minimal changes and must not silently normalize the whole file.

This strategy lowers source-fidelity risk.

## Editor Capability Strategy

Complex editor subfeatures such as Mermaid, tables, code blocks, and images evolve independently as Editor Capabilities.

Default boundaries:

- Each complex capability has its own `editor/capabilities/<name>/` directory and a thin public entry.
- `editor/core` only consumes capability aggregate entries; it must not import Mermaid, table, image, or code-block internals directly.
- `editor/commands` only invokes complex capabilities through capability command factories; it does not know widget, DOM, or third-party library paths.
- `editor/widgets/*` exists only as compatibility re-exports for old paths; it must not host new implementations.
- Shared `editor/wysiwyg` only owns low-cost, source-faithful visual rules and capability decoration composition; it must not own async rendering, file-path resolution, block widget lifecycle, or capability-specific commands.

Current mix points still to watch:

- Image capability detection, path resolution, and DOM still live in one file and must be split before further growth.
- Table source visual classes still live in shared WYSIWYG; if they grow into table-specific visual behavior, move them back into the table capability.
- Task lists still belong to shared list/WYSIWYG behavior; if they become an independent interactive capability, extract a list or task-list capability.

## Mermaid Strategy

Mermaid is a high-performance risk point and must be asynchronous.

Requirements:

- Detect fenced code blocks.
- When a block is active, show fenced source in the main `EditorView` with preview below the block; edits enter the unified undo stack immediately.
- Do not render on the synchronous input path.
- Use a task queue.
- Support canceling stale tasks.
- Support caching.
- Surface render errors visually.

Cache keys must at least include:

- Mermaid source.
- Mermaid version.
- Mermaid configuration.
- Current theme.

## UI Component Strategy

Mature components first.

Prefer:

- Radix UI / Ariakit / equivalent headless components.
- lucide-react or an equivalent icon library.
- TanStack Virtual or an equivalent virtualization library.
- i18next or an equivalent i18n solution.

LumaMark owns:

- Design tokens.
- Theme styling.
- Component composition.
- Editor-specific interactions.

Do not hand-roll:

- Menus.
- Dialogs.
- Tooltips.
- Tabs.
- Split panes.
- Tree components.
- Command palettes.
- Virtual lists.
- Shortcut systems.

Unless there is evidence that mature components cannot meet the goals, and the user explicitly approves.

## Performance Strategy

Performance is designed from the architecture stage.

Hot paths:

- Input.
- Caret and selection.
- Scrolling.
- Syntax decorations.
- Save.

Hot paths must stay in CodeMirror or efficient browser mechanisms whenever possible.

Cold or background paths:

- Mermaid.
- Search.
- Export.
- Outline generation.
- File indexing.
- Image processing.

These paths should be asynchronous, cancelable, and cacheable.

## Anti-Patterns

Forbid these directions:

- Using ProseMirror/Milkdown as the primary editor core unless new validation proves it better fits the goals.
- Using a rich-text AST as Markdown primary storage.
- Hand-rolling basic UI components.
- Letting AppShell, a controller, or a feature component become a cross-feature god object.
- Letting `editor/capabilities/index.ts` or `wysiwyg/markdownDecorations.ts` become a new editor-capability god object.
- Letting an editor capability depend upward on app, feature, or service layers.
- Directly importing stores, services, workflows, Tauri wrappers, or editor commands inside render components.
- React re-rendering the editor on every character.
- Synchronous Mermaid rendering.
- Formatting the entire document on save.
- Shipping features first and patching performance later.
- Declaring something “smooth enough” without benchmarks.

## Architecture Acceptance

Every major architecture change must answer:

- Does it protect Markdown source fidelity?
- Does it affect input latency?
- Does it affect scroll smoothness?
- Does it increase React hot-path rendering?
- Is a mature component available?
- Does it affect i18n?
- Is there automated verification?
- Are there performance baselines?
