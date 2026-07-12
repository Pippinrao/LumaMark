# Live Preview 交互模型（横切）

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference；What's New 1.13 |
| Support URL | https://support.typora.io/Markdown-Reference/ ；https://support.typora.io/What's-New-1.13/ |
| Preferences 依赖 | 多项专题功能受 Markdown 偏好开关影响（见各专题） |
| 横切模型 | 本文 |

本文只记录 **跨语法主题共用** 的 Typora live preview 行为。各专题文档引用本文锚点，不重复展开。

## 1. 模式总览（live preview vs 源码模式）

- Typora 默认以 **hybrid / live preview** 方式编辑：阅读样式与源码编辑在同一文档视图中切换，而不是「左源码右预览」双栏主路径。`support`（产品公开体验与 Markdown Reference 的「键入即渲染 / 光标展开」描述）
- **Quick Start 定义：** 行内样式在键入完成后即可看到；块级样式在键入过程中或按 Enter 聚焦下一段落后呈现。`support`（[Quick Start → Live Preview](https://support.typora.io/Quick-Start/)）
- **源码模式**显示完整 Markdown 源文符号。`support`（What's New 1.13 明确提及 source code mode 与 hybrid editing mode 切换）
- **1.13**：在源码模式与 hybrid 编辑模式之间切换时，**保留滚动位置**。`both`（[What's New 1.13](https://support.typora.io/What's-New-1.13/)；本机光标在可见文末时 `Ctrl+/` 源码停在 `[toc]`/图片行附近，见 `630`/`631`）
- 两种模式编辑的是同一份文档内容；撤销/重做应覆盖用户在两种视图中的编辑连续性——精确共享策略的 GUI 细节本机未逐条录屏，标 `unknown`，见 §10。

## 2. 块级焦点模型（当前块 / 非当前块）

- 文档由块级单元组成（段落、标题、列表项、引用、代码围栏、表格、数学块、图表围栏等）。`support`（Markdown Reference 按 Block Elements 组织）
- **非当前块（阅读态）**：以接近最终阅读的样式呈现，Markdown 结构符号通常被隐藏或弱化，用户看到的是渲染结果。`support`（Reference 对 span「解析并渲染」及块级「键入后生成」的整体模型；像素级显隐规则 GUI `unknown`）
- **当前块（编辑态）**：光标所在块进入可编辑状态，必要时露出结构符号或专用输入 UI（如数学块输入区、表格工具栏）。`support`（Math / Tables 等专题描述；通用块规则 GUI `unknown`）
- 光标离开块后回到阅读态渲染。`support`（与「键入后渲染、进入再展开」一致的公开模型）

## 3. 行内 span 展开模型（光标进入 span 时）

- 行内元素（强调、链接、行内代码、删除线等）在键入完成后会被解析并渲染。`support`（Markdown Reference → Span Elements）
- **将光标移到 span 元素中部会展开为 Markdown 源码**，便于编辑定界符与内容。`both`（Support 原文；本机点击粗体 `boldtarget` 后浅灰 `**` 可见，见 `artifacts/typora-observe/312-bold-click.png`）
- 链接另有特例：单击展开编辑；Command/Ctrl + 单击（或右键「打开链接」）打开超链接。`both`（展开见 `501-plain-crop.png`；打开经用户本机确认）
- 图片：单击可修改 Markdown 源码。`support`（Images 节）
- Preferences 门控的行内扩展（inline math、sub/sup、highlight）遵循同一「渲染 / 光标展开」模型，但需先开启。`support`

## 4. 换行与段落规则（Return / Shift+Return / 空行）

- **经典 Markdown**：源码中段落由两个及以上空行分隔。`support`
- **Typora**：只需 **一次 Return（一个空行）** 即可创建新段落。`both`（Paragraph and line breaks；本机落盘 `ONLYLINE\n\nSECONDPARA\n`）
- **Shift + Return**：创建单个硬换行（line break）。`both`（本机落盘 `SHIFTBASE\nHARDBREAK\n`，无段间空行）
- 多数其它解析器会忽略单一换行；为兼容可在行末留两个空格或插入 `<br>`。`support`
- 列表、引用、标题等块在 Return 时还有各自的续行/退出规则，见对应专题；通用原则是 Return 既可能结束当前块内行，也可能开启新块。

## 5. 选择、复制、粘贴的一般规则

- 用户可在 live preview 中选择渲染后的文本；复制内容与「所见」和「源码」的对应关系依赖具体选区——精确剪贴板格式本机未系统对比，标 `unknown`。
- **默认 Copy：** Typora 默认 `Copy` 意为 **Copy as HTML**（面向粘贴到其它应用，而非默认复制 Markdown 源）。`support`（[Quick Start → Copy](https://support.typora.io/Quick-Start/)）
- **显式复制 Markdown：** Windows/Linux 为 `Ctrl+Shift+C`（`Copy as Markdown`）；macOS 为 `Shift+Command+C`。`support`（[Shortcut Keys](https://support.typora.io/Shortcut-Keys/)）
- **1.13** 上下文菜单增加 **Copy as Plain Text**。`both`（What's New 1.13；本机中文菜单「复制 / 粘贴为…」→「复制为纯文本」，见 `432-copy-as-submenu.png`）
- **Smart Paste：** 粘贴时可分析剪贴板样式（例如从 HTML 粘贴标题会保留一级标题语义）；粘贴为纯文本：Windows/Linux `Ctrl+Shift+V`，macOS `Shift+Command+V`。`support`（Quick Start；Shortcut Keys）
- **源码模式切换：** Windows/Linux `Ctrl+/`，macOS `Command+/`。`support`（Shortcut Keys → View）
- **段落/换行快捷键确认：** `Enter` = New Paragraph；`Shift+Enter` = New Line。`support`（Shortcut Keys → Edit）
- 粘贴：普通文本按 Markdown/纯文本插入；剪贴板图片需先配置存放位置（见图片专题）。`support`（Images）
- 拖拽图片等多文件插入见图片专题；图表右键可复制为图像见图表专题。`support`

## 6. IME 与组合输入的一般规则

- Typora 面向中文等 IME 用户；Support 未单独成章描述组合态与符号隐藏的时序。`unknown`（无公开逐步规范）
- 合理期望（非断言）：组合输入过程中不应因过早解析破坏候选；确认上屏后再参与 span/块解析。具体行为需本机用中文 IME 在粗体、链接、列表边界实测，见 §10。

## 7. 源码符号隐藏的一般原则与例外入口

### 一般原则

- 阅读态隐藏或弱化结构性 Markdown 符号（如标题 `#`、列表标记、强调定界符），呈现排版结果。`support`（live preview 公开模型）
- **Quick Start 明确：** 行内标记（如 `**`）会智能隐藏或显示；块级标记（如 `###`、`- [x]`）在块渲染完成后隐藏。`support`（[Quick Start → Live Preview](https://support.typora.io/Quick-Start/)）
- **本机 1.13.7 截图复核（阅读态）：** 标题 `#`、粗体 `**`、链接定界符、任务 `[ ]`/`[x]`、代码围栏定界符、表格管道符在非焦点下均不可见。`observed`（见 README CRITICAL 与 `artifacts/typora-observe/80-center.png`）
- 编辑需要时通过 **焦点进入块** 或 **光标进入 span** 重新露出源码。`support`

### 例外与专用入口（指向专题）

| 例外 | 说明 | 文档 |
|---|---|---|
| 链接 Ctrl/Cmd+Click | 打开而非仅展开 | [06-links](06-links.md) |
| 图片单击 | 编辑源码；另有对齐/文件夹偏好 | [07-images](07-images.md) |
| 任务列表 checkbox | 点击切换完成态 | [04-lists-and-task-lists](04-lists-and-task-lists.md) |
| 表格焦点工具栏 | 对齐、行列、删除等 | [10-tables](10-tables.md) |
| 数学块输入区 | `$$`+Return 进入；多种方式结束 | [09-math](09-math.md) |
| 图表预览 | Preferences 开启后围栏渲染；右键保存/复制 | [11-mermaid-and-diagrams](11-mermaid-and-diagrams.md) |
| 脚注上标悬停 | 查看脚注内容 | [12-footnotes](12-footnotes.md) |
| 代码围栏 | 仅 fenced；语言高亮 | [08-code-blocks](08-code-blocks.md) |
| Callouts 等 | 需 Preferences | [16-callouts](16-callouts.md) |

## 8. 与各专题文档的引用约定

1. 专题 §3/§4 需要「非当前 / 当前」时，链接到本文 §2、§3、§7，只补充本语法差异。
2. 换行/段落只在 [01](01-paragraphs-and-breaks.md) 写细节；其它专题写「块内 Return 特例」。
3. 复制粘贴一般规则引用本文 §5；图片粘贴、纯文本复制等写在专题。
4. IME 一般规则引用本文 §6；专题只记已知冲突。
5. §8 对齐表中的横切项 ID 使用 `model-*` 前缀，仅出现在本文。

## 9. LumaMark 对齐（仅横切项）

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| model-01 | Hybrid live preview 主路径 | 默认同视图阅读+编辑，非双栏预览主路径 | both | align | V1 UX 明确 Typora-like live preview | V1 |
| model-02 | 源码模式可切换 | 可进入完整源码符号视图（状态栏 </> / Ctrl+/） | both | align | V1 要求视图→源码模式 | V1 |
| model-03 | 模式切换保留滚动 | 1.13 声明保留；本机光标在可见区时 hybrid↔源码大致留在文末附近 | both | defer | V1 未单列；Parity 追平滚动连续性 | Parity |
| model-04 | 当前块可编辑源码 | 光标所在块进入编辑并露出必要符号/专用 UI | support | align | V1 UX：光标所在块显示必要源码 | V1 |
| model-05 | 非当前块阅读态 | 离开焦点后回到接近阅读的渲染 | support | align | V1 UX：离开后回到 live preview 阅读态 | V1 |
| model-06 | 行内 span 中部展开 | 光标进入 span 中部展开为 Markdown 源码 | both | align | V1 基础行内语法的编辑路径 | V1 |
| model-07 | 一次 Return 新段落 | Typora 一次 Return 即新段落，异于经典双空行 | both | align | V1 含段落与换行 | V1 |
| model-08 | Shift+Return 硬换行 | Shift+Return 产生 line break | both | align | V1 含段落与换行 | V1 |
| model-09 | Copy as Plain Text | 上下文菜单「复制为纯文本」 | both | defer | 非 V1 必达；Parity 补齐剪贴板能力 | Parity |
| model-10 | 撤销跨模式连续 | 公开体验暗示同一文档连续编辑；共享细节未逐条核实 | unknown | align | V1 UX：源码与 live preview 共享撤销历史 | V1 |
| model-11 | IME 组合态稳定 | Support 无逐步规范；期望组合中不误解析 | unknown | align | 编辑器标准要求 IME 安全 | V1 |
| model-12 | 符号隐藏不破坏选区 | 阅读态隐藏符号，编辑时再展开 | support | align | V1：隐藏不得破坏光标/选区/复制/IME | V1 |
| model-13 | Preferences 门控扩展 | 部分语法需 Markdown 偏好开启 | support | defer | 门控扩展整体放 Parity | Parity |
| model-14 | 设置变更热重载提示 | 1.13 改 Markdown 设置可不整进程重启，提示重载窗口 | support | defer | 应用设置 UX，非编辑核心 V1 | Parity |
| model-15 | 默认 Copy as HTML | 默认复制面向其它应用的 HTML | support | differ | LumaMark 更宜默认保真复制 Markdown 源，另提供 HTML | Parity |
| model-16 | Smart Paste | 粘贴可保留来源样式语义 | support | defer | V1 先保证纯文本/MD 粘贴正确 | Parity |

## 10. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 当前块 vs 非当前块符号显隐的精确集合 | 对标题/列表/引用/粗体分别移入移出光标并截图 | model-04, model-05, model-12 |
| 源码与 hybrid 是否共享同一 undo 栈 | 在 A 模式编辑→切 B→撤销，观察是否回到 A 的编辑 | model-10 |
| IME 组合中途是否展开 span | 中文输入法在 `**` 内组合汉字，观察定界符与候选 | model-11 |
| Copy as Plain Text 去掉哪些标记 | 选中含链接与粗体的句子，复制纯文本后粘贴到记事本 | model-09 |
| 模式切换滚动保留的误差 | 对比 hybrid↔源码首行像素差；光标离屏时是否跟光标 | model-03 |

## 11. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版：按 Support Markdown Reference 与 What's New 1.13 编码横切模型；版本 observed |
| 2026-07-11 | 本机打开 observe.md，Ctrl+/ 进入源码模式并复制，确认 hybrid/源码可切换且源文完整 |
| 2026-07-11 | 本机核实 Return/Shift+Return、粗体 span 展开、Copy as Plain Text 菜单；光标在可见区时模式切换大致保留文末滚动 |
| 2026-07-11 | common-v1：确认 hybrid 主路径与源码模式可切换且符号完整 |
