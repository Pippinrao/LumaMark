# V1 版本设计

> **历史状态（Alpha 基线）：** 本文冻结为 Foundation / MarkText+ 阶段的产品与架构切片记录，不再作为当前执行计划，也不根据后续实现追溯改写完成状态。当前范围、顺序与退出门禁见 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。

日期：2026-07-05

## 版本口径

LumaMark V1 是第一版可日常试用的 Typora-like Markdown 编辑器基线。

V1 的目标不是一次性达到商业级完整 1.0，也不是完整复刻 Typora 的全部细节，而是完成一个稳定、流畅、可信的最小产品闭环：

> 打开 Markdown，顺畅编辑，看到基础 WYSIWYG，使用 Mermaid，保存不破坏源码，在 Windows 上稳定运行，并内建中文和英文。

V1 对外可以理解为 **MarkText+ / Alpha-to-Beta 基线版本**：先在流畅度、现代感、源码保真和工程质量上赢过 MarkText，再为后续追平 Typora 打基础。

## 设计目标

V1 必须达成五个目标：

1. **可写**：用户能完成新建、打开、编辑、保存 Markdown 的完整闭环。
2. **流畅**：常规输入、滚动、打开文件、保存文件没有明显卡顿。
3. **可信**：保存不会产生无关 diff，不破坏用户源码格式。
4. **像 Typora**：布局、视觉和基础 WYSIWYG 行为对齐成熟 Typora-like 范式。
5. **可演进**：架构、测试、i18n、性能基准和模块边界能支撑后续扩展。

## 成功标准

V1 成功不以功能数量判断，而以核心体验判断。

最低成功标准：

- Windows 开发构建和安装包可用。
- 用户能打开、编辑、保存 `.md` 文件。
- 基础 Markdown 语法有 WYSIWYG 视觉反馈。
- Mermaid fenced block 能异步渲染。
- 1MB 和 5MB 文档编辑流畅。
- 10MB 文档不冻结。
- 保存后无关 diff 为 0。
- 中文和英文界面可切换。
- 关键路径有自动化测试和 E2E 覆盖。

## V1 用户体验

V1 前台 UX 以 [V1 UX 设计](V1_UX_DESIGN.md) 为准。若本文件中的布局描述与 UX 设计冲突，以 UX 设计为准。

### 默认界面

V1 首屏直接进入编辑器，不做营销页。

默认布局：

```text
┌──────────────────────────────────────────────────────────────┐
│ 文件  编辑  段落  格式  视图  主题  帮助                       │
├───────────────┬──────────────────────────────────────────────┤
│ 文件 / 大纲    │ Markdown 编辑区                              │
│ 可切换         │ 内容居中，文档是视觉焦点                      │
└──────────────────────────────────────────────────────────────┘
```

V1 的布局要求：

- 编辑区是视觉中心。
- 左侧侧栏默认承载文件树和大纲 tab。
- 文件树和大纲不能同时作为两列常驻。
- 顶部是菜单栏，不是厚重 toolbar。
- 状态栏只显示必要信息，不抢注意力。

### 写作体验

编辑区应呈现安静、现代、专业的写作界面。

行为原则：

- 光标所在块可以显示必要 Markdown 源码符号。
- 非光标区域优先呈现阅读态效果。
- 用户明确编辑时，不阻止其看到和修改源码。
- WYSIWYG 是视觉层，不是源文替换。
- 所有编辑动作都必须可撤销。

### 文件体验

V1 支持两种入口：

- 打开单个 Markdown 文件。
- 打开工作区目录。

文件树用于浏览工作区内 Markdown 文件，不在 V1 做复杂项目管理。

必须支持：

- 打开文件。
- 保存文件。
- 另存为。
- 最近文件。
- dirty 状态。
- 文件读写错误提示。

### Mermaid 体验

V1 支持 Mermaid fenced block：

```markdown
```mermaid
flowchart TD
  A --> B
```
```

显示策略：

- 停止输入或光标离开 Mermaid block 后显示预览。
- 光标进入 Mermaid block 时允许源码编辑。
- 渲染中显示轻量 loading 状态。
- 渲染失败显示错误卡片和源码入口。
- Mermaid 渲染不阻塞输入。

## V1 功能范围

### P0：必须完成

P0 是 V1 不可缺少的能力。

- Tauri + React + TypeScript 应用骨架。
- CodeMirror 6 主编辑器。
- i18n：简体中文和英文。
- 亮色和暗色主题。
- 打开 `.md` 文件。
- 保存当前文件。
- 另存为。
- dirty 状态。
- 基础 Markdown WYSIWYG：
  - 标题。
  - 粗体。
  - 斜体。
  - 删除线。
  - 引用。
  - 有序列表。
  - 无序列表。
  - 任务列表。
  - 行内代码。
  - 代码块。
