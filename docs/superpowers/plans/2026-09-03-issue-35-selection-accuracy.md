# Issue #35 — Selection Accuracy Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix drag-selection release mismatch and excessive vertical sensitivity (issue #35).

**Architecture:** Extend the existing `pointerSelectionStyle` (ADR 0019) with Y hysteresis and a settlement-skip flag; no new modules.

**Tech Stack:** TypeScript, Vitest, Playwright, CodeMirror 6

## Global Constraints

- Version bump: `0.3.59` → `0.3.60` in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (in final commit).
- All existing `pnpm test` / `pnpm typecheck` / `pnpm lint` must stay green.
- TDD: every production change is preceded by a failing test.
- Do not touch `updateStore` files (unrelated uncommitted work).

---

### Task 1: Failing tests — settlement must not overwrite a drag range

**Files:**
- Modify: `src/editor/wysiwyg/pointerSelectionStyle.test.ts`

**Interfaces:**
- Consumes: `createPointerSelectionStyle` from `pointerSelectionStyle.ts`
- Produces: Two new test cases that will fail until Task 2

- [ ] **Step 1: Write failing test — `dragRangeCommitted` is true after drag past slop**

```typescript
it('signals that a drag range was committed when the pointer passes the slop', () => {
  const { cleanup, view } = mountEditor();
  try {
    const style = createPointerSelectionStyle(view, {
      position: 6,
      x: 100,
      y: 20,
    });
    // Inside slop — not committed
    style.get(mouseEvent(102, 20), false, false);
    expect(style.dragRangeCommitted).toBe(false);
    // Past slop — committed
    style.get(mouseEvent(120, 20), false, false);
    expect(style.dragRangeCommitted).toBe(true);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/editor/wysiwyg/pointerSelectionStyle.test.ts`
Expected: FAIL — `dragRangeCommitted` does not exist on the style object.

---

### Task 2: Implement `dragRangeCommitted` flag

**Files:**
- Modify: `src/editor/wysiwyg/pointerSelectionStyle.ts`

**Interfaces:**
- Consumes: `PointerSelectionAnchor`, `isPrimaryPointerClick`
- Produces: `MouseSelectionStyle` with added `dragRangeCommitted: boolean` property

- [ ] **Step 1: Add `dragRangeCommitted` to the returned style**

In `createPointerSelectionStyle`, add a `dragRangeCommitted` property initialized to `false`. In the `get` method, set it to `true` when `!inSlop` and the resulting range is non-empty.

```typescript
export function createPointerSelectionStyle(
  view: EditorView,
  anchor: PointerSelectionAnchor,
): MouseSelectionStyle & { dragRangeCommitted: boolean } {
  let anchorPosition = anchor.position;
  let lastHead = anchor.position;
  let lastPointerX = anchor.x;
  let startSelection = view.state.selection;
  let committed = false;

  const style: MouseSelectionStyle & { dragRangeCommitted: boolean } = {
    get dragRangeCommitted() { return committed; },

    get(event: MouseEvent, extend: boolean, multiple: boolean) {
      const range = pointerSelectionRange(
        view, anchor, anchorPosition, lastHead, lastPointerX, event,
      );
      lastHead = range.head;
      lastPointerX = event.clientX;
      if (!range.empty) committed = true;

      if (extend) {
        return startSelection.replaceRange(
          startSelection.main.extend(range.from, range.to),
        );
      }
      if (multiple) {
        return startSelection.addRange(range);
      }
      return EditorSelection.create([range]);
    },
    update(update: ViewUpdate) {
      if (update.docChanged) {
        anchorPosition = update.changes.mapPos(anchorPosition);
        lastHead = update.changes.mapPos(lastHead);
        startSelection = startSelection.map(update.changes);
      }
    },
  };
  return style;
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm vitest run src/editor/wysiwyg/pointerSelectionStyle.test.ts`
Expected: PASS — all tests including the new `dragRangeCommitted` test.

- [ ] **Step 3: Commit**

```bash
git add src/editor/wysiwyg/pointerSelectionStyle.ts src/editor/wysiwyg/pointerSelectionStyle.test.ts
git commit -m "feat(editor): expose dragRangeCommitted flag on pointer selection style (#35)"
```

---

### Task 3: Failing tests — Y hysteresis prevents line jumps on small vertical jitter

**Files:**
- Modify: `src/editor/wysiwyg/pointerSelectionStyle.test.ts`

**Interfaces:**
- Consumes: `createPointerSelectionStyle`
- Produces: Failing test that passes after Task 4

- [ ] **Step 1: Write failing test**

```typescript
it('keeps the drag head on the current line when vertical travel is below half a line height', () => {
  const { cleanup, view } = mountEditor();
  try {
    vi.spyOn(view, 'defaultLineHeight', 'get').mockReturnValue(20);
    const style = createPointerSelectionStyle(view, {
      position: 6,
      x: 100,
      y: 20,
    });
    // Drag right past slop — on current line
    const onLine = style.get(mouseEvent(120, 20), false, false);
    // Small Y move (5 px < 10 px = half line height) — should stay on same line
    const jitter = style.get(mouseEventXY(120, 25), false, false);
    expect(jitter.main.head).toBe(onLine.main.head);
  } finally {
    cleanup();
  }
});

it('switches line when vertical travel exceeds half a line height', () => {
  const { cleanup, view } = mountEditor();
  try {
    vi.spyOn(view, 'defaultLineHeight', 'get').mockReturnValue(20);
    const hits = new Map<string, number | null>([
      ['120,20', 16],
      ['120,32', 30],  // different line
    ]);
    vi.spyOn(view, 'posAtCoords').mockImplementation((coords) => {
      return hits.get(`${coords!.x},${coords!.y}`) ?? null;
    });
    const style = createPointerSelectionStyle(view, {
      position: 6,
      x: 100,
      y: 20,
    });
    style.get(mouseEvent(120, 20), false, false);
    // Y travel = 12 px > 10 px = half line height — should allow line change
    const switched = style.get(mouseEventXY(120, 32), false, false);
    expect(switched.main.head).toBe(30);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/editor/wysiwyg/pointerSelectionStyle.test.ts`
