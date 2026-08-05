# LumaMark 文档地图

本文件是 `docs/` 目录的唯一索引。新增、删除、移动或重命名项目文档时，必须同步更新这里。

## 文档治理原则

- 文档要少而准，不为临时想法创建长期文档。
- 同一主题只能有一个主事实来源。
- 近期计划可以细，远期计划保持大纲和决策门。
- 文档服务决策和执行，不记录流水账。
- 修改产品目标、架构、质量门禁或路线时，同步更新相关文档。

## 目录结构

```text
docs/
├─ README.md                 # 文档地图
├─ product/                  # 产品定位、版本范围、PRD、竞品策略
│  ├─ typora-baseline/       # Typora 公开行为基线（专题事实与对齐表）
│  └─ typora-competitive-analysis/ # LumaMark 当前快照与专题差距分析
├─ architecture/             # 架构原则、模块边界、技术选型
├─ decisions/                # 重大决策记录
├─ quality/                  # 测试、性能、质量策略
├─ performance/              # 性能基线和门禁结果
├─ release/                  # 构建、发布和版本交付记录
└─ roadmap/                  # 演进计划和阶段目标
```

按需再创建：

- `docs/testing/`：测试夹具和测试细则。

不要提前创建空目录。

## 必读顺序

新 agent 或贡献者建议按以下顺序阅读：

1. [项目章程](product/PROJECT_CHARTER.md)
2. [产品定位与策略](product/PRODUCT_STRATEGY.md)
3. [演进计划](roadmap/EVOLUTION_PLAN.md)
4. [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
5. [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md)
6. [V1 UX 设计](product/V1_UX_DESIGN.md)
7. [质量策略](quality/QUALITY_STRATEGY.md)
8. [V1 版本设计（历史 Alpha 基线）](product/V1_VERSION_DESIGN.md)
9. [V1 落地实施计划（历史 Alpha 基线）](roadmap/V1_IMPLEMENTATION_PLAN.md)
10. [Agent 工作契约](../AGENTS.md)
11. [AI 开发流程](../DEVELOPMENT_PROCESS.md)

## 当前文档清单

| 文档 | 类型 | 职责 | 更新时机 |
|---|---|---|---|
| [项目章程](product/PROJECT_CHARTER.md) | 产品 | 项目愿景、使命、成功标准、非目标 | 项目定位或长期愿景变化 |
| [产品定位与策略](product/PRODUCT_STRATEGY.md) | 产品 | 用户价值、战场选择、差异化方向 | 产品战略或目标用户变化 |
| [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md) | 历史产品基线 | Foundation / MarkText+ 的 V1 功能范围和验收口径 | 原则上冻结，仅修正链接或历史状态说明 |
| [V1 版本设计](product/V1_VERSION_DESIGN.md) | 历史产品基线 | Foundation / MarkText+ 的 Alpha 产品、交互和架构切片记录；不作为当前执行计划 | 原则上冻结，仅修正链接或历史状态说明 |
| [V1 UX 设计](product/V1_UX_DESIGN.md) | 历史 UX 基线 | Alpha 默认布局、视觉方向、高保真原型和 UX 验收记录 | 稳定视觉原则或历史状态说明变化 |
| [菜单系统设计](product/MENU_SYSTEM_DESIGN.md) | 产品 UX | 顶部菜单视觉、信息结构、命令合同、Typora 快捷键映射和验收标准 | 菜单结构、快捷键、相关 capability 状态或菜单技术方案变化 |
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
| [质量策略](quality/QUALITY_STRATEGY.md) | 质量 | 测试、性能、AI 开发质量策略 | 测试或质量门禁变化 |
| [V1 性能基线](performance/V1_BASELINE.md) | 性能 | V1 alpha 性能预算、实测结果和已知限制 | 性能预算、基准命令或实测结果变化 |
| [Windows V1 构建记录](release/WINDOWS_V1_BUILD.md) | 发布 | Windows 构建命令、安装产物和发布缺口 | Windows 构建配置、产物或发布门禁变化 |
| [演进计划](roadmap/EVOLUTION_PLAN.md) | 路线 | 近细远粗的阶段计划 | 近期阶段目标或退出条件变化 |
| [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) | 当前执行路线 | Parity Reliability Foundation 的实施顺序、合同、证据与退出门禁 | 当前里程碑范围、顺序或门禁变化 |
| [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) | 历史路线基线 | Foundation / MarkText+ 的 Alpha 任务拆解；保留原始 checkbox，不代表当前完成状态 | 原则上冻结，仅修正链接或历史状态说明 |

## 事实来源约定

- 工作规则以 [AGENTS.md](../AGENTS.md) 为准。
- 开发流程以 [DEVELOPMENT_PROCESS.md](../DEVELOPMENT_PROCESS.md) 为准。
- 长期产品定位以 [项目章程](product/PROJECT_CHARTER.md) 和 [产品定位与策略](product/PRODUCT_STRATEGY.md) 为准。
- Alpha 前台 UX 历史基线见 [V1 UX 设计](product/V1_UX_DESIGN.md)；当前交互实施范围以当前执行计划和详细架构为准。
- 当前详细架构以 [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md) 为准。
- 当前阶段定位与 Now/Next/Later 以 [演进计划](roadmap/EVOLUTION_PLAN.md) 为准。
- 当前可执行范围、顺序和退出门禁以 [Typora Parity 核心体验改进计划](roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。
- [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md)、[V1 UX 设计](product/V1_UX_DESIGN.md)、[V1 版本设计](product/V1_VERSION_DESIGN.md) 与 [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) 只作为历史 Alpha 基线，不用于推断当前实现状态。
- Typora 公开行为细节以 [Typora 行为基线](product/typora-baseline/README.md) 为准；专题实现快照以 [Typora 专题竞争分析](product/typora-competitive-analysis/README.md) 为准；LumaMark 当前实施范围仍以当前执行计划为准。

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
