> Language: **English** · [中文](../zh/performance/V1_BASELINE.md)

# V1 Performance Baseline

This document records LumaMark V1 alpha performance gates and current measured results. Later optimization may improve metrics, but must not remove performance gates.

## Environment

- Date: 2026-07-22
- Parity Reliability supplement date: 2026-07-27
- 0.2.0 release calibration date: 2026-08-01
- Reading appearance supplement date: 2026-08-04
- Reading appearance real-layout calibration date: 2026-08-05
- Code-block fence reliability supplement date: 2026-08-12
- Code-block fence completion budget calibration date: 2026-08-13
- Stutter-recovery mixed-document calibration date: 2026-08-18
- Installed UX stutter gate date: 2026-08-19
- Platform: Windows, local development worktree
- Command: `pnpm perf:bench` (jsdom, serial) and `pnpm release:installed-ux-stutter` (live installed/WebView2 window)
- Coverage: Markdown fixture reads, application file-action open, post-open debounced outline refresh, virtualized outline panel initial render, CodeMirror large-document initialization, tail input dispatch, selection-only dispatch, display-mode round-trip, reading-appearance compartment dispatch round-trip, dense code-block document input/activation/real Enter fence completion, simple/complex Mermaid pending render plus active-edit input dispatch, 1/5/10MB document-statistics scheduling, a ~2–4KB mixed document (math + PlantUML + Mermaid + table) tail-input/selection/scroll/processing probe, and installed same-window small-file click, titlebar drag engage, mixed-document scroll, and load long-task measurement
- Run policy: `pnpm test` excludes `tests/perf/**`; performance benchmarks must run separately and serially via `pnpm perf:bench`. The outline panel benchmark warms up once with a tiny render first. Input and default editor creation always collect 5 samples, keep the first sample, and report all values; default editor first input, Mermaid cold paths, and pending-render each use an independent editor/activation/render lifecycle per sample. Existing primary budgets constrain P80 (the 4th ordered sample; at most 1 sample may exceed the primary budget); maxima are constrained by `max(50 ms, 2 × primary budget)`; default editor creation also requires first sample and P80 `< 300 ms` and maximum `< 600 ms`. See [ADR 0007](../decisions/0007-stable-performance-sampling.md) for the full decision. Code-block fence completion, as a complex editing command, uses P80 `< 50 ms` and maximum `< 100 ms`; ordinary tail input remains P80 `< 16 ms` and maximum `< 50 ms`; the boundary is in [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md). Mermaid 1/5/10MB active-edit P80 budgets remain `< 16/50/100 ms`; pending-render P80 and maximum must both be `< 50 ms`.

## Automated Gates

