# 详细架构设计与技术选型

日期：2026-07-04

## 设计结论

LumaMark 的默认架构是：

```text
Tauri v2
├─ Rust Core：系统能力、文件、搜索、索引、缓存、重任务
└─ WebView Frontend
   ├─ React + TypeScript：应用壳和业务 UI
   ├─ CodeMirror 6：唯一主编辑器核心
   ├─ codemirror-markdown-tables：Markdown 表格交互组件
   ├─ Radix Primitives：dialog、tabs、tooltip 等基础交互组件
   ├─ react-resizable-panels：应用分栏
   ├─ react-arborist：文件树
   ├─ cmdk：命令面板
   ├─ lucide-react：图标
   ├─ Zustand：轻量应用状态
   ├─ i18next/react-i18next：多语言
   ├─ Mermaid / KaTeX：复杂块渲染
   └─ Vitest / Playwright：自动化验证
```

核心原则：

- CodeMirror 6 持有 Markdown 正文和编辑热路径。
- React 只做应用外壳，不参与逐字符输入渲染。
- Rust 只处理系统能力和明确重任务。
- Markdown 源文是唯一真实数据。
- 复杂块渲染异步、可取消、可缓存。
- 基础组件成熟库优先，未经确认不自研。

## 分层架构

```text
┌─────────────────────────────────────────────────────────────┐
│ App Shell                                                    │
│ React layout, panels, settings, command palette, i18n, theme │
├─────────────────────────────────────────────────────────────┤
│ Editor Runtime                                               │
│ CodeMirror state/view, Markdown syntax, decorations, widgets │
├─────────────────────────────────────────────────────────────┤
│ Derived Document Services                                    │
│ outline, block registry, render jobs, editor metrics         │
├─────────────────────────────────────────────────────────────┤
│ Frontend Service Layer                                       │
│ typed Tauri command clients, job/event adapters, error model │
├─────────────────────────────────────────────────────────────┤
│ Rust Core                                                    │
│ file IO, watcher, workspace walk, search, cache, export      │
├─────────────────────────────────────────────────────────────┤
│ Operating System                                             │
│ filesystem, dialogs, updater, native integration             │
└─────────────────────────────────────────────────────────────┘
```

## 数据所有权

### Markdown 正文

所有权：CodeMirror `EditorState`。

规则：

- Markdown 正文不进入 React 全局 store。
- React 不订阅全文内容。
- 保存时从 CodeMirror 读取当前文档文本。
- AST、outline、Mermaid 预览、搜索结果都是派生数据。

### 文件状态

所有权：应用状态层 + Rust 文件系统层。

前端保存：

- 当前文件路径。
- dirty 状态。
- 恢复草稿仅保存在 `services/drafts` 的本地持久化槽；React 状态只保留是否有待用户决策的草稿元数据，正文仍从 CodeMirror 读取。恢复总是作为新未保存文档，详见 [ADR 0004](../decisions/0004-local-recovery-drafts.md)。
- 最近文件列表。
- 当前 workspace。
- UI 展开状态。

Rust 保存：

- 文件读写。
- 路径规范化。
- 文件监听。
- 工作区扫描。
- 搜索和索引。
- 缓存。

### UI 状态

所有权：Zustand store。

适合放入 store：

- 当前主题。
- 当前语言。
- 当前布局状态。
- 侧边栏打开状态。
- 当前文件 path。
- dirty 状态。
- 命令面板状态。
- 最近文件元数据。

不放入 store：

- Markdown 全文。
- 每次输入的临时内容。
- CodeMirror 内部选区细节。
- Mermaid 渲染中的大 SVG 内容。

## 技术选型表

