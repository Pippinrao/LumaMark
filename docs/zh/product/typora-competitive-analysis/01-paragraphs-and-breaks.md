> 语言：**中文** · [English](../../../product/typora-competitive-analysis/01-paragraphs-and-breaks.md)

# 段落与换行：Typora 竞争差距分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - live preview 已接入共享段落 keymap：普通段落 Enter 以单个 transaction 创建 `\n\n`，Shift+Enter 创建 `\n`；光标已在空行时让默认行为只增加一个换行。单元测试与 Playwright 覆盖精确源码，命令在 composition、只读、结构块、跨块或混合结构多选区中不会误接管，并验证一次撤销可还原。
> - 因而旧正文中的“普通段落 Enter 语义未实现”已过期；当前结论是代表性行为已实现并有自动化证据。Windows 原生中文 IME、粘贴与 hard break 的完整矩阵及全部 Beta 门禁仍未完成。

## 用途、范围与非目标

本文用于把 Typora 1.13.7 的段落/换行基线与 LumaMark 当前可执行代码、自动化测试及 fixture 逐项对照，明确“代码中存在某种能力”和“真实体验已经追平 Typora”之间的边界，并给出可实施的改进与验收方案。分析快照日期为 2026-07-12。

范围仅包括普通段落的创建、阅读、焦点编辑、源码表示、键鼠输入、多行粘贴、保存以及连续空行、行末双空格、`<br>` 等边界。标题、列表、任务列表、引用、代码块等块结构内部的 Return 特例不在本文结论范围；富文本粘贴只评估它对普通段落与换行的影响。本文不是实现计划完成声明，也不把产品规划中的 `align` 当作当前能力证据。

## 执行摘要

LumaMark 已具备可靠的纯文本编辑底座：Markdown 全文由 CodeMirror `EditorState` 持有，启用换行显示、历史记录、Markdown 解析、源码/实时预览模式切换；保存动作从编辑器读取全文，再经过 `prepareTextForSave` 写出。该回调默认是恒等变换，当前应用注入的实现只负责结算 `lumamark-draft://` 图片引用，现有代码未显示对普通段落执行 trim、换行归一化或尾随空格清理。已有 fixture 可验证“打开后未修改、由 mock editor 返回原 fixture、再保存”的字节级一致。这些事实足以判定普通文本、单换行、空行、行末双空格和 `<br>` 可作为源码进入保存链路，但不能替代真实 CodeMirror 编辑、应用级预处理与保存组合路径的保真证明。

但核心 Typora 手感尚未追平。LumaMark 注册的是 CodeMirror `defaultKeymap`，其安装版本 6.10.4 明确将 `Enter` 和 `Shift+Enter` 都绑定到 `insertNewlineAndIndent`。在本文限定的普通段落上下文中，两者都会走单换行命令：当前没有“Enter 一次生成段间空行（源码 `\n\n`）而 Shift+Enter 只生成段内单换行（源码 `\n`）”的区分。这不是视觉微差，而是用户每次分段都会遇到的高频语义差距。实时预览也没有普通段落的独立 line decoration 或解析态间距模型，视觉间距主要来自每个 `.cm-line` 的统一 padding 与空源码行本身；这能阅读，却不能证明与 Typora 的段落排版、焦点转换和光标手感一致。

测试覆盖同样呈现“基础保真已实现、交互语义证据缺失”：`basic.md` 包含普通段落和行末双空格硬换行，round-trip 测试覆盖它；但没有针对普通段落的 Enter/Shift+Enter、连续 Return、粘贴 CRLF/多段文本、撤销粒度、IME 组合态或保存后精确换行的专门单元、集成或 E2E 断言。结论是：基础文本能力已实现，段落与硬换行的 Typora-like 体验为部分实现，不能宣称体验追平。

## Typora 功能与体验基线

### 创建

在空文档或普通段落末尾按一次 Return，Typora 创建新段落，并在源码中形成一个空行，即相邻文本通常为 `第一段\n\n第二段`。Shift+Return 创建段内硬换行，源码为 `第一行\n第二行`。公开基线同时提醒：为兼容忽略单换行的其它解析器，用户可写行末两个空格或 `<br>`。普通段落没有必要的菜单或拖拽创建入口。