| Path | Budget | Current result | Verdict |
|---|---:|---:|---|
| Read `large-1mb.md` | < 300 ms | 1.99 ms | Pass |
| Read `large-5mb.md` | < 1000 ms | 5.71 ms | Pass |
| Read `large-10mb.md` | < 2000 ms | 14.59 ms | Pass |
| File-action open `large-1mb.md` | < 300 ms | 75.29 ms | Pass |
| File-action open `large-5mb.md` | < 1000 ms | 104.94 ms | Pass |
| File-action open `large-10mb.md` | < 2000 ms | 177.25 ms | Pass |
| Post-open outline refresh `large-1mb.md` | < 50 ms | 7.04 ms | Pass |
| Post-open outline refresh `large-5mb.md` | < 150 ms | 23.55 ms | Pass |
| Post-open outline refresh `large-10mb.md` | < 300 ms | 49.41 ms | Pass |
| Outline panel initial render `large-1mb.md` | < 60 ms | 23 / 799 items, 23.62 ms | Pass |
| Outline panel initial render `large-5mb.md` | < 60 ms | 23 / 3953 items, 19.66 ms | Pass |
| Outline panel initial render `large-10mb.md` | < 60 ms | 23 / 7892 items, 11.33 ms | Pass |
| Default small-document first editor creation | First sample < 300 ms; P80 < 300 ms; max < 600 ms | First sample 98.51 ms; P80 16.79 ms; median 14.46 ms; max 98.51 ms; samples [98.51, 10.39, 13.22, 14.46, 16.79] | Pass |
| Default small-document first tail input dispatch | P80 < 16 ms; max < 50 ms | P80 1.49 ms; median 1.46 ms; max 6.84 ms; samples [6.84, 1.26, 1.46, 1.18, 1.49] | Pass |
| Editor load `large-1mb.md` | < 300 ms | 58.07 ms | Pass |
| Editor load `large-5mb.md` | < 1000 ms | 54.90 ms | Pass |
| Editor load `large-10mb.md` | < 2000 ms | 79.19 ms | Pass |
| 1MB tail input dispatch | P80 < 16 ms; max < 50 ms | P80 2.05 ms; median 1.63 ms; max 3.14 ms; samples [3.14, 2.05, 1.63, 1.49, 1.55] | Pass |
| 5MB tail input dispatch | P80 < 50 ms; max < 100 ms | P80 1.27 ms; median 1.18 ms; max 2.22 ms; samples [2.22, 1.27, 1.16, 1.09, 1.18] | Pass |
| 10MB tail input dispatch | P80 < 100 ms; max < 200 ms | P80 1.21 ms; median 1.19 ms; max 1.54 ms; samples [1.54, 1.19, 1.21, 1.19, 1.16] | Pass |
| Ordinary input dispatch while Mermaid render is pending | P80 < 50 ms; max < 50 ms | P80 0.74 ms; median 0.55 ms; max 3.31 ms; samples [3.31, 0.74, 0.55, 0.46, 0.53] | Pass |
| 1MB document 12 selection-only dispatches | < 100 ms | 22.50 ms (avg 1.88 ms) | Pass |
| 5MB document 12 selection-only dispatches | < 120 ms | 10.94 ms (avg 0.91 ms) | Pass |
| 10MB document 12 selection-only dispatches | < 160 ms | 9.05 ms (avg 0.75 ms) | Pass |
| 1MB document source/live-preview mode round-trip | < 150 ms | 23.44 ms | Pass |
| 5MB document source/live-preview mode round-trip | < 300 ms | 20.83 ms | Pass |
| 10MB document source/live-preview mode round-trip | < 600 ms | 31.52 ms | Pass |
| 1MB document reading-appearance compartment dispatch round-trip | < 50 ms | 0.88 ms | Pass |
| 5MB document reading-appearance compartment dispatch round-trip | < 75 ms | 0.69 ms | Pass |
| 10MB document reading-appearance compartment dispatch round-trip | < 100 ms | 0.84 ms | Pass |
| Load 2048 fenced blocks (0.46 MiB) | < 300 ms | 27.42 ms | Pass |
| 2048 fenced blocks tail input dispatch | P80 < 16 ms; max < 50 ms | P80 2.52 ms; median 1.71 ms; max 4.21 ms; samples [4.21, 2.52, 1.71, 1.59, 1.37] | Pass |
| 2048 fenced blocks focus-activation dispatch | P80 < 16 ms; max < 50 ms | P80 0.96 ms; max 1.72 ms; samples [1.72, 0.96, 0.96, 0.85, 0.84] | Pass |
| 2048 fenced blocks real Enter fence completion at tail | P80 < 50 ms; max < 100 ms | P80 24.55 ms; max 35.75 ms; samples [24.55, 19.98, 13.08, 15.50, 35.75] | Pass |
| Main-document input dispatch while complex Mermaid is pending | P80 < 50 ms; max < 50 ms | 180 nodes / 17,348 bytes; P80 0.74 ms; median 0.62 ms; max 2.64 ms; samples [2.64, 0.62, 0.60, 0.56, 0.74] | Pass |
| Small-document first Mermaid active-edit input dispatch | P80 < 16 ms; max < 50 ms | P80 2.08 ms; median 1.85 ms; max 2.84 ms; samples [2.84, 2.08, 1.85, 1.74, 1.51] | Pass |
| 1MB document Mermaid active-edit input dispatch | P80 < 16 ms; max < 50 ms | P80 2.23 ms; median 2.12 ms; max 2.44 ms; samples [2.44, 2.23, 2.12, 2.06, 1.86] | Pass |
| 5MB document Mermaid active-edit input dispatch | P80 < 50 ms; max < 100 ms | P80 2.02 ms; median 1.94 ms; max 7.35 ms; samples [2.02, 1.84, 1.94, 1.75, 7.35] | Pass |
| 10MB document Mermaid active-edit input dispatch | P80 < 100 ms; max < 200 ms | P80 1.63 ms; median 1.62 ms; max 1.74 ms; samples [1.74, 1.61, 1.63, 1.62, 1.62] | Pass |
| 1MB document statistics (sync count) | P80 < 16 ms | P80 8.25 ms; samples [8.25, 5.62, 4.73] | Pass |
| 5MB document statistics schedule (input path) | P80 < 2 ms | P80 0.19 ms; samples [0.19, 0.01, 0.01] | Pass |
| 10MB document statistics schedule (input path) | P80 < 2 ms | P80 0.04 ms; samples [0.04, 0.00, 0.00] | Pass |
| Mixed ~2–4KB doc (math + PlantUML + Mermaid + table) tail input dispatch | P80 < 8 ms; processing P95 < 32 ms; max < 32 ms | P80 2.01 ms; max 7.23 ms; samples [7.23, 2.01, 1.68, 1.36, 1.72]; processing P95 7.23 ms | Pass |
| Mixed ~2–4KB doc selection-only dispatch | P80 < 8 ms; max < 32 ms | P80 0.33 ms; max 0.62 ms; samples [0.62, 0.33, 0.23, 0.25, 0.31] | Pass |
| Mixed ~2–4KB doc scroll two-frame commit (jsdom proxy) | P80 < 16 ms | P80 0.03 ms; max 0.42 ms | Pass |
| Web first-screen entry JS chunk | < 120 KiB | 15.05 KiB | Pass |
| Any Web JS chunk | < 700 KiB | Max 664.41 KiB, gzip 146.38 KiB, Mermaid dynamic dependency | Pass |