- Mermaid fenced block 检测和异步渲染。
- Markdown round-trip fixture 测试。
- 基础性能 benchmark。
- 基础 E2E。

### P1：应完成

P1 是让 V1 更像真实产品的能力。

- 工作区目录打开。
- 文件树。
- 最近文件。
- 大纲。
- 命令面板。
- 基础快捷键。
- 基础设置页。
- 图片引用基础展示。
- Markdown 链接基础展示。
- 文件读写错误恢复。
- Windows 安装包。

### P2：可延后

P2 不阻塞 V1，但应为后续预留边界。

- 表格编辑体验。
- 数学公式。
- PDF/HTML 导出。
- 全文搜索索引。
- 自动保存和崩溃恢复。
- 自动更新。
- 复杂主题市场。
- 插件系统。
- AI 写作助手。

## Markdown WYSIWYG 设计

V1 的 WYSIWYG 不做富文本主存储。

默认方案：

- CodeMirror 文本模型保存 Markdown 源文。
- Markdown 语法树用于识别语法区域。
- decorations 负责基础视觉效果。
- widgets 负责 Mermaid 等复杂块。
- 命令层只修改用户明确操作的文本范围。

### 基础语法策略

标题：

- `#` 符号在非编辑状态下弱化或隐藏。
- 标题文本使用分级字号和字重。
- 光标进入标题行时源码符号可见。

粗体和斜体：

- `**`、`*` 等标记在非编辑状态下弱化或隐藏。
- 文本应用对应样式。
- 光标进入范围时允许直接编辑标记。

列表：

- 保留 Markdown 源文结构。
- 视觉上优化 marker、缩进和任务 checkbox。
- checkbox 的点击可以修改 `[ ]` / `[x]` 源文。

代码：

- 行内代码显示为 inline code 样式。
- 代码块保留语言信息。
- 代码块内不做 WYSIWYG 隐藏，优先保证源码编辑稳定。

引用：

- `>` 可弱化。
- 左侧显示引用线。

### Mermaid 策略

Mermaid 使用 widget 层。

要求：

- 源码可编辑。
- 预览可显示。
- 渲染任务可取消。
- 缓存可命中。
- 错误可恢复。

V1 不做 Mermaid 可视化编辑器。

## 应用架构切片

V1 实现应按垂直切片推进。

### Slice 1：应用骨架

目标：应用能启动，并显示空编辑器。

包含：

- Tauri。
- React。
- TypeScript strict。
- Vite。
- 基础样式。
- i18n provider。
- theme provider。

验收：

- 应用启动。
- 中英文切换可用。
- 明暗主题切换可用。
- 无硬编码用户可见文案。

### Slice 2：编辑器核心

目标：CodeMirror 成为唯一主编辑器核心。

包含：

- EditorState / EditorView 初始化。
- Markdown language support。
- 基础主题适配。
- dirty 状态事件。
- 编辑器 API。

验收：

- 可输入 Markdown。
- React store 不持有全文。
- 输入不触发全局重渲染。

### Slice 3：文件闭环

目标：打开、编辑、保存文件。

包含：

- Tauri command wrapper。
- Rust 文件读写。
- 打开文件。
- 保存文件。
- 另存为。
- 最近文件。
- 错误模型。

验收：

- 打开 fixture 文件。
- 保存后无关 diff 为 0。
- 写入失败保留 dirty 状态。

### Slice 4：基础 WYSIWYG

目标：基础 Markdown 视觉层可用。

包含：

- 标题 decoration。
- 粗体/斜体/删除线 decoration。
- 引用 decoration。
- 列表和任务列表 decoration。
- 行内代码和代码块样式。

验收：

- 每种语法都有 fixture。
- 光标进入范围后可编辑源码。
- 撤销重做正常。

### Slice 5：Mermaid

目标：Mermaid 异步预览可用。

包含：

- Mermaid block 检测。
- render job scheduler。
- Mermaid 动态加载。
- 缓存。
- 错误状态。

验收：

- Mermaid 渲染不阻塞输入。
- 修改源码后旧任务不会覆盖新结果。
- 错误 Mermaid 不影响编辑器。

### Slice 6：产品外壳

目标：V1 像一个真实桌面应用。

包含：

- 文件树。
- 大纲。
- 命令面板。
- 基础设置。
- 状态栏。
- Windows 打包。

验收：

- 用户能通过 UI 完成主要路径。
- E2E 覆盖打开、编辑、保存、Mermaid、语言切换、主题切换。

## 状态和数据设计

### App Store

V1 store 保存：

