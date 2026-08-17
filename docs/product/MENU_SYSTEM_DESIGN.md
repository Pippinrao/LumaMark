> Language: **English** · [中文](../zh/product/MENU_SYSTEM_DESIGN.md)

# LumaMark Menu System Design

> This document defines the shared product structure, visual direction, command contracts, Typora baseline mapping, and acceptance criteria for LumaMark **top-bar menus, editor/file-tree context menus, and the command palette**. It is for menu implementers, testers, and later Markdown capability maintainers. Current implementation order remains governed by the [Typora Parity Core Experience Improvement Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). Settings are out of scope here; see [Settings System Design](SETTINGS_SYSTEM_DESIGN.md). External open and file-mutation dependencies are in [ADR 0015](../decisions/0015-external-open-and-file-mutations.md).

## Purpose and scope

The top-bar menu redesign already addressed rough visuals, mismatched entries, and unclear state. This document continues to constrain context menus and a unified command model so the three entry surfaces do not split into multiple sources of truth. Scope includes:

- High-contrast desktop-tool visuals for the top menu.
- File, Edit, Paragraph, Format, View, Theme, Language, and Help entries.
- **Context menus (right-click) for the editor area, file tree, and similar surfaces**.
- One shared command source of truth for menus, **context menus**, shortcuts, and the command palette.
- Separators, submenus, checkboxes, radios, icons, shortcut columns, and disabled states.
- Accurate wiring of existing Markdown capabilities and Typora-verified shortcuts.
- Acceptance via Web Playwright, production Web E2E, and Windows Tauri real-device screenshots.
- A menu and context-menu coverage matrix that makes clear which capabilities are wired and which topical capabilities are not yet implemented.

## Non-goals

- Do not implement math, footnotes, TOC, Callout, YAML Front Matter, or restricted HTML capabilities in this round.
- Do not add “coming soon”, permanently disabled, or no-op fake menu items for unimplemented capabilities.
- Do not copy Typora branding, icons, theme assets, or unpublished implementation.
- Do not put full Markdown text, high-frequency editor state, or platform details into React stores.
- Do not replace CodeMirror, Radix Menubar / Context Menu, the command palette, or the Tauri architecture.
- Do not maintain a second context-menu command registry or a second menu design document.
- Outline context menus (for example copy heading anchors) wait until shared heading identity lands, to avoid a second anchor identity.

## Sources of truth

Typora behavior is taken only from the [Typora behavior baseline](typora-baseline/README.md). LumaMark’s current state is taken only from the [Typora topical competitive analysis](typora-competitive-analysis/README.md) plus current code and tests. Typora menu paths or keybindings without sufficient evidence are not written as confirmed facts.

This design specifically re-checked:

- [Live Preview cross-cutting model](typora-baseline/00-live-preview-model.md): source mode `Ctrl+/`, Copy as Markdown `Ctrl+Shift+C`, Paste as Plain Text `Ctrl+Shift+V`.
- [Headings](typora-baseline/02-headings.md): headings 1–6 use `Ctrl+1…6`.
- [Images](typora-baseline/07-images.md): insert local image uses `Ctrl+Shift+I`, entry under Format → Image.
- [Code blocks](typora-baseline/08-code-blocks.md): insert code fence uses `Ctrl+Shift+K`.
- [Tables](typora-baseline/10-tables.md): insert table `Ctrl+T`, select row `Ctrl+L`, select cell `Ctrl+E`, delete row `Ctrl+Shift+Backspace`.
- [Math](typora-baseline/09-math.md): math block uses `Ctrl+Shift+M`, but LumaMark currently has no math capability.
- [Mermaid](typora-baseline/11-mermaid-and-diagrams.md), [Footnotes](typora-baseline/12-footnotes.md), [Horizontal rules](typora-baseline/13-horizontal-rules.md), and [TOC](typora-baseline/15-toc.md): no verified dedicated default shortcuts.

## Pre-redesign problems and root causes

Before the redesign, `CommandMenuItem` could only express flat action, label, shortcut, and disabled. `TopChrome` mapped each item directly to `Menubar.Item`, so grouping, submenus, selected state, and dynamic structure could not be expressed accurately. Old `runAction` coerced strings into action types, and unknown actions lacked an explicit failure path. Menu labels and real behavior also mismatched—for example “About LumaMark” opened settings, the current display mode only showed another toggle action, and theme/language only showed unclear toggles. The current implementation has already converged on recursive nodes, a unified registry, and a type-safe dispatcher; this section is kept to explain design provenance, not to describe the present state.

