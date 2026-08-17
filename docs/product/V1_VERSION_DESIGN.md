> Language: **English** · [中文](../zh/product/V1_VERSION_DESIGN.md)

# V1 Version Design

> **Historical / frozen Alpha baseline — NOT current execution source of truth.**
>
> This document freezes the Foundation / MarkText+ product and architecture slice. Do not treat it as the current execution plan, and do not rewrite completion status from later work. Current scope, sequencing, and exit gates live only in [Typora Parity Implementation Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## What this document was for

Dated 2026-07-05, this was the Alpha “version design” for LumaMark V1: not a commercial complete 1.0 and not full Typora parity, but a stable MarkText+ / Alpha-to-Beta baseline—open Markdown, edit smoothly, basic WYSIWYG, Mermaid, source-faithful save, Windows-ready, with built-in Chinese and English.

### Design goals (historical)

1. **Writable** — new/open/edit/save closed loop  
2. **Fluent** — no obvious jank on typing, scroll, open, save  
3. **Trustworthy** — zero unrelated save diff  
4. **Typora-like** — layout, visuals, and basic live-preview behavior  
5. **Evolvable** — architecture, tests, i18n, and performance baselines that support later parity work  

### Success bar (historical)

Windows dev build and installer usable; open/edit/save `.md`; basic Markdown WYSIWYG; async Mermaid; comfortable editing at 1MB/5MB and no freeze at 10MB; bilingual UI; automation/E2E on critical paths.

The full Chinese text expands default chrome (menu bar, file/outline sidebar tabs, quiet status bar), writing-behavior principles, feature/non-goal slices, architecture and tech choices (Tauri + React + CodeMirror 6), quality/performance gates, and how V1 was meant to stage later Typora parity—without being today’s schedule.

Where layout conflicted with UX design, [V1 UX Design](V1_UX_DESIGN.md) was authoritative for Alpha front-of-house experience.

## Links

- [Chinese full text](../zh/product/V1_VERSION_DESIGN.md)
- [Current execution plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
