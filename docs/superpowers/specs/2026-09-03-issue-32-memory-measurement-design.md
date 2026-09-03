# Design: Issue #32 — Memory measurement gate

**Date:** 2026-09-03
**Status:** Draft — awaiting review
**Issue:** https://github.com/Pippinrao/LumaMark/issues/32

## Purpose

#32 reports 3GB+ idle memory. Previous measurement (v0.3.58, 2026-08-25) showed 430–520 MB and could not reproduce. Before writing any optimization code we must re-measure on the latest build and, if still not reproducible, request a concrete reproduction from the reporter.

## Approach

1. Build the latest main as an installed package.
2. Run `pnpm release:installed-idle-memory` with the default 30s sample, then with `--duration-ms 600000` (10 min).
3. Test with several file types: plain markdown, heavy Mermaid, heavy math, large (1MB+).
4. Record results. If working-set exceeds 1 GB for any idle file → investigate; if not → comment on #32 with measurements and request reproduction details.

## Non-goals

- Speculative memory optimization without evidence.
- Changing production code in this task.

## Deliverable

- A measurement report comment on issue #32.
- If a leak is found: a separate design spec for the fix.
