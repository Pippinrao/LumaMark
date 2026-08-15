# LumaMark 菜单系统设计

> 本文定义 LumaMark **顶栏菜单、编辑器/文件树右键菜单与命令面板** 共用的产品结构、视觉方向、命令合同、Typora 基线映射与验收标准。它面向菜单实现者、测试人员和后续 Markdown capability 维护者；当前实施顺序仍以 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。设置页不在本文范围，见 [设置系统设计](SETTINGS_SYSTEM_DESIGN.md)。外部打开与文件变更依赖见 [ADR 0015](../decisions/0015-external-open-and-file-mutations.md)。

## 用途与范围

顶栏菜单改造已解决视觉粗糙、入口错配与状态不清问题。本文继续约束右键菜单与统一命令模型，使三类入口不分裂为多套事实源。范围包括：

- 顶部菜单的高对比桌面工具视觉。
- 文件、编辑、段落、格式、视图、主题、语言和帮助入口。
- **编辑区、文件树等上下文菜单（右键）**。
- 菜单、**右键**、快捷键和命令面板共用同一命令事实源。
- 分隔线、子菜单、checkbox、radio、图标、快捷键列和禁用态。
- 已有 Markdown capability 的准确接线与 Typora 已核实快捷键。
- Web Playwright、生产 Web E2E 和 Windows Tauri 实机截图验收。
- 菜单与右键覆盖矩阵，明确已接入能力与尚未实现的专题能力。

## 非目标

- 不在本轮实现数学、脚注、TOC、Callout、YAML Front Matter 或受限 HTML capability。
- 不为未实现能力添加“即将推出”、永久禁用或点击无反应的虚假菜单项。
- 不复制 Typora 品牌、图标、主题素材或未公开实现。
- 不将 Markdown 全文、编辑器高频状态或平台细节放入 React store。
- 不替换 CodeMirror、Radix Menubar / Context Menu、命令面板或 Tauri 架构。
- 不单独维护第二套右键命令注册表或第二份菜单设计文档。
- 大纲右键（复制标题锚点等）在共享 heading identity 落地前不做，避免第二套锚点身份。

## 事实来源

Typora 行为只取自 [Typora 行为基线](typora-baseline/README.md)；LumaMark 当前状态只取自 [Typora 专题竞争分析](typora-competitive-analysis/README.md) 和当前代码、测试。证据不足的 Typora 菜单路径或键位不会被写成已确认事实。

本设计重点复核了：

- [Live Preview 横切模型](typora-baseline/00-live-preview-model.md)：源码模式 `Ctrl+/`、复制为 Markdown `Ctrl+Shift+C`、粘贴为纯文本 `Ctrl+Shift+V`。
- [标题](typora-baseline/02-headings.md)：标题 1–6 使用 `Ctrl+1…6`。
- [图片](typora-baseline/07-images.md)：插入本地图片使用 `Ctrl+Shift+I`，入口位于 Format → Image。
- [代码块](typora-baseline/08-code-blocks.md)：插入代码围栏使用 `Ctrl+Shift+K`。
- [表格](typora-baseline/10-tables.md)：插表 `Ctrl+T`、选行 `Ctrl+L`、选单元格 `Ctrl+E`、删行 `Ctrl+Shift+Backspace`。
- [数学](typora-baseline/09-math.md)：数学块使用 `Ctrl+Shift+M`，但 LumaMark 当前未实现数学 capability。
- [Mermaid](typora-baseline/11-mermaid-and-diagrams.md)、[脚注](typora-baseline/12-footnotes.md)、[分割线](typora-baseline/13-horizontal-rules.md) 与 [TOC](typora-baseline/15-toc.md)：没有已核实的专用默认快捷键。

## 改造前问题与根因

改造前的 `CommandMenuItem` 只能表达扁平 action、label、shortcut 和 disabled。`TopChrome` 直接映射每个项目为 `Menubar.Item`，因此不能准确表达分组、子菜单、选中状态或动态结构。旧 `runAction` 将字符串强制转换为 action 类型，未知 action 缺少显式失败路径。菜单标签和真实行为也曾存在错配，例如“关于 LumaMark”实际打开设置、当前显示模式只显示另一个切换动作、主题和语言只显示含义不清的 toggle。当前实现已收敛到递归节点、统一 registry 与类型安全 dispatcher；保留本段用于解释设计来源，而不是描述现状。