### 阅读

非焦点普通段落呈正文排版，不显示“空行标记”；段间有段落节奏。硬换行只在同一段内断行，不应获得新段落间距。精确 CSS 数值在 baseline 中仍是未核实项，因此本文不以像素值断言追平。

### 焦点编辑

段落本身没有额外 Markdown 定界符，光标进入即可直接编辑。焦点从上一段经 Return 移到下一段时，视觉与源码语义应同步：新段是新块；Shift+Return 后仍是同一段的下一行。内含强调等行内结构时才适用相应 span 展开规则。

### 源码

源码模式必须展示真实空行、单换行、行末空格及 `<br>`。Typora 本机基线记录 Return 落盘为 `ONLYLINE\n\nSECONDPARA\n`，Shift+Return 落盘为 `SHIFTBASE\nHARDBREAK\n`。用户手写的两个尾随空格或 `<br>` 不应被静默规范化。

### 键鼠

Return 是新段落，Shift+Return 是新行；鼠标用于定位段落与选区，不需要专门的“段落控件”。键盘路径应保持撤销/重做、选区、复制粘贴和 IME 组合态稳定。

### 粘贴

普通多行纯文本应按剪贴板中的换行落入文档；Typora 对“单换行究竟解释为段内换行还是段落”及 CRLF 的精确 GUI 规则尚未在 baseline 核实。Typora 另有 Smart Paste 与粘贴为纯文本能力，但本专题只要求验证其段落/换行结果，不能据推测写死转换规则。

### 保存

保存必须保留段落空行、段内单换行、尾随双空格、连续空行和 `<br>`，不能因预览或解析过程改写无关源码。写入失败时应保留 dirty 状态并呈现可本地化、可恢复的错误。

### 错误与边界

连续多次 Return、文首/文末 Return、选区替换、CRLF 粘贴、末尾是否带换行、只有空白的文档、尾随空格、`<br>`、中英文与 IME、超长段落及大文档均是边界。Typora 对连续三次 Return 的精确视觉合并方式、富文本/纯文本粘贴的逐字符结果、导出 HTML 中硬换行标签仍未核实，故 LumaMark 不应为“猜测式一致”牺牲源码保真。

## LumaMark 当前清单与直接证据

