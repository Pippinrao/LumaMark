> 语言：**中文** · [English](../../architecture/ARCHITECTURE_STRATEGY.md)

# 架构策略

详细模块边界、数据流和技术选型见 [详细架构设计与技术选型](DETAILED_ARCHITECTURE.md)。本文件只保留高层原则。Parity Reliability 的共享交互、源码格式与单主编辑器合同见 [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md)。

## 架构目标

LumaMark 的架构必须同时服务三个目标：

1. 高性能。
2. 现代化美观界面。
3. 轻量流畅体验。

这三个目标不能互相牺牲。架构选择必须让它们天然成立，而不是靠后期补丁。

## 总体架构

```text
Tauri 桌面壳
├─ React App Shell：布局、侧边栏、设置、命令面板、文件树
├─ CodeMirror 6 Editor：Markdown 源文本、输入、选区、撤销、WYSIWYG decorations
├─ Async Render Layer：Mermaid、公式、图片、导出预览、缓存
├─ Rust Core：文件 IO、搜索、索引、缓存、系统集成、重任务调度
└─ i18n / Theme / Settings：从第一天内建
```

核心原则：

> React 负责应用外壳，CodeMirror 6 独占编辑热路径，Rust 负责系统和重任务，成熟组件库负责 UI 行为。

## 技术选择

### Tauri

选择 Tauri 作为桌面壳。

原因：

- 轻量。
- 使用系统 WebView。
- Rust 适合系统能力和重任务。
- 天然支持 Windows、macOS、Linux。
- 与现代前端框架组合简单。

边界：

- 不把所有逻辑都迁移到 Rust。
- Rust 只承担明确有收益的工作。
- 前端和 Rust 之间通过清晰 command 边界通信。

### React + TypeScript

选择 React 构建应用外壳。

负责：

- 布局。
- 面板。
- 设置。
- 文件树。
- 大纲。
- 命令面板。
- 主题。
- i18n。

边界：

- React 不参与逐字符输入。
- shell 渲染组件只消费 view model、labels、callbacks 和 slots，不直接调用业务 workflow、store、service 或 editor command。
- 业务行为进入 feature workflow、app controller 或 service facade，不能堆进 JSX 组件。
- 不把每个 Markdown 块都变成 React component。
- 不把每次输入同步到全局 React state 再渲染。
- React 只订阅必要的轻量状态，例如当前文件、dirty 状态、outline、选区摘要。

### CodeMirror 6

选择 CodeMirror 6 作为主编辑器核心。

原因：

- 高性能文本模型。
- 适合大文档。
- 支持增量解析。
- 支持 decorations/widgets。
- 可实现 Typora-like 的 Markdown 视觉层。
- Markdown 源文可以保持为主数据。

负责：

- 文本文档。
- 输入。
- 光标。
- 选区。
- 撤销和重做。
- 基础语法高亮。
- Markdown WYSIWYG decorations。
- Mermaid 等块级 widget 的挂载点。
- `EditorInteractionContext` 和 `DocumentSourceFormat` 等与正文同步映射的编辑器状态。

边界：

- 不用富文本 AST 作为主存储。
- 不绕过 CodeMirror 自己实现光标、选区和输入。
- 不在 CodeMirror 外层硬套虚拟滚动。
- 不为 Mermaid 或其他复杂块创建持有待提交正文、选区或独立 undo 栈的第二个 `EditorView`。

### Rust Core

Rust 负责系统能力和性能敏感后台任务。

适合放到 Rust 的能力：

- 文件读写。
- 文件监听。
- 工作区索引。
- 全文搜索。
- 缓存管理。
- 导出流程。
- 大文件预处理。
- 性能敏感解析或调度。

不适合放到 Rust 的能力：

- 普通 UI 状态。
- 简单组件交互。
- 无性能压力的轻量逻辑。
- 只是为了“更底层”而迁移的功能。

## WYSIWYG 策略

LumaMark 不采用“富文本 AST 主存储 -> 保存时 stringify Markdown”的路线。

默认策略：

