> Language: **English** · [中文](../zh/decisions/0013-code-block-completion-performance-budget.md)

# ADR 0013: Independent Performance Budget for Code-Block Fence Completion

**Status:** Accepted

**Date:** 2026-08-13

## Context

The dense code-block benchmark simulates a real `Enter` at the end of a document with 2048 fenced blocks (~0.46 MiB). The editor recognizes the opening fence, inserts a matching closing fence, keeps the caret, and completes the CodeMirror update. It is not an ordinary single-character dispatch: one command includes syntax confirmation, multi-span text and selection transaction, and viewport/height-map updates together.

That case originally reused ordinary typing’s P80 `< 16 ms` and max `< 50 ms`. Fresh remeasurement shows ordinary tail typing still stable at 2–5 ms, while fence completion on the same code tree has local P80 17–28 ms; on GitHub Windows runners P80 was 31.08 ms and max 57.20 ms. The original commit that introduced the benchmark, in an isolated worktree after dependency init, also reproduced P80 19.77 ms / max 24.05 ms on the second round; the first round was P80 54.85 ms / max 77.86 ms, showing cross-round cold-start variance, but still within the new hard max. This means the failure is not regression from later feature merges, but an initial baseline that understated the stable cost of a complex command.

## Decision

- Ordinary dense code-block document tail typing and focus activation continue to use P80 `< 16 ms` and max `< 50 ms`; ordinary typing gates are not relaxed.
- Real `Enter` fence completion, as a complex edit command, separately uses P80 `< 50 ms` and max `< 100 ms`.
- Sampling continues to follow [ADR 0007](0007-stable-performance-sampling.md): fixed 5 samples, keep the first sample, use P80, report all samples, no warmup, no sample discard, no retry; max is still `max(50 ms, 2 × primary budget)`.
- The benchmark continues to assert the command is actually handled, the closing fence is generated exactly, and caret plus temporary-text cleanup are correct; raising the budget cannot replace functional assertions.
- If real Tauri WebView2 later adds keyboard P95 for this command, treat it as supplemental product-environment evidence; do not use it to delete the jsdom regression gate.

## Alternatives considered

- **Keep treating fence completion as ordinary single-key typing at 16/50 ms:** measured overruns already repeated on the original commit, current local machines, and GitHub runners, so real regression cannot be distinguished from a budget that was never valid.
- **Discard the first sample, add warmup, or rerun after failure:** violates ADR 0007 and hides spikes on the user’s first trigger of the command.
- **Raise all code-block typing budgets:** ordinary typing still meets 16/50 ms; there is no evidence to relax it.
- **Rewrite editor core without hotspot evidence:** non-persistent temporary segment profiling did not point primary cost at the project code-block plugin; cost concentrates in full CodeMirror/jsdom view update, parsing, and geometry updates. That diagnosis only rules out guessed directions and is not a long-term performance baseline. Speculative rewrites are high risk with no evidence they can restore 16 ms.

## Consequences

- CI no longer intermittently fails because a complex command was misclassified under the ordinary typing budget, while still blocking regressions where fence-completion P80 reaches 50 ms or any sample reaches 100 ms.
- Ordinary typing, activation, load, and other editor performance budgets stay unchanged; this decision is not precedent for relaxing other typing gates.
- `docs/performance/V1_BASELINE.md` must record the new budget and full samples for each calibration.

## Rollback and revisit criteria

If production WebView2 fence-completion P95 reaches 100 ms, users perceive stalls, or CodeMirror upgrades cause sustained growth, first locate the real hotspot with a profiler and tighten the budget. If later optimizations make multi-round local and CI P80 stably under 16 ms, a new ADR may restore the strict budget; do not roll back from a single fast sample.
