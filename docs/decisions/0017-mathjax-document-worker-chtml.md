> Language: **English** · [中文](../zh/decisions/0017-mathjax-document-worker-chtml.md)

# ADR 0017: MathJax Document-Level Worker and CHTML Math Rendering

**Status:** Accepted

**Date:** 2026-08-13

## Context

Issue #11’s math-formula scope is more than simple `$...$` and `$$...$$` typography: it also requires AMS numbering, in-document `\label` / `\ref`, macros that take effect in source order, Physics, mhchem, offline Tauri WebView, security boundaries, and selectable text. These capabilities have document state: a single formula’s output may depend on macros, numbers, and labels that precede it, and forward references require parsing the complete formula sequence in the same batch.

Both KaTeX and MathJax are mature renderers. KaTeX’s size and synchronous render speed are attractive, but its support table cannot meet the locked full `\label` / `\ref` document semantics for this round. MathJax v4’s TeX input, AMS labels, extension packages, and document-level processing model match the migration goals, so formulas cannot be independently cached or rendered as mutually stateless strings.

Math rendering is also an editor cold path. Putting MathJax on the main thread would make macro expansion, layout, and font-module loading compete with typing, selection, scrolling, and IME; loading arbitrary TeX packages from CDN or at runtime also conflicts with offline desktop, security, and CSP constraints.

## Decision

- Directly and exactly pin `@mathjax/src@4.1.3` and `@mathjax/mathjax-newcm-font@4.1.3`; do not rely on Mermaid’s transitive KaTeX.
- Output is fixed to CHTML with NewCM fonts. CHTML preserves browser text selection and responsive layout; fonts are packaged offline with the app as Vite same-origin static assets.
- MathJax creates a module Web Worker only when a document first contains a renderable formula. Each document uses independent TeX/MathDocument state and receives formulas, config, and layout metrics in whole batches in source order.
- Requests and results carry `documentId` and a monotonic `generation`. Debounce after formula sequence or config changes; new requests cancel the old Worker, and stale generations never write back. Cache keys cover the full ordered formula sequence, layout, preferences, and engine version; do not cache stateful results by single-formula source.
- Markdown body, selection, and undo history continue to be held only by the primary CodeMirror `EditorState`. The React store does not keep full text, CHTML, or high-frequency formula state; Worker results only form discardable decorations/widgets.
- The TeX package allowlist is fixed to `base`, `ams`, `newcommand`, `textmacros`, `configmacros`, `begingroup`, `mhchem`, and `physics`; Physics is preference-gated. Forbid `require`, `autoload`, `setoptions`, `html`, and `texhtml`.
- Enable the MathJax Safe handler; reject external protocols, styles, arbitrary classes, and uncontrolled IDs. User labels do not become DOM IDs directly; numbered fragments get a document-scoped prefix. Before a Widget mounts Worker CHTML, strip scripts, embeds, event attributes, and external URLs again.
- Single-formula input is capped at 10 KiB; a document may have at most 1000 formulas and at most 1 MiB total TeX length. TeX macros, buffers, and template expansion have explicit caps; the Worker is terminated by a watchdog and may recover on later requests.
- Do not relax Tauri CSP; do not use CDN, blob workers, or runtime arbitrary package loading. MathJax and Mermaid stay in independent chunks; production builds recursively check all JavaScript with entry limit `<120 KiB` and any JS chunk limit `<700 KiB`.
- `quality:web-build` treats Rolldown’s `[PLUGIN_TIMINGS]` as a blocking warning rather than allowing later builds to drift silently; when that marker appears, locate the specific plugin or build stage, fix it, and regenerate a warning-free production bundle.
- Same-origin module Worker and main-thread code share the same app release package and trust boundary; the main thread trusts stylesheets produced by the pinned MathJax version and does not claim it can sandbox arbitrary CSS if Worker code itself is tampered. The untrusted boundary for user TeX is jointly constrained by the package allowlist, Safe handler, resource limits, and a second active-markup/URL sanitize before CHTML mount.
- First-version syntax accepts only block delimiters `$$` on independent physical lines, including nested blocks in lists and quotes; inline accepts only `$...$`, defaulting to Pandoc rules, switchable to Legacy or disabled. TeX content stays opaque in the Markdown syntax tree.
- Default preferences are inline Pandoc, numbering none, Physics off; mhchem is always included in the fixed allowlist. Preference changes only reconfigure Markdown language and renderer state and do not modify body, selection, dirty, or undo history.
- Source always shows original Markdown; Reading always shows rendered results; in Live Preview, inactive formulas replace source, active blocks keep primary-editor source with preview below, and active inline formulas reveal source.

## Alternatives considered

- **KaTeX as the final Issue #11 engine:** cannot meet the locked full document-level label and reference goals; a partial compatibility layer must not fake TeX document state.
- **MathJax on the main thread:** puts batch layout, macro expansion, and font loading onto typing/scroll competition paths and weakens isolation and recovery after timeouts.
- **SVG path output:** does not meet selectable-text and responsive-layout goals and enlarges complex-formula output.
- **Cache by single-formula source:** numbering, macros, and references depend on the full ordered formula sequence; single-formula caches may return semantically stale results.
- **CDN, blob workers, autoload, or `\require`:** break offline guarantees and expand CSP, supply-chain, and runtime package-load attack surface.
- **Reuse Mermaid scheduler types or migrate to Rust:** state and error contracts differ; current baselines do not prove a new Rust render path is needed.

## Consequences

- Math enters an independent `editor/capabilities/math` composed of syntax, inventory, session, Worker renderer, widget, font, and preference modules; generic WYSIWYG and Mermaid do not own math’s main logic.
- Document-level whole-batch rendering recomputes when the formula sequence or preferences change, but ordinary non-formula edits only map decorations and do not trigger the Worker. Dedicated performance baselines must continuously cover formula-free 1 MiB documents, 100/1000 formulas, sustained typing, resize, Worker time, and memory release.
- 105 NewCM WOFF2 files increase install size but do not enter the app entry or Mermaid chunk; offline installers must verify common and rare glyphs, Physics, and mhchem make no network requests.
- CHTML provides baseline accessibility with `role="math"` and TeX accessible names; full assistive technology, reference keyboard navigation, and cross-platform fonts remain product acceptance gates.
- `\label` indexes are valid only for the current generation. Reference clicks must re-resolve targets from the current result and call shared location-reveal capability; do not long-term cache absolute source positions.

## Rollback and revisit criteria

If the pinned versions cannot run offline in supported Tauri WebViews, keep breaking JS chunk gates, cause unacceptable typing or memory-budget regression, or present security issues that Safe handler plus second DOM sanitize still cannot isolate, disable the math capability and fall back to source-visible state, then revisit engine or output format via a new ADR.

On revisit, do not silently fall back to main thread, SVG, CDN, blob workers, or relaxed CSP. Re-compare engines only when new compatibility corpora prove KaTeX fully meets document-level numbering, macros, and bidirectional reference goals, or MathJax’s official architecture changes materially.

## References

- [KaTeX support table](https://katex.org/docs/support_table.html)
- [MathJax local hosting](https://docs.mathjax.org/en/latest/web/hosting.html)
- [MathJax CHTML output](https://docs.mathjax.org/en/latest/output/html.html)
- [MathJax SVG output differences](https://docs.mathjax.org/en/latest/output/svg.html)
- [MathJax numbering and references](https://docs.mathjax.org/en/v4.0/input/tex/eqnumbers.html)
- [Tauri CSP](https://v2.tauri.app/security/csp/)