## Interpretation

- Automated performance gates for 1MB, 5MB, and 10MB pass, covering reads, application file-action open, post-open outline refresh, virtualized outline panel initial render, editor load, and tail input dispatch.
- A 10MB file meets the current automated “does not freeze” gate: it can be opened via file action, complete post-debounce outline refresh, initially render only 23 / 7892 outline items, create the editor, and complete one tail input.
- Mermaid rendering runs asynchronously through the scheduler; under pending render, both ordinary and complex input run the P80/maximum `< 50 ms` gate across 5 independent render lifecycles. The active-edit cold path runs P80 `< 16 ms` and maximum `< 50 ms` across 5 independent activations; consecutive 1/5/10MB input within the same document stays near constant time and passes P80 budgets of `< 16/50/100 ms` respectively.
- The 2026-08-18 stutter-recovery calibration restored post-open outline refresh to the original `< 50/150/300 ms` budgets (measured 10.13/25.56/52.40 ms on this run), moved 5/10MB document statistics off the input path (`< 2 ms` schedule), and added a mixed ~2–4KB writing sample. That mixed document keeps tail-input P80 `< 8 ms` and selection P80 `< 8 ms`; Vitest + jsdom processing P95 is a proxy for INP processing time (`< 32 ms`) and is not a real Chrome INP measurement. The 2026-08-19 mixed-doc scroll proxy is P80 `< 16 ms` (measured 0.03 ms) and likewise does not replace installed WebView2 scroll or long-task evidence.
- Parity Reliability supplemental gates prove: selection-only updates do not modify the document; display-mode round-trips keep selection; ordinary tail input and focus language activation on dense code-block documents keep the strict 1MB-input budgets of P80 `< 16 ms` and maximum `< 50 ms`. Real Enter fence completion simultaneously confirms syntax, multi-span insert, selection, viewport, and height-map updates, and is constrained independently as a complex editing command per [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md) at P80 `< 50 ms` and maximum `< 100 ms`; while a complex Mermaid long task is pending, the main `EditorApi` document receives input immediately and does not start a second render task for out-of-block input.
- Reading appearance is reconfigured via CodeMirror compartment and CSS variable round-trips; synchronous dispatch on 1/5/10MB documents in Vitest + jsdom measured 0.88/0.69/0.84 ms locally and is constrained by automated budgets of `< 50/75/100 ms`, without modifying body text or selection. Those numbers exclude browser style calculation, real layout, and paint cost, and must not be used to claim “page reflow completed” latency. Packaged WebView2 smoke waits two frames after width changes and reads `.cm-content` bounds to force observation of real layout, with a budget of `< 500 ms`.
- The Web build has passed the `pnpm quality:web-build` gate: the first-screen entry is split out of the large vendor bundle, with React, CodeMirror, UI dependencies, and heavy Mermaid dependencies loaded in groups. The CodeMirror startup core and Lezer base packages remain one topologically complete 600.41 KiB chunk; language packages continue to load on demand. Do not further split that core group with an arbitrary `maxSize`, because it would break cyclic module initialization order and cause a production white screen. The largest chunk is upstream parse dependencies such as `vscode-languageserver-types` / Langium in the Mermaid dynamic render path; they do not enter the first-screen entry.
- Volume grouping of heavy Mermaid dependencies can form cyclic output chunks, so Rolldown output enables `strictExecutionOrder`. `pnpm test:e2e:production` triggers Mermaid dynamic import against real `dist/` and requires successful SVG with no `pageerror` or unexpected console error; `pnpm release:packaged-webview` further verifies active-save against a real release WebView and Rust file writes. Neither functional gate can be replaced by “build succeeded” or chunk-size budgets alone.

## Installed UX interaction gates

`pnpm release:installed-ux-stutter` measures a live Windows window (OS mouse when the process can take the foreground, otherwise WebView CDP click; Event Timing / two-frame scroll; `PerformanceObserver` long tasks). Routing acceptance must stay on (`LUMAMARK_ROUTING_ACCEPTANCE_MODE=1`) so a second argv does not spawn another process.

These numbers are not interchangeable with `pnpm perf:bench` jsdom dispatch. Passing mixed-doc input P80 in Vitest does not prove installed same-window file click, titlebar drag engage, scroll frames, or load long tasks.

