> Language: **English** · [中文](../zh/architecture/DETAILED_ARCHITECTURE.md)

# Detailed Architecture Design and Technology Selection

Date: 2026-07-04

Updated: 2026-07-27 (Parity Reliability editor contracts)

Updated: 2026-08-04 (start page, session restore, and workspace path recovery)

Updated: 2026-08-05 (desktop file association, single-instance forwarding, and path fidelity)

Updated: 2026-08-16 (Issue #11 MathJax document-level Worker and CHTML math rendering)

Updated: 2026-08-19 (everyday GFM tables mount widgets without format-on-load)

Updated: 2026-08-19 (preview scheduler: source path vs deferred viewport decorations)

Current implementation order and exit gates live in the [Typora Parity Core Experience Improvement Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). The current execution stage is the **Parity Reliability Foundation**, not historical V1 Alpha plans. Editor contracts and review conditions are in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md). Settings persistence and workspace/external-open safety boundaries are in [ADR 0014](../decisions/0014-settings-persistence.md) and [ADR 0015](../decisions/0015-external-open-and-file-mutations.md).

**Landed capabilities (partial; do not treat the whole Typora Parity milestone as complete):**

- Settings persistence: [ADR 0014](../decisions/0014-settings-persistence.md) and [SETTINGS_SYSTEM_DESIGN](../product/SETTINGS_SYSTEM_DESIGN.md)
- Menu system: [MENU_SYSTEM_DESIGN](../product/MENU_SYSTEM_DESIGN.md)
- MathJax document-level Worker / CHTML: [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md)
- PlantUML local rendering: [ADR 0018](../decisions/0018-plantuml-local-rendering.md)
- GitHub NSIS auto-updater: [ADR 0012](../decisions/0012-github-nsis-auto-update.md)
- Desktop multi-window open routing: [ADR 0009](../decisions/0009-desktop-file-open-bridge.md)

V1 product/UX/implementation plans remain a historical Alpha baseline only. They are not the current execution source of truth.

## Design Conclusions

LumaMark’s default architecture is:

```text
Tauri v2
├─ Rust Core: system capabilities, files, search, index, cache, heavy work
└─ WebView Frontend
   ├─ React + TypeScript: application shell and product UI
   ├─ CodeMirror 6: sole primary editor core
   ├─ @codemirror/merge: minimal changes for controlled save transforms
   ├─ codemirror-markdown-tables: Markdown table interaction component
   ├─ Radix Primitives: dialog, tabs, tooltip, and other basic interaction primitives
   ├─ react-resizable-panels: application split panes
   ├─ react-arborist: file tree
   ├─ cmdk: command palette
   ├─ lucide-react: icons
   ├─ Zustand: lightweight application state
   ├─ i18next/react-i18next: localization
   ├─ Mermaid: current complex-block rendering
   ├─ MathJax 4.1.3 CHTML: document-level math Worker and NewCM offline fonts
   └─ Vitest / Playwright: automated verification
```

Core principles:

- CodeMirror 6 holds Markdown body text and the editing hot path.
- The primary CodeMirror `EditorView` exclusively owns body text, selection, and undo history; complex blocks must not hold a second pending body copy.
- React is only the application shell and does not render per-character input.
- Rust only handles system capabilities and clearly heavy work.
- Markdown source is the sole source of truth.
- `DocumentSourceFormat` maps BOM, trailing newline, and per-line newline formats in editor state; normalized `Text` does not mean whole-file normalization on save.
- Complex-block rendering is asynchronous, cancelable, and cacheable.
- Viewport-driven live-preview decoration rebuilds coalesce through the preview scheduler; source, caret, and selection stay on the synchronous CodeMirror update. See [ADR 0020](../decisions/0020-preview-scheduler.md).
- Basic components prefer mature libraries; do not hand-roll without confirmation.

