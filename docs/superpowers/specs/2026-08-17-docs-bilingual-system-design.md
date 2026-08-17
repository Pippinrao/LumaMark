# Design: Bilingual Documentation System + Lag Cleanup

**Date:** 2026-08-17  
**Status:** Approved (owner delegated remaining decisions)  
**Branch / worktree:** `docs/bilingual-system` @ `.worktrees/docs-bilingual`

## Purpose

English-default documentation with full Chinese retained via `docs/zh/` / `*.zh.md`, plus living-doc lag cleanup.

## Locked decisions

- Coverage: active docs full bilingual; specialty/historical Chinese full under `docs/zh/`, English index/archive summary + links
- Layout: English default paths; Chinese mirror `docs/zh/**`; root `*.zh.md`
- Contracts: English `AGENTS.md` / `DEVELOPMENT_PROCESS.md` + Chinese `*.zh.md`
- Cleanup: index + reading-order; revise living status; pointers to landed capabilities; no full competitive rewrite
- Execution: move Chinese first, then English defaults; worktree branch

## Language switcher

- EN: `> Language: **English** · [中文](<rel-zh>)`
- ZH: `> 语言：**中文** · [English](<rel-en>)`

## Specialty

`typora-baseline` / `typora-competitive-analysis`: EN README index + per-topic stubs linking to Chinese full text under `docs/zh/`.

## Historical Alpha

EN archive banner + short summary + link to zh full; remove from must-read primary path.

## Future edits

Update English living docs first, then Chinese mirror in same change. Owner-facing agent chat stays Chinese; docs default English.

## Lag cleanup targets

Doc maps, README status, EVOLUTION_PLAN, DETAILED_ARCHITECTURE overview, AGENTS/DEVELOPMENT_PROCESS bilingual policy, MathJax/PlantUML/settings/updater/multi-window pointers.

## Non-goals

Full EN translation of every specialty topic body; competitive gap matrix rewrite; product code; deleting V1 history.

## Verification

Paired living docs; switchers resolve; single execution source of truth remains Typora Parity plan; version `c+1` on landing commit.
