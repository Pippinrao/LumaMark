# LumaMark 菜单系统设计

> 本文定义 LumaMark 顶部菜单的产品结构、视觉方向、命令合同、Typora 基线映射与验收标准。它面向菜单实现者、测试人员和后续 Markdown capability 维护者；当前实施顺序仍以 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。

## 用途与范围

本轮菜单改造解决两个已经确认的问题：当前菜单视觉粗糙，且入口缺失、状态不清或点击后没有可观察结果。范围包括：

- 顶部菜单的高对比桌面工具视觉。
- 文件、编辑、段落、格式、视图、主题、语言和帮助入口。
- 菜单、快捷键和命令面板共用同一命令事实源。
- 分隔线、子菜单、checkbox、radio、图标、快捷键列和禁用态。
- 已有 Markdown capability 的准确接线与 Typora 已核实快捷键。
- Web Playwright、生产 Web E2E 和 Windows Tauri 实机截图验收。
- 菜单覆盖矩阵，明确已接入能力与尚未实现的专题能力。

## 非目标

- 不在本轮实现数学、脚注、TOC、Callout、YAML Front Matter 或受限 HTML capability。
- 不为未实现能力添加“即将推出”、永久禁用或点击无反应的虚假菜单项。
- 不复制 Typora 品牌、图标、主题素材或未公开实现。
- 不将 Markdown 全文、编辑器高频状态或平台细节放入 React store。
- 不替换 CodeMirror、Radix Menubar、命令面板或 Tauri 架构。

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

## 当前问题与根因

当前 `CommandMenuItem` 只能表达扁平 action、label、shortcut 和 disabled。`TopChrome` 直接映射每个项目为 `Menubar.Item`，因此不能准确表达分组、子菜单、选中状态或动态结构。`runAction` 将字符串强制转换为 action 类型，未知 action 缺少显式失败路径。菜单标签和真实行为也存在错配，例如“关于 LumaMark”实际打开设置、当前显示模式只显示另一个切换动作、主题和语言只显示含义不清的 toggle。

视觉层只有基础矩形浮层和单色 hover；图标、分隔、状态列、子菜单箭头、可见焦点、进出动画和暗色层级均缺失。表格复制和删除常驻编辑菜单，但在非表格上下文可能没有结果，强化了“菜单不可用”的感受。

## 方案选择

### 采用：Radix 菜单系统重构

继续使用已安装且成熟的 `@radix-ui/react-menubar`，建立递归菜单模型和统一命令注册表。Radix 负责方向键、Home/End、Escape、typeahead、焦点管理和 ARIA 基线；LumaMark 负责命令状态、编辑器焦点合同、图标、视觉和 E2E。

### 未采用：Tauri 原生系统菜单

原生菜单的系统助记键和辅助技术集成更直接，但其字体、行高、图标、圆角、高亮和阴影主要由操作系统决定，无法兑现已确认的强视觉方向。Playwright 也无法直接操作或截图系统菜单，需要额外的 Windows UI Automation 链路。原生菜单还会让 WebView 命令与系统菜单状态形成双轨事实源。只有产品未来明确优先系统原生外观并接受平台差异时才复审。

本次继续使用现有成熟组件，不引入主要依赖，也不改变应用架构，因此无需新增 ADR。

## 视觉设计

采用“强视觉桌面工具”方向：

- 顶部触发区保持紧凑，但提供清晰的 hover、open 和 `focus-visible` 状态。
- 浮层采用较大的命中区、完整图标列、深色高对比选中态和明确阴影层级。
- label、shortcut、state/check 和 submenu arrow 使用稳定列宽，长文案不挤压快捷键。
- 分组用细分隔线表达，不用多余说明文字。
- 亮色和暗色主题使用相同层级关系；disabled、highlighted、checked 不能只依赖颜色。
- 动画只用于淡入和轻微位移，并尊重 `prefers-reduced-motion`。
- Windows 高对比模式保留边框、焦点轮廓和选中标记。
- 菜单浮层不得进入窗口拖拽区；触发器和窗口控制继续标记为可交互区域。