1. **文本真源与基础编辑已实现。** `src/editor/core/createEditorState.ts:41-52,97-122` 直接以传入 `doc` 创建 `EditorState`，启用 Markdown、history、`EditorView.lineWrapping` 和默认键位；`src/editor/core/editorApi.ts:78-109` 从 CodeMirror 读取全文并以 transaction 加载全文。`src/editor/core/createEditorState.test.ts:8-14` 证明包含空行及末尾换行的 Markdown 字符串原样进入 state。
2. **Enter 与 Shift+Enter 的 Typora 语义仅部分实现。** 项目没有段落专用 keymap；`src/editor/commands/markdownFormatKeymap.ts:4-37` 只注册格式快捷键，`src/editor/core/createEditorState.ts:114-119` 随后注册 `defaultKeymap`。锁文件 `pnpm-lock.yaml:2916-2920` 固定 `@codemirror/commands` 6.10.4；已安装文件 `node_modules/.pnpm/@codemirror+commands@6.10.4/node_modules/@codemirror/commands/dist/index.js:1717-1745` 明确写出 Enter 和 Shift-Enter 均执行 `insertNewlineAndIndent`。因此两个按键都有输入能力，但没有段落/硬换行分流。
3. **实时预览与源码模式存在。** `src/editor/core/editorDisplayMode.ts:5,40-57` 定义 `livePreview`/`source` 并只在实时预览加载 capability；`src/editor/core/editorApi.test.ts:129-162` 验证模式往返不改文本或撤销历史。普通 Paragraph 未出现在 `src/editor/wysiwyg/markdownDecorations.ts:211-340` 的语法节点映射中；段落与空行当前没有独立 decoration。
4. **阅读基础样式已实现但无追平证据。** `src/editor/core/editor.css:44-63` 设置 16.5px 字号、1.74 行高、换行、居中 810px 内容宽度，并对所有 `.cm-line` 统一加 `0.08rem` 上下 padding。它提供安静可读的正文表面，但没有区分“段内续行”和“段间空行”的专属样式，也没有段落像素/截图回归。
5. **普通焦点编辑已实现，但内部编辑控件的可访问名称证据不足。** `src/editor/core/EditorViewHost.tsx:79-104` 创建 CodeMirror，普通文本可由其编辑控件直接定位和修改；`createEditorState.ts:76-95` 可上报焦点变化。`EditorViewHost.tsx:107-119` 只证明外层 `section` 接收 `aria-label`/`aria-labelledby`，不能单独证明内部 `.cm-content[role="textbox"]` 继承了可访问名称。没有发现普通段落焦点进入/退出的自定义源码重写，因此编辑基础存在，但 Typora 的段块焦点体验与屏幕阅读体验均没有专项测试。
6. **纯文本粘贴基础存在，Smart Paste 未实现。** 未发现普通文本 paste transformer。`src/editor/capabilities/image/imageInputExtension.ts:208-217` 的自定义 paste 路径只处理图片文件，无图片时返回 `false`；普通文字依赖 CodeMirror/浏览器默认粘贴。仓库没有普通多行、HTML 到段落或“粘贴为纯文本”专项实现与测试，不能据默认浏览器行为宣称与 Typora 相同。
7. **保存与错误处理已实现，普通段落的应用级组合保真仍缺专项证明。** `src/features/file-actions/fileActions.ts:126-169` 获取编辑器原文，经 `prepareTextForSave` 后写入目标路径；写入失败不清 dirty，成功后仅在 revision 与文本快照仍一致时清 dirty。`src/features/file-actions/fileActions.ts:91-95` 显示默认预处理为恒等变换，`src/app/controllers/useAppDocumentModel.ts:59-64` 显示应用实际注入 `finalizeAllDraftImages`；因此不能把 file-action 单元测试描述成无条件“原文直写”。`src/features/file-actions/fileActions.test.ts:95-141,143-192,194-274` 覆盖失败、成功和并发编辑。`tests/fixtures/roundTrip.test.ts:8-70` 对 manifest 中每个 fixture 做 byte-for-byte 比较，但其 editor mock 始终返回原始 `sourceText`。
8. **段落 fixture 部分实现。** `tests/fixtures/markdown/basic.md:3-6` 包含普通段落、空行以及行末两个空格的硬换行；`tests/fixtures/markdownFixtureManifest.ts:7-11` 标记 `commonmark:paragraph`；`tests/fixtures/fixtureCoverage.test.ts:9-24,44-63` 检查标签覆盖。但 fixture 未单独覆盖段内裸 `\n`、连续空行、`<br>`、CRLF 和末尾换行矩阵，且 round-trip 模拟的 editor 始终返回原始 `sourceText`，并没有实际键盘编辑。
9. **性能底座有总体门禁，段落路径缺少专项数据。** `package.json:14-24` 提供普通测试、fixture 与禁用文件并行的 perf 命令；`tests/fixtures/markdownFixtureManifest.ts:156-166` 登记 1MB、5MB、10MB fixture。但现有证据不能回答“Enter 插入双换行是否低于 16ms”“超长单段软换行是否保持滚动流畅”，也没有段落扩展对启动耗时和内存的增量数据。

## 真实体验路径

用户新建空文档后输入“第一段”，按 Enter，再输入“第二段”。当前实际数据倾向为 `第一段\n第二段`，因为默认键位只插入一次换行；Markdown 解析会把连续文本行视作同一段，视觉上只是换到下一 CodeMirror 行。用户若想得到 Typora 式新段落，必须自己再按一次 Enter。若改按 Shift+Enter，仍得到同样的 `\n`，两条路径无法从源码或视觉语义上区分。

