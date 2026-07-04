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
   ├─ Radix Primitives：基础交互组件
   ├─ Zustand：轻量应用状态
   ├─ i18next/react-i18next：多语言
   ├─ TanStack Virtual / react-arborist：长列表和文件树
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
│  ├─ providers/
│  ├─ shell/
│  └─ stores/
├─ editor/
│  ├─ core/
│  ├─ markdown/
│  ├─ wysiwyg/
│  ├─ widgets/
│  ├─ commands/
│  └─ metrics/
├─ features/
│  ├─ workspace/
│  ├─ outline/
│  ├─ search/
│  ├─ settings/
│  ├─ command-palette/
│  └─ recent-files/
├─ services/
│  ├─ tauri/
│  ├─ files/
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

### `editor`

负责 CodeMirror 封装和所有编辑器扩展。

边界：

- 不依赖文件树、设置页等业务 UI。
- 暴露清晰的 editor API。
- 只向 React 抛出轻量事件，例如 dirty、selection summary、outline changed。
- Markdown 全文不通过 React store 广播。

推荐子模块：

- `core`：CodeMirror view/state 初始化。
- `markdown`：Markdown 语言包和语法工具。
- `wysiwyg`：Typora-like decorations。
- `widgets`：Mermaid、图片、公式等块级 widget。
- `commands`：编辑器命令和快捷键。
- `metrics`：输入延迟、渲染耗时、scroll 采样。

### `features`

负责独立产品功能。

每个 feature 只通过 service/editor API 与其他层交互，避免横向耦合。

### `services`

负责与 Tauri、渲染任务、缓存、性能记录通信。

所有 Tauri command 必须通过 typed wrapper 调用，不允许在 UI 组件里直接散落 `invoke()`。

### `shared`

只放通用基础设施：

- 成熟组件的轻量封装。
- 设计 token。
- i18n 初始化。
- 图标别名。
- 共享类型。

`shared/components` 不能变成自研组件库。它只允许组合成熟组件和项目视觉样式。

## Rust 模块划分

建议目录：

```text
src-tauri/src/
├─ main.rs
├─ commands/
│  ├─ files.rs
│  ├─ workspace.rs
│  ├─ search.rs
│  ├─ cache.rs
│  └─ app.rs
├─ services/
│  ├─ file_service.rs
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

### Widget 层

用 block widgets 展示复杂块：

- Mermaid。
- 公式。
- 图片预览。
- 未来图表。

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