## 架构与模块边界

```text
app/controllers 当前轻量状态
            │
            ▼
features/commands 统一命令注册表
            │
            ├── 顶部递归菜单模型
            ├── 命令面板模型
            └── 全局 / CodeMirror 快捷键
            │
            ▼
app/shell 菜单渲染 ──► 类型安全 dispatcher ──► editor / feature / service handler
```

- `features/commands` 是命令 ID、i18n key、图标、快捷键、可用性和执行函数的唯一事实源。
- 菜单节点使用可区分联合类型：`item`、`separator`、`submenu`、`checkbox`、`radio`。
- `app/controllers` 只注入 `fileOpening`、display mode、sidebar、focus mode、theme、language、recent files 等轻量状态。
- `app/shell` 只递归渲染 Radix primitives，不理解 Markdown 业务。
- 编辑器 action 通过稳定 command port 执行，不让 feature 或 shell 读取 Markdown 全文。
- 未知 action 在开发与测试环境显式抛错；生产 UI 不生成未知 action。
- 动态最近文件使用稳定命令调用对象携带路径参数，不拼接任意字符串 action ID。

## 命令执行与焦点合同

1. 菜单打开不得清空 CodeMirror selection。
2. 格式、段落、撤销、重做和查找动作对菜单打开前的 selection 执行。
3. 编辑器动作完成后恢复编辑器焦点；打开文件选择器、设置、关于或工作区选择器的动作不强制抢回焦点。
4. 格式与段落动作产生最小 CodeMirror transaction，并保留单次撤销语义。
5. action 返回可观察结果；不适用的上下文动作不显示，或在能够给出明确原因时禁用。
6. 异步文件动作保留现有错误通知和并发保护，不由菜单吞掉错误。

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
- 聚焦编辑器

阅读模式与实时预览、源码互斥。它锁定渲染态、拒绝文档变更、隐藏光标并保留选区与查找，属于会话级状态，不写入设置。只读实现方式、控件行为边界和反馈方式见 [ADR 0010](../decisions/0010-reading-mode-readonly-contract.md)。

### 主题与语言

- 亮色 / 暗色 radio group
- 语言菜单：简体中文 / English radio group

### 帮助

- 关于 LumaMark

“关于”打开独立对话框，显示应用名、版本和产品定位，不再转发到设置。

## 快捷键合同

| 命令 | 菜单显示 | 实现策略 |
|---|---|---|
| 新建 / 打开 / 保存 / 另存为 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | 显示并复用现有全局快捷键 |
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

## 竞品菜单覆盖矩阵

| 能力 | Typora 基线 | LumaMark 本轮状态 | 菜单策略 |
|---|---|---|---|
| 标题、列表、引用、代码块、分割线 | 已有公开输入或菜单/快捷键证据 | 已接入真实命令；代码块 `Ctrl+Shift+K` 已补齐 | 保持单一 command port；不夸大专题边界体验 |
| 本地图片 | Format → Image，`Ctrl+Shift+I` | 真实多选文件入口和快捷键已接入既有导入 pipeline | 取消不改文档；错误沿用文件通知合同 |
| GFM 表格插入 | `Ctrl+T` | `Ctrl+T` 已接入，旧 `Ctrl+Alt+T` 迁移期兼容 | 顶部菜单只显示标准键位 |
| 表格行列与选择 | 工具栏/上下文菜单及专用键 | 证据不足或未实现 | 不生成虚假顶部入口；保留专题差距 |
| Copy as Markdown / Paste as Plain Text | 已确认 | 未建立可靠剪贴板合同 | 不显示；作为剪贴板专题高优先级缺口 |
| 数学 | `Ctrl+Shift+M`、Math Tools | 未实现 | 不显示 |
| Mermaid | 围栏键入为主，无专用键 | 已实现主要渲染路径 | 不新增专用菜单 |
| YAML Front Matter | 顶部菜单可插入，无专用默认键 | 未实现 | 不显示 |
| 脚注 | 无专用菜单或键 | 未实现 | 不显示 |
| TOC | `[toc]` + Return；专用菜单证据不足 | 未实现 | 不显示 |
| Callout | Paragraph → Alert，无专用默认键 | 未实现 | 不显示 |
| HTML / iframe / video | 键入或粘贴，无通用插入键 | 未实现且安全合同缺失 | 不显示 |