| 层级 | 默认选型 | 替代方案 | 决策 |
|---|---|---|---|
| 桌面框架 | Tauri v2 | Electron | 选 Tauri。轻量，Rust 后端适合系统能力。 |
| 前端框架 | React + TypeScript | Vue/Svelte/Solid | 选 React。生态成熟，组件库丰富，AI 生成质量更稳。 |
| 构建工具 | Vite | Webpack/Rspack | 选 Vite。与 React、Vitest、Tauri 组合成熟。 |
| 包管理 | pnpm | npm/yarn | 选 pnpm。依赖安装快，lockfile 稳定，适合后续 monorepo。 |
| 编辑器核心 | CodeMirror 6 | Milkdown/ProseMirror/Monaco | 选 CodeMirror 6。性能、源码保真和可视区渲染更符合目标。 |
| Markdown 交互解析 | `@codemirror/lang-markdown` / Lezer | remark 作为热路径 parser | 编辑热路径选 CodeMirror/Lezer；remark 只用于导出或离线处理。 |
| Markdown 表格交互 | `codemirror-markdown-tables` | 自研 TableWidget / Milkdown / Toast UI / ProseMirror tables | 选 `codemirror-markdown-tables`。在 CodeMirror 6 内提供成熟表格 widget、单元格编辑、行列操作、复制粘贴和 table autocompletion；LumaMark 只做薄集成和主题适配。详见 [ADR 0002](../decisions/0002-codemirror-markdown-tables.md)。 |
| UI 基础组件 | Radix Primitives | Ariakit/Base UI/React Aria | 默认 Radix。若单个组件不满足，再按组件替换。 |
| 视觉样式 | CSS variables + CSS Modules | Tailwind/shadcn/ui | 默认 CSS tokens + CSS Modules。暂不引入 shadcn 生成组件，避免基础组件变成自维护代码。 |
| 图标 | lucide-react | Radix Icons | 选 lucide-react。图标覆盖更广。 |
| 应用状态 | Zustand | Redux/Jotai/TanStack Store | 选 Zustand。轻量、低样板、适合桌面应用状态。 |
| 路由 | 暂不引入路由 | TanStack Router/React Router | V1 以单窗口应用状态为主；多页面需求明确后再引入。 |
| 长列表虚拟化 | TanStack Virtual | react-window | 选 TanStack Virtual。headless，适合自定义 UI。 |
| 文件树 | react-arborist 候选 | 自研树 + TanStack Virtual | 优先评估 react-arborist；不手搓树。 |
| 分栏布局 | react-resizable-panels 候选 | 自研拖拽分栏 | 优先评估 react-resizable-panels；不手搓拖拽布局。 |
| 命令面板 | cmdk 候选 | 自研命令面板 | 优先评估 cmdk；不手搓基础命令面板。 |
| i18n | i18next + react-i18next | Lingui/FormatJS | 默认 i18next。生态成熟，React 支持稳定。 |
| 单元测试 | Vitest | Jest | 选 Vitest。与 Vite 原生集成。 |
| E2E | Playwright | Cypress | 选 Playwright。适合自动化桌面 WebView 体验验证。 |
| Mermaid | mermaid 官方包 | 自研渲染/第三方包装 | 用官方 Mermaid，外层自建异步调度和缓存。 |
| 数学公式 | KaTeX | MathJax | 默认 KaTeX。速度优先；兼容性不足时再评估 MathJax。 |

## 前端模块划分

建议目录：

```text
src/
├─ app/
│  ├─ App.tsx
│  ├─ containers/
│  ├─ controllers/
│  ├─ providers/
│  ├─ shell/
│  └─ stores/
├─ editor/
│  ├─ capabilities/
│  ├─ core/
│  ├─ markdown/
│  ├─ wysiwyg/
│  ├─ widgets/        # compatibility re-exports only
│  ├─ commands/
│  └─ metrics/
├─ features/
│  ├─ commands/
│  ├─ file-actions/
│  ├─ workspace/
│  ├─ outline/
│  ├─ search/
│  ├─ settings/
│  ├─ command-palette/
│  └─ recent-files/
├─ services/
│  ├─ tauri/
│  ├─ files/
│  ├─ workspace/
│  ├─ render-jobs/
│  └─ telemetry/
├─ shared/
│  ├─ components/
│  ├─ i18n/
│  ├─ icons/
│  ├─ styles/
│  └─ types/
└─ tests/
```

### `app`

负责应用启动和全局 provider。

包含：

- i18n provider。
- theme provider。
- app store 初始化。
- shell layout。
- 全局错误边界。

整改门禁：

