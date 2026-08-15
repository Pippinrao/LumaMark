# Typora Parity 核心体验改进计划

> **状态：当前执行计划**
>
> 本文是 LumaMark 当前唯一的实施路线事实来源。Foundation 与 MarkText+ 已形成技术基线；当前里程碑进入 **Parity Reliability Foundation**，目标是让已有能力达到可长期日用的 Typora-like 可靠性，而不是继续按专题堆叠功能。

## 用途与范围

本文把已批准的产品方向转成可验证的执行顺序、质量门禁和退出条件。它约束当前里程碑的编辑器交互、源码序列化、代表性 Markdown 行为和验证工作。

实施状态必须以当前代码、测试输出和变更记录为证据。本文不是完成情况台账，不追溯补填历史 TDD 步骤，也不以勾选框代替验证结果。历史 Alpha 设计和任务拆分见 [V1 版本设计](../product/V1_VERSION_DESIGN.md) 与 [V1 落地实施计划](V1_IMPLEMENTATION_PLAN.md)。

## 本里程碑结果

完成本里程碑时，现有编辑能力应同时满足：

- Markdown 源文件仍是唯一真实数据，保存不会无意改写 BOM、换行、尾随空格或无关文本。
- 焦点、选区、首个可见文档位置和像素偏移在显示模式切换与受控文本转换中保持稳定。
- 中文 IME 组合输入、撤销重做和跨文件历史互不破坏。
- 行内标记只在对应 span 被编辑时展开，块级结构只展开当前最小结构。
- Mermaid 编辑直接修改主 CodeMirror 文档，并进入同一撤销栈；保存、另存为、恢复和关闭读取的始终是最新正文。
- 数据损坏、IME、撤销和 active-save 阻断问题为零，才可进入 Beta 候选评估。

体验对标以 Typora 1.13.7 Windows 为公开行为基线；源码保真、安全与性能采用更严格的 LumaMark 合同。相关架构决策见 [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md)。

## 非目标

本里程碑不包含：

- 数学公式、脚注、TOC、Callout 等完整新能力。
- 任意 HTML、iframe、全局 CSP 放宽或不受控嵌入。
- 插件、AI、云同步或生态系统建设。
- macOS/Linux 深度打磨。
- 绑定发布日期、版本号或以削弱质量预算换取退出。

YAML Front Matter、脚注、`[toc]` 和 Callout 在完整能力实现前只要求安全降级：源码保持可见，不得误呈现为其他语义。

## 必须先守住的编辑器合同

### 共享交互上下文

- `editor/interaction` 从 CodeMirror `EditorState` 与语法树派生 `EditorInteractionContext`。
- 上下文包含 composition 状态、每个选区所在的最小 block、inline span、delimiter 和受保护源码范围。
- 上下文随 transaction 映射和增量重算，不进入 React store，不让 feature 或 shell 持有 Markdown 全文。
- 标题、列表、引用、代码围栏和行内标记都消费同一上下文；不得新增彼此冲突的“活动行”特例。

### 精确源码格式

- CodeMirror 内部持有规范化 `Text`；`DocumentSourceFormat` 独立保存 UTF-8 BOM、末尾换行、主换行格式和逐行换行覆盖。
- 未修改行保留原 LF、CRLF 或 CR。新插入换行沿用邻近格式，无法推断时回退到文档主格式。
- 保存点直接捕获当前 `Text` 与格式状态；保存边界执行精确序列化，禁止静默全文件归一化。
- 受控保存转换只允许产生必要的最小 CodeMirror changes，并与 selection/scroll 映射处于同一 transaction。

### 单一主编辑器

- 主 CodeMirror `EditorView` 是正文、输入、选区和撤销历史的唯一所有者。
- Mermaid 激活时，主编辑器显示围栏源码，预览位于块下方；不得创建持有待提交正文的嵌套 `EditorView`。
- 任何编辑态保存路径必须直接读取主文档，不依赖 blur、关闭弹层或额外 flush。

## Now：Parity Reliability Foundation

以下阶段按顺序推进。前一阶段的阻断门禁未通过前，不在其上叠加新的编辑模型改造。

### 阶段 0：收敛当前可靠性改动

**预期结果：** 现有未提交可靠性工作形成一个可独立验证的稳定基线。

实施范围：

