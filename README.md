> Language: **English** · [中文](README.zh.md)

# LumaMark

LumaMark is a high-performance, modern, cross-platform WYSIWYG Markdown editor.

Project vision: first surpass MarkText quickly, then match Typora’s core writing experience, and ultimately become the world’s leading WYSIWYG Markdown editor.

## Project direction

LumaMark’s path is “replicate first, then innovate”:

1. Phase one aligns with mature Typora-like writing experience and layout patterns.
2. Phase two surpasses existing products in fluidity, source fidelity, large documents, modern UI, multilingual support, and workspace experience.
3. Phase three forms differentiated capabilities and becomes a high-performance Markdown writing workbench.

## Default technical stack

- Desktop framework: Tauri
- Frontend: React + TypeScript
- Primary editor core: CodeMirror 6
- System capabilities and heavy work: Rust
- UI primitives: mature component libraries preferred
- Icons: mature icon libraries preferred
- i18n: Chinese and English built in from day one

## Documentation entry points

- [Project documentation map](docs/README.md)
- [Current Typora Parity implementation plan](docs/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
- [Agent working contract](AGENTS.md)
- [AI development process](DEVELOPMENT_PROCESS.md)

Documentation is **English by default** under `docs/**`, with a full Chinese mirror at `docs/zh/**` and root `*.zh.md`. See [docs/README.md](docs/README.md) for layout and reading order.

## Non-negotiable principles

1. Performance is a core product capability, not a later optimization.
2. The Markdown source file is the single source of truth.
3. WYSIWYG must not destroy source formatting, whitespace, or user intent.
4. Mature components first; do not hand-roll primitives without explicit approval.
5. React must not enter the per-character editing hot path.
6. Mermaid, search, export, and other expensive work must be async, cancellable, and cacheable.
7. All user-visible copy must be localizable.
8. AI-generated code must be proven by tests, benchmarks, review, and CI.

## Current status

Foundation and MarkText+ form an Alpha technical baseline. The project is now in **Parity Reliability Foundation**, prioritizing source fidelity, IME, undo, focus, and active-save reliability. Scope and exit gates are defined by the [Typora Parity core experience plan](docs/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

Landed capabilities (high level; details in linked docs):

- Settings system — [SETTINGS_SYSTEM_DESIGN.md](docs/product/SETTINGS_SYSTEM_DESIGN.md)
- Menu and context menus — [MENU_SYSTEM_DESIGN.md](docs/product/MENU_SYSTEM_DESIGN.md)
- MathJax math rendering — [ADR 0017](docs/decisions/0017-mathjax-document-worker-chtml.md)
- Local PlantUML rendering — [ADR 0018](docs/decisions/0018-plantuml-local-rendering.md)
- GitHub NSIS auto-update — [ADR 0012](docs/decisions/0012-github-nsis-auto-update.md)
- Multi-window / desktop open routing — [ADR 0009](docs/decisions/0009-desktop-file-open-bridge.md)