旧视觉层只有基础矩形浮层和单色 hover；图标、分隔、状态列、子菜单箭头、可见焦点、进出动画和暗色层级均缺失。表格复制和删除曾常驻编辑菜单，但在非表格上下文可能没有结果，强化了“菜单不可用”的感受。

## 方案选择

### 采用：Radix 菜单系统重构

继续使用已安装且成熟的 `@radix-ui/react-menubar`，建立递归菜单模型和统一命令注册表。Radix 负责方向键、Home/End、Escape、typeahead、焦点管理和 ARIA 基线；LumaMark 负责命令状态、编辑器焦点合同、图标、视觉和 E2E。

### 未采用：Tauri 原生系统菜单

原生菜单的系统助记键和辅助技术集成更直接，但其字体、行高、图标、圆角、高亮和阴影主要由操作系统决定，无法兑现已确认的强视觉方向。Playwright 也无法直接操作或截图系统菜单，需要额外的 Windows UI Automation 链路。原生菜单还会让 WebView 命令与系统菜单状态形成双轨事实源。只有产品未来明确优先系统原生外观并接受平台差异时才复审。

Radix 菜单重构本身继续使用现有成熟组件，不引入主要依赖，也不改变应用架构，因此无需单独新增 ADR；本轮外部 opener、工作区文件变更与权限边界另由 [ADR 0015](../decisions/0015-external-open-and-file-mutations.md) 记录。

## 视觉设计

采用“强视觉桌面工具”方向：

- 顶部触发区保持紧凑，但提供清晰的 hover、open 和 `focus-visible` 状态。
- 浮层采用较大的命中区、完整图标列、深色高对比选中态和明确阴影层级。
- label、shortcut、state/check 和 submenu arrow 使用稳定列宽，长文案不挤压快捷键。
- 分组用细分隔线表达，不用多余说明文字。
- 亮色和暗色主题使用相同层级关系；disabled、highlighted、checked 不能只依赖颜色。
- 动画只用于淡入和轻微位移，并尊重 `prefers-reduced-motion`。
- Windows 高对比模式保留边框、焦点轮廓和选中标记。
- 原生窗口拖拽只允许从无控件的空白 title strip 开始。菜单 portal 虽挂到 `document.body`，React 合成事件仍可能回到标题栏；`shouldStartChromeDragging` 必须拒绝 non-descendant portal、`[data-lm-window-interactive]`、`[role="menu"]` / `menuitem*` 与 `.lm-menu-content`，菜单触发器和窗口控制同样标记为可交互区域。

## 架构与模块边界

```text
app/controllers 当前轻量状态
            │
            ▼
features/commands 统一命令注册表
            │
            ├── 顶部递归菜单模型
            ├── 命令面板模型
            ├── 上下文（右键）菜单模型
            └── 全局 / CodeMirror 快捷键
            │
            ▼
app/shell 菜单 / ContextMenuSurface 渲染
            ──► 类型安全 dispatcher ──► editor / feature / service handler
```

- `features/commands` 是命令 ID、i18n key、图标、快捷键、节点组合与可用性规则的唯一事实源；`app/controllers` 注入无参数 action 与带 payload action 的完整类型安全执行映射，shell 只分发 invocation。
- 顶栏与右键共用可区分联合节点类型：`item`、`label`、`separator`、`submenu`、`checkbox`、`radio`（含 `disabled`、`icon`、`shortcut`）。废弃仅含 `action/label/shortcut` 的精简 `CommandContextMenuItem`。
- `app/controllers` 只注入 `fileOpening`、display mode、sidebar、focus mode、theme、language、recent files 与右键命中目标等轻量状态。
- `app/shell` 只递归渲染 Radix primitives（Menubar / ContextMenu），不读取 Markdown 全文；`EditorPane` 是唯一薄 DOM→editor public interaction adapter，用外层 `EditorApi` 的坐标/DOM 命中接口取得已分类 target，目标语义与命令仍由 `editor/interaction` 和 command model 决定。抽出 `ContextMenuSurface` 供编辑器与文件树复用。
- 编辑器 action 通过稳定 command port 执行，不让 feature 或 shell 读取 Markdown 全文。
- `CommandNode` 的可区分联合类型不能表示未知 action；若运行时伪造 invocation，dispatcher 会失败且不得静默 fallback，生产 UI 只生成类型系统覆盖的 action。
- 动态最近文件使用 `openRecentFile` 的类型安全 payload invocation 携带路径；路径不进入 action ID，也不能绕过统一 dispatcher 注入任意 callback。