The old visual layer had only basic rectangular popovers and monochrome hover. Icons, separators, state columns, submenu arrows, visible focus, enter/exit animation, and dark-theme layering were all missing. Table copy and delete once lived permanently in the Edit menu but could produce no result outside table context, reinforcing the sense that “menus do nothing.”

## Option choice

### Adopted: Radix menu-system refactor

Continue using the already installed and mature `@radix-ui/react-menubar`, and establish a recursive menu model plus a unified command registry. Radix owns arrow keys, Home/End, Escape, typeahead, focus management, and ARIA baseline; LumaMark owns command state, editor focus contracts, icons, visuals, and E2E.

### Not adopted: Tauri native system menus

Native menus integrate system mnemonics and assistive technology more directly, but font, line height, icons, radius, highlight, and shadow are largely OS-owned and cannot deliver the confirmed strong visual direction. Playwright also cannot drive or screenshot system menus directly and would need an extra Windows UI Automation path. Native menus would also create a dual source of truth between WebView commands and system-menu state. Revisit only if the product later prioritizes system-native appearance and accepts platform variance.

The Radix menu refactor itself continues to use existing mature components, introduces no major dependency, and does not change application architecture, so a standalone ADR is not required. This round’s external opener, workspace file mutations, and permission boundaries are recorded separately in [ADR 0015](../decisions/0015-external-open-and-file-mutations.md).

## Visual design

Adopt a “strong visual desktop tool” direction:

- Top triggers stay compact but provide clear hover, open, and `focus-visible` states.
- Popovers use larger hit targets, a full icon column, dark high-contrast selected states, and clear shadow layering.
- Label, shortcut, state/check, and submenu arrow use stable column widths so long copy does not crush shortcuts.
- Groups are expressed with thin separators, not extra explanatory copy.
- Light and dark themes share the same hierarchy; disabled, highlighted, and checked must not rely on color alone.
- Animation is limited to fade-in and slight translation, and respects `prefers-reduced-motion`.
- Windows high-contrast mode retains borders, focus outlines, and selected markers.
- Native window dragging may start only from an empty title strip with no controls. Menu portals mount on `document.body`, but React synthetic events can still bubble back to the title bar; `shouldStartChromeDragging` must reject non-descendant portals, `[data-lm-window-interactive]`, `[role="menu"]` / `menuitem*`, and `.lm-menu-content`. Menu triggers and window controls are likewise marked as interactive regions.

## Architecture and module boundaries

```text
app/controllers current lightweight state
            │
            ▼
features/commands unified command registry
            │
            ├── top recursive menu model
            ├── command palette model
            ├── context (right-click) menu model
            └── global / CodeMirror shortcuts
            │
            ▼
app/shell menu / ContextMenuSurface rendering
            ──► type-safe dispatcher ──► editor / feature / service handlers
```

- `features/commands` is the single source of truth for command IDs, i18n keys, icons, shortcuts, node composition, and availability rules. `app/controllers` injects the complete type-safe execution map for zero-arg and payload actions; the shell only dispatches invocations.
- Top bar and context menus share distinguishable union node types: `item`, `label`, `separator`, `submenu`, `checkbox`, `radio` (including `disabled`, `icon`, `shortcut`). Retire the slim `CommandContextMenuItem` that only held `action/label/shortcut`.
- `app/controllers` injects only lightweight state such as `fileOpening`, display mode, sidebar, focus mode, theme, language, recent files, and context-menu hit targets.
- `app/shell` only recursively renders Radix primitives (Menubar / ContextMenu) and does not read full Markdown text. `EditorPane` is the sole thin DOM→editor public interaction adapter: it uses outer `EditorApi` coordinate/DOM hit interfaces to obtain a classified target; target semantics and commands remain owned by `editor/interaction` and the command model. Extract `ContextMenuSurface` for reuse by editor and file tree.
- Editor actions execute through a stable command port so features or shell never read full Markdown text.
- The distinguishable union on `CommandNode` cannot represent unknown actions. If a runtime forges an invocation, the dispatcher fails and must not silently fall back; production UI only generates actions covered by the type system.
- Dynamic recent files use a type-safe payload invocation of `openRecentFile` to carry the path. Paths do not enter action IDs and cannot inject arbitrary callbacks that bypass the unified dispatcher.

