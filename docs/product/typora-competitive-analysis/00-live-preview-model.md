# Live Preview 交互模型竞品分析

> **Parity Reliability 实施更新（2026-07-27）：** 下方主体保留为 2026-07-22 以前的横切审计快照，其中关于“整行全部展开”、缺少 `Mod-/`、fixture 只返回原字符串和 composition 无统一合同的描述不再代表当前工作树。当前 `editor/interaction` 按每个 selection 派生最小 block、inline owner 与 delimiter；行内标记只在 selection 进入对应 owner 时展开，composition 期间映射已有 decoration 并在结束后增量重算。`Mod-/` 已在同一主 `EditorView` 上往返并保持文档、selection、undo 与 scroll snapshot；`DocumentSourceFormat` 与真实 `EditorView → prepareTextForSave → write → reopen → byte diff` 门禁保护 BOM、混合 LF/CRLF/CR 和无关字节。真实 Windows 中文 IME 候选窗、系统剪贴板和 Narrator/NVDA 仍未验证，因此不能据此宣称整体 Typora parity。当前合同与退出条件以 [ADR 0006](../../decisions/0006-parity-reliability-editor-contracts.md) 和 [当前执行计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。

## 用途、范围与非目标

本文把 Typora 1.13.7 的横切 live preview 交互基线，与 LumaMark 当前仓库中可以由代码、测试、fixture 和依赖清单证明的能力逐项对照，为后续实现排期和验收提供事实依据。范围包括同视图阅读/编辑模型、焦点与源码符号显隐、源码模式、键盘和鼠标路径、复制粘贴、保存、错误边界、源码保真、可访问性与性能。Typora 事实以 `docs/product/typora-baseline/00-live-preview-model.md` 为准；规划文档没有被当成 LumaMark 已实现证据。

本文不设计某一种 Markdown 语法的全部细节，不把图片、表格、Mermaid 等专题能力的存在等同于完整 live preview 追平，也不修改 Typora 基线事实。2026-07-22 的增量复核同时使用静态代码、全量自动化和真实 Tauri WebView2 操作；未实际执行的原生 IME、系统文件对话框、屏幕阅读器与跨平台行为继续明确标为证据不足。

## 执行摘要

LumaMark 已实现 live preview 的核心骨架：CodeMirror 6 持有唯一 Markdown 文本；默认模式是 `livePreview`；同一个 `EditorView` 通过 `Compartment.reconfigure` 在 live preview 与 source 间切换；基础 heading、emphasis、blockquote、list、link、inline code、horizontal rule 等由语法树 decoration 呈现，代码块、图片、表格、Mermaid 则以 capability 扩展接入。单元测试证明模式切换不改变文本并保留撤销历史，浏览器 E2E 验证菜单切换、源码标记恢复和若干阅读态视觉效果，fixture round-trip 对 file action 写出的既有 fixture 做逐字节检查。真实 Tauri WebView2 又完成了文件打开、键盘编辑、保存、撤销、重做、重开、恢复草稿、跨文件历史隔离、CRLF 源文回退和外部删除冲突路径。因此，“同视图编辑”“源码是真实数据”“可进入完整源码模式”和基础文件交互已经存在；但完整 fixture 字节 round-trip、原生 IME、系统 dialog 与辅助技术仍没有等价实机证据。

但功能存在不等于体验追平。LumaMark 通用显隐判定仍是“选区 head 所在行”，并非 Typora 的“当前块”和“光标进入具体 span”模型：光标落在一行中的普通区域，也会让该行所有受控标记露出；跨行块和嵌套 span 缺少精确展开策略。源码模式只有菜单入口，未发现 Typora 对应的 `Ctrl+/`/`Command+/` 全局快捷键或状态栏入口。模式切换滚动锚点、默认 Enter/Shift+Enter 段落契约、IME 组合态、跨模式复杂选区、复制为 HTML/Markdown/纯文本和 Smart Paste 仍缺横切实机验收。结论仍是“部分实现”：保存点/历史可靠性和若干大文档热路径已修复，但 Typora 级细粒度焦点模型与平台输入体验尚未追平。

## Typora 功能与体验基线

### 创建

Typora 默认在单一文档视图中创建和编辑 Markdown，不以左源码、右预览的双栏作为主路径。行内标记完成后即时呈现，块级结构可在键入过程中或按 Enter 离开后进入阅读样式。一次 Return 创建新段落并落盘为段落间空行；Shift+Return 创建单个换行。创建过程始终修改同一份 Markdown 源，不应靠渲染 DOM 反向生成源文。

### 阅读态

非当前块以接近最终阅读结果的样式呈现，标题 `#`、强调定界符、链接目的地址、列表或引用标记等结构性源码通常隐藏或弱化。阅读态仍是可选择、可定位的编辑器内容，不是与源码脱节的 HTML 预览。隐藏不能改变字符数据，也不能使复制、选区或光标映射不可预测。

### 焦点编辑态

光标进入块时，该块露出编辑所需的源码或专用输入界面；光标进入强调、链接、行内代码等 span 中部时，相关 span 展开定界符和目的地址。光标离开后恢复阅读态。横切模型要求展开范围跟随当前编辑对象，而不是无差别展开整篇或任意整行；但 Typora 对每一种块语法究竟露出哪些符号的像素级 GUI 集合在基线中仍标为未核实，表格、数学块、图片等还可以有专题专用入口。

### 源码模式

源码模式显示完整 Markdown 标记，与 hybrid 模式编辑同一文档。Windows/Linux 使用 `Ctrl+/`，macOS 使用 `Command+/` 切换。Typora 1.13 明确强调切换时保留滚动位置；同一文档的编辑连续性还要求光标、选区和撤销/重做不因视图切换被重建。

### 键盘

除模式切换外，Enter 与 Shift+Enter 的段落语义是横切规则；常见格式快捷键应在 live preview 中操作源码而非生成不可恢复的富文本。撤销和重做应跨模式连续，键盘选区在标记隐藏/展开时不应跳动。IME 组合期间不能因 decoration 重算过早拆散候选文本，确认上屏后才应稳定进入解析结果。

### 鼠标

点击当前块或 span 用于进入源码编辑态；链接单击展开，Ctrl/Cmd+Click 或右键动作才打开目标；图片单击进入源码编辑。任务 checkbox 等控件可直接修改对应 Markdown 标记。鼠标选择阅读态内容时，视觉字符与底层源码位置必须保持可解释映射。

### 粘贴

Typora 普通粘贴可通过 Smart Paste 从 HTML 等剪贴板内容保留标题等语义，`Ctrl+Shift+V`/`Shift+Command+V` 粘贴为纯文本。普通文本按 Markdown/纯文本插入；剪贴板图片按图片偏好导入。粘贴不得把渲染结果作为新的事实来源，也不得无提示改写无关源文。

### 保存

保存的是当前唯一 Markdown 源。仅查看、聚焦、展开/收起标记或切换源码模式不应产生无关 diff；撤销后的内容和保存内容应一致。复制或预览能力不应改变行尾、空白、定界符风格和未触及文本。

### 错误与边界

Typora 对 IME 精确时序、跨模式共享 undo 的 GUI 细节以及复制为纯文本去除哪些标记仍有未核实部分，不能把合理期望写成已观察事实。实现侧还需处理不完整 Markdown、嵌套/重叠 span、超长行、选区跨越隐藏标记、焦点离屏、异步 widget 失败和大文档 viewport 更新，且错误不能吞掉用户源码。

## LumaMark 当前功能清单

1. **单一 CodeMirror 文档与默认 live preview：已实现。** `src/editor/core/createEditorState.ts:41-122` 创建唯一 `EditorState`，默认 `displayMode = 'livePreview'`，同时接入 Markdown language、history、line wrapping 和 keymap。`src/editor/core/editorApi.ts:78-80` 直接从 `state.doc` 读取保存文本；仓库检索未发现 React store 持有 Markdown 全文。
2. **两种显示模式：已实现。** `src/editor/core/editorDisplayMode.ts:40-57` 在 source 模式只挂载 `lm-editor-source-mode`，live preview 模式挂载 `lm-editor-live-preview-mode` 与 preview extensions。`src/editor/core/editorApi.ts:151-161` 用 compartment 重配置同一 `EditorView`，没有重建文档。
3. **模式切换保持文本和撤销历史：已实现。** `src/editor/core/editorApi.test.ts:129-162` 声明先编辑、切 source、切回 live preview 后文本不变，并可 undo 回初始文本。该证据证明单元测试环境中的功能连续性，但没有证明真实浏览器下光标、选区和滚动像素位置均保持。
4. **基础阅读态装饰：已实现。** `src/editor/wysiwyg/markdownDecorations.ts:183-340` 从 Lezer 语法树识别 heading、blockquote、link、horizontal rule、inline code、table、list、task、strong、emphasis、strikethrough；`src/editor/wysiwyg/wysiwyg.css:1-210` 提供对应排版。`markdownDecorations.test.ts:12-263` 声明覆盖识别及代码块内不误装饰。
5. **符号隐藏与焦点恢复：部分实现。** `markdownDecorations.ts:453-500` 对 HeaderMark、QuoteMark、CodeInfo、LinkMark、URL 与行内 mark 使用 replace widget 隐藏，但 `isRangeOnActiveLine` 只判断 selection head 所在行。`markdownDecorations.test.ts:268-291` 声明离开标题行后重新隐藏，`387-447` 声明活动 list/quote/code 行保留源码、离开后隐藏。没有按具体 block/span 边界展开的通用状态机。
6. **可视区域增量计算：已实现。** `markdownDecorations.ts:121-170` 与 `343-479` 只遍历 `view.visibleRanges`，plugin 在文档、选区或 viewport 改变时重算（`503-519`）。这符合避免全篇 decoration 热路径的方向，但选区变化仍会重建当前 viewport 全部 decoration。
7. **专题 capability 边界：已实现。** `src/editor/capabilities/index.ts:20-39` 将 code block、image、table、Mermaid 扩展组合到 live preview；source 模式不挂载这些扩展。该结构证明模块边界存在，不代表每个专题均达到 Typora 体验。
8. **模式菜单和 i18n：已实现。** `src/features/commands/createCommandModels.ts:266-287` 根据当前模式在 View 菜单显示“源码模式”或“实时预览”；`src/shared/i18n/locales/zh-CN.json:93-94` 与 `en.json:93-94` 有双语键。`tests/e2e/editor-markdown.spec.ts:529-560` 声明验证菜单往返及标记显隐。
9. **Typora 模式快捷键：未实现。** `src/app/controllers/useGlobalCommandShortcuts.ts:19-102` 注册新建、打开、保存、侧栏、命令面板、专注和表格快捷键，未注册 `/`；Markdown keymap 仅覆盖格式命令及 CodeMirror 默认/history/search keymap。仓库检索未发现 `Mod-/` 模式绑定。
10. **滚动保持：证据不足。** 模式切换只重配置 compartment，未显式写 `scrollTop`，这可能自然保持滚动，但 `editorApi.test.ts:129-162` 的模式用例不检查 scroller。`editorApi.ts:86-112` 只在加载文档时显式保存或重置滚动，与模式切换不是同一路径。
11. **键盘段落模型：部分实现。** CodeMirror defaultKeymap 提供常规换行和历史操作，项目没有 live preview 专用 Enter/Shift+Enter 规则，也没有测试声明一次 Enter 生成 Typora 式段落空行。格式快捷键 `Mod-b`、`Mod-i`、`Mod-1..6` 位于 `src/editor/commands/markdownFormatKeymap.ts:4-36`；撤销/重做端口位于 `editorCommandPort.ts:69-89`。
12. **鼠标交互：部分实现。** 通用 decoration 依赖 CodeMirror 光标/选区更新；task checkbox widget 在 `markdownDecorations.ts:78-119` 可点击切换 `[ ]/[x]` 并回焦编辑器。未发现通用链接 Ctrl/Cmd+Click 打开与“单击只展开该 span”的横切实现证据。
13. **复制粘贴：部分实现。** 普通文本复制粘贴主要沿用浏览器/CodeMirror 默认行为；没有默认 Copy as HTML、显式 Copy as Markdown/Plain Text 或 Smart Paste 的应用级策略。`src/editor/capabilities/image/imageInputExtension.ts:180-218` 对剪贴板图片和拖放图片做专门导入，非图片项返回 false 交回默认处理。表格另有复制 Markdown 命令，但不能代表通用复制矩阵。
14. **保存和源码保真：部分实现。** `src/features/file-actions/fileActions.ts:126-169` 从 editor 取唯一文本并调用 service 写入，保存期间若文档继续变化不会错误清 dirty；`tests/fixtures/roundTrip.test.ts:8-72` 声明对 manifest 内 fixture 做逐字节比较。但该测试以固定返回 `sourceText` 的 editor stub 调用 save，没有经过真实 CodeMirror 打开、编辑或读取链路，因此只能证明 file action 对既有文本的写出不改字节，不能单独证明完整 live preview round-trip。`live-preview-rich.md` 已列入 `markdownFixtureManifest.ts:54-65` 并带 `typora-like:live-preview` 与 `typora-like:editing-process` 标签。
15. **浏览器级视觉路径：部分实现。** `tests/e2e/editor-live-preview-visual.spec.ts:19-128` 声明采集图片、代码块焦点、表格 hover/source 和单元格编辑截图，并切 source 检查源文；`tests/e2e/editor-markdown.spec.ts:3-110` 声明基础阅读态与 source 模式路径。测试集中于已支持语法，没有横切覆盖 IME、模式滚动、Enter/Shift+Enter、跨 span 选区和通用剪贴板格式。
16. **性能基线：部分实现。** `tests/perf/editorLargeDocument.bench.test.ts:28-67` 声明用 1/5/10MB fixture 测量创建和末尾 dispatch，预算分别覆盖打开及输入。它测的是默认 live preview，但未单独测选区移动触发的 decoration 重算、模式切换、滚动 FPS 或超长单行。
17. **成熟依赖：已实现。** `package.json` 与 `pnpm-lock.yaml` 锁定 CodeMirror 6、`@codemirror/lang-markdown`、Lezer Markdown、`codemirror-markdown-tables`、Radix、i18next 等；现有实现以成熟编辑器和解析器为基础，没有另造全文富文本模型。

## 当前真实体验路径

### 2026-07-22 真实 Tauri WebView2 复核

- 真实 Rust IPC 打开 UTF-8 Markdown，键盘输入 `PostFixSavepoint-20260722`，`Ctrl+S` 后标题从 dirty 变 clean；`Ctrl+Z` 回到 dirty 且标记消失，`Ctrl+Y` 回到 clean 且标记只出现一次，恢复草稿为空；重载没有恢复弹窗，重开磁盘文件仍只有一个标记。
- 注入恢复草稿后选择恢复，继续输入一个字符再撤销，正文精确回到恢复文本但标题仍为未保存，恢复草稿仍存在；这验证了“恢复内容不是已保存基线”。独立浏览器 E2E 进一步锁定恢复后不编辑直接 reload 仍会再次提供该草稿，只有成功保存或明确丢弃才可清除。打开文件 A 后再打开 B，`Ctrl+Z` 不会回到 A，证明加载文档会隔离历史。
- 对真实 CRLF 样本执行打开、输入、撤销，编辑器内部回到归一化文本且磁盘保持原 22 字节、2 对 CRLF、SHA-256 `0028AD3356845178FA8952D01BD48CF3372AB2B44004671C890D0C6648B3641D`；未保存该样本，因此没有把“CRLF 编辑后保存保真”冒充为已验证。
- 打开临时文件后在磁盘上将其移走，Rust watcher 把文档标为 dirty；继续输入再撤销至原内存文本后仍保持 dirty 和恢复草稿，随后把文件恢复并核对 SHA-256。该路径证明外部删除不会因 undo 回到旧文本而被错误标成已保存。
- 明暗主题、侧栏折叠、专注模式、真实代码块 Enter/undo/redo 与 10MB 文档打开/尾部输入均在同一 Tauri WebView2 中执行。原生中文 IME、Windows 文件 dialog、NVDA/屏幕阅读器和 macOS/Linux 没有实际执行，不能据此下结论。

用户启动应用后进入默认 live preview 的 CodeMirror 单视图。输入 Markdown 会直接更新 `state.doc`，语法树和 viewport decoration 把基础语法排成阅读样式；把光标移到另一行后，上一行受支持的结构标记被替换为空的 aria-hidden widget。用户点击任意目标行时，该行内受控标记恢复源码显示，任务 checkbox、表格、图片、代码块和 Mermaid 进入各自 capability 的交互路径。应用壳、主题、侧栏、专注模式和基础编辑路径已在真实 Tauri WebView2 中确认；每个专题控件仍以各自证据边界为准。

需要查看完整源码时，用户打开“视图”菜单并选择“源码模式”；同一 EditorView 移除 live preview extensions，完整标记重新出现。用户再次从菜单选择“实时预览”即可返回，单元测试锁定文本和 undo 栈保留。当前没有可证明的 `Ctrl+/` 快捷路径，也没有状态栏模式按钮。打开新文件会明确重置历史并建立保存点；恢复草稿建立 unsaved 基线；保存成功才把当前 `Text` 标为保存点，外部删除则清除保存点。fixture 测试继续锁定字节写出，真实 Tauri 小文件另证明 open → edit → save → undo/redo → reopen 主链，但模式切换后保存、asset 迁移和整套 fixture 的真实逐字节门禁仍缺失。

这条路径已经能工作，但焦点体验是行级近似：点击粗体所在行的链接外普通文字，同一行中粗体和链接标记都可能展开；Typora 期望光标进入具体 span 才展开相关源码。普通 Enter、复制粘贴、IME 与模式切换滚动仍主要依赖 CodeMirror/浏览器默认行为，缺少产品级契约和端到端门禁。

## 逐项差距矩阵

| 行为点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 单视图 hybrid 主路径 | 已实现 | 低 | 用户无需在双栏间往返，Markdown 源仍为唯一事实 | `createEditorState.ts:41-122`；`editorDisplayMode.ts:40-57` |
| 完整源码模式 | 已实现 | 低 | 可检查和编辑全部标记 | `editorApi.ts:151-161`；E2E `editor-markdown.spec.ts:529-560` |
| `Ctrl+/`/`Command+/` 切换 | 未实现 | 中 | 高频键盘用户必须打开菜单，与 Typora 肌肉记忆不一致 | `useGlobalCommandShortcuts.ts:19-102` 无 `/` 分支 |
| 模式切换滚动锚点 | 证据不足 | 高 | 长文切换后可能失去阅读位置 | 模式测试不检查 `.cm-scroller`；仅加载文档显式归零 |
| 跨模式文本与 undo 连续 | 已实现 | 低 | 单元测试环境中切换不会另起文档或丢失最近编辑 | `editorApi.test.ts:129-162` |
| 跨模式光标与选区连续 | 证据不足 | 高 | 复杂选区可能跳动，影响格式化和复制 | `setDisplayMode` 未改 selection，但没有专项断言/E2E |
| 非当前行隐藏结构标记 | 已实现 | 低 | 基础阅读态视觉已成立 | `markdownDecorations.ts:453-500`；相关单测 |
| 当前块精确展开 | 部分实现 | 高 | 多行引用、列表、围栏和表格的编辑边界可能过宽或过窄 | 通用判定仅 `doc.lineAt(selectionRange.head)` |
| 当前 span 精确展开 | 部分实现 | 高 | 同行多个 span 会一起露出，视觉跳动大于 Typora | `isRangeOnActiveLine` 行级判断，无 span 状态 |
| 一次 Enter 创建 Typora 段落 | 未实现 | 高 | 落盘换行语义和后续解析与 Typora 不一致 | 只有 CodeMirror `defaultKeymap`，无专用命令/测试 |
| Shift+Enter 单换行契约 | 证据不足 | 中 | 用户无法确信段落与硬换行可预测 | 无横切测试或显式绑定 |
| IME 组合态稳定 | 证据不足 | 阻断 | 中文组合输入若与 decoration 重算冲突会直接破坏核心写作 | 通用 `markdownDecorationsPlugin` 无 composing 门控，且无横切 IME E2E/集成证据；Mermaid 的局部 composing 判断不能外推到通用层 |
| 鼠标点击 checkbox 修改源码 | 已实现 | 低 | 可直接切换任务且可撤销 | widget `input.toggle-task`；E2E 基础用例 |
| 链接点击/修饰键打开模型 | 证据不足 | 中 | 点击编辑与打开目标可能不符合预期 | 通用层仅 link decoration，无横切鼠标 handler |
| 默认 Copy as HTML | 未实现 | 中 | 粘贴到富文本应用不能获得 Typora 默认结果 | 无通用剪贴板序列化层 |
| Copy as Markdown/Plain Text | 未实现 | 中 | 用户缺少可控导出格式 | 仅表格专用 Markdown 复制，不等于通用复制 |
| Smart Paste 与纯文本粘贴 | 未实现 | 中 | 从网页/办公软件粘贴无法可靠保留或剥离语义 | 非图片粘贴交回默认，未见 HTML 转 Markdown 流程 |
| 图片剪贴板导入 | 已实现 | 低 | 图片可落为 Markdown 引用 | `imageInputExtension.ts:180-218` 及对应 E2E |
| 保存直接读取源码 | 已实现 | 低 | 基础保存不依赖渲染 DOM | `fileActions.ts:126-169` 从 editor port 取文本后写出 |
| 真实 EditorView round-trip | 部分实现 | 高 | 真实 Tauri 小文件主链通过；整套 fixture、模式切换和 asset 分支仍未做字节级实机矩阵 | 真实 WebView2 open/edit/save/undo/redo/reopen；`roundTrip.test.ts` 仍使用 editor stub |
| 不完整/嵌套 Markdown 边界 | 部分实现 | 高 | 解析变化时标记可能闪烁或范围判断失准 | Lezer 提供结构基础，但横切测试样本有限 |
| 可访问的隐藏/交互语义 | 部分实现 | 高 | `aria-hidden` checkbox 且不可 Tab 聚焦，屏幕阅读器无法操作 | `TaskCheckboxWidget` 设置 `aria-hidden=true`、`tabIndex=-1` |
| 大文档 live preview 性能 | 部分实现 | 高 | 自动化预算和真实 10MB 输入均有证据，但滚动 FPS、IME、长时间编辑与内存仍未锁定 | 串行 `perf:bench`；真实 Tauri WebView2 10MB CDP/键盘测量 |

## 根因与架构影响

主要根因不是缺少 CSS，而是通用 editing-state 模型过于粗糙。当前 `markdownDecorations.ts` 同时负责语法范围收集、可视区装饰、隐藏 widget、列表/任务交互和焦点规则，焦点规则只有“活动行”这一层抽象。继续在该文件叠加语法特例会扩大热路径、耦合专题 capability，并增加 IME、选区和源码映射风险。

第二个根因是显示模式作为 UI state 和 CodeMirror compartment 已建立，但缺少一个完整的模式命令契约：菜单能调用 `setDisplayMode`，快捷键、滚动锚点、selection 保持、状态呈现和可访问公告没有由同一 command 统一验收。第三个根因是剪贴板和段落行为尚未产品化，仍是编辑器默认行为；这在普通文本下可用，却无法保证 Typora 语义和跨应用格式。第四个根因是测试偏“语法可见”，缺少交互状态转换矩阵，因此功能文件存在容易被误判为体验追平。

架构上应保持 Markdown 仍只在 CodeMirror state 中，React controller 只持轻量模式枚举；不能把全文同步到 store。通用焦点/展开策略属于 `editor`，模式命令由 `editor` 暴露稳定 API、`features/commands` 编排菜单/快捷键；剪贴板转换属于独立 editor command 或 service facade，不能散落在 React shell。专题 widget 继续通过 capability 接口接入，并消费通用 editing context，而不是反向依赖 App。

## 详细改进方案

### 模块归属与成熟依赖优先

在 `editor` 内新增聚焦的 editing-context 模块，输入 CodeMirror selection、syntax tree 和 composition 状态，输出 `activeBlockRange`、`activeInlineRange` 与“应隐藏的 token”集合；通用 decoration 只消费结果。优先使用 CodeMirror `ViewPlugin`、`StateField/Facet`、transaction annotations、`syntaxTree`、`EditorView.composing`/DOM composition 生命周期等成熟能力，不自研 DOM 编辑器或第二份文档模型。Markdown HTML/纯文本转换先评估 CodeMirror clipboard hooks、`markdown-it` 的安全渲染和成熟 HTML-to-Markdown 库；若需要引入主要依赖，先记录依赖、包体和保真决策，不应以正则拼装 HTML。

### 数据流

键盘、鼠标或 IME 产生 CodeMirror transaction；Markdown source 先更新为唯一事实；解析树和 editing-context 基于 transaction/selection 计算当前块与当前 span；decoration 仅在 visibleRanges 内增量更新。模式切换命令在 dispatch 前捕获 selection、scroll anchor（首个可见文档位置及像素偏移），用 compartment 重配扩展后恢复 anchor，并通过轻量事件更新 React 的模式枚举。保存始终从 editor port 读取 source，绝不从 widget DOM 或 HTML 反序列化。

### 源码保真

所有隐藏必须使用 decoration，不改 document；展开/收起和模式切换 transaction 不得带 doc changes。格式、checkbox、Smart Paste 等确需改源文的动作必须限定精确 range 并标注 userEvent，支持同一 undo 栈。新增 fixtures 应覆盖 CRLF/LF、尾随空格、空行、嵌套 emphasis/link/code、未闭合定界符、中文标点和超长行；每项均走 open→save→byte diff，预览行为不得规范化用户未触及源码。

### i18n、可访问性与错误处理

模式菜单、快捷键提示、复制格式、粘贴失败和恢复提示均进入中英文 i18n，不拼接句段。模式切换应有可由辅助技术感知但不打断输入的状态公告。可点击任务、图片、表格控件不能一律 `aria-hidden`；应提供可聚焦语义、名称和键盘等价操作，同时避免隐藏 token 被重复朗读。剪贴板权限、HTML 转换、图片导入和异步 widget 错误应通过现有 feature notice/facade 显式报告；失败时保留原剪贴板文本或 Markdown 源，不做静默降级改写。

### 交互细节

活动块以语法树 block node 为边界，当前 span 优先选择包含 selection head 的最内层可编辑 span；同行其他 span 仍保持阅读态。跨 span 选区时，为避免不可见 token 造成歧义，可临时展开选区相交的全部 span，但不可扩大到无关行。compositionstart 到 compositionend 期间冻结非必要隐藏切换，只允许 CodeMirror 原生组合 transaction；确认后一次重算。Enter 在普通段落按 Typora 契约插入段落分隔，Shift+Enter 插入单换行；列表、引用、代码块交由专题命令优先处理，避免通用规则覆盖结构特例。

## 分阶段 P0 / P1 / P2

### P0：核心编辑可靠性

- 建立 block/span editing-context，替换活动行近似，并覆盖嵌套、跨行和未闭合标记。
- 建立 IME composition 门禁和中文/英文输入集成测试；在证据通过前不得宣称 live preview 核心追平。
- 为模式切换保存 selection、scroll anchor、undo 连续性，加入 `Ctrl+/`/`Command+/`，菜单和快捷键走同一命令。
- 明确并实现 Enter/Shift+Enter 横切契约，同时尊重列表、引用、围栏等专题优先级。
- 将模式切换、聚焦/失焦定义为零 doc change，并纳入 fixture round-trip。

### P1：跨应用工作流与可访问性

- 实现 Copy as Markdown、Copy as Plain Text，并在产品决策后确定默认 Copy 是否追随 Typora 的 HTML；提供可本地化菜单和快捷键。
- 实现可控 Smart Paste/Plain Text Paste，HTML 转换失败时显式保留纯文本选择。
- 修正任务等交互 widget 的可访问名称、键盘操作和焦点回收，补 axe/Playwright 验收。
- 覆盖链接单击展开、Ctrl/Cmd+Click 打开、右键动作和跨隐藏标记鼠标选择。

### P2：体验精修与性能治理

- 优化 selection/viewport decoration 增量更新，建立滚动 FPS、模式切换耗时、超长单行和复杂嵌套 benchmark。
- 增加模式状态栏入口或等价低噪声反馈，并保证焦点模式、侧栏切换不影响编辑锚点。
- 补齐偏好门控扩展热重载、复制 HTML 细节和跨平台原生剪贴板差异；根据真实测量调整缓存和 debounce。

## 可执行验收标准与测试计划

### Unit

- 给定同一行两个 emphasis/link span，selection 进入其中一个时只返回该 span 的展开范围；进入普通文本时两者均不展开。
- 给定多行 blockquote、nested list、fence 与未闭合标记，active block 结果稳定且不越过相邻块。
- 模式切换 transaction 的 `docChanged` 为 false，切换前后 source、selection 和 history depth 一致。
- 普通段落 Enter 产生约定的段落分隔，Shift+Enter 只产生单换行；列表/引用/代码块命令优先级有独立用例。
- clipboard serializer 对相同 selection 输出 Markdown、plain text、HTML 三种确定结果，失败分支不丢原文本。

### Integration

- 在真实 `EditorView` 中依次执行输入→离开 span→返回 span→source→live preview→undo/redo，断言 source 精确、标记显隐正确、selection 不跳。
- 派发 compositionstart、组合更新、compositionend，断言候选期间 decoration 不拆散组合文本，确认后只产生预期 transaction。
- 捕获 scroller 首个可见文档位置和偏移，往返模式后误差保持在约定像素阈值内；光标离屏和多选区也覆盖。
- 粘贴 HTML、Markdown、plain text、图片和权限失败样本，断言 userEvent、错误提示和源码结果。

### E2E

- Windows 路径按 `Ctrl+/` 往返，macOS project 按 `Meta+/` 往返；菜单标签同步变化，编辑器继续聚焦。
- 1MB 长文滚到中段，切换两次后相同段落仍可见，随后输入、undo、redo 和保存均发生在原位置。
- 用 Playwright composition/真实平台人工补充方式验证中文拼音输入粗体、链接和列表边界；自动化必须覆盖可重复 transaction 层，真实 IME 作为发布抽检。
- 选择跨越隐藏强调标记的文本，分别 Copy as Markdown/Plain Text/HTML，再粘贴到受控目标验证内容。
- 用鼠标点击 span、同行普通文本、链接修饰点击和 task checkbox，验证展开边界、打开行为、焦点与键盘等价操作。

### Fixture

- 扩展 `live-preview-rich.md` 或增加职责清晰的交互 fixture，覆盖同行多 span、嵌套、CRLF、尾随空格、未闭合结构和中英混排。
- 对全部相关 fixture 执行 open→零编辑 save→byte diff，以及聚焦/模式切换后 save→byte diff；无关 diff 必须为 0。
- 对 Enter、Smart Paste 等预期改源动作使用 before/after fixture，只允许目标 range 变化。

### Perf

- `perf:bench` 独立运行：1/5/10MB 文档分别测初始 live preview、选区跨 100 个块移动、连续滚动、模式往返和单字符输入。
- 保持现有 1MB 输入 16ms 目标，并为 selection decoration 重算、模式切换和滚动长任务设预算；性能命令不得与 E2E、构建等并行。
- 记录 visible range 内 node 数、decoration 数和最长 transaction，避免只看平均值掩盖卡顿尖峰。

以上条目是尚未全部完成的验收计划，不是通过声明。2026-07-22 本轮实际执行了全量单元/E2E、真实 Tauri 文件与大文档链路；未执行的 IME、系统 dialog、辅助技术和跨平台项仍按本节计划验收。

## 风险与未核实项

- Typora 基线对 IME 组合时序、跨模式共享 undo 的逐步 GUI 行为以及 Copy as Plain Text 的精确剥离规则本身标为未核实，LumaMark 不应凭推测机械复制；应先做固定版本本机观察并保留证据。
- `Compartment.reconfigure` 通常不会重建 EditorView，因此滚动可能已自然保持；但在图片、表格、Mermaid widget 高度变化时仍可能跳动。在没有长文 E2E 断言前状态只能是“证据不足”。
- CodeMirror 默认 Enter、复制和粘贴功能可能提供基础可用行为，但它们没有形成 LumaMark 的 Typora-like 产品契约；不能把依赖默认能力写成体验追平。
- 当前 target 代码与报告周边处于未提交并行修改中，行号会随合并漂移。证据索引同时保留文件和函数/测试名，复审时应按符号定位。
- 通用 decoration 与 table/image/code/Mermaid capability 可能发生嵌套范围冲突；重构 editing-context 必须先定义 ownership，避免一个 token 被多个 plugin replace。
- 可访问性改进可能改变 widget 的原子范围和键盘导航；必须与源码映射、IME 和撤销一起验证，不能只加 ARIA 属性。

## 证据索引

### Typora 基线

- `docs/product/typora-baseline/00-live-preview-model.md`：Typora 1.13.7 hybrid/source、焦点、span、Return、复制粘贴、IME、符号隐藏和未核实项。本文唯一读取的 Typora 专题基线。

### LumaMark 代码

- `src/editor/core/editorDisplayMode.ts`：模式枚举、class 与 live preview extensions。
- `src/editor/core/createEditorState.ts`：默认模式、Markdown language、history、默认 keymap、viewport editor 基础。
- `src/editor/core/editorApi.ts`：唯一 source 读取、文档加载、compartment 模式重配置。
- `src/editor/wysiwyg/markdownDecorations.ts`：语法树 decoration、隐藏 token、活动行规则、task widget。
- `src/editor/wysiwyg/wysiwyg.css`：基础阅读态排版与 hidden mark 样式。
- `src/editor/capabilities/index.ts`：code/image/table/Mermaid capability 组合边界。
- `src/editor/commands/markdownFormatKeymap.ts`、`editorCommandPort.ts`：格式与 undo/redo 命令。
- `src/app/controllers/useGlobalCommandShortcuts.ts`、`src/features/commands/createCommandModels.ts`：全局快捷键集合与模式菜单。
- `src/editor/capabilities/image/imageInputExtension.ts`：图片拖放/粘贴路径。
- `src/features/file-actions/fileActions.ts`：打开、保存与唯一 Markdown 文本数据流。
- `src/shared/i18n/locales/en.json`、`zh-CN.json`：模式可见文案。

### 测试与 fixture

- `src/editor/core/editorApi.test.ts`：模式切换文本与 undo 连续性；加载新文档滚动归零；外部变化重载时 selection 与滚动保持。模式切换用例本身不检查 selection 或滚动。
- `src/editor/wysiwyg/markdownDecorations.test.ts`：语法范围、活动行显示、离开后隐藏、代码块隔离和 task widget。
- `tests/e2e/editor-markdown.spec.ts`：基础 live preview、source 模式、菜单往返和表格路径。
- `tests/e2e/editor-live-preview-visual.spec.ts`、`tests/e2e/fixtures/livePreviewData.ts`：视觉报告、代码块焦点、表格 inline 编辑与 source 检查。
- `tests/fixtures/markdown/live-preview-rich.md`、`tests/fixtures/markdownFixtureManifest.ts`、`tests/fixtures/fixtureCoverage.test.ts`：live preview fixture 内容、标签与存在性约束。
- `tests/fixtures/roundTrip.test.ts`：固定 editor stub 文本经 file action 保存后的逐字节比较；不是实际 EditorView 的 open→save 端到端证据。
- `tests/perf/editorLargeDocument.bench.test.ts`：默认 live preview 的 1/5/10MB 创建和输入预算。

### 依赖证据

- `package.json`、`pnpm-lock.yaml`：CodeMirror 6、Lezer Markdown、Markdown language、成熟表格组件、Radix、i18next 的直接依赖及锁定版本。