- 收敛保存串行化、保存点、恢复草稿、跨文件撤销隔离与外部文件变化处理。
- 收敛代码块、图片和 Mermaid 的增量更新路径。
- 将本地图片 watcher 接到编辑器图片刷新入口。
- 保留当前工作树中的既有变更，避免与下一阶段交互模型改造交叉重写。

图片与 draft finalize 边界见 [ADR 0003](../decisions/0003-live-preview-assets-code-and-table-inline.md)，恢复草稿见 [ADR 0004](../decisions/0004-local-recovery-drafts.md)，外部文件和图片 watcher 见 [ADR 0005](../decisions/0005-external-file-and-image-watch.md)。

退出证据：

- typecheck、lint、常规测试、E2E、Rust 测试和生产构建均以新鲜输出通过。
- 性能门禁单独串行运行，结果不与构建或 E2E 的资源竞争混用。
- 独立代码审查未发现数据损坏、跨文件历史污染或 watcher 生命周期阻断问题。

### 阶段 1：统一交互与显示模式合同

**预期结果：** 所有 Markdown 可视化行为基于同一最小编辑范围，输入法和视图状态可预测。

实施范围：

- 建立并测试 `EditorInteractionContext` 的 block、inline span、delimiter、selection 与 composition 派生。
- 行内标记仅在光标或选区进入相应 span 时展开；块级标记仅展开当前最小结构。
- IME composition 期间映射已有 decoration，不重建候选文本附近的 replacement；composition 结束后增量重算。
- `Mod-/` 切换源码/实时预览模式，并保持选区、撤销历史、首个可见文档位置和像素偏移。
- 明确 keymap 优先级，使结构块命令、composition 和跨块选区不被普通段落命令吞掉。

退出证据：

- 单元测试覆盖多选区、嵌套/相邻 span、转义、多反引号和 composition 生命周期。
- 集成与 Playwright 测试证明模式切换前后 selection、undo 和 scroll anchor 不漂移。
- Windows Tauri 真实中文 IME 路径无候选文本闪烁、丢字或错误展开。

### 阶段 2：完成精确源码序列化

**预期结果：** 编辑器可在规范化内部文本模型上工作，同时按原始字节意图保存。

实施范围：

- 加载时解析 BOM、末尾换行与每行 LF/CRLF/CR，并建立可随 transaction 映射的 `DocumentSourceFormat`。
- 为插入、删除、拆行和合行定义换行格式继承规则。
- 将 `EditorDocumentPort` 的快照、保存点与序列化语义绑定到当前 CodeMirror `Text` 和格式状态。
- 建立真实 `EditorView → production prepareTextForSave → write → reopen → byte diff` 验证链路。
- 仅在稀疏、受控的保存转换路径使用 `@codemirror/merge` 生成最小 changes；超出精确映射保证时显式降级并暴露证据。

退出证据：

- Fixture 覆盖 LF、CRLF、CR、混合换行、BOM、尾随空格、无末尾换行及结构嵌套。
- 未修改文档 round-trip 字节完全一致；修改后的所有无关字节 diff 为 0。
- 保存点不再重新解析调用方字符串，也不依赖 mock 返回原 fixture 作为核心保真证据。

### 阶段 3：交付代表性行为切片

**预期结果：** 共享合同在高频和高风险语法上得到端到端验证，后续能力可按同一模式推广。

#### 段落

- 普通段落 Enter 以单个 transaction 创建 `\n\n` 新段落。
- Shift+Enter 创建单换行；已经位于空行时只增加一个换行。
- 结构块、composition 和跨块选区由更高优先级合同处理。

#### 行内 span

- 粗体、斜体、删除线、行内代码与链接只展开当前 span。
- 覆盖嵌套、相邻、多反引号、转义、多选区和中文输入。

#### 列表与引用

- 先用 characterization tests 固定 CodeMirror 的续写、退出与 Backspace 现状，再添加最小差异行为。
- 补齐列表 Tab/Shift+Tab、多段引用空行、混合选区和键盘可操作的任务 checkbox。

#### 代码块、标题与水平线

- 迁移到共享 interaction context。
- 覆盖逐键创建、退出、未闭合围栏和 YAML/Setext 歧义。
- 禁止新增仅服务单一装饰器的活动行判断。

#### Mermaid

- 编辑态只使用主 `EditorView`，源码可见且预览置于块下方。
- 每次输入立即进入主文档与统一 undo 栈。
- 保存、另存为、恢复草稿和关闭路径在编辑态读取最新正文。

