> Language: **English** · [中文](zh/README.md)

# LumaMark documentation map

This file is the sole index for the `docs/` directory. When adding, deleting, moving, or renaming project docs, update this file in the same change.

## Documentation governance

- Keep docs few and accurate; do not create long-lived docs for temporary ideas.
- Each topic may have only one primary source of truth.
- Near-term plans may be detailed; far-term plans stay outline-level with decision gates.
- Docs serve decisions and execution; they do not record diaries.
- When product goals, architecture, quality gates, or roadmap change, update related docs together.

## Bilingual layout

- **English (default / canonical):** `docs/**` at these paths, plus root `README.md`, `AGENTS.md`, and `DEVELOPMENT_PROCESS.md`.
- **Chinese (full mirror):** `docs/zh/**`, plus root `README.zh.md`, `AGENTS.zh.md`, and `DEVELOPMENT_PROCESS.zh.md`.
- Living docs: update English first, then the Chinese mirror in the same change set.
- Language switchers link paired files; internal links in English docs use English default paths (except the switcher itself).
- Agent chat replies to the project owner still default to Chinese; see `AGENTS.md` documentation language policy.

## Directory structure

```text
docs/
├─ README.md                 # Documentation map (this file)
├─ zh/                       # Full Chinese mirror of project docs
├─ superpowers/              # Non-authoritative agent planning scratch (specs/plans)
├─ product/                  # Product positioning, version scope, PRD, competitor strategy
│  ├─ typora-baseline/       # Typora public behavior baseline (topic facts and alignment tables)
│  └─ typora-competitive-analysis/ # LumaMark snapshot and topic gap analysis
├─ architecture/             # Architecture principles, module boundaries, technology choices
├─ decisions/                # Major decision records
├─ quality/                  # Testing, performance, quality strategy
├─ performance/              # Performance baselines and gate results
├─ release/                  # Build, release, and delivery records
└─ roadmap/                  # Evolution plans and phase goals
```

Create on demand:

- `docs/testing/`: test fixtures and detailed test rules.

Do not pre-create empty directories.

`docs/superpowers/` holds agent specs and plans only. It is **not** a product, architecture, quality, or roadmap source of truth.

## Must-read order

New agents or contributors should read in this order:

1. [Project charter](product/PROJECT_CHARTER.md)
2. [Product positioning and strategy](product/PRODUCT_STRATEGY.md)
3. [Evolution plan](roadmap/EVOLUTION_PLAN.md)
4. [Typora Parity core experience plan](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
5. [Detailed architecture and technology choices](architecture/DETAILED_ARCHITECTURE.md)
6. [Quality strategy](quality/QUALITY_STRATEGY.md)
7. [Agent working contract](../AGENTS.md)
8. [AI development process](../DEVELOPMENT_PROCESS.md)

### Archive (historical Alpha baseline — not primary reading)

These documents record Foundation / MarkText+ Alpha baselines. They are frozen in principle and must not be used to infer current implementation status or execution order:

- [V1 product requirements](product/V1_PRODUCT_REQUIREMENTS.md)
- [V1 UX design](product/V1_UX_DESIGN.md)
- [V1 version design](product/V1_VERSION_DESIGN.md)
- [V1 implementation plan](roadmap/V1_IMPLEMENTATION_PLAN.md)

## Current status

Foundation and MarkText+ form an Alpha technical baseline. The active milestone is **Parity Reliability Foundation**: converge source fidelity, IME, undo, focus, and active-save reliability before stacking more topic features. Scope, order, and exit gates live only in the [Typora Parity core experience plan](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

Landed capabilities (high level; follow the linked English docs for contracts and acceptance):

| Capability | Primary doc |
|---|---|
| Settings system | [SETTINGS_SYSTEM_DESIGN.md](product/SETTINGS_SYSTEM_DESIGN.md), [ADR 0014](decisions/0014-settings-persistence.md) |
| Menu and context menus | [MENU_SYSTEM_DESIGN.md](product/MENU_SYSTEM_DESIGN.md) |
| MathJax math | [ADR 0017](decisions/0017-mathjax-document-worker-chtml.md) |
| Local PlantUML | [ADR 0018](decisions/0018-plantuml-local-rendering.md) |
| GitHub NSIS auto-update | [ADR 0012](decisions/0012-github-nsis-auto-update.md) |
| Multi-window / desktop open routing | [ADR 0009](decisions/0009-desktop-file-open-bridge.md) |

## Current document inventory

| Document | Type | Responsibility | When to update |
|---|---|---|---|
| [Project charter](product/PROJECT_CHARTER.md) | Product | Vision, mission, success criteria, non-goals | Project positioning or long-term vision changes |
| [Product positioning and strategy](product/PRODUCT_STRATEGY.md) | Product | User value, battlefield choice, differentiation | Product strategy or target-user changes |
| [V1 product requirements](product/V1_PRODUCT_REQUIREMENTS.md) | Historical product baseline | Foundation / MarkText+ V1 feature scope and acceptance | Frozen in principle; fix links or historical status notes only |
| [V1 version design](product/V1_VERSION_DESIGN.md) | Historical product baseline | Alpha product, interaction, and architecture slices; not a current execution plan | Frozen in principle; fix links or historical status notes only |
| [V1 UX design](product/V1_UX_DESIGN.md) | Historical UX baseline | Alpha default layout, visual direction, hi-fi prototypes, UX acceptance | Stable visual principles or historical status notes change |
| [Menu system design](product/MENU_SYSTEM_DESIGN.md) | Product UX | Shared visual/info structure, command contracts, context hit-testing, Typora shortcut mapping, and acceptance for top menus, context menus, and command palette | Menu/context structure, shortcuts, related capability status, or menu tech approach changes |
| [Settings system design](product/SETTINGS_SYSTEM_DESIGN.md) | Product UX | Settings dialog sections, schema, persistence/migration contracts, settings vs session boundaries, tests and acceptance | Settings sections/fields, persistence backend, migration strategy, or settings gates change |
| [Competitor strategy and historical debt](product/COMPETITOR_STRATEGY.md) | Product | Typora, MarkText, and related competitor strategy and pitfalls | Competitor judgment or pitfall strategy changes |
| [Typora behavior baseline](product/typora-baseline/README.md) | Product | Typora public writing-behavior facts, sources, and LumaMark alignment tables | Typora version re-check, baseline topic additions, or alignment decisions |
| [Typora topic competitive analysis](product/typora-competitive-analysis/README.md) | Product | Index, responsibility boundaries, status vocabulary, and maintenance gates for 18 topic reports | Related implementation evidence, Typora baseline, or topic structure changes |
| [Architecture strategy](architecture/ARCHITECTURE_STRATEGY.md) | Architecture | High-level architecture principles and anti-patterns | Architecture principle changes |
| [Detailed architecture and technology choices](architecture/DETAILED_ARCHITECTURE.md) | Architecture | Module boundaries, data flow, technology choices | Default architecture or major dependency changes |
| [ADR 0001: V1 app shell mature UI components](decisions/0001-task8-ui-components.md) | Decision | Task 8 UI primitive choices and review conditions | File tree, split pane, command palette, or dialog primitive changes |
| [ADR 0002: CodeMirror Markdown table interaction](decisions/0002-codemirror-markdown-tables.md) | Decision | Mature table interaction choice and review conditions | Table interaction, source fidelity, or primary editor core changes |
| [ADR 0003: Live preview assets, code highlight, table inline](decisions/0003-live-preview-assets-code-and-table-inline.md) | Decision | Image resolve/refresh and draft finalize, code-highlight deps, table inline render thin layer | Image, code block, table inline syntax, or related dependency changes |
| [ADR 0004: Local recovery draft safety boundary](decisions/0004-local-recovery-drafts.md) | Decision | Exact serialization, restore, and cleanup boundary for local recovery drafts | Recovery strategy, save semantics, or draft persistence changes |
| [ADR 0005: External Markdown and local image watch](decisions/0005-external-file-and-image-watch.md) | Decision | File watch, external-edit conflict, and on-disk image refresh boundaries | Watcher dependency, conflict policy, or image refresh semantics changes |
| [ADR 0006: Parity Reliability editor contracts](decisions/0006-parity-reliability-editor-contracts.md) | Decision | Shared interaction context, exact source format, Mermaid single primary editor, and save-diff dependency boundaries | Edit interaction, source serialization, Mermaid ownership, or save transform changes |
| [ADR 0007: Stable performance sampling gates](decisions/0007-stable-performance-sampling.md) | Decision | P80, max, independent cold path, and CI debounce rules for performance samples | Sample count, statistics, primary budget, or hard max changes |
| [ADR 0008: Shared media viewer for images and Mermaid](decisions/0008-shared-media-viewer.md) | Decision | Expand view, zoom dependency, editor events, and focus/source-fidelity boundaries | Media viewing, zoom component, payload ownership, or fullscreen semantics changes |
| [ADR 0009: Desktop file open and multi-window routing](decisions/0009-desktop-file-open-bridge.md) | Decision | File association, durable requests, document identity, single-instance worker, multi/aggregate window ownership and restore | Desktop association, window routing, path identity, request lifecycle, or single-instance dependency changes |
| [ADR 0010: Reading mode readonly and render-lock contract](decisions/0010-reading-mode-readonly-contract.md) | Decision | Readonly implementation, render-state lock, control interaction, feedback, and display-mode cycle | Display-mode set, readonly semantics, source expand strategy, or readonly feedback changes |
| [ADR 0011: Sidebar adaptive width and constraint release](decisions/0011-sidebar-adaptive-width.md) | Decision | Sidebar drag bounds, adaptive basis and recalc timing, width persistence boundary | Width constraints, adaptive algorithm, recalc triggers, or persistence strategy changes |
| [ADR 0012: GitHub NSIS auto-update](decisions/0012-github-nsis-auto-update.md) | Decision | Official updater plugin, NSIS-only, GitHub `latest.json`, signing keys, release workflow, Windows manual system-proxy boundary | Update source, signing policy, artifact shape, proxy boundary, or install confirmation UX changes |
| [ADR 0013: Independent performance budget for fence completion](decisions/0013-code-block-completion-performance-budget.md) | Decision | Budget boundary between complex fence-completion commands and ordinary typing, sampling rules, review conditions | Fence-completion implementation, CodeMirror update cost, primary budget, or max changes |
| [ADR 0014: Settings persistence in Rust config file](decisions/0014-settings-persistence.md) | Decision | Move settings from localStorage to `settings.json`, corrupt backups, migration, and session-state boundaries | Settings persistence backend, migration strategy, or config layout changes |
| [ADR 0015: External open and workspace file mutations](decisions/0015-external-open-and-file-mutations.md) | Decision | Opener dependency, protocol allowlist, workspace writes, trash delete, and capability boundaries | Opener/shell dependency, delete semantics, workspace path validation, or file-tree write changes |
| [ADR 0016: Desktop plain-text clipboard adapter](decisions/0016-tauri-text-clipboard-adapter.md) | Decision | Official Tauri clipboard-manager, browser adapter, EditorCommandPort injection, minimal text permissions | Clipboard plugin, permissions, plain-text command entry, or desktop/browser adapter boundaries |
| [ADR 0017: MathJax document worker and CHTML math](decisions/0017-mathjax-document-worker-chtml.md) | Decision | Math engine, document state, Worker/CHTML, offline fonts, security, and rollback boundaries | MathJax version, output format, TeX packages, security policy, chunk, or performance gate changes |
| [ADR 0018: Local PlantUML via official TeaVM](decisions/0018-plantuml-local-rendering.md) | Decision | Local PlantUML engine, canonical settings, reading lock, dark mode, lazy chunk, and installed-package acceptance | PlantUML engine, settings fields, render lock, or installed-package acceptance changes |
| [ADR 0019: Live-preview pointer selection style](decisions/0019-live-preview-pointer-selection-style.md) | Decision | Custom `mouseSelectionStyle` ownership, press anchor, click slop, and installed-package pointer acceptance | Pointer selection ownership, click slop, anchor resolution, or pointer acceptance changes |
| [ADR 0020: Preview scheduler](decisions/0020-preview-scheduler.md) | Decision | Source/caret stay sync; viewport WYSIWYG rebuilds coalesce to one animation-frame preview pass | Preview scheduling, viewport decoration rebuild timing, or installed stutter evidence changes |
| [ADR 0021: Adaptive document width and wide-block breakout](decisions/0021-adaptive-document-width-and-block-breakout.md) | Decision | Adaptive prose column, settings v4 migration, and table/Mermaid/PlantUML/image breakout track | Page-width defaults, block-widget width, or height-map refresh after pane resize |
| [Quality strategy](quality/QUALITY_STRATEGY.md) | Quality | Testing, performance, and AI development quality strategy | Test or quality gate changes |
| [V1 performance baseline](performance/V1_BASELINE.md) | Performance | V1 alpha performance budgets, measured results, known limits, installed UX stutter gates | Performance budgets, benchmark commands, installed UX gates, or measured results change |
| [Windows V1 build record](release/WINDOWS_V1_BUILD.md) | Release | Windows build commands, install artifacts, release gaps | Windows build config, artifacts, or release gates change |
| [Evolution plan](roadmap/EVOLUTION_PLAN.md) | Roadmap | Near-detail / far-outline phase plan | Near-term phase goals or exit conditions change |
| [Typora Parity core experience plan](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) | Current execution roadmap | Parity Reliability Foundation order, contracts, evidence, and exit gates | Current milestone scope, order, or gates change |
| [V1 implementation plan](roadmap/V1_IMPLEMENTATION_PLAN.md) | Historical roadmap baseline | Foundation / MarkText+ Alpha task breakdown; original checkboxes retained; not current completion status | Frozen in principle; fix links or historical status notes only |

## Fact-source rules

- Working rules: [AGENTS.md](../AGENTS.md).
- Development process: [DEVELOPMENT_PROCESS.md](../DEVELOPMENT_PROCESS.md).
- Long-term product positioning: [Project charter](product/PROJECT_CHARTER.md) and [Product positioning and strategy](product/PRODUCT_STRATEGY.md).
- Alpha front-end UX historical baseline: [V1 UX design](product/V1_UX_DESIGN.md); current interaction implementation scope follows the current execution plan and detailed architecture.
- Current detailed architecture: [Detailed architecture and technology choices](architecture/DETAILED_ARCHITECTURE.md).
- Current phase positioning and Now/Next/Later: [Evolution plan](roadmap/EVOLUTION_PLAN.md).
- Current executable scope, order, and exit gates: [Typora Parity core experience plan](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).
- [V1 product requirements](product/V1_PRODUCT_REQUIREMENTS.md), [V1 UX design](product/V1_UX_DESIGN.md), [V1 version design](product/V1_VERSION_DESIGN.md), and [V1 implementation plan](roadmap/V1_IMPLEMENTATION_PLAN.md) are historical Alpha baselines only; do not infer current implementation status from them.
- Typora public behavior detail: [Typora behavior baseline](product/typora-baseline/README.md); topic implementation snapshots: [Typora topic competitive analysis](product/typora-competitive-analysis/README.md); LumaMark current implementation scope still follows the current execution plan.
- `docs/superpowers/` is non-authoritative planning scratch and never overrides the sources above.

If documents conflict, judge by the fact sources above first, then update the stale document.

## Admission for new documents

Before adding a long-lived document, answer:

- Can an existing document be updated instead?
- Does the new document have an independent lifecycle?
- Does it have a clear audience?
- Will it become a new source of truth?
- Is it already registered in this file?

If the answers are unclear, do not add the document.

## Maintenance checks

Before finishing a documentation task, check:

- Are links reachable?
- Are there duplicate fact sources?
- Are there unfinished placeholders?
- Is far-term planning written too finely?
- Does this index need updating?
- Were English defaults updated before Chinese mirrors for living docs?