## 2026-08-02 实施与验证结果

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

### Component / Integration

- 鼠标和键盘打开菜单，覆盖方向键、Home/End、Escape、typeahead、子菜单与焦点返回。
- 打开菜单前建立选区，执行格式或段落动作后断言文本、selection 和一次 undo。
- radio/checkbox 执行后重新打开菜单，状态与应用一致。
- 表格上下文外不出现表格破坏性动作；表格内动作名称和语义准确。
- 关于对话框与设置对话框相互独立，关闭后焦点回到触发器。

### Playwright E2E

- 逐个执行文件、编辑、段落、格式、视图、主题和帮助菜单的主路径。
- 通过真实编辑器文本变化证明格式命令执行，而非只断言菜单文字。
- 覆盖代码块 `Ctrl+Shift+K`、图片 `Ctrl+Shift+I`、表格 `Ctrl+T`、标题、源码模式和旧表格键迁移兼容。
- 覆盖中文和英文菜单，以及亮色和暗色状态。
- 1440×900 固定视口截取亮色菜单、暗色菜单、子菜单、radio/checkbox 和 keyboard focus。

### Windows Tauri 实机

- 真实窗口验证文件和图片选择器、菜单点击、快捷键、窗口拖拽区、最小化/最大化按钮与菜单互不抢占。
- 验证菜单执行编辑器动作后光标回归，打开系统对话框时不抢焦点。
- 保存桌面截图作为人工视觉验收证据。

### 质量门禁

- 相关 Vitest。
- `pnpm typecheck`。
- `pnpm lint`。
- `pnpm test:e2e` 的菜单专项和完整回归。
- `pnpm test:e2e:production`。
- `pnpm quality:web-build`。

菜单不位于编辑器输入热路径，不新增 Markdown 全文订阅或高频 React 状态，因此不单独增加大文档性能基准。若实现引入 selection/context 的 React 高频同步，必须停止并改为 CodeMirror 派生或按菜单打开时查询。

## 验收标准

1. 所有可见菜单项都有真实执行路径，且测试证明产生预期结果；不存在“关于打开设置”或非表格上下文删表无响应等错配。
2. 顶部菜单支持分组、图标、子菜单、radio、checkbox、快捷键列、禁用态和可见键盘焦点。
3. 代码块、图片、表格和标题快捷键符合本文合同；菜单、快捷键和命令面板复用同一 action。
4. 菜单打开前的 CodeMirror selection 在格式动作中保持正确，动作可一次撤销。
5. 中英文资源对称，亮色、暗色、减少动画与 Windows 高对比下信息可辨。
6. Playwright E2E、生产 E2E 和 Windows Tauri 实机路径都有新鲜运行证据与截图。
7. 未实现的数学、脚注、TOC、Callout、YAML 和 HTML 不出现虚假入口，覆盖矩阵准确记录差距。
8. 菜单实现不持有 Markdown 全文，不改变保存或源码保真策略，不增加编辑器输入热路径工作。

## 更新时机

出现以下变化时更新本文：

- 增删顶部菜单组、菜单节点类型或全局快捷键。
- 新 Markdown capability 进入可用状态并需要菜单入口。
- Typora 基线复核改变已确认的菜单或快捷键事实。
- Radix Menubar、Tauri 原生菜单策略或菜单自动化链路发生变化。
- 剪贴板、图片、表格或关于对话框合同发生变化。