#### 安全降级

- YAML Front Matter、脚注、`[toc]` 与 Callout 保持可见源码。
- 通用装饰器不得把它们误判为水平线、标题、普通链接或引用。

退出证据：

- 每个 transaction 都有精确 before/after 单元测试。
- 集成测试覆盖结构命令优先级、Mermaid active-save、恢复草稿与外部文件冲突。
- Playwright 覆盖 Enter/Shift+Enter、span 展开、列表/引用续写、`Mod-/`、任务键盘操作和保存重开。

### 阶段 4：系统验证与真实自用

**预期结果：** 可靠性合同在真实 Windows 桌面环境与长期文档负载下成立。

验证范围：

- Windows Tauri 实测真实中文 IME、剪贴板、Mermaid active-save 与 Narrator/NVDA 最小路径。
- 1 MB、5 MB、10 MB 文档继续满足现有打开与输入预算。
- 新增 selection-only、模式切换、代码块密集和真实复杂 Mermaid 长任务数据。
- 性能基准独立串行执行；既有主预算不提高，5 样本 P80 与最大值门禁按 [ADR 0007](../decisions/0007-stable-performance-sampling.md) 执行；后续改变预算或统计口径仍须新的决策记录。
- 完成一次真实自用反馈整理，并将阻断问题关联到可复现证据。

里程碑只有在数据损坏、IME、撤销、active-save 阻断问题归零，且所有适用质量门禁均有新鲜通过输出后退出。

## 并行范围：阅读模式与侧栏宽度

本节与 Parity Reliability Foundation 并行推进，不改变上述阶段顺序，也不参与本里程碑的退出门禁。它只约束两项已批准的外壳与显示模式改动。

**侧栏宽度先行**，因为它只触及应用外壳，与编辑器合同无关：

- 拖拽下限降到 120px 并在更窄处吸附折叠；上限由编辑器面板 360px 最小宽度反推。
- 自适应依据改为文件树已展开节点的最长项，clamp 到 200–480px，仅在结构变化时重算。
- 移除侧栏宽度持久化，保留开关持久化；本会话内手动拖动后自适应让位。

**阅读模式随后**，因为它触及显示模式合同与表格点击路径：

- 视图菜单 `display-mode` radio 增加第三项，`Ctrl+/` 改为三态循环。
- 只读经独立 Compartment 重配置 `EditorState.readOnly`，锁定渲染态且不展开源码标记。
- 表格在阅读模式下不激活嵌套编辑器；该路径属于高成本缺陷区，必须补端到端断言。

边界与被否决方案见 [ADR 0010](../decisions/0010-reading-mode-readonly-contract.md) 和 [ADR 0011](../decisions/0011-sidebar-adaptive-width.md)。

退出证据：

- 依赖 240/360 宽度边界的既有单元、集成与 Playwright 断言全部重写并通过。
- 阅读模式覆盖只读拒绝变更、渲染态不展开、表格不激活、保存仍可用和状态栏反馈。
- typecheck、lint、常规测试与相关 E2E 以新鲜输出通过。

## 质量与证据矩阵

| 层级 | 必须证明的行为 |
| --- | --- |
| 单元测试 | interaction context、composition、keymap 优先级、换行格式映射、每个 Markdown transaction 的精确 before/after |
| 集成测试 | 模式切换、selection/scroll 保持、Mermaid active-save、恢复草稿、外部文件冲突 |
| 保真 fixture | LF/CRLF/CR、混合换行、BOM、尾随空格、无末尾换行、同行多 span、未闭合语法、结构嵌套 |
| Playwright | Enter/Shift+Enter、span 展开、列表/引用、`Mod-/`、任务键盘操作、保存重开 |
| Windows Tauri | 中文 IME、剪贴板、Mermaid 编辑态保存、Narrator/NVDA 最小路径 |
| 独立性能门禁 | 1/5/10 MB 打开与输入、selection-only、模式切换、代码块密集、复杂 Mermaid 长任务 |

完整命令与完成定义遵循 [DEVELOPMENT_PROCESS.md](../../DEVELOPMENT_PROCESS.md) 和 [质量策略](../quality/QUALITY_STRATEGY.md)。性能事实与预算以 `docs/performance/` 下对应基准文档为准。

