> 语言：**中文** · [English](../README.md)

# LumaMark 文档地图

本文件是 `docs/` 目录的中文索引。新增、删除、移动或重命名项目文档时，必须在同一变更中同步更新本文件与英文 [docs/README.md](../README.md)。

## 文档治理原则

- 文档要少而准，不为临时想法创建长期文档。
- 同一主题只能有一个主事实来源。
- 近期计划可以细，远期计划保持大纲和决策门。
- 文档服务决策和执行，不记录流水账。
- 修改产品目标、架构、质量门禁或路线时，同步更新相关文档。

## 双语布局

- **英文（默认 / 权威）：** `docs/**` 下的这些路径，以及根目录 `README.md`、`AGENTS.md`、`DEVELOPMENT_PROCESS.md`。
- **中文（完整镜像）：** `docs/zh/**`，以及根目录 `README.zh.md`、`AGENTS.zh.md`、`DEVELOPMENT_PROCESS.zh.md`。
- 活文档：先更新英文，再在同一变更集中更新中文镜像。
- 语言切换链接到成对文件；中文文档内部链接指向中文镜像路径（切换器本身除外）。
- Agent 对项目所有者的聊天回复默认仍用中文；见 `AGENTS.zh.md` 的文档语言策略。

## 目录结构

```text
docs/
├─ README.md                 # 英文文档地图
├─ zh/                       # 项目文档的完整中文镜像（本文件所在目录）
├─ superpowers/              # 非权威的 agent 规划草稿（specs/plans）
├─ product/                  # 产品定位、版本范围、PRD、竞品策略
│  ├─ typora-baseline/       # Typora 公开行为基线（专题事实与对齐表）
│  └─ typora-competitive-analysis/ # LumaMark 快照与专题差距分析
├─ architecture/             # 架构原则、模块边界、技术选型
├─ decisions/                # 重大决策记录
├─ quality/                  # 测试、性能、质量策略
├─ performance/              # 性能基线和门禁结果
├─ release/                  # 构建、发布和版本交付记录
└─ roadmap/                  # 演进计划和阶段目标
```

按需再创建：

- `docs/testing/`：测试夹具和测试细则（中文对应 `docs/zh/testing/`）。

不要提前创建空目录。

`docs/superpowers/` 仅存放 agent 规格与计划草稿，**不是**产品、架构、质量或路线的事实来源。

## 必读顺序

新 agent 或贡献者建议按以下顺序阅读：

