# ADR 0001：V1 应用外壳成熟组件选型

日期：2026-07-05

## 背景

Task 8 需要落地工作区、文件树、大纲、命令面板、设置页和可调整分栏。项目规则要求优先成熟组件；只有在成熟组件无法满足性能、可访问性、i18n 或可维护性目标，并得到用户确认后，才允许自研基础组件。

## 决策

V1 应用外壳采用以下成熟组件：

- `react-resizable-panels`：分栏、折叠和布局持久化。
- `react-arborist`：文件树虚拟化、键盘导航和自定义节点渲染。
- `cmdk`：命令面板、命令过滤和键盘导航。
- Radix Primitives：设置 dialog、tabs 和后续 tooltip。
- `lucide-react`：工具按钮图标。

项目代码只负责 LumaMark 的数据适配、命令编排、i18n 文案和性能边界，不自研基础 UI 组件。

## 评估结论

- 文件树：`react-arborist` 支持虚拟化、键盘导航、受控数据和自定义 renderer；Windows 路径通过 `path` 字段透传，不在 UI 里硬切分路径。目录懒加载由 workspace store 在 `onToggle` 时调用 Rust `workspace_list_children` 实现。
- 分栏：`react-resizable-panels` 支持 collapsible panel 和 layout 持久化，满足 V1 侧边栏/编辑区/大纲布局。
- 命令面板：`cmdk` 支持可控 open/search、命令过滤和键盘导航；命令 label、placeholder、empty state 和分组文案全部由 LumaMark i18n 资源提供；`Ctrl/Cmd+K` 快捷键由应用层监听并打开受控面板；V1 命令量很小，不需要额外虚拟化。若未来命令规模显著增长，可切换为 `shouldFilter={false}` 并接入应用侧过滤或虚拟化。
- Dialog/Tabs/Tooltip：Radix 提供焦点管理和可访问性基础，符合成熟组件优先原则。

## 被否决方案

- 自研文件树、分栏、命令面板或 dialog：没有证据表明成熟组件无法满足 V1，因此不允许。
- 一次性引入大型完整设计系统：当前需要的是安静的桌面应用壳和可控交互基础，不需要增加过重的主题/组件约束。

## 影响

- `AppShell` 只做跨功能编排。
- `features/file-tree`、`features/outline`、`features/command-palette`、`features/settings` 各自保持边界。
- Markdown 正文仍只在 CodeMirror 中，outline 由当前编辑器文本派生，不进入全局 store。
- Rust workspace command 保持薄入口，目录读取和过滤进入 `workspace_service`。

## 复审条件

出现以下情况时重新评估：

- 文件树节点规模或懒加载需求超出 `react-arborist` 能力。
- 分栏持久化或跨平台输入行为出现不可接受问题。
- 命令数量达到需要自定义索引、虚拟化或异步检索的规模。
- 任何组件阻塞输入、滚动或编辑器热路径。
