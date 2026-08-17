> Language: **English** · [中文](../zh/decisions/0007-stable-performance-sampling.md)

# ADR 0007: Stable Performance Sampling Gates

**Status:** Accepted

**Date:** 2026-08-01

## Context

V1 performance tests already run independently and serially, but synchronous typing paths still took a single wall-clock sample. Across two GitHub `windows-latest` 0.2.0 candidate gates, the first sample showed scale-independent jitter: the 1MB sample was slower than 5MB/10MB, and three unrelated `< 16 ms` paths each exceeded budget by only 0.17ms, 0.17ms, and 3.44ms. In the same run, Mermaid 1/5/10MB active-edit stayed near-constant time, and functional, E2E, and production builds all passed.

A single wall-clock sample mixes target code, JIT, jsdom initialization, and shared runner scheduling. It can misread noise as regression and cannot distinguish sustained slowdown from one spike. Raising the existing 16ms target or rerunning after failure would weaken the gate, so a clear, reviewable statistical contract is required.

## Decision

- Large-document tail typing, dense code-block typing, and Mermaid active-edit always collect 5 samples. The first sample must be kept and reported; no discard, retry, or take-minimum. Each sample for default editor first typing uses an independent new editor; each Mermaid cold-path sample uses an independent new editor and independent activation so later warm typing in the same lifecycle cannot dilute the first-path measurement.
- Existing 1/5/10MB primary budgets stay unchanged and constrain the P80 of the 5 samples (4th after sorting). Strict typing paths still use `< 16 ms` as the primary target, so each group may have at most 1 sample over the primary budget. Median continues to be reported for observation but is not a more lenient pass criterion.
- Each group also constrains the maximum: `max(50 ms, 2 × primary budget)`. Therefore every sample on a `< 16 ms` path must be `< 50 ms`, and `< 50/100 ms` paths must keep max `< 100/200 ms`.
- Default small-document editor creation likewise collects 5 independent lifecycles; first sample and P80 must both be `< 300 ms`, and max must be `< 600 ms`. Each lifecycle measures first typing once and applies the `< 16 ms` P80 and `< 50 ms` max gates above.
- The two Mermaid pending-render cases likewise establish 5 independent render/editor lifecycles, measuring the specified in-flight render main-document dispatch once per lifecycle; P80 and max must both be `< 50 ms`.
- All sample values, P80, median, and max must be written to test output. Failure of any primary budget or max fails the gate; automatic reruns are not pass evidence.
- `pnpm perf:bench` remains separated from other heavy CPU gates and runs serially. Real Tauri WebView2 keyboard P50/P95, undo, and open measurements remain product-environment evidence and cannot be replaced by jsdom statistics.

## Alternatives considered

- **Directly raise the 16ms primary budget:** legitimizes sustained typing regression.
- **Rerun after failure or keep only the minimum:** hides reproducible spikes and makes pass results incomparable.
- **Unlimited warmup then measure only steady state:** cannot constrain first create and first typing.
- **Immediately change production hot paths from a single CI run:** current data shows synchronized cross-case jitter without evidence of a specific production module regression.

## Consequences

- Typing gates change from “one sample must be under the primary budget” to “5-sample P80 under the original primary budget, and no sample may exceed an explicit hard max”. Cold-path and pending-render’s five typing samples each come from five independent lifecycles; this allows at most one process-level JIT or shared-runner spike per group, but 2/5 over the primary budget fails, and any sample over the hard max fails.
- Benchmarks execute more real edit transactions and take slightly longer; each sample still mutates a real CodeMirror document and verifies final content.
- Performance baseline docs must record samples, P80, median, and max together. Adding or raising a primary budget or sample hard max still requires a new ADR.

## Rollback and revisit criteria

After obtaining a fixed-hardware runner, compare single-sample, P95, and the current P80/max contract; if stable hardware proves the max gate too loose, tighten the hard max. If user measurement shows first-typing stalls, prioritize adding a real WebView cold-path P95 gate and revisit this decision; do not only tune jsdom numbers.
