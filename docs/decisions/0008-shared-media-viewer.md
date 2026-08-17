> Language: **English** · [中文](../zh/decisions/0008-shared-media-viewer.md)

# ADR 0008: Shared Media Viewer for Images and Mermaid

**Status:** Accepted

**Date:** 2026-08-04

## Context

Image blocks and Mermaid blocks need expand-to-view outside the editor, with zoom, pan, and reset. That interaction must not rewrite Markdown, create edit transactions, duplicate Mermaid render work, or put image/SVG payloads in a global store. Dialog, zoom, and pan are foundational UI capabilities and should prefer mature components.

## Decision

- Use existing `@radix-ui/react-dialog` for modal layer, focus trap, Esc close, and accessible name; use `react-zoom-pan-pinch` for zoom, pan, touch, and transform state.
- `features/media-viewer` owns the viewer React UI and session state and is lazy-loaded by the app container. Each request creates a new session so zoom state resets; on close, prefer returning focus to a still-connected expand button, otherwise focus the primary editor.
- The editor only exposes `EditorMediaPreviewRequestHandler`: ordinary images pass the resolved asset URL actually loaded by the browser; Mermaid passes the SVG already successfully rendered by the current Widget. The Mermaid viewer must not re-call the renderer.
- Image and Mermaid widgets expose expand buttons only in the success state. Button events stop propagation into edit/delete behavior but do not dispatch CodeMirror transactions; loading/error states have no expand action.
- Mermaid SVG stays only in the Widget instance and the current feature session; it is not written to Zustand, services, or persistence. After the viewer closes it does not participate in Markdown save, restore, or undo/redo.
- The image capability is split into `imageBlockDetection`, `imagePathResolver`, `ImageBlockWidget`, and `imagePreviewExtension` so toolbar and async image lifecycle stop expanding the StateField file.

## Alternatives considered

- **Use a gallery/lightbox suite (for example yet-another-react-lightbox):** its gallery, slide, and modal abstractions overlap existing Radix Dialog; this need is single-media viewing, not album state.
- **Custom pointer/wheel transform engine:** would require owning bounds, touch, wheel, animation, and cross-browser behavior; violates mature-components-first.
- **Mount a fullscreen layer directly inside a CodeMirror Widget:** couples app-level modal, focus, and i18n lifecycle to decoration DOM and makes sessions easier to lose on Widget rebuild.
- **Use the browser Fullscreen API:** enters OS fullscreen permission and window-level Esc semantics; this need uses an in-app viewport Dialog for more predictable, consistent Tauri cross-platform behavior.
- **Clone Typora’s proprietary viewer:** public experience goals only; do not copy proprietary assets or private implementation.

## Consequences

- Adds one frontend chunk loaded only on first expand and a `react-zoom-pan-pinch` dependency; startup and typing hot paths do not import the component.
- Editor capabilities gain one injectable lightweight event boundary but do not depend on React, app, feature, service, or Tauri.
- Mermaid expand reuses the existing SVG, so it does not add Mermaid parse/render cost; image buttons are created only after successful load.
- Button names, tooltips, Dialog titles, and descriptions for Chinese and English are provided uniformly by i18n resources.

## Rollback and revisit criteria

If the dependency causes measurable startup bundle, first-open latency, memory, or cross-platform touch regression, first verify upgrade or config convergence; only then evaluate replacing the library if gates still cannot be met. If multi-image navigation, download, rotate, or export is added later, re-evaluate gallery components instead of accumulating custom infrastructure inside the current feature.
