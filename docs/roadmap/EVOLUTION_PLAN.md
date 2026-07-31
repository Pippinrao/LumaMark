# 演进计划

## 规划原则

LumaMark 的路线采用“近细远粗”的规划方式。

- **近期细化**：当前 Parity Reliability Foundation 由唯一的 [当前执行计划](TYPORA_PARITY_IMPLEMENTATION_PLAN.md)写到可执行、可验证。
- **中期定方向**：Typora Migration Completeness 保留依赖顺序和能力边界，在进入 Now 前不锁死实现任务。
- **远期留弹性**：World-Class 和生态方向只保留主题，不做过细承诺。

原因很简单：编辑器产品的真实判断来自原型、性能数据和用户试用。远期计划写得过细，会制造假确定性，并增加返工。

Foundation 与 MarkText+ 已形成 Alpha 技术基线，其历史范围保留在 [V1 版本设计](../product/V1_VERSION_DESIGN.md) 和 [V1 落地实施计划](V1_IMPLEMENTATION_PLAN.md)。本文只维护阶段定位与 Now/Next/Later，不复制当前实施细节。

## 总体路径

LumaMark 的演进路线分为四个层级：

1. **Foundation**：建立架构、质量和验证地基。
2. **MarkText+**：快速超过 MarkText，形成可试用 Alpha。
3. **Typora Parity**：追平 Typora 核心日常体验。
4. **World-Class**：基于真实反馈选择创新方向，冲击世界第一的 WYSIWYG Markdown 编辑器。

路线原则：

- 每个阶段都必须有可运行产物。
- 每个阶段都必须有性能和源码保真验证。
- 不为了功能数量牺牲输入流畅度。
- 不提前建设插件、云同步等大系统。
- 后一阶段的详细计划，必须基于前一阶段的验证结果再展开。

## 阶段 0：Foundation

目标：建立可持续开发的项目地基，证明默认架构可行。

**状态：** 已形成技术基线；以下内容作为历史阶段定义保留。

### 核心产出

- 初始化 Tauri + React + TypeScript 项目。
- 接入 CodeMirror 6，并显示、编辑 Markdown 文本。
- 接入基础 i18n，支持简体中文和英文。
- 建立基础主题系统，至少支持亮色和暗色。
- 建立测试框架。
- 建立 Playwright E2E 框架。
- 建立 Markdown fixture round-trip 测试框架。
- 建立性能 benchmark 框架。
- 建立基础 CI 门禁。

### 验收标准

- 应用可启动。
- 编辑器可显示和编辑 Markdown 文本。
- 可以运行 typecheck、lint、unit test、E2E 基础用例。
- 可以执行 open -> save -> diff 的 fixture 验证。
- 所有用户可见示例文案进入 i18n。

### 阶段退出条件

只有满足以下条件，才能进入 MarkText+ 阶段：

- CodeMirror 6 作为主编辑核心跑通。
- React 未进入逐字符编辑热路径。
- fixture round-trip 验证机制可运行。
- 性能基准机制可运行。
- AI 开发流程和完成门禁已被项目文档固定。

## 阶段 1：MarkText+

目标：快速超过 MarkText 的流畅性、现代感和源码可信度，形成可试用 Alpha。

**状态：** 已形成 Alpha 能力基线；可靠性缺口并入当前 Parity Reliability Foundation 收敛。

### 核心产出

编辑闭环：

- 打开 Markdown 文件。
- 编辑 Markdown 文件。
- 保存 Markdown 文件。
- 最近文件。
- dirty 状态提示。

基础 Typora-like 编辑体验：

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

应用外壳：

- Typora-like 基础布局。
- 中央编辑区。
- 可选文件树。
- 大纲。
- 亮色主题。
- 暗色主题。
- 中文和英文界面。

复杂块初版：

- 识别 Mermaid fenced code block。
- Mermaid 异步渲染。
- Mermaid 渲染失败状态。
- Mermaid 渲染不阻塞输入。

质量和性能：

- 1MB、5MB、10MB Markdown 样本文档。
- 保存无无关 diff。
- 基础 E2E。
- 大文档性能基准。

### 验收标准

- Windows 开发构建可用。
- 用户能完成打开、编辑、保存 Markdown 的闭环。
- 基础 Markdown WYSIWYG 行为可用。
- Mermaid 可用且不阻塞输入。
- 1MB 和 5MB 文件打开与编辑顺畅。
- 10MB 文件不冻结。
- 保存后无无关 diff。
- 中文和英文界面可切换。
- 基础 E2E 和 fixture 测试通过。

### 阶段定位

> 让用户第一次使用就觉得 LumaMark 比 MarkText 更顺、更稳、更现代。

### 阶段退出条件

历史阶段定义要求满足以下条件后再进入 Typora Parity 细化规划。当前已转入可靠性收敛不等于追溯宣称每项完成；缺失证据直接纳入当前计划：

- MarkText+ 核心路径经过自动化验证。
- 性能基准数据稳定。
- Markdown 源码保真策略被验证。
- Mermaid 异步渲染策略被验证。
- 至少完成一轮真实自用或试用反馈整理。

## 阶段 2：Typora Parity

目标：追平 Typora 的核心日常写作体验。

**状态：当前阶段。** 第一子阶段是 Parity Reliability Foundation：先统一源码保真、焦点、输入和撤销合同，再将合同推广到代表性 Markdown 行为。完整范围、顺序和退出门禁只在 [当前执行计划](TYPORA_PARITY_IMPLEMENTATION_PLAN.md)维护。

### 方向范围

优先方向：

