# 竞品策略与历史债务

> **当前阶段更新（2026-07-27）：** Foundation / MarkText+ 已形成 Alpha 技术基线，当前不是继续堆专题 P0，而是按“薄内核 + 代表切片”收敛 Parity Reliability。实施顺序和退出门禁统一见 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。

## 总体判断

LumaMark 的竞品策略不是简单复制现有工具，而是吸收成熟体验，避开历史债务。

第一阶段对标 Typora 的核心写作体验，快速超过 MarkText 的流畅性和可信度。

## MarkText 债务与避坑

MarkText 的方向证明了开源 Typora-like Markdown 编辑器有需求，但它也暴露了几个必须避开的长期债务。

### 1. 文档模型债务

风险：如果内部频繁以完整字符串表示文档，并在编辑时反复 parse、render、serialize，大文档会产生大量 CPU 和内存压力。

LumaMark 策略：

- 使用 CodeMirror 6 管理编辑文档和增量更新。
- 不在每次输入时处理完整 Markdown 字符串。
- 派生数据异步计算，不能阻塞输入。

### 2. 源码保真债务

风险：如果 WYSIWYG 的内部表示是主数据，保存时再 stringify 成 Markdown，容易产生打开即改写、空行丢失、缩进变化、未编辑区域被格式化等问题。

LumaMark 策略：

- Markdown 源文件是唯一真实数据。
- AST、outline、Mermaid 预览都是派生数据。
- 保存逻辑必须通过 fixture round-trip 测试。
- 未编辑区域不能被重排。

### 3. 自研编辑器债务

风险：完整自研编辑器会快速吞掉团队精力，包括输入法、光标、选区、撤销、粘贴、拖拽、可访问性和大文档性能。

LumaMark 策略：

- 主编辑器核心使用 CodeMirror 6。
- 自研只集中在 Typora-like Markdown 行为和性能调度。
- 基础编辑能力不手搓。

### 4. Parser fork 债务

风险：fork Markdown parser 后需要长期追随标准和生态，维护成本高。

LumaMark 策略：

- 优先使用成熟 Markdown/语法生态。
- 不轻易 fork parser。
- 如果必须扩展，先写决策记录和测试。

### 5. 大文档和复杂块卡顿

风险：Mermaid、公式、代码高亮、大纲、搜索等高成本任务如果同步运行，会造成输入和滚动卡顿。

LumaMark 策略：

- Mermaid 异步、可取消、可缓存。
- 大纲和搜索增量或后台计算。
- React 不参与逐字符编辑渲染。
- 建立大文档性能基准。

## Typora 基线与超越策略

Typora 是 LumaMark 第一阶段最重要的体验基线。

**行为细节**（语法表面、阅读态/编辑态、输入路径、源码落盘、对齐表）以 [Typora 行为基线文档集](typora-baseline/README.md) 为准；本文件只保留战略判断与节奏，不重复逐条行为事实。

Typora 的强项：

- 阅读和写作一体。
- Markdown 符号隐藏自然。
- 单文档编辑体验安静。
- 常用输入动作打磨细。
- UI 克制。

LumaMark 需要先追平：

- 常用 Markdown 输入体验。
- 标题、列表、引用、代码块、表格、图片、链接。
- Mermaid 和公式。
- 大纲。
- 导出。
- 快捷键和设置。

LumaMark 超越 Typora 的方向：

- 大文档更流畅。
- 源码保真更透明。
- 工作区、搜索和命令面板更现代。
- 异步渲染更稳定。
- 多语言从第一天内建。
- AI 原生质量体系更强。

## Obsidian 和 Zettlr

Obsidian 强在知识库、插件、链接网络和生态。LumaMark 第一阶段不和它正面竞争生态。

Zettlr 强在学术写作和发布流程。LumaMark 第一阶段不和它正面竞争学术套件。

LumaMark 的第一战场保持清晰：

> 做世界上最流畅、最美观、最保真的 Typora-like Markdown 编辑器。

## 竞争节奏

### 快速超过 MarkText

目标：

- 更流畅。
- 更现代。
- 更少历史包袱。
- 更可信的源码保存。
- 更清晰的维护和测试流程。

关键能力：

- CodeMirror 6 主编辑核心。
- Tauri 轻量桌面壳。
- Markdown round-trip 测试。
- Mermaid 异步渲染。
- 性能基准。

### 追平 Typora

目标：

- Typora 用户能迁移。
- 常用写作路径无明显缺口。
- 输入动作自然。

关键能力：

- 完整 Markdown 基础语法。
- 表格和图片体验。
- 公式。
- 导出。
- 快捷键和设置。
- 主题。

### 超过 Typora

目标：

- 用户不是因为“替代”，而是因为“更好”选择 LumaMark。

关键能力：

- 大文档第一。
- 源码保真第一。
- 异步复杂块渲染第一。
- 现代工作区体验。
- 质量和性能观测内建。