## 命令执行与焦点合同

1. 顶栏或右键菜单打开不得清空 CodeMirror selection。
2. 格式、段落、撤销、重做和查找等**顶栏**动作对菜单打开前的 selection 执行。
3. **右键目标专属命令**的作用点是右键命中位置（文档坐标或树节点），不是当前光标位置；「复制链接地址」必须复制命中链接的 URL，图片删除与表格复制/删除必须携带命中 range。普通剪切、复制、粘贴与全选仍按打开菜单前保留的 selection/cursor 执行。
4. **LumaMark 显式定义：** 右键落在当前选区外时，**不移动光标、不折叠选区**；菜单关闭后 selection 保持打开前状态。目标专属命令使用命中位置而非 `selection.main`，普通剪贴板命令不把右键位置冒充新光标。该行为写入测试并锁定（Typora 基线此处未核实）。
5. 编辑器动作完成后恢复编辑器焦点；打开文件选择器、设置、关于、工作区选择器、系统 opener 或二次确认对话框的动作不强制抢回焦点。
6. 格式与段落动作产生最小 CodeMirror transaction，并保留单次撤销语义。打开右键菜单与只读动作（复制链接、复制路径）的 transaction 必须 `docChanged === false`。
7. action 的成功副作用或失败提示必须可观察，不能静默执行破坏性 fallback。依赖特定命中目标的上下文动作（链接、图片、表格）在不适用时**隐藏不显示**；普通剪切、复制、粘贴、全选等稳定编辑入口保留在菜单中，并按只读态、选区与纯文本剪贴板端口可用性显示 disabled。桌面端口使用官方 Tauri clipboard-manager；原生失败不得回退 WebView navigator。
8. 异步文件动作保留现有错误通知和并发保护，不由菜单吞掉错误。
9. 键盘：Shift+F10 与应用菜单键可打开右键菜单；Escape 关闭并归还焦点。

## 菜单信息结构

### 文件

- 新建文档
- 打开文件
- 打开最近文件（动态子菜单）
- 打开工作区
- 分隔线
- 保存
- 另存为
- 分隔线
- 设置

### 编辑

- 撤销
- 重做
- 分隔线
- 剪切
- 复制
- 粘贴
- 全选
- 分隔线
- 查找
- 命令面板

表格复制和删除不再常驻编辑菜单。相关动作只在真实表格上下文中出现；“删除整张表”必须与 Typora 的“删除表格行”区分。

### 段落

- 普通段落与标题 1–6
- 列表子菜单：有序列表、无序列表、任务列表
- 块子菜单：引用、代码块
- 插入子菜单：表格、分割线

普通段落作为 LumaMark 的明确归一化命令，不冒充 Typora 已核实的独立菜单入口。它只移除当前 ATX heading marker，不重排段落内容。

### 格式

- 加粗
- 斜体
- 删除线
- 行内代码
- 分隔线
- 链接
- 图片

图片命令使用真实本地图片选择和既有 image import pipeline；不再仅插入通用 URL 占位符。

### 视图

- 实时预览 / 源码模式 / 阅读模式 radio group
- 侧边栏 checkbox
- 专注模式 checkbox
- 重置缩放
- 聚焦编辑器

阅读模式与实时预览、源码互斥。它锁定渲染态、拒绝文档变更、隐藏光标并保留选区与查找，属于会话级状态，不写入设置。只读实现方式、控件行为边界和反馈方式见 [ADR 0010](../decisions/0010-reading-mode-readonly-contract.md)。

### 主题与语言

- 亮色 / 暗色 / 跟随系统 radio group；三项与设置 schema 共用 typed action、当前值和 i18n，`system` 不另建命令模型
- 语言菜单：简体中文 / English radio group

### 帮助

- 检查更新
- 关于 LumaMark

“关于”打开独立对话框，显示应用名、版本和产品定位，不再转发到设置。

## 快捷键合同