- 当前：源码格式、interaction context、IME、撤销、模式切换与 Mermaid 单主文档模型。
- 当前代表切片：段落、行内 span、列表与引用、代码块、标题、水平线和安全降级。
- 后续迁移完整性：链接、图片、代码块入口、表格和经 ADR 选型后的块级数学。
- 后续产品闭环：共享 heading identity、TOC、YAML、脚注、查找替换、导出、设置和快捷键。

### 规划原则

- 只补齐 Typora 日常迁移所需的核心能力。
- 每个能力都必须先定义验收样例和自动化测试。
- 任何会影响编辑热路径的能力，都必须先做性能原型。
- 不为追平功能清单牺牲输入流畅度。

### 阶段成功标准

- Typora 用户可以完成主要迁移。
- 常用 Markdown 写作动作自然。
- 图片、表格、链接、公式没有明显日常使用缺口。
- 保存仍然不产生无关 diff。
- 性能基准没有明显退化。
- 数据损坏、IME、撤销和 active-save 阻断问题为零。

## 阶段 3：World-Class

目标：超过 Typora，形成 LumaMark 自己的护城河。

本阶段只保留创新主题，不提前承诺具体功能。真实方向必须来自前两个阶段的性能数据、用户反馈和产品判断。

### 候选创新主题

- 大文档体验做到行业领先。
- 源码保真做到行业领先。
- 异步复杂块渲染做到行业领先。
- 工作区体验更现代。
- 搜索和索引更强。
- 主题和视觉系统更精致。
- 跨平台体验更稳定。
- AI 辅助写作和 Markdown 重构。
- 扩展点或插件能力。

### 规划原则

- 先验证用户痛点，再决定创新方向。
- 先做好核心写作体验，再扩展生态。
- 先做内部扩展点，再考虑公开插件系统。
- 任何新方向都不能破坏“打开快、输入顺、滚动稳、保存可信、界面美”。

## Later：生态和平台

以下方向只作为长期候选，不进入近期承诺：

- 插件市场。
- 云同步。
- Git 工作流集成。
- 团队协作。
- 文档发布平台。
- 移动端。
- 知识库增强。

进入这些方向前必须重新评估：

- 是否已有足够用户需求。
- 是否会拖慢核心编辑体验。
- 是否需要新的商业或运营能力。
- 是否会显著增加维护成本。

## Now / Next / Later

### Now

- 收敛已有保存、恢复、外部变更、图片 watcher 与增量渲染可靠性改动。
- 建立共享 editing context、精确 `DocumentSourceFormat` 和单主 `EditorView` 合同。
- 用段落、行内 span、列表/引用、代码块/标题/水平线和 Mermaid 代表切片验证合同。
- 完成真实保存重开、Windows 中文 IME、可访问性、独立性能门禁和自用反馈。

详细任务、顺序与退出证据见 [Typora Parity 核心体验改进计划](TYPORA_PARITY_IMPLEMENTATION_PLAN.md)；核心架构合同见 [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md)。

### Next

- 完整链接工作流。
- 图片选择器、策略持久化和事务回滚。
- 代码块创建入口与表格行列、对齐、粘贴合同。
- 以固定迁移语料评估 KaTeX/MathJax，形成 ADR 后先做块级数学。
- 建立共享增量 heading identity，再推进 Outline、内部锚点、TOC、YAML、脚注、查找替换、导出、设置与快捷键闭环。

### Later

- Callout、受限 HTML/嵌入、高级图表和更新器。
- macOS/Linux 深度打磨。
- 根据真实反馈选择插件、AI 和生态方向。
- 任意 HTML、iframe 或全局 CSP 放宽不构成近期承诺。

## 阶段状态与当前里程碑

### 历史 Alpha 基线

M0 可运行骨架、M1 可编辑 Markdown 与 M2 可日常试用 Alpha 的原始定义保留在历史 [V1 落地实施计划](V1_IMPLEMENTATION_PLAN.md)。这些历史 checkbox 不用于推断当前完成状态。

### 当前：Parity Reliability Foundation

- 以“薄内核 + 代表切片”完成可靠性收敛。
- 保持 Markdown 字节意图、IME、选区、scroll 和统一 undo 合同。
- 退出前完成自动化门禁、Windows 实测和真实自用。
- 数据损坏、IME、撤销与 Mermaid active-save 阻断问题必须归零。

## 主要风险

### 编辑器 WYSIWYG 难度

风险：Typora-like 行为细节多，容易漏掉 IME、撤销、选区、粘贴等边缘场景。

应对：

- 小步实现。
- 每个 Markdown 行为有测试。
- E2E 覆盖关键输入路径。

### 性能退化

风险：功能增加后输入和滚动变慢。

应对：

- React 不进入编辑热路径。
- 性能基准进入 CI。
- Mermaid、搜索、导出异步化。

### 源码保真破坏

风险：WYSIWYG 逻辑或保存逻辑产生无关 diff。

应对：

- fixture round-trip 测试。
- Markdown 源文作为唯一真实数据。
- 不做全量自动格式化。

### AI 生成质量波动

风险：AI 写出可运行但不可维护或未验证的代码。

应对：

- TDD。
- Definition of Done。
- 独立代码审查。
- 自动化验证。
- 小任务拆分。

## 战略判断

LumaMark 最容易失败的方式，是变成一个功能很多但输入不顺、保存不可信、性能不稳的 Markdown 工具。

LumaMark 最应该坚持的路径，是先用狭窄但高质量的核心体验立住：

> 打开快，输入顺，滚动稳，保存可信，界面美。

当这五件事成立后，再根据真实反馈细化后续计划。