- 当前语言。
- 当前主题。
- 当前文件路径。
- dirty 状态。
- 最近文件。
- 当前工作区。
- 文件树展开状态。
- 命令面板打开状态。
- 设置。

V1 store 不保存：

- Markdown 全文。
- 每次输入内容。
- Mermaid SVG 大对象。
- CodeMirror 内部 selection。

### Editor API

编辑器对外暴露：

- `loadDocument(text, metadata)`。
- `getDocumentText()`。
- `focus()`。
- `saveSnapshot()`。
- `dispatchCommand(command)`。
- `subscribeEditorEvents(listener)`。

这些是概念接口，具体命名在实现计划中确定。

### Rust Commands

V1 需要的 command：

- `files.read_text`。
- `files.write_text`。
- `files.save_text_as`。
- `files.show_open_file_dialog`。
- `files.show_save_file_dialog`。
- `workspace.open_directory`。
- `workspace.list_children`。
- `app.get_system_info`。

所有 command 必须通过 TypeScript wrapper 调用。

## UI 组件选型

V1 默认使用成熟组件。

默认：

- Radix Primitives：dialog、tooltip、menu、tabs、switch 等。
- lucide-react：图标。
- react-resizable-panels：侧边栏分栏候选。
- react-arborist：文件树候选。
- cmdk：命令面板候选。
- TanStack Virtual：长列表候选。
- i18next/react-i18next：多语言。

候选组件在进入实现前必须做小样验证。验证失败时先寻找成熟替代，不直接自研。

## 质量设计

V1 必须从第一天建立自动化验证。

### 必备测试

- 单元测试：纯逻辑、缓存 key、i18n key、路径处理。
- 编辑器集成测试：Markdown decoration、命令、保存源码保真。
- Fixture 测试：open -> save -> diff。
- E2E：启动、打开、输入、保存、语言切换、主题切换、Mermaid。
- 性能 benchmark：打开文件、输入延迟、Mermaid 渲染、保存。

### Fixture 集

V1 至少包含：

- `basic.md`
- `headings.md`
- `emphasis.md`
- `lists.md`
- `task-list.md`
- `blockquote.md`
- `code-blocks.md`
- `links-images.md`
- `mermaid.md`
- `mixed-chinese-english.md`
- `large-1mb.md`
- `large-5mb.md`
- `large-10mb.md`

## V1 性能预算

初始目标：

- 1MB Markdown 打开时间小于 300ms。
- 5MB Markdown 打开时间小于 1s。
- 10MB Markdown 可编辑且不冻结。
- 普通输入延迟尽量低于 16ms。
- 滚动接近 60 FPS。
- Mermaid 渲染不阻塞输入。
- 保存前后无关 diff 为 0。

这些指标允许在真实基准建立后调整，但不能取消。

## 发布形态

V1 优先 Windows。

V1 最低发布形态：

- Windows 开发构建。
- Windows 安装包。
- 默认中文和英文界面。
- 本地文件读写。
- 不依赖云服务。

macOS 和 Linux 保持架构兼容，但 V1 不承诺同等打磨。

## 非目标

V1 不做：

- 完整插件系统。
- 云同步。
- 多人协作。
- 移动端。
- 类 Notion 数据库。
- 学术写作全家桶。
- AI 写作助手。
- 完整导出系统。
- 复杂表格编辑器。

## 主要风险和应对

### WYSIWYG 细节失控

风险：Markdown 行为很多，一次做太多会引入大量交互 bug。

应对：

- 按语法逐个切片实现。
- 每种语法都有 fixture 和 E2E。
- 光标、撤销、IME、粘贴作为固定检查项。

### Mermaid 卡顿

风险：Mermaid 渲染同步执行导致输入卡顿。

应对：

- 动态加载。
- debounce。
- 缓存。
- 取消过期任务。
- 渲染失败隔离。

### 源码保真破坏

风险：WYSIWYG 或保存逻辑改写用户未编辑区域。

应对：

- 源文本为唯一真实数据。
- fixture round-trip。
- 不做全局格式化。
- 保存失败时不清 dirty。

### UI 组件自研膨胀

风险：为了追求掌控感手搓文件树、命令面板、分栏等基础组件。

应对：

- 成熟组件优先。
- 候选组件小样验证。
- 自研必须有证据并经用户确认。

## V1 完成定义

V1 只有在以下条件都满足时才算完成：

- P0 全部完成。
- P1 中除 Windows 安装包外的核心体验完成，若安装包延后必须明确说明。
- 打开、编辑、保存、Mermaid、语言切换、主题切换有 E2E。
- fixture round-trip 无无关 diff。
- 大文档不冻结。
- Mermaid 不阻塞输入。
- 中文和英文文案覆盖完整。
- 没有已知数据损坏风险。
- 关键技术债务记录在文档中。