| 命令 | 菜单显示 | 实现策略 |
|---|---|---|
| 新建 / 打开 / 保存 / 另存为 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | 显示并复用现有全局快捷键 |
| 剪切 / 复制 / 粘贴 / 全选 | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+A` | 顶栏、右键、快捷键共用 EditorCommandPort 与实时可用性判定；app 注入 `services/clipboard` 的纯文本端口，桌面走官方 Tauri plugin、浏览器走 navigator adapter；异步剪贴板完成前校验原选区，失败不误删文本。平台边界见 [ADR 0016](../decisions/0016-tauri-text-clipboard-adapter.md) |
| 命令面板 | `Ctrl+K` | 显示并复用现有全局快捷键 |
| 标题 1–6 | `Ctrl+1…6` | 与 Typora 基线一致；复用 CodeMirror keymap |
| 加粗 / 斜体 | `Ctrl+B` / `Ctrl+I` | 显示现有 LumaMark 键位，不声明为本地基线已核实的 Typora 键位 |
| 图片 | `Ctrl+Shift+I` | 对齐 Typora；菜单、命令面板和快捷键调用真实本地图片流程 |
| 代码块 | `Ctrl+Shift+K` | 对齐 Typora；三个入口调用同一 command |
| 表格 | `Ctrl+T` | 对齐 Typora；当前 `Ctrl+Alt+T` 在迁移期兼容，菜单只显示 `Ctrl+T` |
| 删除整张表 | 独立 LumaMark 键位 | 不复用 Typora `Ctrl+Shift+Backspace`，避免把删行冒充删表 |
| 显示模式循环 | `Ctrl+/` | 键位与 Typora 基线一致，但循环实时预览 → 源码 → 阅读；三个 radio 状态同步，菜单不把该键标注为只属于源码模式 |
| 侧边栏 / 专注模式 | 现有 LumaMark 键位 | 在菜单显示，但不声明为 Typora 基线键位 |

`Ctrl+Shift+C` 复制为 Markdown、`Ctrl+Shift+V` 粘贴为纯文本、表格选行/选单元格/删行和数学块属于已知差距。本轮不注册空动作；它们保留在覆盖矩阵中，由对应 capability 和剪贴板合同实现后接入。

## 右键菜单：上下文命中模型

编辑区上下文最终只由外层文档的 `EditorState` 与语法树判定。普通目标使用外层 `view.posAtCoords()`；表格 widget 的 DOM 只作为命中提示，再用外层 `view.posAtDOM(widget)` 映射回文档位置并校验精确 `Table` 范围。不得读取 widget 内嵌套 `EditorView` 的文档，也不得仅凭 `target.closest('.tbl-table-widget')` 认定表格：

```ts
export type EditorContextTarget =
  | { at: number; kind: 'plain' }
  | { from: number; href: string; kind: 'link'; to: number }
  | { from: number; kind: 'codeBlock'; to: number }
  | { from: number; kind: 'mermaid'; to: number }
  | { from: number; kind: 'selection'; to: number }
  | { from: number; kind: 'table'; to: number }
  | { from: number; kind: 'image'; src: string; to: number };
```

- 普通正文位置由外层 `view.posAtCoords()` 得到；表格 widget 由外层 `view.posAtDOM()` 回到稳定边界，再由语法树确认范围。
- 新增 `deriveInteractionAtPosition(state, pos)`，复用既有 block/inline owner 收集；不改动基于 `state.selection` 的 `deriveEditorInteractionContext`。
- fenced code、行内代码与 protected-source（YAML、`[^id]`、`[toc]`）范围内不产生链接/图片目标。
- 非编辑器区域：文件树用 `react-arborist` 节点数据；大纲暂不实现右键。

```text
右键事件
  ├─ 编辑器普通目标 → outer posAtCoords ───────────┐
  ├─ 表格 widget → outer posAtDOM → Table 校验 ──┴→ EditorContextTarget ─┐
  └─ 文件树 → react-arborist 节点数据 ───────────────→ FileTreeContextTarget ─┤
                                                                          ↓
features/commands 上下文菜单模型
        ↓
