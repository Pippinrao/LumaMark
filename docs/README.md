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
3. [V1 版本设计](product/V1_VERSION_DESIGN.md)
4. [V1 UX 设计](product/V1_UX_DESIGN.md)
5. [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md)
6. [演进计划](roadmap/EVOLUTION_PLAN.md)
7. [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md)
8. [质量策略](quality/QUALITY_STRATEGY.md)
9. [Agent 工作契约](../AGENTS.md)
10. [AI 开发流程](../DEVELOPMENT_PROCESS.md)

## 当前文档清单

| 文档 | 类型 | 职责 | 更新时机 |
|---|---|---|---|
| [项目章程](product/PROJECT_CHARTER.md) | 产品 | 项目愿景、使命、成功标准、非目标 | 项目定位或长期愿景变化 |
| [产品定位与策略](product/PRODUCT_STRATEGY.md) | 产品 | 用户价值、战场选择、差异化方向 | 产品战略或目标用户变化 |
| [V1 产品需求](product/V1_PRODUCT_REQUIREMENTS.md) | 产品 | V1 功能范围和验收标准 | V1 需求范围变化 |
| [V1 版本设计](product/V1_VERSION_DESIGN.md) | 产品 | V1 产品、交互、架构切片和完成定义 | V1 设计、验收或切片变化 |
| [V1 UX 设计](product/V1_UX_DESIGN.md) | 产品 | V1 默认布局、Apple-like 视觉方向、高保真原型和 UX 验收 | V1 前台体验、菜单、布局或视觉标准变化 |
| [竞品策略与历史债务](product/COMPETITOR_STRATEGY.md) | 产品 | Typora、MarkText 等竞品策略和避坑 | 竞品判断或避坑策略变化 |
| [架构策略](architecture/ARCHITECTURE_STRATEGY.md) | 架构 | 高层架构原则和反模式 | 架构原则变化 |
| [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md) | 架构 | 模块边界、数据流、技术选型 | 默认架构或主要依赖变化 |
| [ADR 0001：V1 应用外壳成熟组件选型](decisions/0001-task8-ui-components.md) | 决策 | Task 8 UI 基础组件选择和复审条件 | 文件树、分栏、命令面板、dialog 基础组件变化 |
| [质量策略](quality/QUALITY_STRATEGY.md) | 质量 | 测试、性能、AI 开发质量策略 | 测试或质量门禁变化 |
| [V1 性能基线](performance/V1_BASELINE.md) | 性能 | V1 alpha 性能预算、实测结果和已知限制 | 性能预算、基准命令或实测结果变化 |
| [Windows V1 构建记录](release/WINDOWS_V1_BUILD.md) | 发布 | Windows 构建命令、安装产物和发布缺口 | Windows 构建配置、产物或发布门禁变化 |
| [演进计划](roadmap/EVOLUTION_PLAN.md) | 路线 | 近细远粗的阶段计划 | 近期阶段目标或退出条件变化 |
| [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) | 路线 | V1 可执行任务拆解、质量门禁、验收顺序 | V1 执行任务、阶段门禁或验证命令变化 |

## 事实来源约定

- 工作规则以 [AGENTS.md](../AGENTS.md) 为准。
- 开发流程以 [DEVELOPMENT_PROCESS.md](../DEVELOPMENT_PROCESS.md) 为准。
- V1 当前设计以 [V1 版本设计](product/V1_VERSION_DESIGN.md) 为准。
- V1 前台 UX 以 [V1 UX 设计](product/V1_UX_DESIGN.md) 为准。
- 当前详细架构以 [详细架构设计与技术选型](architecture/DETAILED_ARCHITECTURE.md) 为准。
- 当前阶段计划以 [演进计划](roadmap/EVOLUTION_PLAN.md) 为准。
- 当前 V1 执行拆解以 [V1 落地实施计划](roadmap/V1_IMPLEMENTATION_PLAN.md) 为准。

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