用户打开已有的 `第一段\n\n第二段` 时，空源码行会作为空 `.cm-line` 呈现，因而能看到段间距离；切到源码模式时文本不变，保存也可原样写回。这个路径说明“已有正确 Markdown 可阅读、可保存”，并不说明“创建正确 Markdown 的手感已实现”。对于粘贴，现有图像 handler 在剪贴板没有图片文件时返回 `false`，把事件交回后续默认处理；但仓库没有真实用户路径证据说明普通多行文本最终如何处理 LF/CRLF、空行、尾随空格和 HTML，因此不能写成“通常可正常进入编辑器”。保存失败时 dirty 会保留，这部分行为已有单元测试。

## 逐项差距矩阵

| 行为点 | 状态 | 严重度 | 用户影响 | 直接证据 |
|---|---|---|---|---|
| 普通文字输入、选区与软换行显示 | 已实现 | 低 | 可进行基本写作和长行自动折行 | `createEditorState.ts:97-122` |
| Enter 一次创建 `\n\n` 新段落 | 未实现 | 阻断 | 高频操作与 Typora 相反，需多按一次 Enter | 默认键位 `Enter -> insertNewlineAndIndent` |
| Shift+Enter 创建段内单 `\n` | 部分实现 | 高 | 能产生单换行，但与 Enter 无语义区分 | `createEditorState.ts:114-119`；commands 6.10.4 keymap |
| 已有空行文档的阅读 | 已实现 | 中 | 可读取段落结构，但仅依赖源码空行与通用行样式 | `editor.css:44-63` |
| 段间距与段内硬换行视觉区分 | 部分实现 | 高 | 空行能拉开距离，缺少语义化样式与视觉回归 | Paragraph 不在 decoration 映射中 |
| 焦点直接编辑普通段落 | 已实现 | 低 | 段落无定界符，基本光标编辑可用 | `EditorViewHost.tsx:79-104` |
| 内部编辑 textbox 的可访问名称与屏幕阅读顺序 | 证据不足 | 高 | 外层区域虽有标签，屏幕阅读器仍可能读不到编辑控件名称或被 decoration 干扰 | `EditorViewHost.tsx:107-119` 仅标记外层 `section`；无 a11y 专项测试 |
| 源码/预览切换保持换行与 undo | 已实现 | 中 | 模式切换不会主动改写源码 | `editorApi.test.ts:129-162` |
| 行末双空格与 `<br>` 保存保真 | 部分实现 | 高 | 未编辑 round-trip 可保真；编辑后、粘贴后尚无专项证明 | `basic.md:5-6`；`roundTrip.test.ts:8-70` |
| 连续多个空行保真与光标体验 | 证据不足 | 中 | 可能出现不稳定的空行高度、导航或保存结果 | baseline 与仓库均无专项测试 |
| 普通多行纯文本粘贴 | 部分实现 | 中 | 依赖浏览器默认路径，缺少 LF/CRLF/空行契约 | 无普通 paste handler/测试 |
| 跨段选区复制与纯文本剪贴板保真 | 证据不足 | 中 | 隐藏标记或块 decoration 不应污染复制结果，但当前无剪贴板断言 | 无普通 copy handler/测试 |
| Smart Paste 保留段落语义 | 未实现 | 中 | 从网页/富文本复制时难以得到可预测 Markdown 段落 | 仅有图片 paste 扩展证据 |
| 键盘撤销一次恢复一次分段操作 | 证据不足 | 高 | 自定义分段后若产生多 transaction 会破坏手感 | 目前没有段落 undo 测试 |
| IME 组合态下 Enter/Shift+Enter | 证据不足 | 高 | 中文输入确认键可能被错误拦截 | 无 composition 专项证据 |
| 保存失败保留 dirty 与错误 | 已实现 | 中 | 写入失败不会误报已保存 | `fileActions.test.ts:95-141` |
| 段落专项 E2E 与截图回归 | 未实现 | 高 | 无法持续证明真实键位和视觉体验 | `rg` 未发现对应断言 |
| 1–10MB 段落输入/滚动性能 | 证据不足 | 高 | 大文档可能发生按键延迟或滚动抖动 | 仅有总体 fixture/perf 入口 |

## 根因与架构影响

根因不是 Markdown 解析器缺失，而是编辑命令层没有“普通段落语义”。项目把 CodeMirror 默认文本编辑命令直接作为最终行为，默认命令无法知道 LumaMark 对 Enter 的产品定义。视觉层同样按物理行统一排版，尚未把语法树中的 Paragraph、空行与段内换行映射成稳定的块级呈现。测试层则侧重已有源码 round-trip，尚未覆盖“用户操作生成什么源码”。