## Next：Typora Migration Completeness

当前里程碑（Parity Reliability Foundation）退出后，按下列梯队推进。梯队内仍按依赖顺序；未完成前置门禁前不跳级堆叠新 capability。

代码块命令入口与逐键围栏补齐已于 2026-08-12 落地，不再属于 Next；后续只按独立证据推进语言选择器、复制操作或更广的 Markdown 自动配对，不把它们隐含进该能力。

进入 Next 前，统一普通剪切/复制/粘贴/全选、编辑器与文件树上下文菜单、链接/图片首批右键动作，以及 v2 设置持久化和垂直设置页构成前置基线；下列梯队不重复列这些基础设施。其实施状态只以当前代码、构建记录和新鲜验收证据为准，本文不记录某次分支的完成进度。

### 第一梯队（阻断日常迁移）

1. **完整链接工作流**
   - 剩余：Ctrl/Cmd+Click、内部标题锚点跳转；右键打开/复制、统一命中模型与 opener 白名单已经落地。
   - 依赖：[菜单系统设计](../product/MENU_SYSTEM_DESIGN.md) 右键合同、[ADR 0015](../decisions/0015-external-open-and-file-mutations.md) opener 与协议白名单。
2. **剪贴板合同**
   - 复制为纯文本（Typora 1.13 上下文菜单已核实项）、Copy as Markdown、`Ctrl+Shift+V` 粘贴为纯文本；随后再接到右键与顶栏。
   - 前置：明确 HTML/Markdown/纯文本序列化保真与失败可见性；不静默改写源码。
### 第二梯队（高频编辑与资源）

3. **图片选择器事务回滚与 `typora-root-url` 预览解析**
   - 图片策略持久化以及复制路径、reveal、删除引用右键动作已经落地；删磁盘文件仍不在本轮范围。
4. **表格行列、对齐、粘贴合同与组件内菜单双语化**
   - `Ctrl+L` / `Ctrl+E` / 删行等与 Typora 语义对齐；`codemirror-markdown-tables` 内文案进 i18n（发布阻断项）。
5. **代码块创建与退出路径补强**（在菜单入口已存在的基础上补齐键入/IME/保真证据）。
6. **查找替换深度定级**
   - 先实测现有 `editor.search.*` UI 完整度，再决定是缺口修复还是能力增强；不在未核实前写入虚假完成声明。

### 第三梯队（新 capability，需架构前置）

7. **块级数学**：用固定迁移语料评估 KaTeX 与 MathJax，形成 ADR 后先实现块级数学；行内数学与 Inline Math 设置门控同批或紧随。
8. **共享增量 heading identity**：供 Outline、内部锚点与 TOC 复用；稳定前不做大纲锚点右键。
9. **heading identity 稳定后**：YAML Front Matter、脚注、`[toc]`、导出与相关设置/快捷键闭环。
10. **Callout / GitHub Style Alerts**：由未来 settings `markdown` 门控承载；关闭时源码可见降级。
11. **受限 HTML / 嵌入**：独立安全评审与 ADR 后方可进入。

以上 capability 在完整实现前只要求 protected-source 安全降级，不得把「源码可见」写成产品能力已交付。

这些项目在进入对应实现批次前只保持能力边界、依赖顺序、验收方向与文档合同；逐任务实现细节在开工时按 `DEVELOPMENT_PROCESS.md` 拆分。

## Later：平台与生态

- Callout、受限 HTML/嵌入与高级图表。
- 更新器和 macOS/Linux 深度打磨。
- 插件、AI 与生态能力。

Later 只表达战略方向，不构成近期承诺。任意 HTML、iframe 或全局 CSP 放宽若未来进入范围，必须另行完成安全评审和决策记录。

## 维护规则

- 本文是当前唯一执行计划；当前里程碑范围或顺序改变时直接更新本文。
- [演进计划](EVOLUTION_PLAN.md) 只维护阶段定位和 Now/Next/Later 摘要，不复制这里的任务细节。
- 产品目标变化更新产品主文档；架构合同变化更新 [详细架构](../architecture/DETAILED_ARCHITECTURE.md) 和对应 ADR。
- 不把测试运行结果、临时调查记录或逐日进度写入本文。
- 若提高性能预算、改变保存/源码保真策略、恢复嵌套编辑器或替换编辑器核心，必须先新增或修订 ADR。
