> Language: **English** · [中文](../zh/product/PROJECT_CHARTER.md)

# LumaMark Project Charter

Date: 2026-07-04

## One-line positioning

LumaMark is a high-performance, modern, cross-platform WYSIWYG Markdown editor. In phase one it uses a Typora-like experience as the baseline: first recreate a mature writing experience, then innovate on performance, engineering capability, and modern workflows.

## Vision

Become the world's leading WYSIWYG Markdown editor.

“World-leading” here does not mean the largest feature count. It means leading overall on:

- Natural, quiet, and stable writing experience.
- Smoothness that holds up on large documents.
- Markdown source fidelity.
- Expensive content such as Mermaid, math, images, and code blocks that does not block typing.
- A modern, beautiful, lightweight UI.
- Reliable multilingual and cross-platform experience.
- An AI-native development process that keeps the project maintainable long term.

## Mission

Help users write and maintain documents in Markdown for long sessions with low distraction and high reliability.

LumaMark should make users feel that:

- Opening is fast.
- Typing feels smooth.
- Scrolling stays stable.
- Saving is trustworthy.
- The UI is comfortable.
- Heavy documents are not something to fear.

## Strategic path

LumaMark follows a “recreate first, then innovate” path.

### Recreate first

Phase one does not rush into divergent innovation. It first aligns with the mature Typora-like paradigm:

- The central editor is the primary surface.
- Sidebar and outline are optional and restrained.
- Markdown source markers hide or soften at the right moments.
- Editing and reading feel unified.
- Common Markdown input actions are smooth and predictable.

The goal of recreation is to lower learning cost and establish a clear, comparable experience baseline.

### Then innovate

After the baseline is stable, innovation concentrates on LumaMark’s differentiation:

- Large-document performance.
- Source fidelity.
- Async block rendering.
- Modern UI and theming.
- Workspace, full-text search, and command palette.
- Extensibility.
- AI-assisted writing and Markdown refactoring.

## Target users

Core users:

- Developers
- Technical writers
- Product managers
- Researchers
- Writing-oriented knowledge workers
- Long-time users of Markdown tools such as Typora, MarkText, Obsidian, and Zettlr

These users share concerns about:

- Not being interrupted by the UI while writing.
- Markdown files remaining durable and portable over time.
- Large documents not stuttering.
- The editor not silently corrupting files.
- Mermaid, code blocks, images, outlines, and similar content remaining reliable.

## Success criteria

Short-term success: quickly surpass MarkText.

- Smoother.
- More modern.
- More trustworthy source handling.
- Clearer maintenance strategy.
- More stable Windows experience.

Medium-term success: match Typora’s core experience.

- Typora users can migrate without obvious friction.
- Common Markdown editing actions feel natural.
- Core capabilities such as images, links, tables, code blocks, Mermaid, math, and export are complete.

Long-term success: surpass Typora.

- Clearly better large-document experience.
- Stronger workspace and search.
- More reliable source fidelity.
- More modern UI.
- Stronger performance observability, automation quality, and extensibility.

## Non-goals

Phase one does not include:

- A cloud sync platform.
- A full plugin marketplace.
- A team collaboration suite.
- Notion-like databases.
- Complex knowledge graphs.
- Mobile apps.
- A full academic writing suite.

These capabilities can be reassessed after the core editing experience is stable.

## Core constraints

- Prefer mature components.
- Do not hand-roll basic components unless the user explicitly approves.
- Markdown source files are the single source of truth.
- All UI copy must be localizable.
- Editor hot paths must not be owned by React.
- Performance metrics must be measured automatically.
- AI development must obey testing, verification, and review gates.
