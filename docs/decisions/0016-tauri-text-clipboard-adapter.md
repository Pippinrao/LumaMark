> Language: **English** · [中文](../zh/decisions/0016-tauri-text-clipboard-adapter.md)

# ADR 0016: Desktop Plain-Text Clipboard Adapter

## Purpose and scope

Records the sole platform boundary for reading and writing plain-text clipboard content in LumaMark across desktop and browser environments. This decision does not cover images, HTML, RTF, file lists, or clipboard history management.

## Context

Browser Playwright can explicitly grant `clipboard-read` / `clipboard-write`, but in installed Windows WebView `navigator.clipboard.readText()` may never complete. Continuing to treat the WebView Clipboard API as the desktop source of truth would make real menu Paste commands wait forever, and browser E2E cannot cover that failure.

## Decision

- Desktop runtime adopts official `tauri-plugin-clipboard-manager` and grants only `clipboard-manager:allow-read-text` and `clipboard-manager:allow-write-text` to the main window.
- `services/clipboard` is the platform facade: Tauri runtime calls only the plugin; browser preview and browser tests resolve the navigator adapter.
- The app controller injects a structured plain-text port into `EditorCommandPort`. Editor, feature, and shell neither import the Tauri plugin nor hold platform-detection logic.
- Native call failures must reject as-is and be localized through the existing command error channel; probing or falling back to navigator is forbidden, to avoid re-entering the known WebView pending path.
- Plain-text copies such as tables, link addresses, image paths, and file-tree paths reuse the same port/facade. Image or rich-media clipboard does not gain a product entry or capability merely because the plugin dependency exists.

## Alternatives considered

- **Keep using `navigator.clipboard` on desktop:** installed builds already have real evidence of non-completion; rejected.
- **Custom Rust clipboard command:** official Tauri v2 plugin already provides cross-platform commands, permission lists, and JS API; custom work has no benefit.
- **Grant `clipboard-manager:default` or image/HTML permissions:** default does not express this product’s capability, and extra formats exceed current needs and least-privilege boundaries.
- **Fall back to navigator after native failure:** would mask native errors and reintroduce the non-completing path; rejected.

## Consequences

- JS and Rust lockfiles gain the official plugin; the Rust plugin brings platform-related dependencies via `arboard` even though product capability remains text-only.
- Desktop installer size, build time, and hashes may change; release acceptance must record final EXE version, size, and SHA-256.
- The browser adapter remains, so non-Tauri unit tests and browser E2E need not simulate desktop IPC.

## Revisit criteria

- The official Tauri plugin changes read/write-text commands, permission names, error semantics, or minimum version.
- WebView provides verifiable, cross-platform, stable clipboard capability without extra grants, and passes installed-build real-menu acceptance.
- The product needs image, HTML, or file-list clipboard; design permissions, privacy, and recovery contracts separately then—do not simply enlarge this ADR.