- `AppShell` 只能组合 `useAppShellModel`、`useAppShellSlots` 和 `AppShellView`，不直接调用文件、工作区、编辑器表格或 Tauri service 细节。
- `app/shell/**` 是纯渲染层：只消费 props、labels、callbacks 和 ReactNode slots；不能 import store、service、workflow、editor command 或窗口控制实现。
- `app/controllers/` 拆为独立子域 hook：document、workspace、commands、editor、settings、window；不能再形成新的总控大文件。
- `app/containers/` 负责把 feature UI 容器装配成 shell slots；shell view 不知道 feature workflow 或 store。
- 菜单、命令面板和右键菜单必须消费 `features/commands` 的同一组 command model，不能在 shell JSX 或 controller 中重复定义同一业务动作。
- i18n label 生成放在 controller/model 层，渲染组件只消费字符串。
- `tests/quality/architectureBoundaries.test.ts` 是当前架构止血边界测试，新增 shell/workflow/editor widget 改动时必须保持通过。

### `editor`

负责 CodeMirror 封装和所有编辑器扩展。

边界：

- 不依赖文件树、设置页等业务 UI。
- 暴露清晰的 editor API。
- 只向 React 抛出轻量事件，例如 dirty、selection summary、outline changed。
- Markdown 全文不通过 React store 广播。

推荐子模块：

- `core`：CodeMirror view/state 初始化。
- `capabilities`：Mermaid、table、code block、image 等可独立演进的编辑器子能力。
- `markdown`：Markdown 语言包和语法工具。
- `wysiwyg`：Typora-like 通用 visual decorations 组合层，只保留低成本、源码保真的通用视觉规则，不持有复杂子能力主体实现。
- `widgets`：旧路径兼容导出；新能力不得把主体实现放回这里。
- `commands`：编辑器命令和快捷键。
- `metrics`：输入延迟、渲染耗时、scroll 采样。

Editor capability 边界：

- 每个复杂编辑器子功能进入 `editor/capabilities/<name>/`，例如 `mermaid`、`table`、`code-block`、`image`。
- 每个 capability 通过一个薄 public entry 暴露 extension、command factory 和必要类型；主体实现拆到 detection、DOM、adapter、commands、decorations 等子模块。
- `editor/core/**` 只能消费 capability 聚合入口，不能 import capability 内部文件或旧 `widgets/*` 内部文件。
- `editor/commands/**` 只能通过 capability command factory 调用表格、代码块等能力，不能直接 import table widget、Mermaid widget 或 code-block decoration internals。
- `editor/widgets/**` 只允许保留兼容 re-export，不能继续承载新主体实现。
- 通用 `wysiwyg/markdownDecorations.ts` 可以负责标题、引用、列表 marker、inline mark 隐藏等低成本 syntax visual rule，也可以组合 capability 暴露的 decoration builder；代码块、图片、Mermaid、表格交互增强行为不得重新堆回通用 WYSIWYG 文件。

编辑器命令边界：

- app 层只调用 `editor/commands/editorCommandPort.ts` 暴露的 `EditorDocumentPort` 和 `EditorCommandPort`。
- Markdown format、table command、display mode、range selection 等具体 CodeMirror 命令不能散落 import 到 shell 渲染层或 feature UI。
- `EditorDocumentPort` 只提供 `getText()`、`loadText(text)`、`focus()`、`setContext(context)` 等轻量能力，避免 React 层持有 Markdown 全文。

Mermaid capability 拆分要求：

- public entry 保持 `editor/widgets/mermaid/MermaidWidget.ts`，只做兼容导出。
- 主体实现位于 `editor/capabilities/mermaid/`。
- `createMermaidCapability.ts` 只组装 public capability。
- `mermaidPreviewExtension.ts` 只组装 CodeMirror extension/state field。
- `mermaidBlockDetection.ts` 负责 fenced block 检测和类型。
- `MermaidBlockWidget.ts` 负责 `WidgetType` lifecycle 和 DOM view 协调。
- `mermaidWidgetDom.ts` 负责按钮、状态、svg container 等 DOM 创建。
- `mermaidInlineEditor.ts` 负责 inline editor 创建、事件和 flush。
- `mermaidRenderAdapter.ts` 负责 Mermaid dynamic import、safe config 和 render。
- `mermaidEditingState.ts` 负责正在编辑 block 的状态。
- 后续性能优化应优先在 `mermaidPreviewExtension` 的 block 收集和 decoration 构建路径上做增量化，不能把复杂逻辑重新堆回 public entry。

