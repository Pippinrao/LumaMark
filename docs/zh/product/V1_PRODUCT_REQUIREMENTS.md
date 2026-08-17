> 语言：**中文** · [English](../../product/V1_PRODUCT_REQUIREMENTS.md)

# V1 产品需求

> **历史状态（Alpha 基线）：** 本文保留 Foundation / MarkText+ 阶段的 V1 范围与验收口径，不再作为当前执行计划，也不据后续实现追溯改写完成状态。当前范围、顺序和退出门禁见 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。

## V1 目标

V1 的目标是做出一个可日常使用的 Typora-like Markdown 编辑器。

V1 不追求功能最多，而追求核心写作路径稳定、流畅、可信。

用户应该能够：

1. 打开 Markdown 文件。
2. 顺畅编辑。
3. 使用常见 Markdown 语法。
4. 看到 WYSIWYG 效果。
5. 使用 Mermaid。
6. 保存文件且不产生无关源码变化。
7. 在中文和英文界面之间切换。

## V1 核心范围

### 编辑器

必须支持：

- 标题
- 粗体
- 斜体
- 删除线
- 引用
- 有序列表
- 无序列表
- 任务列表
- 分割线
- 行内代码
- 代码块
- Markdown 链接
- 图片引用
- Mermaid fenced code block

V1 的 WYSIWYG 策略：

- Markdown 源文本始终是 source of truth。
- 使用 CodeMirror decorations/widgets 实现视觉效果。
- 不把文档主数据转换成富文本 AST。
- 不对未编辑区域做自动格式化。

### 文件能力

必须支持：

- 打开单个 Markdown 文件。
- 保存当前文件。
- 另存为。
- 最近文件。
- 工作区目录打开。
- 文件树。
- 文件修改状态提示。

保存必须满足：

- 无关 diff 为 0。
- 不改变未编辑区域。
- 不删除用户手写空行。
- 不重排列表、表格或代码块。

### Mermaid

必须支持：

- 识别 Mermaid fenced code block。
- 渲染 Mermaid 预览。
- Mermaid 渲染异步执行。
- Mermaid 渲染不能阻塞输入。
- 渲染失败时显示可理解的错误状态。

缓存策略：

- 缓存 key 至少包含源码、主题、Mermaid 配置和 Mermaid 版本。
- 源码变化时取消过期任务。

### UI 和布局

V1 布局先对齐 Typora-like 文件管理模式，具体 UX 以 [V1 UX 设计](V1_UX_DESIGN.md) 为准：

- 顶部是文件、编辑、段落、格式、视图、主题、帮助菜单栏。
- 左侧为文件树和大纲 tab，可切换、可折叠、可调整宽度。
- 右侧为唯一 Markdown 编辑区。
- 不做默认三栏常驻布局。
- 顶部区域克制，不做显眼 toolbar。
- 默认进入真实编辑体验，而不是营销页。

必须支持：

- 亮色主题。
- 暗色主题。
- 基础设置页。
- 命令面板。
- 快捷键。

### 多语言

必须支持：

- 简体中文。
- 英文。
- 语言切换。
- 所有可见文案走 i18n。

覆盖范围：

- 菜单。
- 命令。
- tooltip。
- 设置。
- 错误信息。
- 空状态。
- 文件操作提示。

## V1 性能目标

初始性能目标：

- 1MB Markdown 打开时间小于 300ms。
- 5MB Markdown 打开时间小于 1s。
- 10MB Markdown 可编辑且不冻结。
- 普通输入延迟尽量低于 16ms。
- 滚动接近 60 FPS。
- Mermaid 渲染不阻塞输入。
- 保存前后无关 diff 为 0。

这些指标可在真实基准建立后调整，但不能取消性能门禁。

## V1 质量要求

V1 必须建立：

- TypeScript typecheck。
- lint。
- 单元测试。
- 集成测试。
- Playwright E2E。
- fixture round-trip 测试。
- 性能基准。
- i18n key 检查。

编辑器核心改动必须验证：

- IME 输入。
- 撤销和重做。
- 选区稳定性。
- 复制和粘贴。
- 保存源码保真。
- 大文档行为。

## V1 非目标

V1 不做：

- 完整插件系统。
- 云同步。
- 多人实时协作。
- 移动端。
- 类 Notion 数据库。
- 完整学术发布套件。
- 复杂知识图谱。
- AI 写作助手。

这些能力进入 V2 之后再评估。

## V1 验收标准

V1 可进入公开测试的最低标准：

- Windows 上可安装和启动。
- 用户能完成打开、编辑、保存 Markdown 的完整闭环。
- 基础 Markdown WYSIWYG 行为稳定。
- Mermaid 可用且不拖慢输入。
- 中文和英文界面可切换。
- 大文档测试不冻结。
- fixture round-trip 无无关 diff。
- 关键 E2E 用例通过。
- 没有已知的数据损坏风险。