## Command execution and focus contracts

1. Opening the top bar or a context menu must not clear the CodeMirror selection.
2. Format, paragraph, undo, redo, find, and similar **top-bar** actions operate on the selection that existed before the menu opened.
3. **Context-target-specific commands** act at the right-click hit location (document coordinate or tree node), not the current caret. “Copy link address” must copy the hit link’s URL; image delete and table copy/delete must carry the hit range. Ordinary cut, copy, paste, and select-all still use the selection/cursor preserved before the menu opened.
4. **LumaMark explicitly defines:** when right-click lands outside the current selection, **do not move the caret or collapse the selection**; after the menu closes, selection remains as before open. Target-specific commands use the hit location rather than `selection.main`; ordinary clipboard commands do not treat the right-click location as a new caret. This behavior is locked by tests (Typora baseline is unverified here).
5. After editor actions complete, restore editor focus. Actions that open file pickers, settings, about, workspace pickers, system openers, or secondary confirmation dialogs do not forcibly steal focus back.
6. Format and paragraph actions produce minimal CodeMirror transactions and preserve single-step undo semantics. Opening a context menu and read-only actions (copy link, copy path) must have transactions with `docChanged === false`.
7. Success side effects or failure feedback for actions must be observable; destructive silent fallbacks are forbidden. Context actions that depend on a specific hit target (link, image, table) are **hidden when inapplicable**. Stable editing entries such as cut, copy, paste, and select-all remain in the menu and show disabled based on read-only state, selection, and plain-text clipboard port availability. Desktop ports use the official Tauri clipboard-manager; native failure must not fall back to WebView `navigator`.
8. Async file actions retain existing error notifications and concurrency protection; menus must not swallow errors.
9. Keyboard: Shift+F10 and the Application Menu key can open the context menu; Escape closes and returns focus.

## Menu information architecture

### File

- New document
- Open file
- Open recent file (dynamic submenu)
- Open workspace
- Separator
- Save
- Save as
- Separator
- Settings

### Edit

- Undo
- Redo
- Separator
- Cut
- Copy
- Paste
- Select all
- Separator
- Find
- Command palette

Table copy and delete no longer live permanently in the Edit menu. Related actions appear only in real table context. “Delete entire table” must be distinguished from Typora’s “delete table row.”

### Paragraph

- Normal paragraph and headings 1–6
- Lists submenu: ordered list, unordered list, task list
- Blocks submenu: quote, code block
- Insert submenu: table, horizontal rule

Normal paragraph is an explicit LumaMark normalize command and does not pretend to be a Typora-verified standalone menu entry. It only removes the current ATX heading marker and does not rearrange paragraph content.

### Format

- Bold
- Italic
- Strikethrough
- Inline code
- Separator
- Link
- Image

The image command uses real local image picking and the existing image import pipeline; it no longer only inserts a generic URL placeholder.

### View

- Live Preview / Source / Reading Mode radio group
- Sidebar checkbox
- Focus mode checkbox
- Reset zoom
- Focus editor

Reading Mode is mutually exclusive with Live Preview and Source. It locks rendered state, rejects document changes, hides the caret, and preserves selection and find. It is session-level state and is not written to settings. Read-only implementation, control behavior boundaries, and feedback are in [ADR 0010](../decisions/0010-reading-mode-readonly-contract.md).

### Theme and Language

- Light / Dark / System radio group; the three items share typed action, current value, and i18n with the settings schema; `system` does not get a separate command model
- Language menu: Simplified Chinese / English radio group

### Help

- Check for updates
- About LumaMark

“About” opens a dedicated dialog showing app name, version, and product positioning; it no longer forwards to settings.

## Shortcut contracts

