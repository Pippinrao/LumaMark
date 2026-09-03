# Design: Issue #34 — Table render regression test matrix

**Date:** 2026-09-03
**Status:** Draft — awaiting review
**Issue:** https://github.com/Pippinrao/LumaMark/issues/34

## Purpose

#34 reports "some tables don't render again." The root cause is unknown — the previous occurrence (#21) was a GFM source formatting conflict in `codemirror-markdown-tables`. Before writing any fix, we need a comprehensive test matrix that exercises all common table syntax variants. Whichever variants fail to mount `.tbl-table-widget` become the reproduction, and only then do we write the minimal fix.

## Approach

1. **Add unit-level table render matrix tests** in `tablePreviewExtension.test.ts` covering:
   - Table inside a blockquote (`> | A | B |`)
   - Table immediately after a heading (no blank line)
   - Table immediately after a paragraph (no blank line)
   - Two consecutive tables separated by a single blank line
   - Table with empty cells (`| | |`)
   - Table with alignment colons (`:---:`, `---:`, `:---`) — partially covered
   - Wide table (10+ columns)
   - Table inside a list item
   - Table with inline formatting (bold, italic, links, code, math) — partially covered
   - Single-column table
   - Table with trailing whitespace / inconsistent pipe padding

2. Each test asserts that `.tbl-table-widget .tbl-table` is present and contains expected cell text.

3. If any test fails → that is the #34 reproduction → write the minimal fix via TDD.

4. If all tests pass → #34 needs a concrete reproduction file from the reporter; close the testing task with the matrix committed.

5. Add an E2E smoke test that opens `tests/fixtures/markdown/table.md` (extended with the new variants) and asserts all tables render as widgets.

## Non-goals

- Changing table rendering, styling, or interaction unless a test fails.
- Table cell click/caret accuracy (separate issue #35 / #25).
- Memory (#32).

## Verification

- `pnpm vitest run src/editor/capabilities/table/tablePreviewExtension.test.ts` — all new and existing tests pass.
- `pnpm test:e2e -- editor-markdown` — table smoke tests pass.