Table/code-block/image capability 规则：

- table capability 使用 `codemirror-markdown-tables`，LumaMark 只做 thin extension、theme、insert/copy/delete command factory，以及 inactive cell inline Markdown 薄渲染层；复杂表格交互仍以成熟组件为准。
- code-block capability 负责 fenced/indented code block decoration、整块行级 preview class 和 wrap command；代码高亮通过 CodeMirror 官方语言包接入。
- image capability 负责 image-only Markdown preview、relative path resolution、image DOM widget 和注入式远程图片 resolver；不直接依赖 workspace、file tree、app shell 或 Tauri service。

当前能力边界审计结论：

- 已独立的能力：`mermaid`、`table`、`code-block`、`image` 都有独立 capability 目录和薄 public entry；`editor/core/**` 与 `editor/commands/**` 不直接 import capability 内部实现。
- 允许的共享层：`editor/capabilities/index.ts` 只做 capability 和通用 WYSIWYG extension 组装；不得出现 DOM 创建、语法树扫描、渲染调度、第三方 widget 配置等主体逻辑。
- 允许的通用 WYSIWYG：`wysiwyg/markdownDecorations.ts` 只处理所有 Markdown 都会共享的视觉规则，以及 capability decoration builder 的组合。它不能拥有异步渲染、block widget lifecycle、文件路径解析、table 命令、Mermaid 编辑器或 image preview DOM。
- 已修正的依赖方向：capability 内部不能反向 import `app`、`features`、`services` 或 `wysiwyg` 私有类型；跨 capability 共享的 decoration range 类型放在 `editor/markdown`。
- 仍需治理的债务：`imagePreviewExtension.ts` 目前仍集中 detection、path resolution、StateField 和 DOM widget，若继续增加 toolbar、cache、async size probing 或错误恢复，应拆为 `imageBlockDetection`、`imagePathResolver`、`ImageBlockWidget`、`imagePreviewExtension`。
- 仍需治理的债务：表格的源码视觉 class 仍在通用 WYSIWYG 里，表格交互和 inactive cell inline Markdown 薄渲染已在 table capability 里。若表格视觉规则继续增长，应迁入 table capability 提供的 decoration builder。
- 仍需治理的债务：任务列表 checkbox、`Mod-Enter` toggle 和列表 marker 仍在通用 WYSIWYG/list command 附近。若后续出现 task-list toolbar、批量操作、嵌套列表专门逻辑，应新增 `editor/capabilities/list` 或 `editor/capabilities/task-list`，不能继续扩大 `markdownDecorations.ts`。
- 兼容层债务：`editor/widgets/*` 只允许 re-export。迁移完成且调用方稳定后，应删除旧路径和对应 re-export 测试，而不是在旧路径继续加逻辑。

自动化门禁：

- `tests/quality/architectureBoundaries.test.ts` 必须阻止 shell render component 直接调用业务能力。
- 同一测试必须阻止 `editor/core/**`、`editor/commands/**` 直接 import capability 内部文件。
- 同一测试必须阻止 `editor/capabilities/**` 反向 import app、feature、service 层。
- 同一测试必须限制 `editor/capabilities/index.ts` 保持薄组装入口，不能成为新的总控文件。

### `features`

负责独立产品功能。

每个 feature 只通过 service/editor API 与其他层交互，避免横向耦合。

feature workflow 规则：

- 文件打开、保存、另存为、dirty revision 和 recent files 通过 `features/file-actions` 的 workflow 收口。
- 当前文档的磁盘监听事件也由 `features/file-actions` 收口：clean 自动重载，dirty 只产生显式冲突决策，同文档 request id 和跨文档 generation 都必须阻止旧读取晚到覆盖。
- `features/file-actions` 通过 `FileStateAdapter`、`StatusAdapter`、`EditorDocumentPort` 接收状态和编辑器能力，不能硬依赖 `appStore`。
- 工作区打开、children lazy load、stale request 防护通过 `features/workspace` 的 workflow 收口。
- `features/workspace` 拆为 workflow、selectors、view model/UI-facing 类型；打开文件只通过注入 callback，不知道 file workflow 实现。
- `features/commands` 是 command id、label、shortcut、enabled 状态和 run handler 的唯一 command model 来源。
- `features/*/components/**` 只负责渲染；需要业务行为时由 feature container、workflow 或 app container 注入 props。
- feature 可以组合 editor API 和 service facade，但不能持有 Markdown 全文。

