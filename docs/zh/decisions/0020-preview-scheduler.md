> 语言：**中文** · [English](../../decisions/0020-preview-scheduler.md)

# ADR 0020：实时预览 decoration 的 preview scheduler

**状态：** 已采纳

**日期：** 2026-08-19

## 背景

实时预览此前在处理输入、拖拽选区和滚动的同一条 CodeMirror transaction 上同步重建 WYSIWYG decoration，因而付上完整插件 `update()` 栈的成本。安装包 0.3.31 证据显示混合文档滚动产生 10 次 long task（最长 165 ms）。单独削减各插件 `update()` 并没有解开这种耦合。

## 决策

- 在 editor 层增加 preview scheduler（`src/editor/preview/previewScheduler.ts`）。
- 源码、光标和选区仍走同步 CodeMirror update。
- 视口驱动的 WYSIWYG decoration 重建等待一帧合并后的 preview pass（约 6–8 ms 预算）。后续用户手势取消挂起的帧并重新调度。
- 块 widget（表格、数学、Mermaid、PlantUML、图片）继续使用 `blockWidgetGeometry.ts` 的预留高度，避免 pass 挂起期间 click→caret 漂移。
- 不以关闭这些 widget 换取流畅，也不把 jsdom 两帧 rAF 时长当作已安装 UX 证据。

## 被否决的方案

- **第四轮按插件削减 `update()`：** 已对安装包 long task 失败三次。
- **在 `viewportChanged` 上同步重建 decoration：** 实现最便宜；日常 GFM 表格挂载后会把表格 widget 放回滚动路径。
- **自研表格网格以避开滚动路径上的库：** 违反成熟组件优先，也无法修复数学/Mermaid。

## 影响

- 新进入视口的范围可能晚一帧才出现标题/强调标记。
- 安装包卡顿门禁必须在手势期间采样 `longtask`，并要求日常表格 widget，而不是 `scrollTop += 280` 后等两帧 rAF。

## 回滚或复审条件

- 延迟 widget 高度后 click→caret 几何漂移（见 `AGENTS.md` 表格/媒体规则）。
- 普通输入时 preview 标记缺失超过一帧。
- 上游 CodeMirror 提供可替换本插件的一等 decoration scheduler。