1. [项目章程](product/PROJECT_CHARTER.md)
2. [产品定位与策略](product/PRODUCT_STRATEGY.md)
3. [演进计划](roadmap/EVOLUTION_PLAN.md)
4. [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
5. [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md)
6. [质量策略](quality/QUALITY_STRATEGY.md)
7. [Agent 工作契约](../../AGENTS.zh.md)
8. [AI 开发流程](../../DEVELOPMENT_PROCESS.zh.md)

### 归档（历史 Alpha 基线 — 非必读）

这些文档记录 Foundation / MarkText+ 的 Alpha 基线。原则上冻结，不得用于推断当前实现状态或执行顺序：

- [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md)
- [V1 UX 设计](product/V1_UX_DESIGN.md)
- [V1 版本设计](product/V1_VERSION_DESIGN.md)
- [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md)

## 当前状态

Foundation 与 MarkText+ 已形成 Alpha 技术基线。当前活跃里程碑是 **Parity Reliability Foundation**：在叠加更多专题能力之前，先收敛源码保真、输入法、撤销、焦点和 active-save 可靠性。范围、顺序与退出门禁仅以 [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。

已落地能力（高层索引；合同与验收见链接的中文文档）：

| 能力 | 主文档 |
|---|---|
| 设置系统 | [SETTINGS_SYSTEM_DESIGN.md](product/SETTINGS_SYSTEM_DESIGN.md)、[ADR 0014](decisions/0014-settings-persistence.md) |
| 菜单与右键菜单 | [MENU_SYSTEM_DESIGN.md](product/MENU_SYSTEM_DESIGN.md) |
| MathJax 数学 | [ADR 0017](decisions/0017-mathjax-document-worker-chtml.md) |
| 本地 PlantUML | [ADR 0018](decisions/0018-plantuml-local-rendering.md) |
| GitHub NSIS 自动更新 | [ADR 0012](decisions/0012-github-nsis-auto-update.md) |
| 多窗口 / 桌面打开路由 | [ADR 0009](decisions/0009-desktop-file-open-bridge.md) |

## 当前文档清单

| 文档 | 类型 | 职责 | 更新时机 |
|---|---|---|---|
| [项目章程](product/PROJECT_CHARTER.md) | 产品 | 项目愿景、使命、成功标准、非目标 | 项目定位或长期愿景变化 |
| [产品定位与策略](product/PRODUCT_STRATEGY.md) | 产品 | 用户价值、战场选择、差异化方向 | 产品战略或目标用户变化 |
| [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md) | 历史产品基线 | Foundation / MarkText+ 的 V1 功能范围和验收口径 | 原则上冻结，仅修正链接或历史状态说明 |
| [V1 版本设计](product/V1_VERSION_DESIGN.md) | 历史产品基线 | Foundation / MarkText+ 的 Alpha 产品、交互和架构切片记录；不作为当前执行计划 | 原则上冻结，仅修正链接或历史状态说明 |
| [V1 UX 设计](product/V1_UX_DESIGN.md) | 历史 UX 基线 | Alpha 默认布局、视觉方向、高保真原型和 UX 验收记录 | 稳定视觉原则或历史状态说明变化 |
| [菜单系统设计](product/MENU_SYSTEM_DESIGN.md) | 产品 UX | 顶栏菜单、右键菜单与命令面板共用的视觉、信息结构、命令合同、上下文命中、Typora 快捷键映射和验收标准 | 菜单/右键结构、快捷键、相关 capability 状态或菜单技术方案变化 |
| [设置系统设计](product/SETTINGS_SYSTEM_DESIGN.md) | 产品 UX | 设置对话框分区、schema、持久化与迁移合同、设置与会话状态边界、测试与验收 | 设置分区/字段、持久化后端、迁移策略或设置门禁变化 |
| [竞品策略与历史债务](product/COMPETITOR_STRATEGY.md) | 产品 | Typora、MarkText 等竞品策略和避坑 | 竞品判断或避坑策略变化 |
| [Typora 行为基线](product/typora-baseline/README.md) | 产品 | Typora 公开写作行为事实、出处与 LumaMark 对齐表 | Typora 版本复核、基线专题增补或对齐决策变化 |
| [Typora 专题竞争分析](product/typora-competitive-analysis/README.md) | 产品 | 18 份专题报告的目录导航、职责边界、状态词表和维护门禁 | 相关实现证据、Typora 基线或专题结构变化后 |
| [架构策略](architecture/ARCHITECTURE_STRATEGY.md) | 架构 | 高层架构原则和反模式 | 架构原则变化 |
| [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md) | 架构 | 模块边界、数据流、技术选型 | 默认架构或主要依赖变化 |
| [ADR 0001：V1 应用外壳成熟组件选型](decisions/0001-task8-ui-components.md) | 决策 | Task 8 UI 基础组件选择和复审条件 | 文件树、分栏、命令面板、dialog 基础组件变化 |
| [ADR 0002：CodeMirror 表格交互组件选型](decisions/0002-codemirror-markdown-tables.md) | 决策 | Markdown 表格交互成熟组件选择和复审条件 | 表格交互、源码保真或主编辑器核心变化 |
| [ADR 0003：Live Preview 图片缓存、代码高亮和表格内嵌语法](decisions/0003-live-preview-assets-code-and-table-inline.md) | 决策 | 图片解析/刷新与 draft finalize、代码高亮依赖和表格 inline 渲染薄层 | 图片、代码块、表格内嵌语法或相关依赖变化 |
| [ADR 0004：本地恢复草稿的安全边界](decisions/0004-local-recovery-drafts.md) | 决策 | 本地恢复草稿的精确序列化、恢复和清理边界 | 恢复策略、保存语义或草稿持久化变化 |
| [ADR 0005：外部 Markdown 与本地图片变更监听](decisions/0005-external-file-and-image-watch.md) | 决策 | 文件监听、外部修改冲突和图片磁盘刷新边界 | watcher 依赖、冲突策略或图片刷新语义变化 |
| [ADR 0006：Parity Reliability 编辑器合同](decisions/0006-parity-reliability-editor-contracts.md) | 决策 | 共享 interaction context、精确源码格式、Mermaid 单主编辑器与保存 diff 依赖边界 | 编辑交互、源码序列化、Mermaid 编辑所有权或保存转换变化 |
| [ADR 0007：稳定的性能采样门禁](decisions/0007-stable-performance-sampling.md) | 决策 | 性能样本的 P80、最大值、独立冷路径与 CI 防抖口径 | 样本数量、统计方式、主预算或最大值硬上限变化 |
| [ADR 0008：图片与 Mermaid 共享媒体查看器](decisions/0008-shared-media-viewer.md) | 决策 | 展开查看、缩放依赖、editor 事件和焦点/源码保真边界 | 媒体查看、缩放组件、payload 所有权或全屏语义变化 |
| [ADR 0009：桌面文件打开与多窗口路由](decisions/0009-desktop-file-open-bridge.md) | 决策 | 文件关联、持久请求、文档 identity、单实例 worker、multi/aggregate 窗口所有权和恢复边界 | 桌面文件关联、窗口路由、路径 identity、请求生命周期或 single-instance 依赖变化 |
| [ADR 0010：阅读模式的只读与渲染锁定合同](decisions/0010-reading-mode-readonly-contract.md) | 决策 | 只读实现方式、渲染态锁定、控件交互边界、反馈方式和显示模式循环 | 显示模式集合、只读语义、源码展开策略或只读反馈方式变化 |
| [ADR 0011：侧边栏内容自适应宽度与约束放开](decisions/0011-sidebar-adaptive-width.md) | 决策 | 侧栏拖拽上下限、自适应依据与重算时机、宽度持久化边界 | 侧栏宽度约束、自适应算法、重算触发条件或宽度持久化策略变化 |
| [ADR 0012：GitHub NSIS 自动更新](decisions/0012-github-nsis-auto-update.md) | 决策 | 官方 updater 插件、NSIS-only、GitHub `latest.json`、签名密钥、发布 workflow 与 Windows 手动系统代理边界 | 更新源、签名策略、发布产物形态、代理边界或安装确认交互变化 |
| [ADR 0013：代码块围栏补齐的独立性能预算](decisions/0013-code-block-completion-performance-budget.md) | 决策 | 复杂围栏补齐命令与普通输入的预算边界、采样口径和复审条件 | 围栏补齐实现、CodeMirror 更新成本、主预算或最大值变化 |
| [ADR 0014：设置持久化下沉到 Rust 配置文件](decisions/0014-settings-persistence.md) | 决策 | 设置从 localStorage 迁到 `settings.json`、损坏备份、迁移与会话状态边界 | 设置持久化后端、迁移策略或配置文件布局变化 |
| [ADR 0015：外部打开与工作区文件变更](decisions/0015-external-open-and-file-mutations.md) | 决策 | opener 依赖、协议白名单、工作区写操作、回收站删除与 capability 边界 | opener/shell 依赖、删除语义、工作区路径校验或文件树写操作变化 |
| [ADR 0016：桌面纯文本剪贴板适配](decisions/0016-tauri-text-clipboard-adapter.md) | 决策 | 官方 Tauri clipboard-manager、浏览器 adapter、EditorCommandPort 注入与最小文本权限 | 剪贴板插件、权限、纯文本命令入口或桌面/浏览器适配边界变化 |
| [ADR 0017：MathJax 文档级 Worker 与 CHTML 数学渲染](decisions/0017-mathjax-document-worker-chtml.md) | 决策 | 数学引擎、文档状态、Worker/CHTML、离线字体、安全和回滚边界 | MathJax 版本、输出格式、TeX 包、安全策略、chunk 或性能门禁变化 |
| [ADR 0018：PlantUML 官方 TeaVM 本地渲染](decisions/0018-plantuml-local-rendering.md) | 决策 | 本地 PlantUML 引擎、canonical 设置、阅读锁、暗色、懒加载 chunk 与安装包验收 | PlantUML 引擎、设置字段、渲染锁或安装包验收变化 |
| [ADR 0019：实时预览指针选区 style](decisions/0019-live-preview-pointer-selection-style.md) | 决策 | 自定义 `mouseSelectionStyle` 所有权、按下锚点、单击容差与安装包指针验收 | 指针选区所有权、单击容差、锚点解析或指针验收变化 |
| [ADR 0020：Preview scheduler](decisions/0020-preview-scheduler.md) | 决策 | 源码/光标保持同步；视口 WYSIWYG 重建合并到一帧 preview pass | Preview 调度、视口 decoration 重建时机或安装包卡顿证据变化 |
| [质量策略](quality/QUALITY_STRATEGY.md) | 质量 | 测试、性能、AI 开发质量策略 | 测试或质量门禁变化 |
| [V1 性能基线](performance/V1_BASELINE.md) | 性能 | V1 alpha 性能预算、实测结果、已知限制与装机交互卡顿门禁 | 性能预算、基准命令、装机交互门禁或实测结果变化 |
| [Windows V1 构建记录](release/WINDOWS_V1_BUILD.md) | 发布 | Windows 构建命令、安装产物和发布缺口 | Windows 构建配置、产物或发布门禁变化 |
| [演进计划](roadmap/EVOLUTION_PLAN.md) | 路线 | 近细远粗的阶段计划 | 近期阶段目标或退出条件变化 |
| [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) | 当前执行路线 | Parity Reliability Foundation 的实施顺序、合同、证据与退出门禁 | 当前里程碑范围、顺序或门禁变化 |
| [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) | 历史路线基线 | Foundation / MarkText+ 的 Alpha 任务拆解；保留原始 checkbox，不代表当前完成状态 | 原则上冻结，仅修正链接或历史状态说明 |

## 事实来源约定

- 工作规则以 [AGENTS.md](../../AGENTS.zh.md) 为准。
- 开发流程以 [DEVELOPMENT_PROCESS.md](../../DEVELOPMENT_PROCESS.zh.md) 为准。
- 长期产品定位以 [项目章程](product/PROJECT_CHARTER.md) 和 [产品定位与策略](product/PRODUCT_STRATEGY.md) 为准。
- Alpha 前台 UX 历史基线见 [V1 UX 设计](product/V1_UX_DESIGN.md)；当前交互实施范围以当前执行计划和详细架构为准。
- 当前详细架构以 [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md) 为准。
- 当前阶段定位与 Now/Next/Later 以 [演进计划](roadmap/EVOLUTION_PLAN.md) 为准。
- 当前可执行范围、顺序和退出门禁以 [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。
- [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md)、[V1 UX 设计](product/V1_UX_DESIGN.md)、[V1 版本设计](product/V1_VERSION_DESIGN.md) 与 [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) 只作为历史 Alpha 基线，不用于推断当前实现状态。
- Typora 公开行为细节以 [Typora 行为基线](product/typora-baseline/README.md) 为准；专题实现快照以 [Typora 专题竞争分析](product/typora-competitive-analysis/README.md) 为准；LumaMark 当前实施范围仍以当前执行计划为准。
- `docs/superpowers/` 是非权威的规划草稿，不得覆盖上述事实来源。

如果文档之间出现冲突，先按上述事实来源判断，再更新过期文档。

## 新增文档准入

新增长期文档前，先回答：

- 能不能更新现有文档？
- 新文档是否有独立生命周期？
- 新文档是否有明确读者？
- 新文档是否会成为新的事实来源？
- 是否已经在本文件登记？

如果答案不清楚，不要新增文档。

## 维护检查

每次文档任务结束前检查：

- 链接是否可达。
- 是否存在重复事实来源。
- 是否出现未完成占位标记。
- 是否把远期计划写得过细。
- 是否需要更新本索引。
- 活文档是否先更新英文默认，再更新中文镜像。