### `services`

负责与 Tauri、渲染任务、缓存、性能记录通信。

所有 Tauri command 必须通过 typed wrapper 调用，不允许在 UI 组件里直接散落 `invoke()`。

当前强制边界：

- workspace Tauri wrapper 位于 `services/workspace/`，`features/workspace/` 只保留 workflow、store 和 UI-facing 类型使用。
- 文件监听 command/event wrapper 位于 `services/file-watch/`；打开结果 fingerprint 与 watch baseline 在这里形成竞态握手。图片 resolver 只向该 facade 串行同步已授权本地目标，editor capability 不直接依赖 Tauri。
- services 不能依赖 React 组件、Zustand store 或 app shell。

### `shared`

只放通用基础设施：

- 成熟组件的轻量封装。
- 设计 token。
- i18n 初始化。
- 图标别名。
- 共享类型。

`shared/components` 不能变成自研组件库。它只允许组合成熟组件和项目视觉样式。

## 前端依赖方向和端口

当前前端必须按以下方向依赖：

```text
app/shell view
  <- app/containers
  <- app/controllers
  <- features workflows + feature containers
  <- services + editor ports
  <- Tauri commands / CodeMirror internals
```

允许的调用关系：

- `app/shell/**` 只接收 props，不直接调用业务能力。
- `app/containers/**` 可以组合 shell view 和 feature UI container，但不实现业务流程。
- `app/controllers/**` 可以组合 feature workflow、editor port、i18n label、轻量 app state 和窗口级 callbacks。
- `features/**` 可以组合 service facade 和 editor port，但不能依赖具体 app shell，也不能持有 Markdown 全文。
- `services/**` 只暴露 typed command client 或纯 service facade，不依赖 React、Zustand、editor 或 app。
- `editor/**` 暴露稳定 `EditorApi`、`EditorDocumentPort`、`EditorCommandPort` 和轻量事件，不依赖 app shell、file tree、settings 或 workspace UI。

禁止的调用关系：

- shell render component import `useAppStore`、feature workflow、service wrapper、Tauri command、editor table command 或 window control adapter。
- feature UI component 直接调用 service/store；需要业务动作时从 container 或 workflow 注入。
- service import React 组件、hook、Zustand store 或 CodeMirror view。
- app controller 重新定义菜单、命令面板和右键菜单的动作列表；这些动作必须来自 `features/commands`。

轻量端口：

```ts
interface EditorDocumentPort {
  getText(): string
  loadText(text: string): void
  focus(): void
  setContext(context: EditorDocumentContext): void
}

interface EditorCommandPort {
  runFormat(command: MarkdownFormatCommand): void
  copyTable(): void
  deleteTable(): void
  setDisplayMode(mode: EditorDisplayMode): void
  selectRange(position: number): void
}

interface StatusAdapter {
  setStatusKey(statusKey: string): void
}
```

这些端口是跨层协作边界，不是新的全局抽象层。端口只放已经跨层使用、且需要隔离实现细节的最小能力。

## Rust 模块划分

建议目录：

```text
src-tauri/src/
├─ main.rs
├─ commands/
│  ├─ files.rs
│  ├─ file_watch.rs
│  ├─ workspace.rs
│  ├─ search.rs
│  ├─ cache.rs
│  └─ app.rs
├─ services/
│  ├─ file_service.rs
│  ├─ file_watch_service.rs
│  ├─ workspace_service.rs
│  ├─ search_service.rs
│  └─ cache_service.rs
├─ models/
├─ errors.rs
└─ state.rs
```

### Rust 负责

