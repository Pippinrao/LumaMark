> 语言：**中文** · [English](../../decisions/0021-adaptive-document-width-and-block-breakout.md)

# ADR 0021：自适应文档宽度与宽块越界

**状态：** 已接受

**日期：** 2026-08-21

## 背景

固定的 `standard`（810px）页面宽度会在宽屏上把图片、Mermaid、PlantUML 压得过小，日常表格也会溢出写作栏，让 `.cm-scroller` 出现横向滚动条。该滚动条同时还是点击→光标几何的风险源。用户要求把自适应作为默认，并先评估对输入性能的影响。

## 决策

- 新增 `adaptive` 页面宽度：正文列为 `clamp(720px, 70%, 1100px)`，仍套在现有安全 gutter 的 `min()` 里。
- 将其设为新默认。设置 schema 第 4 版会在升级时把旧的 `standard` 改写为 `adaptive`。明确选过的 `narrow`、`wide`、`fluid`，以及之后再次明确选择的 `standard` 予以保留。
- 默认页面宽度已不再是 `adaptive`。ADR 0022 把 `fluid`（适应窗口）设为默认；设置 schema 第 5 版会把旧的 `adaptive` 改写为 `fluid`。`adaptive` 预设本身仍可用，CSS 不变。
- 由 CodeMirror view plugin 观察 `view.scrollDOM`，把 `clientWidth - gutter` 量化为整数 px，写入 `--lm-editor-block-track-width`，仅在值变化时写入。
- 表格、Mermaid、PlantUML、图片使用该轨道（较窄时居中）。数学公式与围栏代码仍留在正文列，因为 MathJax CHTML 会在内容宽度变化时重新渲染。
- 后续轨道宽度变化后强制 CodeMirror `mustMeasureContent`，以便未注册进 `blockWidgetGeometry` 的表格 widget 刷新高度图。编辑器构造时的首次发布不整页重测：CodeMirror 第一次布局已经会测量 widget。ResizeObserver 回调合并到同一帧，避免打开多表格文件时叠满重测。
- `.tbl-table-widget` 使用写作轨道宽，并设 `min-width: min-content`，保留库的 `contain: paint`。长单元格文本仍在轨道处折行。无法再压缩的宽表会撑开 widget，paint containment 就不会裁切。不要改成 `width: max-content`（单元格不再折行），也不要关闭 paint containment（即使页面宽度不是自适应，打开多表格也会卡住）。

## 被否决方案

- **在 `.lm-editor-paper` 上使用 `container-type: inline-size`：** 纯 CSS，但 `contain: layout` 会让该元素成为 fixed 定位子孙（CodeMirror panels、表格菜单）的包含块，且无法计入滚动条宽度。
- **把现有 `fluid`（100%）当作新默认：** 宽屏上正文行会过长。
- **给表格/图片加内层滚动或 `max-width` 裁剪：** 被 `AGENTS.md` 中的表格/widget 几何契约禁止。

## 影响

- 新安装以及从未改过、仍为 `standard` 的配置会得到更宽的正文列和越界宽块。
- 曾明确选择 `standard` 的用户无法与从未改过的用户区分，因此会被迁移；他们可以再选回「标准」。
- 侧栏自适应仍独立（见 ADR 0011）。自适应页面宽度不改变侧栏测量。
- 纸张宽度 CSS 只能打在 `.lm-codemirror > .cm-editor > .cm-scroller > .cm-content`。嵌套表格单元格编辑器也在 `.lm-codemirror` 下，不得继承 96px gutter 或纸张 padding。
- 表格库会在单元格之间复用同一个嵌套 `EditorView`。连续点击必须在捕获阶段记下坐标，并在布局后再映射到该视图；一次性 “已经 apply 过” 不够。
- 表格 widget 使用写作轨道宽（`width: 轨道; min-width: min-content`），从而可以保留库的 `contain: paint`。只覆盖内层 `overflow-x: auto`；不再关闭 paint containment。

## 回滚与复审条件

- 混合文档输入 P80 超出既有 8 ms 门禁，32 张日常 GFM 表格文件打开 P80 超过 300 ms（自适应或标准宽度），或安装包 UX 卡顿门禁在自适应默认下滚动 longtask P95/max 超过 50 ms。
- 窗格缩放后表格下方的点击→光标映射失败（高度图未跟上越界）。
- 不先失焦的连续 GFM 单元格点击偏离半个字形预算。
- 若后续证明 MathJax 足够便宜，可再评估是否让数学块加入越界。

装机 OS 鼠标门禁（`pnpm release:packaged-table-caret`、`pnpm release:installed-media-caret-os`、`pnpm release:installed-ux-stutter`）在自适应为默认时仍须在 Windows 上跑过。Linux agent 只能跳过或失败这些脚本，不得视为已关闭该复审条件。
