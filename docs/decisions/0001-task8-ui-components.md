> Language: **English** · [中文](../zh/decisions/0001-task8-ui-components.md)

# ADR 0001: V1 App Shell Mature Component Selection

Date: 2026-07-05

## Context

Task 8 needs to ship workspace, file tree, outline, command palette, settings, and resizable panes. Project rules require preferring mature components; custom foundational UI is allowed only when mature components cannot meet performance, accessibility, i18n, or maintainability goals and the user has confirmed that approach.

## Decision

The V1 app shell uses these mature components:

- `react-resizable-panels`: panes, collapse, and layout persistence.
- `react-arborist`: file-tree virtualization, keyboard navigation, and custom node rendering.
- `cmdk`: command palette, command filtering, and keyboard navigation.
- Radix Primitives: settings dialog, tabs, and later tooltips.
- `lucide-react`: toolbar button icons.

Project code owns only LumaMark data adaptation, command orchestration, i18n copy, and performance boundaries. It does not custom-build foundational UI components.

## Evaluation conclusions

- File tree: `react-arborist` supports virtualization, keyboard navigation, controlled data, and custom renderers. Windows paths pass through the `path` field without hard-splitting paths in the UI. Directory lazy loading is implemented by the workspace store calling Rust `workspace_list_children` on `onToggle`.
- Panes: `react-resizable-panels` supports collapsible panels and layout persistence, covering the V1 sidebar / editor / outline layout.
- Command palette: `cmdk` supports controlled open/search, command filtering, and keyboard navigation. Command labels, placeholders, empty states, and group copy all come from LumaMark i18n resources. The `Ctrl/Cmd+K` shortcut is listened for at the app layer and opens the controlled palette. V1 command volume is small, so extra virtualization is unnecessary. If command scale grows significantly later, switch to `shouldFilter={false}` and plug in app-side filtering or virtualization.
- Dialog / Tabs / Tooltip: Radix provides focus management and accessibility foundations, matching the mature-components-first rule.

## Alternatives considered

- Custom file tree, panes, command palette, or dialog: no evidence that mature components fail V1 needs, so custom work is disallowed.
- Introducing a large full design system at once: the need is a quiet desktop shell and controllable interaction primitives, not heavy theme/component constraints.

## Consequences

- `AppShell` only does cross-feature orchestration.
- `features/file-tree`, `features/outline`, `features/command-palette`, and `features/settings` keep their own boundaries.
- Markdown body stays only in CodeMirror; outline is derived from the current editor text and does not enter the global store.
- Rust workspace commands stay thin entry points; directory listing and filtering live in `workspace_service`.

## Revisit criteria

Re-evaluate when any of the following occurs:

- File-tree node scale or lazy-loading needs exceed `react-arborist` capabilities.
- Pane persistence or cross-platform input behavior becomes unacceptable.
- Command count reaches a scale that needs custom indexing, virtualization, or async search.
- Any component blocks typing, scrolling, or the editor hot path.
