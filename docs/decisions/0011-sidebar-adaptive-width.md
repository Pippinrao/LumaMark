> Language: **English** · [中文](../zh/decisions/0011-sidebar-adaptive-width.md)

# ADR 0011: Sidebar Content-Adaptive Width and Constraint Relaxation

**Status:** Accepted

**Date:** 2026-08-10

## Context

The sidebar is based on `react-resizable-panels`, with drag width hard-coded between 240–360px. Deep directories or long filenames are still ellipsis-truncated at the upper bound, while narrow-screen users cannot make the sidebar narrower—both ends are constrained.

There was already an “adaptive” path, but it only measured the currently open filename width, unrelated to the file tree actually shown in the sidebar, so it often computed widths that felt wrong. It also had an unnoticed defect: the “user has manually set width” marker was not persisted while width itself was persisted in `localStorage`, so after restart adaptive overwrote the user’s last dragged width and adjustments appeared to vanish randomly.

## Decision

- Lower the drag minimum to 120px. Continuing to drag left snaps closed to 0, equivalent to closing the sidebar.
- The drag maximum is no longer a fixed pixel value; it is derived from the editor panel’s own 360px minimum width—window width minus editor minimum. The sidebar cannot consume the whole window.
- Adaptive width is based on the longest item among currently expanded file-tree nodes, including indent depth, clamped to 200–480px. With no workspace open, compute from the recent-files list and current filename using the same clamp.
- Switching to the outline tab remounts that panel and reports heading label width plus indent using the same 200–480px clamp, with outline-specific chrome (no file-tree chevron or icon). Switching back to Files remounts the file tree and reports that width again.
- Width measurement uses canvas `measureText` from node data sources and does not read the DOM. The file tree is virtualized by `react-arborist`, so only visible nodes exist in the DOM and reading DOM would yield scroll-dependent results. Outline measurement walks the heading list, not the virtualized viewport.
- Recompute when the file-tree structure changes: opening a workspace or folder, expanding or collapsing nodes, or file add/remove; when the outline heading list changes; and when the sidebar tab changes. Scrolling does not recompute.
- Once the user manually drags the sidebar in the current session, adaptive yields and later structure changes no longer alter width. After restart, adaptive resumes.
- Remove `localStorage` persistence of sidebar width. Persistence of sidebar open/closed state remains.

## Alternatives considered

- **Remove min/max entirely:** the sidebar can be dragged to a few dozen pixels where tabs and filenames are both unusable, with no way back into a usable range because adaptive is then disabled by “user has manually set width”.
- **Also remove the editor panel’s 360px minimum:** the editing area could be crushed below a writable width, conflicting with the product principle of designing for long writing sessions.
- **Keep width persistence and re-adapt after startup:** the first paint would show a visible width jump, and two width sources would coexist, needing extra priority rules. If startup always adapts, persisted width is unread dead data.
- **Adapt in real time from currently visible nodes:** the virtual list’s visible set changes while scrolling, so sidebar width would jitter.
- **Keep the old measure-current-filename-only logic:** unrelated to what the sidebar actually presents and cannot fix deep-directory truncation.
- **Use a horizontal scrollbar for long filenames:** inner scrolling introduces a new coordinate system and is explicitly marked high-risk in the working contract.

## Consequences

- The constant semantics of `sidebarPanelConstraints` change as a whole; unit, integration, and E2E assertions that depend on 240/360 bounds must be rewritten together.
- Sidebar width no longer persists across sessions—a user-visible behavior change: manual adjustments apply only to the current session.
- Adaptive measurement changes from “one filename” to “a batch of nodes”, so recompute timing is strictly limited to structure changes to avoid measurement cost on the scroll hot path.
- Legacy layout keys left in `localStorage` are no longer read.

## Rollback and revisit criteria

If users report that non-persistent manual width is painful, reintroduce width persistence while keeping adaptive defaults, but also persist the “user has manually set” marker; otherwise the width-loss defect described here returns. Additional sidebar tabs should report their own content width and chrome on activation; they must not keep using a stale file-tree measurement.
