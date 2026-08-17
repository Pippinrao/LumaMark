> Language: **English** · [中文](../zh/roadmap/V1_IMPLEMENTATION_PLAN.md)

# V1 Implementation Plan

> **Historical / frozen Alpha baseline — NOT current execution source of truth.**
>
> This document keeps the original Foundation / MarkText+ task breakdown and unfinished checkboxes. It is not the current execution plan, and later work must not be backfilled as forged TDD completion. Current scope, sequencing, and exit gates live only in [Typora Parity Implementation Plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## What this document was for

This was the Alpha execution plan to land V1 as a daily-trial Typora-like baseline: open, edit, WYSIWYG, Mermaid, save, zh/en, performance baselines, and a usable Windows build.

**Historical stack:** Tauri v2, React, TypeScript, Vite, pnpm, CodeMirror 6, Radix Primitives, Zustand, i18next, Vitest, Playwright, Mermaid, Rust—with CodeMirror owning Markdown text and the edit hot path, React owning the shell, and Rust owning file/system capabilities.

### Historical task graph

```text
0 Docs and repo baseline
└─ 1 App scaffold and quality commands
   ├─ 2 i18n, theme, and app shell
   ├─ 3 Test fixtures and performance baselines
   └─ 4 CodeMirror editor core
      └─ 5 File open/save loop
         ├─ 6 Basic Markdown WYSIWYG
         ├─ 7 Async Mermaid
         └─ 8 Product shell: file tree, outline, command palette
            └─ 9 V1 convergence, E2E, performance, Windows build
```

Execution rules emphasized TDD, one clear slice per task, reading verification output before claiming done, independent review on major changes, and user approval before any hand-rolled UI primitive. The Chinese full text retains the long per-task checklists from that era for archival reference only.

## Links

- [Chinese full text](../zh/roadmap/V1_IMPLEMENTATION_PLAN.md)
- [Current execution plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