## Layered Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ App Shell                                                    │
│ React layout, panels, settings, command palette, i18n, theme │
├─────────────────────────────────────────────────────────────┤
│ Editor Runtime                                               │
│ CodeMirror state/view, Markdown syntax, decorations, widgets │
├─────────────────────────────────────────────────────────────┤
│ Derived Document Services                                    │
│ outline, block registry, render jobs, editor metrics         │
├─────────────────────────────────────────────────────────────┤
│ Frontend Service Layer                                       │
│ typed Tauri command clients, job/event adapters, error model │
├─────────────────────────────────────────────────────────────┤
│ Rust Core                                                    │
│ file IO, watcher, workspace walk, search, cache, export      │
├─────────────────────────────────────────────────────────────┤
│ Operating System                                             │
│ filesystem, dialogs, updater (GitHub NSIS), native integration│
└─────────────────────────────────────────────────────────────┘
```

### Auto-update (Windows NSIS)

Current implementation:

- Rust registers `tauri-plugin-updater`; public key and endpoints are configured in `src-tauri/tauri.conf.json`.
- The update manifest is a static `latest.json` on the GitHub Release, covering only `windows-x86_64` NSIS.
- The frontend checks/downloads/installs through `src/services/updater/updaterService.ts`; UI lives in `src/features/updates/`.
- Official distribution only accepts GitHub Actions signed publishes: `.github/workflows/windows-release-publish.yml` signs the build and uploads NSIS, `.sig`, and `latest.json` on tag or manual `workflow_dispatch`. `.github/workflows/windows-release-build.yml` must also sign and only uploads artifacts; it does not create a GitHub Release.

Decision record: [ADR 0012](../decisions/0012-github-nsis-auto-update.md).

## Data Ownership

### Markdown Body

Owner: CodeMirror `EditorState`.

Rules:

- Markdown body text must not enter the React global store.
- React must not subscribe to full document content.
- CodeMirror uses normalized `Text` internally; `documentSourceFormatField` holds and maps UTF-8 BOM, trailing newline, primary newline format, and per-line LF/CRLF/CR overlays in sync.
- Save snapshots capture the current `Text` and `DocumentSourceFormat` directly, then serialize exactly from the editor boundary; format must not be reconstructed from a caller string.
- AST, outline, Mermaid preview, and search results are all derived data.

### File State

Owner: application state layer + Rust filesystem layer.

Frontend holds:

- Current file path.
- Dirty status.
- Recovery drafts only in local persistence slots under `services/drafts`; React state keeps only draft metadata awaiting user decision, while body text is still read from CodeMirror. Recovery always opens as a new unsaved document; see [ADR 0004](../decisions/0004-local-recovery-drafts.md).
- Recent files list.
- Current workspace.
- Startup preferences, recent workspaces, and last session store only paths, names, and timestamps; Markdown body text must never be persisted there.
- UI expansion state.

Rust holds:

- File read/write.
- Path normalization.
- File watching.
- Workspace scanning.
- Search and indexing.
- Cache.

### UI State

Owner: Zustand store.

Suitable for the store:

- Current theme.
- Current language.
- Current layout state.
- Sidebar open state.
- Current file path.
- Dirty status.
- Command palette state.
- Recent file metadata.
- Recent workspaces, last file/workspace session, and startup-behavior metadata.

Not for the store:

- Full Markdown text.
- Per-keystroke temporary content.
- Internal CodeMirror selection details.
- Large SVG content from Mermaid rendering.

## Technology Selection Table

| Layer | Default choice | Alternatives | Decision |
|---|---|---|---|
| Desktop framework | Tauri v2 | Electron | Choose Tauri. Lightweight; Rust backend fits system capabilities. |
| Frontend framework | React + TypeScript | Vue/Svelte/Solid | Choose React. Mature ecosystem, rich component libraries, more stable AI-generated quality. |
| Build tool | Vite | Webpack/Rspack | Choose Vite. Mature combination with React, Vitest, and Tauri. |
| Package manager | pnpm | npm/yarn | Choose pnpm. Fast installs, stable lockfile, ready for a later monorepo. |
| Editor core | CodeMirror 6 | Milkdown/ProseMirror/Monaco | Choose CodeMirror 6. Performance, source fidelity, and viewport rendering better match goals. |
| Markdown interactive parsing | `@codemirror/lang-markdown` / Lezer | remark as hot-path parser | Editing hot path chooses CodeMirror/Lezer; remark is only for export or offline processing. |
| Save-transform diff | `@codemirror/merge` | Hand-rolled diff / full-text replace | Only after sparse, controlled `prepareTextForSave` transforms, produce minimal CodeMirror changes; never on the ordinary input hot path. Target text is exact, but position mapping under extreme inputs must not be treated as unconditionally exact; review and fallback are in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md). |
| Markdown table interaction | `codemirror-markdown-tables` | Hand-rolled TableWidget / Milkdown / Toast UI / ProseMirror tables | Choose `codemirror-markdown-tables`. Mature table widget, cell editing, row/column ops, copy/paste, and table autocompletion inside CodeMirror 6; LumaMark only does thin integration, theme adaptation, and source-fidelity boundaries. A project patch mounts valid GFM tables without a load-time `table.format` rewrite; remaining format document changes are dropped so source stays verbatim. See [ADR 0002](../decisions/0002-codemirror-markdown-tables.md) and [ADR 0003](../decisions/0003-live-preview-assets-code-and-table-inline.md). |
| UI primitives | Radix Primitives | Ariakit/Base UI/React Aria | Default Radix. Replace per component if one does not fit. |
| Visual styling | CSS variables + CSS Modules | Tailwind/shadcn/ui | Default CSS tokens + CSS Modules. Do not introduce shadcn-generated components yet, to avoid turning primitives into self-maintained code. |
| Icons | lucide-react | Radix Icons | Choose lucide-react. Broader icon coverage. |
| Application state | Zustand | Redux/Jotai/TanStack Store | Choose Zustand. Lightweight, low boilerplate, fits desktop app state. |
| In-page routing | No router for now | TanStack Router/React Router | Each desktop window remains a single editor shell; desktop multi-window is owned by Rust/Tauri window routing, so React Router is not needed. Revisit when multi-page needs are clear. |
| Long-list virtualization | TanStack Virtual | react-window | Choose TanStack Virtual. Headless and suitable for custom UI. |
| File tree | react-arborist | Hand-rolled tree + TanStack Virtual | Adopted react-arborist; keep its virtualization and keyboard semantics; do not hand-roll a tree. |
| Split layout | react-resizable-panels | Hand-rolled drag panes | Adopted react-resizable-panels; do not hand-roll drag layout. |
| Command palette | cmdk | Hand-rolled command palette | Adopted cmdk; command metadata still comes from the unified command model. |
| i18n | i18next + react-i18next | Lingui/FormatJS | Default i18next. Mature ecosystem, stable React support. |
| Plain-text clipboard | `tauri-plugin-clipboard-manager` + browser navigator adapter | WebView Clipboard API / hand-rolled Rust command | Desktop uses the official Tauri plugin with permissions limited to read-text/write-text; browser adapter is only for non-Tauri environments; app injects a structured port — see [ADR 0016](../decisions/0016-tauri-text-clipboard-adapter.md). |
| External open | tauri-plugin-opener + own Rust command allowlist | shell plugin / granting opener capability directly to WebView | Adopted the official opener Rust API, but do not grant `opener:*` directly to WebView; URL, path, and WorkspaceSession authorization are validated by own commands/services — see [ADR 0015](../decisions/0015-external-open-and-file-mutations.md). |
| Unit tests | Vitest | Jest | Choose Vitest. Native integration with Vite. |
| E2E | Playwright | Cypress | Choose Playwright. Fits automated desktop WebView experience verification. |
| Mermaid | Official mermaid package | Hand-rolled render / third-party wrapper | Use official Mermaid; build async scheduling and caching around it. |
| Math | MathJax 4.1.3 CHTML + NewCM | KaTeX, main-thread render, SVG | Document-level Worker, AMS labels/refs, mhchem, optional Physics. Decision: [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md). |

## Frontend Module Boundaries

Current directories (long-term boundaries only; not an exhaustive file listing):

```text
src/
├─ app/
│  ├─ App.tsx
│  ├─ containers/
│  ├─ controllers/
│  ├─ providers/
│  ├─ shell/
│  └─ stores/
├─ editor/
│  ├─ capabilities/
│  ├─ commands/
│  ├─ core/
│  ├─ interaction/
│  ├─ markdown/
│  ├─ metrics/
│  ├─ widgets/        # compatibility re-exports only
│  └─ wysiwyg/
├─ features/
│  ├─ about/
│  ├─ command-palette/
│  ├─ commands/
│  ├─ document-statistics/
│  ├─ file-actions/
│  ├─ file-tree/
│  ├─ media-viewer/
│  ├─ outline/
│  ├─ reading-appearance/
│  ├─ recent-files/
│  ├─ recovery-drafts/
│  ├─ settings/
│  ├─ startup/
│  ├─ updates/
│  └─ workspace/
├─ services/
│  ├─ assets/
│  ├─ clipboard/
│  ├─ debug/
│  ├─ drafts/
│  ├─ file-watch/
│  ├─ files/
│  ├─ open-requests/
│  ├─ opener/
│  ├─ preferences/
│  ├─ settings/
│  ├─ tauri/
│  ├─ updater/
│  ├─ window/
│  └─ workspace/
└─ shared/
   ├─ debug/
   ├─ i18n/
   └─ styles/
