> Language: **English** · [中文](../zh/product/PRODUCT_STRATEGY.md)

# Product Positioning and Strategy

## Product positioning

LumaMark is a modern desktop editor for people who write Markdown frequently.

It does not try to become “the collection of every document tool” from day one. It first aims to be a Typora-like Markdown editor that is fast enough, beautiful enough, and trustworthy enough.

## Core promises

LumaMark promises users that:

- Your Markdown files will not be silently corrupted by the editor.
- Large documents should still be comfortable to write in.
- Complex content such as Mermaid should not slow typing.
- The UI should serve writing instead of stealing attention.
- Chinese and English users should receive equal-class experience.

## Battlefield choice

The first battlefield is not plugin ecosystems or cloud sync. It is:

> The world’s smoothest, most beautiful, and most fidelity-preserving Typora-like Markdown editing experience.

That battlefield is narrow enough, and valuable enough.

## User value

### For Typora users

LumaMark should offer a familiar alternative that is more modern and smoother.

Key migration motives:

- Better large-document performance.
- A more transparent source-fidelity strategy.
- A more modern UI.
- Stronger workspace and search.
- Better Mermaid and async rendering experience.

### For MarkText users

LumaMark should offer a more stable, less stuttery, more trustworthy open-source direction.

Key migration motives:

- Avoid historical performance debt.
- Avoid source round-trip risk.
- Avoid the long-term cost of a hand-rolled editor.
- Clearer quality gates and evolution strategy.

### For Obsidian users

LumaMark does not compete head-on with knowledge-base ecosystems in phase one.

Attractors:

- Purer single-document WYSIWYG writing.
- Visual and input experience closer to Typora.
- Stronger focus on the Markdown file itself.

### For Zettlr users

LumaMark does not compete head-on with academic publishing suites in phase one.

Attractors:

- Lighter weight.
- More modern.
- Smoother WYSIWYG writing experience.

## Product principles

### Recreate first

V1 first aligns with Typora-like patterns users already understand, lowering learning cost.

Layout first recreates the mature paradigm as closely as practical:

- Central editing area.
- Hideable sidebar.
- Outline and file tree as assistants.
- Restrained top chrome.
- Writing-first, not a marketing-style first screen.

### Performance first

Performance is not merely a technical metric; it is product experience.

Long-term attention is required for:

- Startup speed.
- File open speed.
- Input latency.
- Scroll smoothness.
- Memory use.
- Mermaid render blocking.
- Save reliability.

### Source fidelity

Markdown files are user assets.

LumaMark must not casually rearrange text, delete blank lines, change indentation, or reformat unedited regions because of WYSIWYG behavior.

### Multilingual by design

Multilingual support is not a late patch.

From day one:

- Chinese and English copy are maintained in sync.
- All user-visible strings go through i18n.
- Translation fragments are not concatenated.
- Settings, menus, tooltips, and error messages are all localizable.

### Mature components first

LumaMark’s custom-build budget is spent only on differentiating capabilities:

- Typora-like editing experience.
- Large-document fluency.
- Source fidelity.
- Async render scheduling.
- Performance observability.

Menus, dialogs, trees, tabs, virtual lists, tooltips, command palettes, and similar basics prefer mature libraries.

## Differentiation

LumaMark should ultimately form five differentiating capabilities:

1. **High-performance editing core**: based on CodeMirror 6, avoiding full-document DOM and rich-text AST as the primary store.
2. **Source fidelity**: opening, editing, and saving do not produce unrelated diffs.
3. **Async block rendering**: Mermaid, math, images, and export preview do not block typing.
4. **Modern desktop experience**: Tauri + React deliver a lightweight, quiet, beautiful UI.
5. **AI-native quality system**: AI writes code, but tests, benchmarks, review, and CI guarantee quality.

## Brand character

LumaMark should feel:

- Clear and bright.
- Quiet.
- Refined.
- Reliable.
- Light and quick.
- Professional.

Avoid:

- Heavy tool aesthetic.
- Over-decoration.
- Flashy animation.
- IDE-like pressure.
- Feature-stacked complex UI.