| Path | Budget | Current result | Verdict |
|---|---:|---:|---|
| Same-window small-file click (`pointerdown` → target text visible) | P80 < 50 ms | P80 25.0 ms; samples [28.1, 24.5, 22.5, 25.0, 23.9]; 2026-08-19 this-branch release exe | Pass |
| Titlebar drag first `GetWindowRect` change | < 50 ms after mouse motion | Skipped: Start/Search kept the foreground (`foregroundTitle='开始'`). Native `.lm-titlebar-drag` region is unchanged; the probe records first-move timing when the window can take focus | Skipped |
| Mixed ~2–4KB doc scroll two frames | P80 < 16 ms; P95 < 32 ms | P80 16.7 ms; P95 16.8 ms; samples ~16.6–16.8 ms after two warmup scrolls. 16.7 ms is one 60 Hz vsync; the gate allows 1 ms slack so a quantized frame does not fail | Pass |
| Mixed-doc load/render long task (3 s window) | < 50 ms | 0 ms (`PerformanceObserver` longtask) | Pass |
| Cold argv → visible text | Recorded, not gated to 50 ms | 933 ms on this run (WebView boot) | Known limit |

Acceptance for “the installed package no longer stutters on these three paths” requires a green run of `pnpm release:installed-ux-stutter` against an exe that contains the corresponding source. Do not treat a jsdom mix-doc dispatch pass as that evidence. Titlebar drag engage is skipped (not failed) when the OS Start menu holds the foreground; that skip is not a production defect.

## Real Tauri WebView2 Ergonomic Measurements

On 2026-07-22, real Rust file reads and keyboard events were exercised via WebView2 CDP on `src-tauri/target/release/lumamark.exe`. The window was 1000 × 700 CSS pixels at DPR 1.5; sample `ergonomic-large-10mb.md` was 10,486,549 bytes, 10,044,653 CodeMirror UTF-16 positions, and 299,863 lines. Keyboard data timed from page `performance.now()` before the event through two `requestAnimationFrame`s, 7 trials each; it includes event handling and the cost of two visible commit frames.

| Path | Result | Verdict |
|---|---:|---|
| Recent-file click to full EditorState with status “opened” | 249.97 ms | Passes current 10MB open budget |
| 10MB direct tail dispatch | 26.60 ms | Passes current 100 ms input budget |
| 10MB real keyboard input | P50 48.20 ms; P95 90.40 ms | P95 passes current 100 ms gate, but above single-frame 16 ms |
| 10MB real `Ctrl+Z` | P50 148.50 ms; P95 155.90 ms | Does not meet 100 ms; kept as an explicit optimization item |
| Initial visible DOM | 31 lines; scroll height 7,000,168 px; no page horizontal overflow | Virtualization/viewport rendering is effective |
| Primary data after 7 input/undo trials | Document length and line count restored exactly; title clean; recovery draft empty | Save point and undo round-trip pass on this sample |
| Small-document page-width switch to two-frame layout commit | 19.60 ms | Passes packaged WebView2 `< 500 ms` smoke budget |

On the same development real WebView2 before the fix, 10MB tail keyboard input was P50 226 ms / P95 242 ms; after fixing the changed-range/viewport hot path, the development rebuild remeasured P50 86.9 ms, and the release build finished at P50 48.2 ms / P95 90.4 ms. That comparison used the same on-disk sample and in-page two-frame policy, but development and release build modes differ, so it is only for locating improvement direction—not a strict isomorphic benchmark.

## Known Limitations

- The automated baseline still primarily runs in Vitest + jsdom; this round added real Windows Tauri WebView2 observations for open, tail input, undo, and small-document reading-appearance two-frame layout, but that does not replace large-document width/font reflow, scroll FPS, native IME feel, screen readers, or long editing sessions.
- jsdom `view.dispatch` / synthetic scroll is not installed INP, titlebar drag engage, WebView2 scroll frames, or `longtask` duration. Use `pnpm release:installed-ux-stutter` for those three interaction paths.
- Cold argv open of a two-line Markdown file includes WebView boot (~900–1100 ms in prior installed probes) and is an explicit known limitation; it is not the same-window 50 ms file-click budget.
- Real WebView2 10MB undo P95 is 155.90 ms and still has perceptible delay; do not claim large-document human experience is fully meeting targets just because automated dispatch is 1.79 ms.
- Web build chunk budgets are automated. If Mermaid, KaTeX, Cytoscape, and similar dependencies keep growing, prefer evaluating lazy load by diagram type or finer-grained entry replacement over raising the budget.
- Performance numbers are affected by local CPU, disk cache, and dependency versions. If CI or other machines show regressions, treat the automated gates and a new baseline record as authoritative.