| Command | Menu display | Implementation strategy |
|---|---|---|
| New / Open / Save / Save as | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | Display and reuse existing global shortcuts |
| Cut / Copy / Paste / Select all | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A` | Top bar, context menu, and shortcuts share `EditorCommandPort` and live availability checks; the app injects the plain-text port from `services/clipboard`; desktop uses the official Tauri plugin, browser uses the navigator adapter; before async clipboard completion, validate the original selection and never delete text on failure. Platform boundaries are in [ADR 0016](../decisions/0016-tauri-text-clipboard-adapter.md) |
| Command palette | `Ctrl+K` | Display and reuse existing global shortcuts |
| Headings 1–6 | `Ctrl+1…6` | Matches Typora baseline; reuse CodeMirror keymap |
| Bold / Italic | `Ctrl+B` / `Ctrl+I` | Display existing LumaMark bindings; do not claim them as locally verified Typora bindings |
| Image | `Ctrl+Shift+I` | Align with Typora; menu, command palette, and shortcut call the real local-image flow |
| Code block | `Ctrl+Shift+K` | Align with Typora; all three entries call the same command |
| Table | `Ctrl+T` | Align with Typora; current `Ctrl+Alt+T` remains compatible during migration; menu shows only `Ctrl+T` |
| Delete entire table | Dedicated LumaMark binding | Do not reuse Typora `Ctrl+Shift+Backspace`, to avoid presenting row delete as table delete |
| Display-mode cycle | `Ctrl+/` | Binding matches Typora baseline, but cycles Live Preview → Source → Reading; the three radio states stay in sync; the menu does not label this key as source-mode only |
| Sidebar / Focus mode | Existing LumaMark bindings | Shown in the menu, but not claimed as Typora baseline bindings |

`Ctrl+Shift+C` Copy as Markdown, `Ctrl+Shift+V` Paste as Plain Text, table select-row / select-cell / delete-row, and math blocks are known gaps. This round does not register empty actions; they remain in the coverage matrix and are wired after the corresponding capability and clipboard contracts land.

## Context menus: hit-target model

Editor context is ultimately decided only from the outer document’s `EditorState` and syntax tree. Ordinary targets use outer `view.posAtCoords()`. Table-widget DOM is only a hit hint, then outer `view.posAtDOM(widget)` maps back to a document position and validates the precise `Table` range. Do not read nested `EditorView` documents inside widgets, and do not treat `target.closest('.tbl-table-widget')` alone as proof of a table:

```ts
export type EditorContextTarget =
  | { at: number; kind: 'plain' }
  | { from: number; href: string; kind: 'link'; to: number }
  | { from: number; kind: 'codeBlock'; to: number }
  | { from: number; kind: 'mermaid'; to: number }
  | { from: number; kind: 'selection'; to: number }
  | { from: number; kind: 'table'; to: number }
  | { from: number; kind: 'image'; src: string; to: number };
```

- Ordinary body positions come from outer `view.posAtCoords()`; table widgets return through outer `view.posAtDOM()` to stable bounds, then the syntax tree confirms the range.
- Add `deriveInteractionAtPosition(state, pos)`, reusing existing block/inline owner collection; do not change `deriveEditorInteractionContext`, which is based on `state.selection`.
- Inside fenced code, inline code, and protected-source ranges (YAML, `[^id]`, `[toc]`), do not produce link/image targets.
- Outside the editor: the file tree uses `react-arborist` node data; outline context menus are not implemented yet.

```text
right-click event
  ├─ editor ordinary target → outer posAtCoords ───────────┐
  ├─ table widget → outer posAtDOM → Table validate ──┴→ EditorContextTarget ─┐
  └─ file tree → react-arborist node data ───────────────→ FileTreeContextTarget ─┤
                                                                          ↓
features/commands context-menu model
        ↓