```

### `app`

Owns application startup and global providers.

Includes:

- i18n provider.
- Theme provider.
- App store initialization.
- Shell layout.
- Global error boundary.

Remediation gates:

- `AppShell` may only compose `useAppShellModel`, `useAppShellSlots`, and `AppShellView`; it must not call file, workspace, editor-table, or Tauri service details directly.
- `app/shell/**` is the render layer: it only consumes props, labels, callbacks, and ReactNode slots; it must not import stores, services, workflows, editor commands, or window-control implementations. The sole exception is `EditorPane` as a thin DOM→editor public interaction adapter that calls hit classification from `editor/interaction` and outer `EditorApi` coordinate interfaces; it must not read full Markdown text, execute business commands, or depend on capability private implementations.
- `app/controllers/` splits into independent subdomain hooks: document, workspace, commands, editor, startup, settings, window; it must not form a new god-file controller.
- `useStartupExperience` only orchestrates file/workspace workflows, recovery-draft decisions, and versioned startup metadata; while the start page is shown the editor stays mounted, but the entire workspace content must be `inert` and hidden from the accessibility tree.
- `app/containers/` assembles feature UI containers into shell slots; the shell view does not know feature workflows or stores.
- Menus, the command palette, and context menus must consume the same command model from `features/commands`; the same business action must not be redefined in shell JSX or controllers.
- i18n label generation lives in controller/model layers; render components only consume strings.
- `tests/quality/architectureBoundaries.test.ts` is the current architecture stop-bleed boundary test; shell/workflow/editor widget changes must keep it green.

### `editor`

Owns the CodeMirror wrapper and all editor extensions.

Boundaries:

- Must not depend on business UI such as the file tree or settings page.
- Exposes a clear editor API.
- Emits only lightweight events to React, such as dirty, selection summary, and outline changed.
- Full Markdown text is not broadcast through the React store.

Recommended submodules:

- `core`: CodeMirror view/state initialization.
- `interaction`: Derives selection, minimal block, inline owner, delimiter, composition, and protected source ranges from CodeMirror state and the Lezer syntax tree.
- `capabilities`: Independently evolving editor sub-capabilities such as Mermaid, table, code block, and image.
- `markdown`: Markdown language pack and syntax helpers.
- `wysiwyg`: Typora-like shared visual decorations composition layer; keeps only low-cost, source-faithful shared visual rules and does not host complex sub-capability implementations.
- `widgets`: Compatibility re-exports for old paths; new capabilities must not put primary implementations back here.
- `commands`: Editor commands and shortcuts.
- `metrics`: Input latency, render duration, and scroll sampling.

Editor capability boundaries:

- Each complex editor subfeature enters `editor/capabilities/<name>/`, for example `mermaid`, `math`, `plantuml`, `table`, `code-block`, `image`.
- Each capability exposes extensions, command factories, and necessary types through a thin public entry; primary implementation splits into detection, DOM, adapter, commands, decorations, and similar submodules.
- `editor/core/**` may only consume capability aggregate entries; it must not import capability internals or old `widgets/*` internals.
- `editor/commands/**` may only invoke table, code-block, and similar capabilities through capability command factories; it must not import table widget, Mermaid widget, or code-block decoration internals directly.
- `editor/widgets/**` may only keep compatibility re-exports; it must not continue hosting new primary implementations.
- Shared `wysiwyg/markdownDecorations.ts` may own low-cost shared syntax visual rules such as heading, quote, list marker, and inline mark hiding, and may compose decoration builders exposed by capabilities; code-block, image, Mermaid, and table interaction enhancements must not be piled back into the shared WYSIWYG file.
- All mark expansion and structure activation consume `EditorInteractionContext` from `editor/interaction` uniformly; capabilities or shared WYSIWYG must not invent independent active-line and composition special cases.
- `EditorInteractionContext` is transaction-derived state and does not enter the React store; during IME composition, prefer mapping existing decorations, then incrementally recompute structure near candidate text after composition ends.

Editor command boundaries:

- The app layer only calls `EditorDocumentPort` and `EditorCommandPort` exposed by `editor/commands/editorCommandPort.ts`.
- Concrete CodeMirror commands such as Markdown format, table commands, display mode, and range selection must not be imported into the shell render layer or feature UI.
- `EditorDocumentPort` exposes lightweight commands such as snapshot, serialize, savepoint, load, focus, context, and targeted image refresh; callers may read body text immediately but must not hold or broadcast full Markdown text.
- Page width and font zoom are reconfigured through `EditorApi.setAppearance` and an independent CodeMirror compartment; platform primary modifier plus wheel (macOS `Meta`, Windows/Linux `Ctrl`) emits only a lightweight zoom request from the editor DOM, and the app settings controller updates normalized settings and debounce-persists them. That transaction must not modify body text, selection, or undo history.

Mermaid capability split requirements:

- Public entry remains `editor/widgets/mermaid/MermaidWidget.ts` for compatibility export only.
- Primary implementation lives in `editor/capabilities/mermaid/`.
- `createMermaidCapability.ts` only assembles the public capability.
- `mermaidPreviewExtension.ts` only assembles the CodeMirror extension/state field.
- `mermaidBlockDetection.ts` owns fenced-block detection and types.
- `MermaidBlockWidget.ts` owns `WidgetType` lifecycle and DOM view coordination.
- `mermaidWidgetDom.ts` owns button, status, svg container, and other DOM creation.
- `mermaidInlineEditor.ts` only activates the target block in the main `EditorView`, sets selection, and focuses; it must not create a nested editor that holds pending body text or a flush protocol.
- `mermaidRenderAdapter.ts` owns Mermaid dynamic import, safe config, and render.
- `mermaidEditingState.ts` owns mappable state for the block being edited; when active, fenced source stays in the main document and preview decoration sits below the block.
- Later performance work should prioritize incrementalizing block collection and decoration construction in `mermaidPreviewExtension`, not piling complex logic back into the public entry.

Math capability split requirements:

- Primary implementation lives in `editor/capabilities/math/` and must not reuse Mermaid business types, cache entries, or Worker protocol.
- `mathSyntax.ts` only extends Lezer Markdown; TeX content stays opaque.
- `mathInventory.ts` forms the formula sequence in source order; `mathRenderSession.ts` owns Worker, debounce, generation, and last successful result.
- `mathDocumentRenderer.ts` typesets the whole document batch in source order inside the Worker and returns CHTML. Macros, numbering, and references must not be split into stateless single-formula jobs.
- `mathPreferences.ts` defines `disabled | pandoc | legacy`, `none | ams | all`, and Physics gating; defaults are Pandoc / none / off. The sole editor-core entry `EditorApi.setMathPreferences` must not change body text, selection, dirty, or undo history.
- Desktop document identity comes from Rust `DocumentPathIdentity` / claim; frontend `editorDocumentIdentity.ts` only mints untitled ids and path-byte-hash fallbacks and must not guess Windows drive letters or UNC paths.
- `@mathjax/src` and `@mathjax/mathjax-newcm-font` are pinned to 4.1.3. Allowed packages, safety options, and rollback conditions follow [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md).
- `\ref` / `\eqref` clicks must reuse `EditorCommandPort.revealPosition()`, resolve position with the current generation label index plus a fresh inventory, and must not long-term cache absolute offsets.

PlantUML capability split requirements:

- Primary implementation lives in `editor/capabilities/plantuml/`; it must not reuse Mermaid business types or cache entries, but scheduling/geometry/reading-lock contracts align with Mermaid.
- `createPlantumlCapability.ts` only assembles the public capability; `plantumlPreviewExtension.ts` only assembles the extension, theme observer, and decoration field.
- `plantumlEngine.ts` owns TeaVM engine lazy load, sticky failure, and serial queue; `plantumlRenderAdapter.ts` owns `dompurify` SVG sanitization.
- Reading mode must not create Edit/Delete; Expand still emits already-rendered SVG through `EditorMediaPreviewRequestHandler`.
- The switch is canonical `markdown.plantuml.enabled`, default on. Version, safety, and rollback follow [ADR 0018](../decisions/0018-plantuml-local-rendering.md).

Table/code-block/image capability rules:

- The table capability uses `codemirror-markdown-tables`; LumaMark only provides thin extension, theme, insert/copy/delete command factories, and style adaptation based on the component’s source-token DOM; it does not create sibling preview DOM. Complex table interaction still follows the mature component; vertical caret column preservation is currently corrected by a minimal pnpm patch on the locked version.
- The code-block capability owns fenced/indented code-block decoration, whole-block line-level preview classes, and wrap command; code highlighting is wired through official CodeMirror language packs.
- The image capability owns image-only Markdown preview, relative path resolution, image DOM widget, and injected remote image resolver; it must not depend directly on workspace, file tree, app shell, or Tauri services.
- Image capability detection, path resolution, Widget DOM, and decoration StateField live in `imageBlockDetection.ts`, `imagePathResolver.ts`, `ImageBlockWidget.ts`, and `imagePreviewExtension.ts` respectively; toolbar and async load lifecycle must not be piled back into the StateField file.
- Image and Mermaid capabilities emit currently successfully loaded asset URLs or already-rendered SVG to the app through an injected `EditorMediaPreviewRequestHandler`; that callback must not create editor transactions or let capabilities depend upward on feature UI.

Current capability-boundary audit conclusions:

- Independent capabilities: `mermaid`, `math`, `plantuml`, `table`, `code-block`, and `image` each have their own capability directory and thin public entry; `editor/core/**` and `editor/commands/**` do not import capability internals directly.
- Shared contracts established: `editor/interaction` uniformly derives edit ranges; `documentSourceFormatField` and savepoints map source format in sync; Mermaid editing uses only the main `EditorView`. See [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md).
- Allowed shared layer: `editor/capabilities/index.ts` only assembles capabilities and shared WYSIWYG extensions; it must not host DOM creation, syntax-tree scanning, render scheduling, third-party widget configuration, or other primary logic.
- Allowed shared WYSIWYG: `wysiwyg/markdownDecorations.ts` only handles visual rules shared by all Markdown, plus composition of capability decoration builders. It must not own async rendering, block widget lifecycle, file-path resolution, table commands, Mermaid editors, or image preview DOM.
- Corrected dependency direction: capability internals must not import private types from `app`, `features`, `services`, or `wysiwyg`; decoration range types shared across capabilities live in `editor/markdown`.
- Completed boundary work: image detection, path resolution, DOM Widget, and StateField are split; later cache, size probing, or error recovery continues into focused modules and must not be backfilled into `imagePreviewExtension.ts`.
- Remaining debt: table source visual classes still live in shared WYSIWYG, while table interaction and inactive-cell inline Markdown thin rendering already live in the table capability. If table visual rules keep growing, move them into a decoration builder provided by the table capability.
- Remaining debt: task-list checkbox, `Mod-Enter` toggle, and list markers still sit near shared WYSIWYG/list commands. If task-list toolbar, batch ops, or nested-list-specific logic appear later, add `editor/capabilities/list` or `editor/capabilities/task-list`; do not keep expanding `markdownDecorations.ts`.
- Compatibility-layer debt: `editor/widgets/*` may only re-export. After migration is complete and callers are stable, delete old paths and corresponding re-export tests instead of adding logic on the old paths.

Automated gates:

- `tests/quality/architectureBoundaries.test.ts` must prevent shell render components from calling business capabilities directly.
- The same test must prevent `editor/core/**` and `editor/commands/**` from importing capability internals directly.
- The same test must prevent `editor/capabilities/**` from importing app, feature, or service layers upward.
- The same test must keep `editor/capabilities/index.ts` as a thin assembly entry and prevent it from becoming a new god file.

### `features`

Owns independent product features.

Each feature interacts with other layers only through service/editor APIs to avoid lateral coupling.

Feature workflow rules:

- File open, save, save-as, dirty revision, and recent files are closed through workflows in `features/file-actions`.
- Disk-watch events for the current document are also closed through `features/file-actions`: clean auto-reloads, dirty only produces an explicit conflict decision; same-document request ids and cross-document generations must both block late reads from overwriting newer state.
- `features/file-actions` receives state and editor capabilities through `FileStateAdapter`, `StatusAdapter`, and `EditorDocumentPort`; it must not hard-depend on `appStore`.
- Workspace open, children lazy load, and stale-request protection are closed through workflows in `features/workspace`.
- `features/workspace` splits into workflow, selectors, and view-model/UI-facing types; opening a file only uses an injected callback and does not know the file-workflow implementation.
- `features/startup` only holds start-page UI and versioned session metadata store. Auto-restore must wait until the editor is ready and recovery-draft checks complete; pending recovery drafts take priority over the last session.
- File and workspace open workflows return `opened`, `cancelled`, `failed`, or applicable `superseded` results; the app controller may close the start page only after confirmed success.
- `features/commands` is the sole command-model source for command id, label, icon, shortcut, menu-node composition, and availability rules; `app/controllers` injects complete no-arg action and payload action handler maps, and the shell only hands distinguishable invocations to an exhaustive dispatcher.
- `features/settings` holds a small, low-frequency v2 settings document and structured load/recovery/write lifecycle; it must not hold Markdown body text or selection. Writes go only through `services/settings`; on failure the canonical snapshot is retained for retry, and the app controller projects normalized settings onto existing runtime stores. See also [SETTINGS_SYSTEM_DESIGN](../product/SETTINGS_SYSTEM_DESIGN.md) and [ADR 0014](../decisions/0014-settings-persistence.md).
- `features/reading-appearance` only holds editor appearance runtime state; page width and font zoom persist through `features/settings` as the source of truth. Combined wheel events produce lightweight zoom requests that update settings via the app controller; disk writes must not happen inside editor input transactions.
- `features/media-viewer` only holds the current viewing session and opener, composing Radix Dialog and `react-zoom-pan-pinch`; media payloads do not enter Zustand, and the Dialog is lazy-loaded by an app container. Dependencies and rollback conditions are in [ADR 0008](../decisions/0008-shared-media-viewer.md).
- `features/*/components/**` only render; when business behavior is needed, feature containers, workflows, or app containers inject props.
- Features may compose editor APIs and service facades but must not hold full Markdown text.

Menu composition and availability also follow [MENU_SYSTEM_DESIGN](../product/MENU_SYSTEM_DESIGN.md); shell and controllers must not redefine the same business actions outside `features/commands`.

### `services`

Owns communication with Tauri, render jobs, cache, and performance recording.

All Tauri commands must be called through typed wrappers; UI components must not scatter `invoke()` calls.

Current hard boundaries:

- Workspace Tauri wrappers live in `services/workspace/`; `features/workspace/` keeps only workflow, store, and UI-facing type usage.
- Settings Tauri wrappers live in `services/settings/`; they retain structured errors and `settingsFileExists`/field-recovery results and do not depend on React.
- The plain-text clipboard facade lives in `services/clipboard/`: Tauri runtime only calls official `tauri-plugin-clipboard-manager`; the navigator adapter is only for browser test/preview. Desktop permissions are strictly limited to `read-text` / `write-text`; native failures must surface upward with no silent fallback to the WebView Clipboard API. The app controller injects the structured port into `EditorCommandPort`; editor and features do not depend on the Tauri plugin directly.
- The window facade lives in `services/window/` and only exposes platform capabilities such as `onCloseRequested`/`destroy`; the app close coordinator composes settings flush, and the service does not depend upward on features. Title-bar X, Alt+F4, and system close destroy the window only after flush succeeds.
- File-watch command/event wrappers live in `services/file-watch/`; open-result fingerprints and watch baselines form the race handshake here. The image resolver only serially syncs authorized local targets to this facade; editor capabilities do not depend on Tauri directly.
- Desktop open-request wrappers live in `services/open-requests/`; they actively recover/claim by current window label and advance durable lifecycle through `record_applied` / `acknowledge`. `desktop-open-requests-available` only prompts a specific window to recheck and must not carry path facts. Path identity, window owner, serial routing, and failure boundaries are in [ADR 0009](../decisions/0009-desktop-file-open-bridge.md).
- Browser/WebView preference storage adapters live in `services/preferences/`; they only expose business-agnostic key-value storage, do not depend on feature stores, and do not decide which fields persist.
- Services must not depend on React components, Zustand stores, or the app shell.

### `shared`

Only shared infrastructure:

- Thin wrappers around mature components.
- Design tokens.
- i18n initialization.
- Icon aliases.
- Shared types.

`shared/components` must not become a hand-rolled component library. It may only compose mature components and project visual styling.

## Frontend Dependency Direction and Ports

Current frontend dependencies must follow this direction:

```text
app/shell view
  <- app/containers
  <- app/controllers
  <- features workflows + feature containers
  <- services + editor ports
  <- Tauri commands / CodeMirror internals
```

Allowed call relationships:

- `app/shell/**` only receives props and does not call business capabilities directly.
- `app/containers/**` may compose shell view and feature UI containers, but do not implement business flows.
- `app/controllers/**` may compose feature workflows, editor ports, i18n labels, lightweight app state, and window-level callbacks.
- `features/**` may compose service facades and editor ports, but must not depend on a concrete app shell or hold full Markdown text.
- `services/**` only expose typed command clients or pure service facades; they do not depend on React, Zustand, editor, or app.
- `editor/**` exposes stable `EditorApi`, `EditorDocumentPort`, `EditorCommandPort`, and lightweight events; it does not depend on app shell, file tree, settings, or workspace UI.

Forbidden call relationships:

- Shell render components importing `useAppStore`, feature workflows, service wrappers, Tauri commands, editor table commands, or window-control adapters.
- Feature UI components calling services/stores directly; inject business actions from containers or workflows.
- Services importing React components, hooks, Zustand stores, or CodeMirror views.
- App controllers redefining action lists for menus, command palette, and context menus; those actions must come from `features/commands`.

Lightweight ports:

```ts
interface EditorDocumentPort {
  captureSnapshot(): EditorDocumentSnapshot
  isSnapshotCurrent(snapshot: EditorDocumentSnapshot): boolean
  getText(): string
  serializeText(): string
  loadText(text: string, options?: LoadDocumentOptions): void
  markSaved(snapshot: EditorDocumentSnapshot): void
  markUnsaved(): void
  refreshImages?(path: string): void
  focus(): void
  setContext(context: EditorDocumentContext): void
}

interface EditorCommandPort {
  copy(): Promise<boolean>
  copyTable(range?: EditorInteractionRange): Promise<boolean>
  cut(): Promise<boolean>
  deleteImageReference(range: { from: number; to: number }): void
  deleteTable(range?: EditorInteractionRange): boolean
  focus(): void
  getDisplayMode(): EditorDisplayMode
  getEditState(): EditorEditState
  insertImages(
    images: readonly { alt: string; markdownSource: string }[],
    position?: { x: number; y: number },
  ): void
  openSearch(): void
  paste(): Promise<boolean>
  runFormat(command: MarkdownFormatCommand): void
  redo(): void
  selectAll(): boolean
  setDisplayMode(mode: EditorDisplayMode): void
  selectPosition(position: number): void
  undo(): void
}

interface StatusAdapter {
  setStatusKey(statusKey: string): void
}
```

These ports are cross-layer collaboration boundaries, not a new global abstraction layer. Ports only expose the minimal capabilities that are already used across layers and need implementation isolation.

## Rust Module Boundaries

Current directories:

```text
src-tauri/src/
├─ main.rs
├─ lib.rs
├─ commands/
│  ├─ assets.rs
│  ├─ debug_log.rs
│  ├─ document_claims.rs
│  ├─ files.rs
│  ├─ file_watch.rs
│  ├─ opener.rs
│  ├─ open_requests.rs
│  ├─ recent_files.rs
│  ├─ settings.rs
│  └─ workspace.rs
├─ services/
│  ├─ asset_service.rs
│  ├─ desktop_window_service.rs
│  ├─ debug_log_service.rs
│  ├─ document_claim_service.rs
│  ├─ document_path_identity.rs
│  ├─ file_service.rs
│  ├─ file_watch_service.rs
│  ├─ file_watch_session_hub.rs
│  ├─ opener_service.rs
│  ├─ open_request_lifecycle.rs
│  ├─ open_request_service.rs
│  ├─ recent_files_service.rs
│  ├─ settings_service.rs
│  ├─ workspace_mutation_service.rs
│  ├─ workspace_service.rs
│  └─ workspace_session_service.rs
└─ errors.rs
```

### Rust owns

- Reading files.
- Writing files.
- Atomic save.
- Path normalization.
- File watching.
- Current Markdown and authorized local images use parent-directory non-recursive watchers, exact target filtering, and content fingerprints; events must not be treated as final file state directly.
- Workspace scanning.
- Search.
- Cache.
- System integration.

### Rust does not own

- UI state.
- Editor caret and selection.
- Markdown WYSIWYG decorations.
- React component logic.

## Tauri Command Design

Currently registered command families (names use underscores consistently; keep typed wrappers and tests in sync when adding or removing):

```text
files_read_text
files_write_text
files_show_open_file_dialog
files_show_open_image_dialog
files_show_save_file_dialog
watch_document
replace_local_image_targets
unwatch_document
assets_cache_remote_image
assets_import_document_image
assets_authorize_local_image
assets_copy_local_image
assets_import_draft_image
assets_finalize_draft_images
workspace_open_directory
workspace_open_path
workspace_list_children
workspace_create_file
workspace_create_directory
workspace_rename_entry
workspace_delete_entry
open_requests_recover
open_requests_claim
open_requests_record_applied
open_requests_acknowledge
document_claim_heartbeat
document_claim_release
opener_open_url
opener_reveal_path
settings_get
settings_set
settings_acceptance_config_dir  # LUMAMARK_ACCEPTANCE_MODE + script-owned system temp dir only
settings_acceptance_write_barrier_dir  # same acceptance mode: read-back restricted write-barrier dir
settings_acceptance_mark_close_entered  # same acceptance mode: record close coordinator entered
debug_append_log
```

The three `settings_acceptance_*` commands serve only [Windows menu real-pointer acceptance](../release/WINDOWS_V1_BUILD.md#menu-and-context-menu-real-pointer-acceptance): they require explicit acceptance mode and a script-owned fixed directory that remains under the same system temp root after canonicalization, and they prove the close coordinator is waiting on persistence via write-barrier and close-entered markers. Any unmet environment or path contract fails closed; these entries are not regular business commands or portable-config features.

Unified return shape:

```ts
type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
```

Error shape:

```ts
interface AppError {
  code: string
  message: string
  details?: unknown
  recoverable: boolean
}
```

Rules:

- UI components do not call `invoke()` directly.
- Every command has a TypeScript wrapper.
- Rust errors convert to stable error codes.
- User-visible error text goes through i18n; raw Rust errors are not shown directly.

## Core Data Flows

### Desktop File Open

```text
first instance args_os / second instance Vec<String>
-> synchronous entry copies launch data and dispatches a spawn_blocking worker
-> worker bounded-waits for primary durable-state readiness before any config or filesystem access
-> one global routing mutex serializes the complete launch batch
-> each valid Markdown path resolves one validated DocumentPathIdentity
-> claim owner / retained target authority wins without loading settings
-> otherwise load openWindowMode for the new identity
-> startup multi reuses an unowned blank main, later multi paths use document-N;
   aggregate reuses main or a deterministic managed live window
-> clone main WindowConfig when a managed window must be created
-> durable enqueue_path_for_identity with queued -> processing -> applied-pending -> acknowledged lifecycle
-> targeted desktop-open-requests-available hint
-> target frontend recover/claim -> existing fileWorkflow.openPath
-> record_applied, then acknowledge after the document is safely owned
```

Requirements:

- First-instance paths stay as `OsStr`/`Path` at the OS layer; lossy conversion is forbidden; paths that cannot cross a JSON boundary fail explicitly.
- Upstream second-instance args from single-instance can only be `Vec<String>`; that limitation, platform differences, and review conditions follow [ADR 0009](../decisions/0009-desktop-file-open-bridge.md).
- All valid Markdown args from one launch are routed in original order; each path is persisted only to its own target window; never enqueue the whole argv batch repeatedly for every window.
- The same validated identity may have only one window owner across claim, retained request, and concurrent launch; unrelated offline/UNC retained-path queries must not re-touch the disk or block the current path.
- `tauri-plugin-single-instance` must be the first Tauri plugin; a side-effect-free readiness gate may be managed early; the durable-state plugin follows immediately after but only constructs and manages authority. Secondary must exit before the state plugin and must not read or write durable state. The single-instance synchronous callback only copies `AppHandle`, args, cwd, and validated acceptance config, then dispatches `spawn_blocking`; the worker bounded-waits for ready before any config/filesystem access, fails closed on timeout, and must not wait forever. Parsing, reading settings, persisting, or creating WebViews inside the callback is forbidden; creating a WebView directly in the Windows sync handler risks deadlock.
- First-instance initial argv must go through the sole serial launch worker. That worker restores durable active targets first, then routes argv, and publishes readiness only after full success; on failure it keeps an explicit error and does not release secondary. For `multiWindow` cold start, the first new path reuses empty `main` only when `main` has no authority; two new paths should become `main` + `document-1` and must not leave an extra empty window. Startup restore rebuilds durable active targets first and must not overwrite an existing `main` owner.
- `desktop-open-requests-available` is a lossy, repeatable directed notification, not a source of truth; the target window must actively recover/claim after mount and must not acknowledge a durable request before success.
- Routing, window creation, durable enqueue, notification, and show/unminimize/focus failures all return explicitly; if enqueue fails after creating an empty window, destroy only that empty window and retain an explicit error.
- Dirty cancel clears the current local batch; confirm only processes the currently shown item; the start page must not close and last session must not be written before success.
- Windows file association, Explorer double-click, second launch, multi-window/aggregate, exactly-once, and window focus must be accepted serially on a real installer with isolated config; browser bridge mocks or CDP synthetic clicks cannot replace `ClientToScreen` + OS input gates.

### Open File

```text
User action
-> dialog plugin / Rust command
-> Rust read file
-> frontend receives source text + metadata
-> parse BOM and per-line LF/CRLF/CR into normalized Text + DocumentSourceFormat
-> create CodeMirror EditorState with both values
-> update app store currentFile
-> run outline/fixture/perf hooks as needed
```

Requirements:

- Opening large files must not freeze the UI.
- File content enters CodeMirror, not the global store.
- `DocumentSourceFormat` shares the editor-state lifecycle with body text and maps with transactions.
- Encoding problems must fail explicitly.

### External File and Image Changes

```text
Rust parent-directory watcher
-> 200ms debounce + exact target filter
-> bounded retry + read/hash current target
-> file-watch://changed
-> service facade
-> clean document reload / dirty conflict decision / targeted image preview revision
```

Requirements:

- Watch scope includes only the current Markdown and authorized local images; do not recursively authorize or watch the whole workspace.
- After a Markdown event arrives, content must be re-read; image events may only refresh runtime asset URLs and must not rewrite Markdown.
- Local image authorization paths, watcher event paths, and frontend revision keys must share the same lexical path identity: fold `.` / `..`, unify separators, and ignore case on Windows; string spelling differences must not be treated as different files.
- Document targets and image targets are managed separately; replacing/canceling document watches must not clear already-synced image targets.
- Open/write fingerprints and watcher baselines must share the same source; temporary read failures retry through a single merged worker with bounded retries; events are sent serially; the frontend still drops late events by revision; exhausted `error` events may only show recoverable prompts.
- Document switches, reference-set changes, and React cleanup must release old watches; self-saves with the same fingerprint must not produce user conflicts.

Watch, conflict, and targeted image-refresh boundaries are in [ADR 0005](../decisions/0005-external-file-and-image-watch.md); image resolver and draft finalize boundaries are in [ADR 0003](../decisions/0003-live-preview-assets-code-and-table-inline.md).

### Edit Document

```text
User input
-> CodeMirror transaction
-> CodeMirror updates doc/view
-> EditorInteractionContext maps or incrementally derives the minimum active structures
-> editor plugins update decorations/widgets
-> debounced lightweight events to React
```

Requirements:

- React does not receive every full-text change.
- Complex derived work uses debounce or idle scheduling.
- Input latency is recorded as a metric.

### Reading Appearance

```text
Settings page-width/font-zoom choice or modified wheel
-> app settings controller
-> features/settings store (debounced settings.json persistence)
-> features/reading-appearance runtime projection
-> app controller maps preset to pixel boundary
-> EditorApi.setAppearance
-> CodeMirror appearance compartment + CSS variables

Platform primary modifier + wheel inside CodeMirror
-> non-passive scrollDOM listener prevents WebView zoom
-> throttle repeated touchpad events to one request per 80 ms
-> lightweight zoom request
-> persisted fontZoomPercent through the settings controller
-> EditorApi.setAppearance
```

Requirements:

- Page width uses only the four stable presets `narrow`, `standard`, `wide`, and `fluid`; default is `standard`, and invalid persisted values fall back to the default.
- Theme settings use `light`, `dark`, and `system`; default is `light`. `system` resolves `prefers-color-scheme` on the bootstrap first frame and in ThemeProvider, and listens for changes; the stored canonical value always remains `system`.
- Font zoom ranges from 50%–250% in 10% steps; illegal values fall back to 100% by field, and normalized values enter v2 `settings.json`.
- Ordinary wheel and combined wheel outside the editor must not trigger font zoom; only macOS `Meta + wheel` and Windows/Linux `Ctrl + wheel` may trigger it; non-primary modifiers, stacked modifiers, and AltGraph input must not be intercepted. Legal combined wheel is intercepted by a non-passive listener on the entire CodeMirror `scrollDOM` (including page margins), must prevent WebView page-level zoom, and throttles high-frequency touchpad events to 80 ms.
- When page-width reads are corrupt or writes fail, continue applying the current session choice, but the settings page must provide a localized accessible error; the UI must not imply the value was saved successfully.
- Appearance updates may only reconfigure view extensions/CSS variables; they must not create document changes or broadcast full Markdown text.

### Save File

```text
Save command
-> capture current CodeMirror Text + DocumentSourceFormat savepoint
-> serialize exact source text
-> optional prepareTextForSave (for example finalize draft image references)
-> Rust atomic write
-> if snapshot is still current, map any prepared text back with minimal CodeMirror changes
-> mark the exact current Text + format as saved; otherwise remain dirty
```

Requirements:

- Do not format the whole document.
- Unmodified lines preserve original LF/CRLF/CR, BOM, trailing spaces, and trailing-newline intent.
- Save transforms must be based on the captured snapshot; new edits during write must not be marked clean by an old save result.
- `@codemirror/merge` is used only for minimal changes after controlled transforms. After applying changes, the written text must result; selection/scroll semantic mapping exactness follows the boundary verification in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md).
- Write failures must keep dirty status.
- Errors must be recoverable and understandable.

### Mermaid Rendering

```text
CodeMirror detects mermaid block
-> inactive block widget requests render job
-> render scheduler debounce/cancel/cache
-> dynamic import mermaid
-> mermaid render
-> widget receives SVG or error

User activates mermaid block
-> main EditorView reveals fenced source and owns every edit/undo
-> preview decoration remains below the active block
-> save/recovery reads the main document immediately
```

Requirements:

- Do not render on the synchronous input path.
- Repeated renders of the same source hit cache.
- Stale tasks must be discarded.
- Render failure must not affect editing.
- Do not create a nested `EditorView`, and do not maintain a Mermaid body copy waiting to commit after blur/close.
- Mermaid heavy dependencies may continue to be dynamically code-split; if manual grouping and `maxSize` form cyclic output chunks, Rolldown must enable `strictExecutionOrder`, proven by a real `dist/` lazy-load render test of execution order.
- Windows packaged WebView must cover immediate save while editing the main document; a development server or an app-shell-only view is not a substitute.

### Search

Search is layered as follows (Parity Reliability / current roadmap scope; historical V1 Alpha plans are not the execution source):

- Current-document search: prefer CodeMirror search capabilities.
- Workspace search: Rust owns scanning and querying.

Full-text indexing enters a later stage and is not locked during the Parity Reliability Foundation stage.

## Editor WYSIWYG Layers

Typora-like behavior is implemented in three layers:

### Visual Layer

Use decorations to change presentation:

- Heading sizes.
- Bold/italic styles.
- Quote styles.
- List marker styles.
- Softening or hiding Markdown markers.

The visual layer uses `EditorInteractionContext` to decide the minimal expansion range. When a collapsed caret enters nested inline syntax, only the innermost owner expands; a non-empty selection expands all intersecting owners. Headings and lists expand the current minimal block; ordinary multi-line quotes only expand the marker on the selection’s line; code fences, Mermaid, and similar boundary-integrity semantics keep the full block delimiter. Activated source markers use weakened source-mark decorations that do not replace text and inherit theme tokens; source mode does not apply that visual rule. During composition, replacement decorations near candidate text must not be rebuilt.

### Capability and Widget Layer

Use editor capabilities to manage complex editor subfeatures, and block widgets to present complex blocks that need replaced or enhanced rendering:

- Tables.
- Mermaid.
- Math.
- Image previews.
- Future diagrams.

Capability rules:

- A capability is a long-term boundary that owns composition of extensions, commands, DOM widgets, render adapters, detection logic, and performance hooks.
- A widget is an internal implementation detail of a capability; old `editor/widgets/*` paths exist only as compatibility exports.
- When adding a complex-block capability, create a capability first; do not scatter logic into `core`, `commands`, `wysiwyg`, or the app shell.

Table widget rules:

- Live-preview table interaction is provided by `codemirror-markdown-tables`; Markdown source still lives in the CodeMirror document.
- Source mode does not enable the table widget and shows raw Markdown tables.
- LumaMark only implements thin commands such as copy current table source, delete current table block, and theme adaptation.
- Row/column insert, delete, move, select, copy/paste, cell editing, and table autocompletion follow the mature component’s behavior; do not hand-roll a table editor.

### Command Layer

Use editor commands to change text:

- Toggle bold.
- Toggle italic.
- Insert task list.
- List indent.
- Insert code block.

Rules:

- The visual layer does not change source.
- The command layer only changes text ranges the user explicitly operated on.
- The widget layer must be able to return to source editing.

## Performance Design

### Hot Paths

These paths must stay in CodeMirror or efficient browser paths whenever possible:

- Input.
- Caret.
- Selection.
- Scrolling.
- Basic decorations.
- Transaction mapping and local derivation of interaction context.

### Cold Paths

These paths must be asynchronous:

- Mermaid.
- Batch math rendering.
- Image dimension reads.
- Workspace search.
- Export.
- Full outline rebuild.
- Pre-save asset finalize and save-preparation diff.

### Performance Metrics

Must continuously measure:

- App startup.
- File open.
- Typing latency.
- Scroll smoothness.
- Render job duration.
- Memory usage.
- Save duration.
- Selection-only decoration updates and display-mode switches.
- Code-block-dense documents and long complex Mermaid tasks.

## Mature Component Usage Boundaries

Mature components first, but do not pile on dependencies blindly.

Before introducing a dependency, confirm:

- Whether it solves a real problem.
- Whether it sits on the editing hot path.
- Whether accessibility is sufficient.
- Whether TypeScript is supported.
- Whether theming is controllable.
- Whether it adds meaningful package size or startup cost.
- Whether it can expose degraded or non-exact states, avoiding silent fallback on source-fidelity paths.

If a mature component does not meet goals, record evidence and request user confirmation before hand-rolling.

## Candidates That Later Milestones Must Validate

These choices are not adopted yet and need small-sample validation before entering the corresponding milestone:

- `KaTeX`: already rejected as the final engine for Issue #11; see [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md).
- Workspace search library: whether to start with simple Rust scanning or introduce an index library directly should follow current Typora Parity / Parity Reliability roadmap scope, not historical V1 Alpha plans.

Validation failure does not mean immediate hand-rolling. Prefer finding a mature alternative of the same class.

## Architecture Anti-Patterns

Forbid:

- React store holding full Markdown text.
- Every Markdown block being a React component.
- Re-stringifying an entire Markdown AST on save.
- Synchronous Mermaid rendering.
- Wrapping the CodeMirror editing area with outer virtual scroll.
- Hand-rolling menus, dialogs, tooltips, trees, or command palettes.
- Bypassing the CodeMirror input model for “stronger control.”
- Making large editor-core changes without benchmarks.

## Reference Sources

- Tauri v2 architecture and commands: <https://v2.tauri.app/concept/architecture/>, <https://v2.tauri.app/develop/calling-rust/>
- CodeMirror 6 reference and decorations: <https://codemirror.net/docs/ref/>, <https://codemirror.net/examples/decoration/>
- CodeMirror merge/diff reference: <https://codemirror.net/docs/ref/#merge>
- Radix Primitives: <https://www.radix-ui.com/primitives>
- TanStack Virtual: <https://tanstack.com/virtual/latest/docs/introduction>
- react-i18next: <https://react.i18next.com/>
- Vitest: <https://vitest.dev/guide/>
- Playwright: <https://playwright.dev/>
- Mermaid usage: <https://mermaid.js.org/config/usage.html>
- KaTeX: <https://katex.org/>
- MathJax: <https://docs.mathjax.org/>