- 读文件。
- 写文件。
- 原子保存。
- 路径规范化。
- 文件监听。
- 当前 Markdown 与已授权本地图片使用父目录非递归 watcher、精确目标过滤和内容 fingerprint；事件不得直接被当作最终文件状态。
- 工作区扫描。
- 搜索。
- 缓存。
- 系统集成。

### Rust 不负责

- UI 状态。
- 编辑器光标和选区。
- Markdown WYSIWYG decorations。
- React 组件逻辑。

## Tauri Command 设计

命名规则：

```text
files.read_text
files.write_text
files.show_open_dialog
watch_document
replace_local_image_targets
unwatch_document
workspace.open
workspace.list_children
workspace.watch
search.query
cache.get
cache.set
app.get_system_info
```

返回结构统一：

```ts
type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
```

错误结构：

```ts
interface AppError {
  code: string
  message: string
  details?: unknown
  recoverable: boolean
}
```

规则：

- UI 组件不直接调用 `invoke()`。
- 所有 command 都有 TypeScript wrapper。
- Rust 错误转换为稳定错误码。
- 用户可见错误信息走 i18n，不直接显示 Rust 原始错误。

## 核心数据流

### 打开文件

```text
User action
-> dialog plugin / Rust command
-> Rust read file
-> frontend receives text + metadata
-> create CodeMirror EditorState
-> update app store currentFile
-> run outline/fixture/perf hooks as needed
```

要求：

- 打开大文件不能冻结 UI。
- 文件内容进入 CodeMirror，不进入全局 store。
- 文件编码问题必须显式报错。

### 外部文件与图片变更

```text
Rust parent-directory watcher
-> 200ms debounce + exact target filter
-> bounded retry + read/hash current target
-> file-watch://changed
-> service facade
-> clean document reload / dirty conflict decision / targeted image preview revision
```

要求：

- 监听范围只包含当前 Markdown 和已授权本地图片，不递归授权或监听整个工作区。
- Markdown 事件到达后必须重新读取；图片事件只能刷新运行时 asset URL，不能改写 Markdown。
- 本地图片授权路径、watcher 事件路径和前端 revision key 必须使用同一词法路径身份：折叠 `.` / `..`、统一分隔符，并在 Windows 下忽略大小写；不能把字符串拼写差异当成不同文件。
- 文档 target 和图片 target 分别管理；替换/取消文档监听不能清空已同步的图片 targets。
- 打开/写入 fingerprint 与 watcher baseline 必须同源；临时读取失败通过单一合并 worker 有界重试，事件串行发送，前端仍按 revision 丢弃迟到事件；耗尽的 `error` 事件只能显示可恢复提示。
- 文档切换、引用集合变化和 React cleanup 必须释放旧监听；自身保存的相同 fingerprint 不产生用户冲突。

### 编辑文档

```text
User input
-> CodeMirror transaction
-> CodeMirror updates doc/view
-> editor plugins update decorations/widgets
-> debounced lightweight events to React
```

要求：

- React 不接收每次全文变化。
- 复杂派生任务 debounce 或 idle scheduling。
- 输入延迟作为指标记录。

### 保存文件

```text
Save command
-> read current doc from CodeMirror
-> Rust atomic write
-> update dirty state
-> optional round-trip guard in tests
```

要求：

- 不格式化整篇文档。
- 不改变未编辑区域。
- 写入失败必须保留 dirty 状态。
- 错误必须可恢复、可理解。

### Mermaid 渲染

```text
CodeMirror detects mermaid block
-> widget requests render job
-> render scheduler debounce/cancel/cache
-> dynamic import mermaid
-> mermaid render
-> widget receives SVG or error
```

要求：

- 不在输入同步路径渲染。
- 同一源码重复渲染命中缓存。
- 过期任务必须丢弃。
- 渲染失败不影响编辑。

### 搜索

V1 搜索分两层：

- 当前文档搜索：优先用 CodeMirror search 能力。
- 工作区搜索：Rust 负责扫描和查询。

全文索引进入后续阶段，不在 Foundation 阶段锁死。

## 编辑器 WYSIWYG 分层

Typora-like 行为分三层实现：

### 视觉层

用 decorations 改变展示：

- 标题字号。
- 粗体/斜体样式。
- 引用样式。
- 列表 marker 样式。
- Markdown 符号弱化或隐藏。