ContextMenuSurface (Radix) → exhaustive typed invocation dispatcher
```

## Context menus: per-target inventories

Hide inapplicable items. Items that depend on [ADR 0015](../decisions/0015-external-open-and-file-mutations.md) must not show fake entries before capabilities are wired.

### Editor general

- Cut, copy, paste, select all
- Separator
- Insert table

Copy as plain text / Markdown and similar clipboard contracts are wired after those contracts land.

### Link

- Open link (protocol allowlist; relative paths open in-app)
- Copy link address

In the Typora baseline these two are verified (observed) facts and are prioritized.

### Image

- Copy image path
- Reveal in file manager
- Delete reference (remove only `![]()` syntax; single undo step)

Delete on disk, move, and rename: later batches; deleting on disk must require secondary confirmation.

### Table

- Insert table (already in general area)
- Copy table, delete entire table (only when a table is hit)

Row/column insert/delete and alignment join the same command contract after table capability is complete.

### Mermaid

No dedicated context items today; editing continues through existing preview/source interaction. Do not duplicate a second entry for the same action. Copy image and save SVG/PNG/JPG are later topics; do not show fake menus before capability and export contracts land.

### File tree

- New file, new folder
- Rename
- Delete (recycle-bin semantics; see ADR 0015)
- Reveal in file manager
- Copy path

Directory and file node menus may differ; the workspace root node does not offer delete.

### Outline

Not implemented yet.

## Context-menu safety contracts

- External links: only `http` / `https` / `mailto`; reject `javascript:` / `data:` / `file:` with an explicit error; Rust is the security boundary.
- Workspace writes: claimed root must be equivalent to the current canonical root of Rust `WorkspaceSession`; the target’s canonical path must stay inside that root; `..`, symlink/junction escape, or an invalid session → `invalid_path`.
- Reveal: with a workspace, reuse the managed-session boundary above; for a standalone document, the only trusted built-in frontend fallback is “canonical actual parent directory of an existing document.” This does not claim to resist a compromised WebView; detailed boundaries are in ADR 0015.
- Name collisions do not overwrite; delete defaults to the recycle bin.

## Competitor menu coverage matrix

| Capability | Typora baseline | LumaMark this round | Menu strategy |
|---|---|---|---|
| Headings, lists, quotes, code blocks, horizontal rules | Public input or menu/shortcut evidence exists | Real commands wired; code-block `Ctrl+Shift+K` completed | Keep a single command port; do not overclaim topical edge experience |
| Local images | Format → Image, `Ctrl+Shift+I` | Real multi-select file entry and shortcut wired into existing import pipeline | Cancel leaves the document unchanged; errors reuse the file notification contract |
| GFM table insert | `Ctrl+T` | `Ctrl+T` wired; old `Ctrl+Alt+T` compatible during migration | Top menu shows only the standard binding |
| Table row/column and selection | Toolbar/context menu and dedicated keys | Insufficient evidence or unimplemented | Do not invent fake top entries; keep topical gaps |
| Table context copy / delete entire table | Context menu | Implemented (only when a table is hit) | Keep; row/column items await capability |
| Link context open / copy address | Verified observed | Absolute URL allowlist, relative document open, and copy-failure feedback implemented | Show real commands; dual frontend/backend protocol checks |
| Image context resource management | Documented in Support | Copy path, reveal, delete reference implemented | Remote images do not show local reveal; delete reference runs on the hit range |
| File-tree context | Not a Typora editor-area baseline; product need | Root/directory/file scenario combinations and mutation confirmations implemented | Recycle-bin delete; path and directory-link escape protection |
| Copy as Markdown / Paste as Plain Text | Confirmed | Reliable clipboard contract not yet established | Do not show; high-priority clipboard-topic gap |
| Math | `Ctrl+Shift+M`, Math Tools | Unimplemented | Do not show |
| Mermaid | Mostly fence typing; no dedicated key | Main render path implemented; no dedicated context menu | Do not show for now; editing uses existing preview/source interaction; export images come later |
| YAML Front Matter | Insertable from top menu; no dedicated default key | Unimplemented | Do not show |
| Footnotes | No dedicated menu or key | Unimplemented | Do not show |
| TOC | `[toc]` + Return; dedicated-menu evidence insufficient | Unimplemented | Do not show |
| Callout | Paragraph → Alert; no dedicated default key | Unimplemented | Do not show |
| HTML / iframe / video | Type or paste; no general insert key | Unimplemented and safety contract missing | Do not show |

## 2026-08-02 historical menu-refactor baseline

This section only summarizes the 2026-08-02 top-bar menu refactor. It is not fresh verification evidence for the current worktree. Version, commit, test counts, and release artifacts from that time take the [0.2.1 NSIS-only Release](../release/WINDOWS_V1_BUILD.md#021-nsis-only-release) as the historical source of truth. Context-menu and settings-system verification ledgers for this round are appended to the same Windows build record after all gates pass; a second count is not maintained inside product design.

- Recursive Radix menus landed; eight top-level menu groups can express action, separator, submenu, checkbox, and radio. Menus, command palette, and global shortcuts dispatch through the same type-safe handler map.
- Local image entry wired to the Tauri multi-select system dialog and the existing image-reference pipeline. Browser E2E verifies menu and `Ctrl+Shift+I` command orchestration; Rust tests verify the IPC contract; Windows Tauri real-device checks confirm the system dialog can open and that cancel leaves the document unchanged.
- `Ctrl+Shift+K`, `Ctrl+T`, `Ctrl+/`, `Ctrl+1…6`, and `Ctrl+0` all have automated command-result verification; the old `Ctrl+Alt+T` migration key remains supported.
- Final automation results were Vitest 637, Web Playwright 137, production-bundle Playwright 2, Rust 81, and standalone performance benches 23, all passing. Menu-specific work added 6 more cases that generate light, dark, nested, and English screenshots at a fixed 1440×900 viewport.
- Windows Tauri real-device manual checks covered top menus, nested structure, shortcut columns, source-mode state, and the image system dialog. Disk import after a real image selection is covered by layered automation; the manual step for that round only exercised the cancel path and did not modify user files.

Screenshot evidence is stored with the implementation: [light Chinese File menu](../../artifacts/menu-system-report/menu-light-file-zh.png), [dark Chinese state menu](../../artifacts/menu-system-report/menu-dark-view-states-zh.png), [dark Chinese keyboard nested menu](../../artifacts/menu-system-report/menu-dark-nested-keyboard-zh.png), [dark English File menu](../../artifacts/menu-system-report/menu-dark-file-en.png), [Windows native image picker](../../artifacts/menu-system-report/tauri-native-image-dialog-zh.png), and [unmodified document after cancel](../../artifacts/menu-system-report/tauri-image-dialog-cancelled-zh.png).

Remaining Typora gaps did not get fake menu entries: Copy as Markdown, Paste as Plain Text, table select-row / select-cell / delete-row, plus math, footnotes, TOC, Callout, YAML Front Matter, and restricted HTML remain owned by their topical capability plans.

## Errors and degradation

- Canceling a file or image dialog is a normal result and does not show an error.
- File or image selection failures reuse stable error codes and bilingual notifications; they must not silently fall back to placeholder Markdown.
- When a recent file is missing, show an explicit error and keep the entry, so a temporary disk offline event does not silently erase user history; recent-file cleanup is a separate explicit action.
- When an action does not apply to the current context, do not run a destructive fallback.
- High contrast, reduced motion, or narrow windows do not change menu semantics. Narrow-window menubar horizontal clipping or aggregation requires a separate design before implementation; this round does not hand-roll an adaptive overflow menu.

## Test design

### Unit

- Menu-tree node types, group order, separators, submenus, checkboxes, and radios.
- Chinese/English labels, shortcuts, and command-palette metadata consistency.
- State projection for display mode, sidebar, focus mode, theme, language, and fileOpening.
- Unknown actions, dynamic recent-file parameters, and async error propagation.
- Exact command results for new normal-paragraph, code-block, table-key, and image-entry work.
- `deriveInteractionAtPosition`: link text/URL, adjacent plain text, links inside nested emphasis, images, and pseudo-links inside code/protected-source.
- Context-menu model: link / plain / table / image / file-tree nodes each produce the correct item sets.
- Protocol allowlist and relative-path branches; path-escape and name-collision error codes.

### Component / Integration

- Open menus with mouse and keyboard, covering arrow keys, Home/End, Escape, typeahead, submenus, and focus return.
- Establish a selection before opening the menu; after format or paragraph actions, assert text, selection, and one undo.
- After radio/checkbox execution, reopen the menu and assert state matches the app.
- Destructive table actions do not appear outside table context; in-table action names and semantics are accurate.
- About dialog and settings dialog are independent; after close, focus returns to the trigger.
- Context menus do not clear selection; right-click outside selection does not move the caret; copy link uses the hit URL.
- Shift+F10 opens the context menu; Escape returns editor focus.
- Opening a context menu and copying a link have transactions with `docChanged === false`.

### Playwright E2E

- Execute main paths for File, Edit, Paragraph, Format, View, Theme, and Help menus one by one.
- Prove format commands via real editor text changes, not menu-label assertions alone.
- Cover code block `Ctrl+Shift+K`, image `Ctrl+Shift+I`, table `Ctrl+T`, headings, source mode, and old table-key migration compatibility.
- Cover Chinese and English menus, plus light and dark states.
- Capture light menus, dark menus, submenus, radio/checkbox, and keyboard focus at a fixed 1440×900 viewport.
- Add a `context-menu` specialty: link right-click copy address, table right-click regression, and file-tree new-file main path; file-tree menus keep [light Chinese](../../artifacts/context-menu-report/file-tree-context-menu-light-zh.png) and [dark Chinese](../../artifacts/context-menu-report/file-tree-context-menu-dark-zh.png) visual baselines.

### Windows Tauri real-device

- Real windows verify file and image pickers, menu clicks, shortcuts, and that window drag regions, minimize/maximize buttons, and menus do not steal from each other.
- Verify caret returns after menus run editor actions, and that opening system dialogs does not steal focus.
- Save desktop screenshots as manual visual acceptance evidence.
- System opener for external links, reveal in explorer, and recycle-bin delete: manual spot checks; do not count them as pure Web E2E pass claims.
- `scripts/release/verify-installed-menu-context-os.mjs` binds the current worktree Release exe and uses Win32 OS pointer, `ClientToScreen`, Per-Monitor V2, and `WindowFromPoint` to verify title-bar menus, portals, editor/file-tree context menus, and settings restart restore. Run and isolation boundaries are in the [Windows V1 build record](../release/WINDOWS_V1_BUILD.md).

### Quality gates

- Related Vitest.
- `pnpm typecheck`.
- `pnpm lint`.
- Menu specialty and full regression from `pnpm test:e2e`.
- `pnpm test:e2e:production`.
- `pnpm quality:web-build`.
- `pnpm test:fixtures` when editor transactions are involved.
- `cargo test --manifest-path src-tauri/Cargo.toml` when Rust commands are involved.

Menus and context menus are not on the editor input hot path and do not add full-Markdown subscriptions or high-frequency React state, so they do not alone require a new large-document performance bench. If an implementation introduces high-frequency React sync of selection/context, stop and switch to CodeMirror-derived state or query-on-menu-open. If file-tree context menus cause whole-tree re-renders, add coverage in the existing outline large-document bench pattern.

## Acceptance criteria

1. Every visible menu and context item has a real execution path, and tests prove expected results. There are no mismatches such as “About opens settings” or no-response delete-table outside table context.
2. Top menus support grouping, icons, submenus, radios, checkboxes, shortcut columns, disabled states, and visible keyboard focus.
3. Context menus and the top bar share node types, the command registry, and an exhaustive typed invocation dispatcher. `ContextMenuSurface` contains no business logic and cannot execute arbitrary callbacks.
4. Code-block, image, table, and heading shortcuts match this document’s contracts; menus, shortcuts, and the command palette reuse the same action.
5. CodeMirror selection from before menu/context open remains correct; context actions use the hit location; read-only actions produce zero doc change.
6. Chinese and English resources are symmetric; information remains distinguishable in light, dark, reduced motion, and Windows high contrast.
7. Playwright E2E, production E2E, and Windows Tauri real-device paths have fresh run evidence and screenshots; opener/recycle-bin manual items are marked separately.
8. Unimplemented math, footnotes, TOC, Callout, YAML, and HTML do not appear as fake entries; the coverage matrix accurately records gaps.
9. Menu implementation does not hold full Markdown text, does not change save or source-fidelity strategy, and does not add work to the editor input hot path.
10. External-link protocol allowlisting and workspace path-escape protection have automated evidence.

## When to update

Update this document when any of the following change:

- Top menu groups, context-menu trigger targets, menu node types, or global shortcuts are added or removed.
- A new Markdown capability becomes available and needs a menu or context entry.
- Typora baseline review changes confirmed menu, context-menu, or shortcut facts.
- Radix Menubar/Context Menu, Tauri native-menu strategy, opener, or menu automation paths change.
- Clipboard, image, table, link, file-tree, or about-dialog contracts change.