ContextMenuSurface（Radix）→ exhaustive typed invocation dispatcher
```

## 右键菜单：各触发对象清单

不适用项隐藏。依赖 [ADR 0015](../decisions/0015-external-open-and-file-mutations.md) 的项在能力未接线前不得显示虚假入口。

### 编辑区通用

- 剪切、复制、粘贴、全选
- 分隔线
- 插入表格

复制为纯文本 / Markdown 等剪贴板合同落地后再接入。

### 链接

- 打开链接（协议白名单；相对路径走应用内打开）
- 复制链接地址

Typora 基线中这两项为已核实（observed）事实，优先实现。

### 图片

- 复制图片路径
- 在文件管理器中显示
- 删除引用（只删 `![]()` 语法，单次可撤销）

删除磁盘文件、移动、重命名：更后批，且删除磁盘文件必须二次确认。

### 表格

- 插入表格（通用区已有）
- 复制表格、删除整表（仅表格命中时）

行列增删与对齐等在表格 capability 补齐后接入同一 command contract。

### Mermaid

当前没有专用右键项；编辑继续走既有预览/源码交互，不为同一动作复制第二入口。复制图像、保存 SVG/PNG/JPG 属后续专题，在 capability 与导出合同落地前不显示虚假菜单。

### 文件树

- 新建文件、新建文件夹
- 重命名
- 删除（回收站语义，见 ADR 0015）
- 在文件管理器中显示
- 复制路径

目录与文件节点菜单项集合可不同；工作区根节点不提供删除。

### 大纲

暂不做。

## 右键安全合同

- 外链：仅 `http` / `https` / `mailto`；`javascript:` / `data:` / `file:` 拒绝并返回明确错误；Rust 为安全边界。
- 工作区写操作：claimed root 必须与 Rust `WorkspaceSession` 当前 canonical 根等价，目标的 canonical 路径必须在该根内；`..`、symlink/junction 逃逸或已失效会话 → `invalid_path`。
- reveal：有工作区时沿用上述 managed-session 边界；standalone 文档仅以“现存文档的 canonical 实际父目录”为可信内置前端 fallback，不宣称抵御 compromised WebView，详细边界见 ADR 0015。
- 重名不覆盖；删除默认进回收站。

## 竞品菜单覆盖矩阵

| 能力 | Typora 基线 | LumaMark 本轮状态 | 菜单策略 |
|---|---|---|---|
| 标题、列表、引用、代码块、分割线 | 已有公开输入或菜单/快捷键证据 | 已接入真实命令；代码块 `Ctrl+Shift+K` 已补齐 | 保持单一 command port；不夸大专题边界体验 |
| 本地图片 | Format → Image，`Ctrl+Shift+I` | 真实多选文件入口和快捷键已接入既有导入 pipeline | 取消不改文档；错误沿用文件通知合同 |
| GFM 表格插入 | `Ctrl+T` | `Ctrl+T` 已接入，旧 `Ctrl+Alt+T` 迁移期兼容 | 顶部菜单只显示标准键位 |
| 表格行列与选择 | 工具栏/上下文菜单及专用键 | 证据不足或未实现 | 不生成虚假顶部入口；保留专题差距 |
| 表格右键复制/删整表 | 上下文菜单 | 已实现（仅表格命中时） | 保持；行列项待 capability |
| 链接右键打开/复制地址 | 已核实 observed | 已实现绝对 URL 白名单、相对文档打开与复制失败提示 | 显示真实命令；前后端双重协议校验 |
| 图片右键资源管理 | Support 记载 | 已实现复制路径、reveal、删引用 | 远程图片不显示本地 reveal；删引用按命中范围执行 |
| 文件树右键 | 非 Typora 编辑区基线；产品需要 | 已实现根/目录/文件场景组合与变更确认 | 回收站删除；路径与目录链接逃逸防护 |
| Copy as Markdown / Paste as Plain Text | 已确认 | 未建立可靠剪贴板合同 | 不显示；作为剪贴板专题高优先级缺口 |
| 数学 | `Ctrl+Shift+M`、Math Tools | 未实现 | 不显示 |
| Mermaid | 围栏键入为主，无专用键 | 已实现主要渲染路径，未接入专用右键 | 当前不显示；编辑走既有预览/源码交互，导出图属后续 |
| YAML Front Matter | 顶部菜单可插入，无专用默认键 | 未实现 | 不显示 |
| 脚注 | 无专用菜单或键 | 未实现 | 不显示 |
| TOC | `[toc]` + Return；专用菜单证据不足 | 未实现 | 不显示 |
| Callout | Paragraph → Alert，无专用默认键 | 未实现 | 不显示 |
| HTML / iframe / video | 键入或粘贴，无通用插入键 | 未实现且安全合同缺失 | 不显示 |

## 2026-08-02 历史菜单重构基线

本节只摘要 2026-08-02 顶栏菜单重构，不代表当前工作树的新鲜验证结果；当时的版本、提交、测试计数与发布产物以 [0.2.1 NSIS-only Release](../release/WINDOWS_V1_BUILD.md#021-nsis-only-release) 为历史事实源。右键与设置系统的本轮验证台账在完成全部门禁后追加到同一 Windows 构建记录，不在产品设计内维护第二份计数。

- 递归 Radix 菜单已经落地，8 个顶层菜单组可表达 action、separator、submenu、checkbox 和 radio；菜单、命令面板与全局快捷键通过同一类型安全 handler map 分发。
- 本地图片入口已接入 Tauri 多选系统对话框与既有图片引用 pipeline；浏览器 E2E 验证菜单和 `Ctrl+Shift+I` 的命令编排，Rust 测试验证 IPC 合同，Windows Tauri 实机验证系统对话框可打开且取消后文档不变。
- `Ctrl+Shift+K`、`Ctrl+T`、`Ctrl+/`、`Ctrl+1…6` 和 `Ctrl+0` 均有自动化命令结果验证；旧 `Ctrl+Alt+T` 迁移键仍受支持。
- 最终自动化结果为 Vitest 637 项、Web Playwright 137 项、生产 bundle Playwright 2 项、Rust 81 项和独立性能基准 23 项全部通过；菜单专项另有 6 项，通过固定 1440×900 视口生成亮色、暗色、二级菜单和英文四种截图。
- Windows Tauri 实机已人工检查顶部菜单、二级结构、快捷键列、源码模式状态和图片系统对话框；真实选择图片后的磁盘导入由分层自动化覆盖，本轮人工步骤只执行取消路径，未修改用户文件。

截图证据随实现一同保存：[亮色中文文件菜单](../../artifacts/menu-system-report/menu-light-file-zh.png)、[暗色中文状态菜单](../../artifacts/menu-system-report/menu-dark-view-states-zh.png)、[暗色中文键盘二级菜单](../../artifacts/menu-system-report/menu-dark-nested-keyboard-zh.png)、[暗色英文文件菜单](../../artifacts/menu-system-report/menu-dark-file-en.png)、[Windows 原生图片选择器](../../artifacts/menu-system-report/tauri-native-image-dialog-zh.png)和[取消后的未修改文档](../../artifacts/menu-system-report/tauri-image-dialog-cancelled-zh.png)。

仍未补齐的 Typora 差距没有生成虚假菜单入口：Copy as Markdown、Paste as Plain Text、表格选行/选单元格/删行，以及数学、脚注、TOC、Callout、YAML Front Matter 和受限 HTML 继续由各专题 capability 计划负责。

## 错误与降级

- 文件或图片对话框取消是正常结果，不显示错误。
- 文件或图片选择失败沿用稳定错误码和双语通知，不静默 fallback 为占位 Markdown。
- recent file 不存在时显示明确错误并保留条目，避免一次临时磁盘离线静默删除用户历史；最近文件清理另设显式操作。
- action 不适用于当前上下文时不运行破坏性 fallback。
- 高对比、减少动画或窄窗口不改变菜单语义；窄窗口允许菜单栏水平裁剪或聚合前必须另行设计，不在本轮手搓自适应 overflow 菜单。

## 测试设计

### Unit

- 菜单树节点类型、分组顺序、separator、submenu、checkbox 和 radio。
- 中英文标签、shortcut 和 command palette 元数据一致。
- display mode、sidebar、focus mode、theme、language 与 fileOpening 的状态投影。
- 未知 action、动态 recent file 参数和异步错误传播。
- 新增普通段落、代码块、表格键位与图片入口的精确命令结果。
- `deriveInteractionAtPosition`：链接文本/URL、相邻普通文本、嵌套 emphasis 内链接、图片、code/protected-source 内伪链接。
- 右键菜单模型：link / plain / table / image / 文件树节点各自产出正确项集。
- 协议白名单与相对路径分支；路径逃逸与重名冲突错误码。

### Component / Integration

- 鼠标和键盘打开菜单，覆盖方向键、Home/End、Escape、typeahead、子菜单与焦点返回。
- 打开菜单前建立选区，执行格式或段落动作后断言文本、selection 和一次 undo。
- radio/checkbox 执行后重新打开菜单，状态与应用一致。
- 表格上下文外不出现表格破坏性动作；表格内动作名称和语义准确。
- 关于对话框与设置对话框相互独立，关闭后焦点回到触发器。
- 右键不清空 selection；选区外右键不移动光标；复制链接使用命中 URL。
- Shift+F10 打开右键；Escape 归还编辑器焦点。
- 打开右键与复制链接的 transaction `docChanged === false`。

### Playwright E2E

- 逐个执行文件、编辑、段落、格式、视图、主题和帮助菜单的主路径。
- 通过真实编辑器文本变化证明格式命令执行，而非只断言菜单文字。
- 覆盖代码块 `Ctrl+Shift+K`、图片 `Ctrl+Shift+I`、表格 `Ctrl+T`、标题、源码模式和旧表格键迁移兼容。
- 覆盖中文和英文菜单，以及亮色和暗色状态。
- 1440×900 固定视口截取亮色菜单、暗色菜单、子菜单、radio/checkbox 和 keyboard focus。
- 新增 `context-menu` 专项：链接右键复制地址、表格右键回归、文件树新建文件主路径；文件树菜单保留[亮色中文](../../artifacts/context-menu-report/file-tree-context-menu-light-zh.png)与[暗色中文](../../artifacts/context-menu-report/file-tree-context-menu-dark-zh.png)视觉基线。

### Windows Tauri 实机

- 真实窗口验证文件和图片选择器、菜单点击、快捷键、窗口拖拽区、最小化/最大化按钮与菜单互不抢占。
- 验证菜单执行编辑器动作后光标回归，打开系统对话框时不抢焦点。
- 保存桌面截图作为人工视觉验收证据。
- 系统 opener 打开外链、reveal in explorer、回收站删除：人工抽检，不计入纯 Web E2E 通过声明。
- `scripts/release/verify-installed-menu-context-os.mjs` 绑定当前工作树 Release exe，以 Win32 OS 指针、`ClientToScreen`、Per-Monitor V2 与 `WindowFromPoint` 验证标题栏菜单、portal、编辑器/文件树右键及设置重启恢复；运行和隔离边界见 [Windows V1 构建记录](../release/WINDOWS_V1_BUILD.md)。

### 质量门禁

- 相关 Vitest。
- `pnpm typecheck`。
- `pnpm lint`。
- `pnpm test:e2e` 的菜单专项和完整回归。
- `pnpm test:e2e:production`。
- `pnpm quality:web-build`。
- 涉及编辑器 transaction 时 `pnpm test:fixtures`。
- 涉及 Rust command 时 `cargo test --manifest-path src-tauri/Cargo.toml`。

菜单与右键不位于编辑器输入热路径，不新增 Markdown 全文订阅或高频 React 状态，因此不单独增加大文档性能基准。若实现引入 selection/context 的 React 高频同步，必须停止并改为 CodeMirror 派生或按菜单打开时查询。文件树右键若导致整树重渲染，按既有 outline 大文档 bench 模式补测。

## 验收标准

1. 所有可见菜单项与右键项都有真实执行路径，且测试证明产生预期结果；不存在“关于打开设置”或非表格上下文删表无响应等错配。
2. 顶部菜单支持分组、图标、子菜单、radio、checkbox、快捷键列、禁用态和可见键盘焦点。
3. 右键与顶栏共用节点类型、命令注册表和 exhaustive typed invocation dispatcher；`ContextMenuSurface` 不包含业务逻辑，也不能执行任意 callback。
4. 代码块、图片、表格和标题快捷键符合本文合同；菜单、快捷键和命令面板复用同一 action。
5. 菜单/右键打开前的 CodeMirror selection 保持正确；右键作用点为命中位置；只读动作零 doc change。
6. 中英文资源对称，亮色、暗色、减少动画与 Windows 高对比下信息可辨。
7. Playwright E2E、生产 E2E 和 Windows Tauri 实机路径都有新鲜运行证据与截图；opener/回收站人工项单独标明。
8. 未实现的数学、脚注、TOC、Callout、YAML 和 HTML 不出现虚假入口，覆盖矩阵准确记录差距。
9. 菜单实现不持有 Markdown 全文，不改变保存或源码保真策略，不增加编辑器输入热路径工作。
10. 外链协议白名单与工作区路径逃逸防护有自动化证据。

## 更新时机

出现以下变化时更新本文：

- 增删顶部菜单组、右键触发对象、菜单节点类型或全局快捷键。
- 新 Markdown capability 进入可用状态并需要菜单或右键入口。
- Typora 基线复核改变已确认的菜单、右键或快捷键事实。
- Radix Menubar/Context Menu、Tauri 原生菜单策略、opener 或菜单自动化链路发生变化。
- 剪贴板、图片、表格、链接、文件树或关于对话框合同发生变化。