改进应归属 `editor` 层：键位判断与 transaction 放在明确的 paragraph capability/command 中，不能堆入 React shell、全局 store 或 Tauri command。CodeMirror 文档继续是唯一 Markdown 真源；feature 和 React 只接收轻量 dirty/version 事件。文件 service 无需理解段落。若为段落视觉新增 decorations，必须限定可视范围或使用增量 StateField/ViewPlugin，避免每次输入扫描全文。此变更影响 IME、undo、selection、copy/paste、源码保真和大文档热路径，属于编辑器核心高风险改动，需要独立审查和架构文档同步检查；若仅复用 CodeMirror API，不构成更换核心或自研基础组件。

## 详细改进方案

### 模块归属与成熟依赖优先

在 `src/editor/capabilities/paragraph/` 建立聚焦能力，导出 paragraph keymap 与必要的可视化扩展，由现有 capability 组合入口接入。优先复用 `@codemirror/commands` 的 `insertNewlineAndIndent`、`@codemirror/state` 的单 transaction 变更和现有 Markdown syntax tree；不要手写 contenteditable、解析器或通用键盘系统。先验证 CodeMirror keymap 的 `shift` 分支、`EditorView.composing`/composition 行为和 transaction annotation，再决定是否需要很薄的自定义命令。

### 数据流与输入语义

普通 Paragraph 或空文档的普通文本上下文中，Enter 应以一个 transaction 将选区替换为 `\n\n`，光标置于两个换行之后；Shift+Enter 以一个 transaction 插入 `\n`。命令必须先判断 composition、只读状态和当前 Markdown 上下文。标题、列表、引用、代码围栏等上下文交给各自能力或 CodeMirror 默认命令，不能由普通段落命令吞掉。若当前行已为空、选区跨块或位于文首/文末，需用书面规则和测试定义是否补一还是两个换行，避免连续 Enter 指数式增加空行。transaction 必须带合适 `userEvent`，确保一次按键对应一次 undo。

### 阅读呈现与源码保真

以语法树/行结构识别普通 Paragraph 的开始、结束和段内行，必要时对段落首尾使用 line decoration 调整节奏；不要修改文档字符来制造视觉间距。源码模式不加载该呈现。任何保存都从 `editor.getDocumentText()` 获取原始字符；禁止 trim、换行标准化或清理尾随空格。fixture 至少增加 LF、CRLF 粘贴归一后的明确契约、裸单换行、双空格硬换行、`<br>`、1/2/3 个空行、无末尾换行和中文段落组合。

### 粘贴

第一阶段保持成熟浏览器/CodeMirror 的纯文本粘贴，并增加确定性测试；只有在实测 Typora Smart Paste 后才设计 HTML-to-Markdown 转换。若引入转换，优先评估已存在的 `markdown-it` 是否只适合渲染、以及维护活跃的 HTML-to-Markdown 库，不得自研通用 HTML 解析器。纯文本粘贴快捷键必须绕过富文本转换，失败时保留可粘贴的纯文本，而不是静默丢内容。

### i18n、可访问性与错误处理

段落输入本身不应新增可见文案；若增加命令面板动作、快捷键帮助或错误提示，必须同步 `en.json` 与 `zh-CN.json`，不要拼接句子。当前本地化 `aria-label` 位于外层 `section`，实现时必须用角色查询和真实辅助技术确认内部 CodeMirror textbox 获得可访问名称；若未获得，应通过 CodeMirror `editorAttributes` 等成熟接口把名称落到实际编辑控件。若视觉段落 decoration 使用隐藏 widget，不能污染无障碍树，屏幕阅读顺序与复制出的纯文本仍应是源码顺序。输入命令不应抛出 UI 错误；不适用上下文应明确返回 `false` 让后续 keymap 接管。粘贴转换失败应走可本地化错误边界并保留原文本。保存失败继续沿用 file-action 的 recoverable error 与 dirty 保留机制。

## 优先级

### P0

