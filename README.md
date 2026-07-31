# LumaMark

LumaMark 是一个高性能、现代化、跨平台的所见即所得 Markdown 编辑器。

项目愿景：先快速超过 MarkText，再追平 Typora 核心体验，最终成为世界第一的所见即所得 Markdown 编辑器。

## 项目方向

LumaMark 的路线是“先复刻，再创新”：

1. 第一阶段对齐成熟的 Typora-like 写作体验和布局范式。
2. 第二阶段在流畅度、源码保真、大文档、现代 UI、多语言和工作区体验上超过现有产品。
3. 第三阶段形成自己的差异化能力，成为高性能 Markdown 写作工作台。

## 默认技术路线

- 桌面框架：Tauri
- 前端：React + TypeScript
- 主编辑器核心：CodeMirror 6
- 系统能力和重任务：Rust
- UI 基础组件：成熟组件库优先
- 图标：成熟图标库优先
- i18n：中文和英文从第一天内建

## 文档入口

- [项目文档地图](docs/README.md)
- [当前 Typora Parity 实施计划](docs/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
- [Agent 工作契约](AGENTS.md)
- [AI 开发流程](DEVELOPMENT_PROCESS.md)

## 不可妥协原则

1. 性能是核心产品能力，不是后期优化项。
2. Markdown 源文件是唯一真实数据。
3. 所见即所得不能破坏源码格式、空白和用户意图。
4. 成熟组件优先，未经明确确认不得手搓基础组件。
5. React 不进入逐字符编辑热路径。
6. Mermaid、搜索、导出等高成本任务必须异步、可取消、可缓存。
7. 所有用户可见文案必须可本地化。
8. AI 生成代码必须由测试、基准、审查和 CI 证明。

## 当前状态

Foundation 与 MarkText+ 已形成 Alpha 技术基线；当前进入 Parity Reliability Foundation，优先收敛源码保真、输入法、撤销、焦点和 active-save 可靠性。当前范围与退出门禁以 [Typora Parity 核心体验改进计划](docs/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。