### Capability 和 Widget 层

用 editor capabilities 管理复杂编辑器子功能，用 block widgets 展示需要替换或增强渲染的复杂块：

- 表格。
- Mermaid。
- 公式。
- 图片预览。
- 未来图表。

capability 规则：

- capability 是长期边界，负责 extension、commands、DOM widget、render adapter、检测逻辑和性能 hooks 的组合。
- widget 是 capability 内部实现细节；旧 `editor/widgets/*` 路径只作为兼容导出。
- 新增复杂块能力时，先创建 capability，不把逻辑散落到 `core`、`commands`、`wysiwyg` 或 app shell。

表格 widget 规则：

- live preview 表格交互由 `codemirror-markdown-tables` 提供，Markdown 源文仍由 CodeMirror 文档持有。
- source mode 不启用表格 widget，显示原始 Markdown 表格。
- LumaMark 只实现薄命令，例如复制当前表格源码、删除当前表格 block，以及主题适配。
- 行列插入、删除、移动、选择、复制粘贴、单元格编辑和 table autocompletion 以成熟组件行为为准，不再自研表格编辑器。

### 命令层

用 editor commands 改变文本：

- toggle bold。
- toggle italic。
- 插入任务列表。
- 列表缩进。
- 代码块插入。

规则：

- 视觉层不改变源码。
- 命令层只改变用户明确操作的文本范围。
- Widget 层必须能回到源码编辑。

## 性能设计

### 热路径

以下路径必须尽量留在 CodeMirror 或浏览器高效路径中：

- 输入。
- 光标。
- 选区。
- 滚动。
- 基础 decorations。

### 冷路径

以下路径必须异步：

- Mermaid。
- 公式批量渲染。
- 图片尺寸读取。
- 工作区搜索。
- 导出。
- 大纲全量重建。

### 性能指标

必须持续测量：

- app startup。
- file open。
- typing latency。
- scroll smoothness。
- render job duration。
- memory usage。
- save duration。

## 成熟组件使用边界

成熟组件优先，但不能无脑堆依赖。

引入依赖前必须确认：

- 是否解决真实问题。
- 是否位于编辑热路径。
- 是否可访问性足够。
- 是否支持 TypeScript。
- 是否主题可控。
- 是否会增加明显包体积或启动成本。

如果成熟组件不满足目标，必须先记录证据并请求用户确认，再自研。

## 实现前必须验证的候选

以下选型是当前推荐，但进入实现前要做小样验证：

- `react-arborist`：文件树是否满足 Windows 路径、懒加载、虚拟化、键盘导航。
- `react-resizable-panels`：是否满足 Typora-like 固定/折叠侧边栏体验。
- `cmdk`：是否满足命令面板、i18n、快捷键和大量命令性能。
- `KaTeX`：是否满足目标数学公式兼容范围。
- 工作区搜索库：先用简单 Rust 扫描还是直接引入索引库，需要根据 V1 范围决定。

验证失败不等于立刻自研。优先寻找同类成熟替代。

## 架构反模式

禁止：

- React store 持有 Markdown 全文。
- 每个 Markdown 块都是 React component。
- 保存时重新 stringify 整个 Markdown AST。
- Mermaid 同步渲染。
- 外层虚拟滚动包裹 CodeMirror 编辑区。
- 自研菜单、对话框、tooltip、树、命令面板。
- 为了“更强控制力”绕过 CodeMirror 输入模型。
- 缺少 benchmark 就做编辑核心大改。

## 参考来源

- Tauri v2 架构与 command：<https://v2.tauri.app/concept/architecture/>、<https://v2.tauri.app/develop/calling-rust/>
- CodeMirror 6 reference 与 decorations：<https://codemirror.net/docs/ref/>、<https://codemirror.net/examples/decoration/>
- Radix Primitives：<https://www.radix-ui.com/primitives>
- TanStack Virtual：<https://tanstack.com/virtual/latest/docs/introduction>
- react-i18next：<https://react.i18next.com/>
- Vitest：<https://vitest.dev/guide/>
- Playwright：<https://playwright.dev/>
- Mermaid usage：<https://mermaid.js.org/config/usage.html>
- KaTeX：<https://katex.org/>