- 定义并实现普通段落 Enter=`\n\n`、Shift+Enter=`\n` 的上下文感知单 transaction 命令。
- 覆盖普通段落、空文档、文首文末、选区、undo/redo、IME composition 与保存后的精确源码。
- 新增段落 fixture 矩阵并通过真实编辑器 open→按键→save→diff 验证，而非 mock 原文返回。

### P1

- 建立段落/硬换行视觉区分的集成与截图回归，校准亮色/暗色、中文/英文及焦点状态。
- 覆盖跨段复制、多行纯文本 LF/CRLF 粘贴、尾随双空格、`<br>` 和连续空行，并确认实际 textbox 的可访问名称与阅读顺序。
- 在 1MB/5MB/10MB 文档中单独测量分段 transaction、输入延迟、滚动、启动增量和内存增量，不与 E2E/构建并行。

### P2

- 在完成 Typora 实测后评估 Smart Paste 的段落转换与“粘贴为纯文本”。
- 实测 Typora 连续三次 Return、HTML 导出硬换行及精确段间距，再决定是否继续像素/导出对齐。

## 可执行验收标准与测试计划

1. **Unit：** 给定文档 `a`、光标 offset=1，运行 Enter 命令后文档严格等于 `a\n\n`、光标 offset=3，继续输入 `b` 后严格等于 `a\n\nb`；同一初始条件运行 Shift+Enter 后严格等于 `a\n`、继续输入 `b` 后严格等于 `a\nb`。每个按键只产生一个可撤销事件，undo 恢复原文，redo 恢复结果。覆盖选区、空文档、已有空行、文末、中文、尾随空格及命令不适用的块上下文。
2. **Integration：** 用真实 `EditorView` 派发键盘事件，断言 Enter/Shift+Enter、光标位置、selection、composition 期间不误提交；切换 source/livePreview 后文本与 undo history 不变。断言 Paragraph decoration 只改变展示，不改变 state.doc。
3. **Copy/Paste integration：** 跨段选择 `a\n\nb` 后复制，断言剪贴板 `text/plain` 严格等于所选源码且不包含 decoration/widget 文本；再分别粘贴 `a\nb`、`a\n\nb`、`a\r\n\r\nb`、行末双空格和 `<br>`，记录并断言项目约定的精确 state.doc。纯文本失败路径不得丢字。Smart Paste 在 Typora 规则未核实前不作为一致性验收。
4. **Fixture：** 新增专门 paragraphs-and-breaks fixture，覆盖裸单换行、段间空行、1/2/3 个连续空行、尾随双空格、`<br>`、有/无末尾换行与中英混排。运行 `pnpm test:fixtures`，要求所有 open→save 字节差为 0；另加真实编辑 transaction 后的目标 diff。
5. **E2E：** 启动应用，新建文档，输入两段及一个 Shift+Enter 硬换行，切源码模式断言精确字符，撤销/重做，再保存并读取 mock 文件系统中的精确文本。分别用鼠标点击两段、键盘上下移动验证光标稳定；亮暗主题、英文/中文 UI 各执行关键路径。
6. **视觉与 a11y E2E：** 非焦点两段之间有稳定段落节奏，硬换行没有段间距；焦点、选区、末尾空段在 Chromium/WebView 目标尺寸截图无跳动。用 `getByRole('textbox', { name: 本地化编辑器名称 })` 定位实际 CodeMirror 编辑控件，中文/英文各断言名称、键盘焦点和跨段阅读顺序；补充 axe 或等价检查，但不以自动扫描替代屏幕阅读器抽检。像素阈值应基于核实后的产品基准，而非猜测 Typora CSS。
7. **Perf：** 在 `pnpm perf:bench` 中串行测普通小文档与 1MB/5MB/10MB fixture 的单次 Enter/Shift+Enter transaction；普通输入目标尽量低于 16ms，10MB 不冻结。记录长单段软换行的滚动帧表现、decoration 更新范围、启用段落 capability 前后的编辑器创建耗时与堆内存增量；性能测试不得与 E2E、typecheck、lint 或构建并行。
8. **门禁：** 实现时依次执行聚焦测试、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:fixtures`、目标 E2E，再单独运行 `pnpm perf:bench`。涉及编辑器核心与源码保真，合入前必须独立审查。

## 风险与未核实项

- Typora 连续多个 Return 的视觉合并、Smart Paste 精确拆分、硬换行导出 HTML 仍未核实；本文明确不把推测当事实。
- 在所有 Markdown 块上全局拦截 Enter 会破坏列表、引用、围栏、表格和 IME，必须严格限定普通 Paragraph 上下文并让其它 capability 优先。
- `\n\n` 的单 transaction 虽可形成新段落，空行的可点击高度、光标上下移动和屏幕阅读仍需真实 WebView 验证。
- 当前 round-trip 测试使用 mock editor 直接返回原 fixture，只证明文件动作不改文本，不证明真实 CodeMirror 编辑和粘贴后仍保真。
- 应用保存前会调用 `finalizeAllDraftImages`；现有代码显示其目标是替换 draft 图片引用，但段落 fixture 尚未通过“真实 CodeMirror → 应用预处理 → 文件写入”组合路径验证。
- 外层 `section` 有本地化标签不等于内部 CodeMirror textbox 已获得可访问名称；跨段屏幕阅读顺序与复制剪贴板内容也尚未核实。
- `basic.md` 当前含环境相关图片路径，但不影响本文引用的段落与双空格证据；它也不应替代专门段落 fixture。
- 依赖包内 `dist/index.js` 是安装产物证据，长期行为应由项目自有测试锁定，不能把上游实现细节当永久契约。

## 证据索引

| 证据 | 用途 |
|---|---|
| `docs/product/typora-baseline/01-paragraphs-and-breaks.md:13-90` | Typora 范围、Return/Shift+Return、源码、粘贴及未核实项 |
| `docs/product/typora-baseline/00-live-preview-model.md:38-54` | 横切段落、换行、Smart Paste 与快捷键基线 |
| `src/editor/core/createEditorState.ts:41-122` | 编辑器真源、line wrapping、history 与 keymap |
| `node_modules/.pnpm/@codemirror+commands@6.10.4/node_modules/@codemirror/commands/dist/index.js:1717-1745` | Enter 与 Shift+Enter 当前同命令的依赖直接证据 |
| `pnpm-lock.yaml:2916-2920` | CodeMirror commands 实际锁定版本 |
| `src/editor/commands/markdownFormatKeymap.ts:4-37`；`src/editor/core/createEditorState.ts:114-119` | 项目键位层无段落 Enter 分流，随后注册默认键位 |
| `src/editor/core/editorDisplayMode.ts:40-57` | 源码/实时预览扩展边界 |
| `src/editor/core/editorApi.ts:78-109`；`src/editor/core/editorApi.test.ts:129-162` | 原文读取、加载与模式切换保真 |
| `src/editor/core/editor.css:44-63` | 当前正文、行高、宽度和统一行 padding |
| `src/editor/core/EditorViewHost.tsx:79-119` | CodeMirror 创建、焦点宿主与仅位于外层区域的可访问标签 |
| `src/editor/wysiwyg/markdownDecorations.ts:211-340,453-500` | 当前语法 decoration 与焦点行机制；无 Paragraph 映射 |
| `src/features/file-actions/fileActions.ts:91-95,126-169`；`src/app/controllers/useAppDocumentModel.ts:59-64` | 保存快照、预处理器、并发 revision 与 dirty 数据流 |
| `src/features/file-actions/fileActions.test.ts:95-274` | 保存成功、失败、并发编辑的自动化证据 |
| `tests/fixtures/markdown/basic.md:3-6` | 普通段落、空行、尾随双空格 fixture |
| `tests/fixtures/markdownFixtureManifest.ts:7-11,156-166`；`tests/fixtures/fixtureCoverage.test.ts:9-63` | paragraph 与大文件标签登记、覆盖检查 |
| `tests/fixtures/roundTrip.test.ts:8-70` | 未编辑 fixture 的 byte-for-byte 保存证据及其 mock 边界 |
| `package.json:12-24` | typecheck、lint、test、fixture、E2E 与禁用文件并行的 perf 门禁入口 |