Expected: FAIL — no Y hysteresis logic exists.

---

### Task 4: Implement Y hysteresis in `pointerSelectionRange`

**Files:**
- Modify: `src/editor/wysiwyg/pointerSelectionStyle.ts`

**Interfaces:**
- Consumes: `view.defaultLineHeight`, `view.posAtCoords`
- Produces: `stabilizeDragHead` now considers Y axis

- [ ] **Step 1: Add `lastPointerY` and `lineEntryY` tracking; update `stabilizeDragHead`**

Add `lastPointerY` to `createPointerSelectionStyle`. Add `lineEntryY` that records the Y where the current line was entered. In `pointerSelectionRange`, call `posAtCoords(coordinates, true)` instead of `posAtCoords(coordinates, false)`. In `stabilizeDragHead`, add Y hysteresis: if the new head is on a different document line and `|pointerY - lineEntryY| < defaultLineHeight / 2`, return `lastHead`.

```typescript
function stabilizeDragHead(
  view: EditorView,
  mapped: number | null,
  lastHead: number,
  lastPointerX: number,
  pointerX: number,
  lineEntryY: number,
  pointerY: number,
): { head: number; newLineEntryY: number } {
  if (mapped === null) {
    return { head: lastHead, newLineEntryY: lineEntryY };
  }

  // X-axis anti-flicker (existing)
  const pointerDelta = pointerX - lastPointerX;
  const headDelta = mapped - lastHead;
  if (pointerDelta * headDelta < 0) {
    return { head: lastHead, newLineEntryY: lineEntryY };
  }

  // Y hysteresis: if mapped is on a different line than lastHead,
  // reject unless pointer traveled >= half a line height from line entry
  const lastLine = view.state.doc.lineAt(lastHead);
  const mappedLine = view.state.doc.lineAt(mapped);
  if (lastLine.number !== mappedLine.number) {
    const threshold = view.defaultLineHeight / 2;
    if (Math.abs(pointerY - lineEntryY) < threshold) {
      return { head: lastHead, newLineEntryY: lineEntryY };
    }
    // Accepted line change — update lineEntryY
    return { head: mapped, newLineEntryY: pointerY };
  }

  return { head: mapped, newLineEntryY: lineEntryY };
}
```

- [ ] **Step 2: Update `pointerSelectionRange` to use `posAtCoords(coordinates, true)` and the new `stabilizeDragHead` signature**

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/editor/wysiwyg/pointerSelectionStyle.test.ts`
Expected: PASS — all tests including the new Y hysteresis tests.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/editor/wysiwyg/pointerSelectionStyle.ts src/editor/wysiwyg/pointerSelectionStyle.test.ts
git commit -m "fix(editor): add Y hysteresis to drag selection to prevent line jumping (#35)"
```

---

### Task 5: Failing test — settlement skips head overwrite when drag committed

**Files:**
- Modify: `src/editor/wysiwyg/markdownDecorations.test.ts`

**Interfaces:**
- Consumes: `settlePointerSelection` logic in `MarkdownDecorationsPlugin`
- Produces: Failing test that passes after Task 6

- [ ] **Step 1: Write failing test**

Write a test that simulates a drag past slop (so `dragRangeCommitted` is true) and verifies that `settlePointerSelection` does not change the selection head. The exact test structure depends on how settlement currently accesses the style; the implementer must read the current `markdownDecorations.test.ts` settlement tests and follow the pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/editor/wysiwyg/markdownDecorations.test.ts`
Expected: FAIL

---

### Task 6: Settlement reads `dragRangeCommitted` and skips head overwrite

**Files:**
- Modify: `src/editor/wysiwyg/markdownDecorations.ts`

**Interfaces:**
- Consumes: `dragRangeCommitted` from the active pointer selection style
- Produces: Settlement dispatches `settlePointerMarkdownDecorations` effect only (no selection change) when drag was committed

- [ ] **Step 1: Store a reference to the active pointer selection style in the plugin**

When `beginPointerSelection` creates the style via `createPointerSelectionStyle`, save it on the plugin instance.

- [ ] **Step 2: In `settlePointerSelection`, check `dragRangeCommitted`**

If the saved style's `dragRangeCommitted` is true AND `candidate.intent === 'caret'` AND the gesture is not a primary click (i.e., drag happened), skip the selection override and only dispatch the settlement effect.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/editor/wysiwyg/markdownDecorations.test.ts`
Expected: PASS

- [ ] **Step 4: Run full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/wysiwyg/markdownDecorations.ts src/editor/wysiwyg/markdownDecorations.test.ts
git commit -m "fix(editor): settlement skips head overwrite when drag range was committed (#35)"
```

---

### Task 7: E2E verification and version bump

**Files:**
- Modify: `tests/e2e/editor-preview-click-selection.spec.ts`
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add E2E test — drag release position matches last drag position**

In `editor-preview-click-selection.spec.ts`, add a test that drags across bold text, samples the selection at a mid-drag point, then compares with the selection after release. They must agree.

- [ ] **Step 2: Run E2E**

Run: `pnpm test:e2e -- editor-preview-click-selection`
Expected: PASS

- [ ] **Step 3: Bump version `0.3.59` → `0.3.60`**

Update `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.

- [ ] **Step 4: Run full quality gate**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix(editor): drag selection accuracy and vertical sensitivity (#35)

Closes #35."
```
