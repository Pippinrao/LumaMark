> Language: **English** · [中文](../zh/decisions/0018-plantuml-local-rendering.md)

# ADR 0018: PlantUML Uses Official TeaVM Local Rendering

- Status: Accepted
- Date: 2026-08 (corresponds to issue #12 “plantuml syntax support”)
- Numbering note: the issue-12 draft previously used 0014, but the repository already occupies [ADR 0014](0014-settings-persistence.md); MathJax is [ADR 0017](0017-mathjax-document-worker-chtml.md). This decision therefore lands as 0018.

## Context

LumaMark needs PlantUML diagram preview. The official PlantUML renderer is Java-based and traditionally depends on a JVM or a remote PlantUML server. Project principles require local, offline, privacy-friendly, no JVM, high performance, and mature components first. Settings must enter canonical `settings.json` and must not use a separate localStorage store.

## Decision

Adopt official `@plantuml/core` (TeaVM-compiled engine, MIT, pinned 1.2026.6) for **local rendering inside the WebView**:

- Lazy-load `plantuml.js` and `viz-global.js` in a **hidden same-origin iframe**: `viz-global.js` is a classic UMD script and TeaVM calls `document.getElementById()`, so a module Worker cannot host the engine. This matches the official `@plantuml/core` iframe worker PoC.
- Inject the Graphviz script and dynamically `import('@plantuml/core')` only when the first ` ```plantuml ` block appears (inside that iframe).
- `renderToString(lines, onSuccess, onError, { dark: true })` follows `document.documentElement`’s `data-theme`.
- Engine failure promises stay sticky to avoid re-injecting a broken Graphviz script.
- The TeaVM runtime has process-level mutable state, so render calls are queued serially.
- Sanitize SVG with an explicit `dompurify` dependency (SVG profile) before injection.
- Scheduling, caching, `jobOwner` isolation, and `BlockWidgetGeometryTracker` mirror the Mermaid contract and do not block typing.
- Reading mode follows the existing render-lock: no Edit/Delete creation; Expand remains available.
- The switch is canonical v3 field `markdown.plantuml.enabled`, default on. Existing v3 documents missing the field are not invalid but need writeback. Do not bump `SETTINGS_VERSION`.

## Alternatives considered

- **Bundle `plantuml.jar` + JVM:** large install size, slow cold start, complex cross-platform JVM management.
- **Remote servers (official PlantUML / Kroki):** need network, leak privacy, unavailable offline, and conflict with CSP `connect-src`.
- **Independent `plantumlSettingsStore` / localStorage:** conflicts with canonical settings and corruption-recovery contracts.
- **Module Web Worker:** `viz-global.js` is a classic UMD script (`this` is undefined under `import()`), and TeaVM writes SVG through the DOM. Official guidance uses hidden iframes for this reason.

## Consequences

- Adds direct dependencies `@plantuml/core@1.2026.6` and `dompurify@3.4.11`.
- Installer size grows by about 8 MB; runtime is lazy-loaded. `quality:web-build` excludes `plantuml-` / `viz-global-` chunks from the 700KiB JS budget and raises Vite `chunkSizeWarningLimit` to 7000. Copying this engine and MathJax NewCM fonts triggers Rolldown `vite:asset` `PLUGIN_TIMINGS`; the gate exempts only that plugin name—see [Quality Strategy](../quality/QUALITY_STRATEGY.md).
- PlantUML is an independent editor capability, enabled by default, with settings taking effect immediately.
- Real-machine completion evidence must include the NSIS installer + Win32 OS pointer path: `scripts/release/verify-installed-plantuml-os.mjs`.

## Rollback / revisit criteria

- If `@plantuml/core` breaks API or size becomes uncontrolled, fall back to evaluating a Rust sidecar / local jar and reassess remote options.
- If the official npm artifacts stop updating, vendor `plantuml.js` + `viz-global.js` instead.