- Markdown 源文件是 source of truth。
- CodeMirror 文本模型持有源文。
- CodeMirror 内部规范化 `Text`，同时映射 BOM、末尾换行和逐行换行格式；保存边界精确序列化。
- Lezer/Markdown parser 生成语法信息。
- decorations 隐藏或弱化 Markdown 符号。
- widgets 渲染 Mermaid、公式、图片预览等复杂块。
- 保存直接基于 editor snapshot；受控转换只能产生必要的最小 changes，不能静默全文件归一化。

这种策略可以降低源码保真风险。

## Editor Capability 策略

Mermaid、表格、代码块、图片等复杂编辑器子功能按 Editor Capability 独立演进。

默认边界：

- 每个复杂能力有独立 `editor/capabilities/<name>/` 目录和薄 public entry。
- `editor/core` 只消费 capability 聚合入口，不直接 import Mermaid、table、image、code-block 内部实现。
- `editor/commands` 只通过 capability command factory 调用复杂能力，不知道 widget、DOM 或第三方库路径。
- `editor/widgets/*` 只作为旧路径兼容 re-export，不承载新实现。
- 通用 `editor/wysiwyg` 只负责低成本、源码保真的视觉规则和 capability decoration 组合，不承担异步渲染、文件路径解析、block widget lifecycle 或能力专属命令。

当前仍需警惕的混杂点：

- image capability 的检测、路径解析和 DOM 仍在一个文件里，继续增长前必须拆分。
- 表格源码视觉 class 仍在通用 WYSIWYG，若扩展为表格专属视觉行为应迁回 table capability。
- 任务列表目前仍属于通用列表/WYSIWYG 行为，若变成独立交互能力应抽成 list 或 task-list capability。

## Mermaid 策略

Mermaid 是高性能风险点，必须异步。

要求：

- 识别 fenced code block。
- 激活块时在主 `EditorView` 中显示围栏源码，预览置于块下方；编辑立即进入统一 undo 栈。
- 不在输入同步路径渲染。
- 使用任务队列。
- 支持取消过期任务。
- 支持缓存。
- 渲染错误可视化展示。

缓存 key 至少包含：

- Mermaid 源码。
- Mermaid 版本。
- Mermaid 配置。
- 当前主题。

## UI 组件策略

成熟组件优先。

优先选择：

- Radix UI / Ariakit / 同等级 headless 组件。
- lucide-react 或同等级图标库。
- TanStack Virtual 或同等级虚拟化库。
- i18next 或同等级 i18n 方案。

LumaMark 自己负责：

- 设计 token。
- 主题风格。
- 组件组合。
- 编辑器专属交互。

不自己手搓：

- 菜单。
- 对话框。
- tooltip。
- tab。
- split pane。
- 树组件。
- 命令面板。
- 虚拟列表。
- 快捷键系统。

除非有证据证明成熟组件无法达成目标，并且用户明确批准。

## 性能策略

性能从架构阶段开始设计。

热路径：

- 输入。
- 光标和选区。
- 滚动。
- 语法装饰。
- 保存。

热路径必须尽可能留在 CodeMirror 或浏览器高效机制中。

冷路径或后台路径：

- Mermaid。
- 搜索。
- 导出。
- 大纲生成。
- 文件索引。
- 图片处理。

这些路径应异步、可取消、可缓存。

## 反模式

禁止以下方向：

- 用 ProseMirror/Milkdown 作为主编辑核心，除非新的验证证明它更符合目标。
- 用富文本 AST 作为 Markdown 主存储。
- 自研基础 UI 组件。
- 让 AppShell、controller 或 feature component 变成跨功能总控。
- 让 `editor/capabilities/index.ts` 或 `wysiwyg/markdownDecorations.ts` 变成新的编辑器能力总控。
- 让某个 editor capability 反向依赖 app、feature、service 层。
- 在渲染组件里直接 import store、service、workflow、Tauri wrapper 或编辑器命令。
- React 逐字符重渲染编辑器。
- Mermaid 同步渲染。
- 保存时格式化整个文档。
- 先堆功能再补性能。
- 缺少 benchmark 就判断“足够流畅”。

## 架构验收

每次重大架构改动都必须回答：

- 是否保护 Markdown 源码保真？
- 是否影响输入延迟？
- 是否影响滚动流畅度？
- 是否增加 React 热路径渲染？
- 是否有成熟组件可用？
- 是否影响 i18n？
- 是否有自动化验证？
- 是否有性能基准？
