# 1. LumaMark 与 Typora 水平线（Horizontal Rules）竞品分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - 标题 marker 已消费共享 block context；水平线与标题装饰共同消费 protected-source ranges。由 `---`/`...` 闭合的文首 YAML 因而不会再被误装饰成水平线或 Setext 标题，并有 UI 回归测试。
> - 这不等于水平线已完整迁移到共享活动结构模型；其焦点编辑、删除、变体、原生 IME 与源码保真矩阵仍未全面追平。

## 2. 用途、范围与非目标

本文用于判断 LumaMark 的水平线能力究竟处于“功能存在”还是“体验追平”阶段，并为后续实现、验收与回归提供可执行依据。范围限定为 Markdown thematic break / horizontal rule：通过 `***`、`---` 等源码创建，live preview 中的阅读态与焦点编辑态，源码模式，键盘、鼠标、粘贴、菜单、命令面板、保存、撤销以及与 Setext 标题和 YAML Front Matter 的边界。

本文不分析普通 UI 分隔线、表格 delimiter、HTML `<hr>`、导出样式，也不把产品规划视为实现证据。Typora 基线以 `docs/product/typora-baseline/13-horizontal-rules.md`、其直接引用的 `00-live-preview-model.md` 与 `14-yaml-front-matter.md` 为准；其中标记为未核实的体验，本文保持证据边界，不据此虚构 Typora 行为。

## 3. 执行摘要

结论：LumaMark 的水平线**功能存在，但体验尚未追平**。当前版本已经能依赖 CodeMirror Markdown / Lezer 语法树识别 `HorizontalRule`，在 live preview 中将源码染为透明并绘制一条 1px 视觉线；源码模式会卸载 live-preview 扩展而显示真实 Markdown；段落菜单和命令面板都能插入规范化的 `---`；英文与简体中文菜单文案已进入 i18n；现有单元测试、E2E 和 fixture round-trip 对 `---` 主路径提供了真实证据。

差距集中在“编辑过程”和“边界保真”。当前水平线没有独立 capability，而是混在通用 `markdownDecorations.ts` 中。定点语法树探针确认当前编辑器实际使用的 parser 能把 `***`、`___`、带空格 marker 与 4 个连字符识别为 `HorizontalRule`，所以不能把这些语法说成不存在；但通用装饰不排除活动行，第三个 marker 一旦使语法树成立，源码就会被透明样式覆盖，没有焦点进入时的源码展开规则，也没有专属鼠标命中、删除或键盘移动语义。现有持久化测试仍大多以整段插入 `---` 或调用菜单命令为起点，没有覆盖上述变体的真实逐键输入、复制/剪切、粘贴、中文 IME、撤销重做、编辑后保存重开，以及 YAML/Setext 歧义。因此只能判定“语法显示功能存在”，不能把它写成“输入与编辑体验已追平”。

优先级上，P0 应先锁定源码保真和歧义边界，并补齐真实键入、焦点删除与保存回归；P1 再完善 Typora-like 焦点模型、鼠标和可访问性；P2 才处理更细的视觉参数与经实测确认的 Typora 特例。

## 4. Typora 功能与完整体验基线

### 4.1 创建

Typora 1.13.7 的公开基线明确：在空行输入 `***` 或 `---` 后按 Return，生成水平线。这里的“生成”不是把 Markdown 文本替换成私有对象，而是在同一份 Markdown 源码上进入 live-preview 呈现。菜单存在“段落 → 分割线类项”的可能路径，但基线文档对精确 GUI 文案仍标记为未核实，因此只能把键入路径视为已知基线，不能断言菜单像素与名称。

### 4.2 阅读态

光标不在水平线块时，Typora 显示为分隔线，`***` 或 `---` 结构符号隐藏。该行为继承横切 live-preview 模型：块完成并离开焦点后，以接近阅读结果的样式呈现，同时仍以 Markdown 源文件为唯一真实数据。

### 4.3 焦点编辑态

Typora 基线尚未核实“点击水平线后是否立即展开为 `---` 源码”，也未核实 Backspace/Delete 的精确删除阶梯。因此本专题的追平标准不能预设某种像素级展开动画；但至少必须满足可发现、可定位、可删除、光标稳定、撤销可逆，且不因透明源码造成用户无法判断当前编辑位置。

### 4.4 源码模式

源码模式应显示完整原文标记。用户原来写的是 `***`、`---` 或其他解析器接受的等价形式，就应看到并保存该形式。live preview 与源码模式编辑同一份文档，切换不应改写内容；横切基线还要求 1.13 的模式切换尽量保持滚动位置。

### 4.5 键盘

已知创建路径是空行输入 `***` 或 `---` 后按 Return。基线没有记录水平线专属默认快捷键。合理的完整体验还包括：方向键能稳定越过该块，Home/End 行为可预测，Backspace/Delete 不误删相邻段落，撤销与重做恢复精确源码；但 Typora 的具体按键阶梯仍需本机复核。

### 4.6 鼠标

阅读态应有稳定的可点击区域，点击后光标落点可预测，且不会因为视觉线覆盖源码而产生“看得见却选不中”的死区。Typora 点击后是否展开源码目前证据不足；菜单插入的精确路径也未完成 GUI 复核。

### 4.7 复制与剪切

横切基线说明 Typora 默认 Copy 面向 HTML，另有 Copy as Markdown 与 Copy as Plain Text；但水平线专题没有核实仅选中分隔线、跨越分隔线选区或剪切分隔线时的精确剪贴板内容。报告不得预设透明 marker 会被复制成 `---`，也不得把 LumaMark 的默认 CodeMirror 复制行为当成 Typora 已追平。最低质量要求是选区稳定、显式 Copy as Markdown 保留原 marker、剪切不误删相邻段落且可一次撤销。

### 4.8 粘贴

横切基线说明 Typora 支持普通粘贴、纯文本粘贴和 Smart Paste，但水平线专题没有核实粘贴一行 `---`/`***` 后的即时呈现时机。最低保真要求是：粘贴的 Markdown 原样进入文档，解析只影响显示，不静默统一 marker 风格；撤销一次应撤回本次粘贴事务。

### 4.9 保存

落盘必须保持用户选择的 marker，不把 `***` 静默改写为 `---`。水平线周围的空白、换行和相邻内容不能产生无关 diff。打开、编辑、保存、重开后应得到相同语义与除目标编辑外完全一致的源码。

### 4.10 错误与边界

文首 `---` 与 YAML Front Matter 存在歧义：Typora 基线将“文首 `---` + Return”归入 metadata，而正文中的 `***`/`---` 归入水平线。连续连字符也可能是 Setext 二级标题的下划线。`___`、带空格 marker、超过三个 marker、相邻列表或强调等 CommonMark 变体在当前 Typora 专题未完整实测，必须保留为未核实项。失败时不能吞字符、崩溃或改写邻近源码；无法识别时应按普通文本安全回退。

## 5. LumaMark 当前功能清单与证据

1. **语法识别与显示：已实现。** `src/editor/markdown/markdownLanguage.ts:1-18` 使用 `@codemirror/lang-markdown` 的 GFM Markdown language；`package.json:37,45` 与 `pnpm-lock.yaml:20-22,44-46` 锁定相关成熟依赖。`src/editor/wysiwyg/markdownDecorations.ts:183-248` 遍历语法树并把 `HorizontalRule` 映射成 `lm-md-horizontal-rule` / `horizontalRule`。本次用实际 `markdown({ base: markdownLanguage })` 对 `---`、`***`、`___`、`* * *`、`----` 做只读语法树探针，五者均产生 `HorizontalRule`；这证明当前 parser 的语法分类，不证明 Typora-like Return 时机、焦点态和保存体验。
2. **阅读态视觉线：已实现。** `src/editor/wysiwyg/wysiwyg.css:168-184` 将匹配范围设为透明、宽度 100%，并用 `::after` 绘制 1px 主题边框色水平线。它证明“有视觉线”，不证明已匹配 Typora 的间距、颜色或焦点反馈。
3. **live preview 接入：已实现。** `src/editor/capabilities/index.ts:31-39` 把通用 WYSIWYG 扩展加入 live-preview capabilities；`src/editor/core/editorDisplayMode.ts:42-57` 仅在 `livePreview` 模式装载这些扩展。
4. **源码模式显示原文：已实现。** `src/editor/core/editorDisplayMode.ts:42-57` 的 source 分支只增加源码模式 class，不装载水平线 decoration；`src/editor/core/editorApi.ts:151-161` 通过 compartment 重配置同一 EditorView。E2E `tests/e2e/editor-markdown.spec.ts:62-110` 检查切到源码模式后仍含 `---`。
5. **菜单与命令面板插入：已实现。** `src/features/commands/createCommandModels.ts:104-115` 注册 `insert-horizontal-rule` 命令，`230-253` 将 `horizontalRule` 放入段落菜单；`src/app/controllers/useAppCommandModels.ts:16-36` 将其纳入 Markdown command 集合；`src/editor/commands/markdownFormatCommands.ts:26-44,143-179` 最终调用插入函数。
6. **规范化插入布局：已实现。** 插入函数在空行或非空块上生成带段落边界的 `---`，并将 selection 移到后续位置。`src/editor/commands/markdownFormatCommands.test.ts:106-127` 覆盖非空块和空行两种布局，断言结果均为 `Before\n\n---\n\nAfter`。
7. **中英文文案：已实现。** `src/shared/i18n/locales/en.json:81` 为 `Horizontal Rule`，`zh-CN.json:81` 为“分割线”；`src/shared/i18n/i18n.test.ts:4-110` 将该 key 纳入双语非空检查。
8. **`---` 装饰单测：已实现。** `src/editor/wysiwyg/markdownDecorations.test.ts:85-149` 两个用例都以 `---` 断言 `horizontalRule` 范围与 class。
9. **真实 UI 主路径 E2E：已实现。** `tests/e2e/editor-markdown.spec.ts:3-47` 验证插入整段 Markdown 后视觉线可见；`450-481` 验证段落菜单与命令面板插入，并在源码模式断言五行精确内容。
10. **未编辑 fixture 的逐字节保存：部分实现。** `tests/fixtures/markdown/basic.md:6-10` 与 `tests/fixtures/markdown/comprehensive.md:12` 含 `---`；只有 `comprehensive.md` 在 `tests/fixtures/markdownFixtureManifest.ts:76-95` 明确标记 `commonmark:thematic-break`；`tests/fixtures/roundTrip.test.ts:8-71` 对 manifest 文件执行 byte-for-byte open/save 比较。但 fixture 没有水平线 marker 变体，也没有对水平线做编辑后再保存。
11. **真实键入 `***`/`---` + Return：部分实现。** 普通 CodeMirror 文本输入和已核实的 parser 足以形成 `HorizontalRule`，但现有 E2E 使用 `keyboard.insertText` 一次性插入整段内容，或直接触发菜单 command；没有逐键输入三个 marker 再按 Return 的断言。由于装饰对活动行同样生效，当前实现还可能在第三个 marker 后、Return 前就把源码变透明，不能据语法识别宣称输入时机追平。
12. **焦点、鼠标和删除模型：未实现。** `markdownDecorations.ts:242-248` 只加 mark；CSS 始终 `color: transparent`。水平线不在 `collectHiddenMarkdownMarks` 的按活动行显隐逻辑中，也没有专属 widget、DOM handler 或 keymap。通用 CodeMirror 仍可能提供基本光标和删除能力，但仓库没有专题测试点击落点、源码展开、Backspace/Delete、方向键和撤销，所以这些具体体验仍为证据不足。
13. **复制、剪切与粘贴：证据不足。** 仓库存在表格专用剪贴板 E2E，但没有水平线选区的默认 Copy、Copy as Markdown、剪切、普通粘贴或撤销测试；不能从 CodeMirror 默认行为推断透明 marker 的选区边界、剪贴板内容和 Typora 默认 Copy-as-HTML 对齐情况。

## 6. 当前真实体验路径

菜单路径的真实数据流是：用户在段落菜单或命令面板选择“分割线” → `createCommandModels` 调用 `handlers.horizontalRule` → app controller 将 action 转交 editor command port → `applyMarkdownFormatCommand(..., 'horizontalRule')` → `insertHorizontalRule` 向 CodeMirror transaction 插入 `---` 与必要空行 → Markdown language 解析为 `HorizontalRule` → live-preview decoration 为范围添加 class → CSS 隐藏 marker 并绘制视觉线。切换源码模式时，compartment 卸载 live-preview capabilities，原始 `---` 在同一个文档中重新可见。

直接输入或粘贴的路径更短：字符进入 CodeMirror 文档 → 成熟 Markdown parser 重建语法树 → 若节点被识别为 `HorizontalRule`，通用 decoration 绘线。这里没有产品级 input rule，也没有针对 Return 的事务语义；装饰在活动行也生效。保存路径是 `fileActions.ts:126-169` 从 `editor.getDocumentText()` 取出文本，经 `prepareTextForSave` 后调用 `writeText`；该参数的默认值在 `fileActions.ts:91-99` 是恒等函数，但应用实际从 `useAppDocumentModel.ts:62-64` 注入 `finalizeAllDraftImages`，所以只能断言“没有水平线专用规范化逻辑”，不能笼统断言整个应用保存预处理恒等。水平线 decoration 本身只读语法树，不会改写 marker；现有 round-trip 证明未编辑的 `---` 可原样写出，但不能替代编辑后变体保真的验证。

## 7. 逐项差距矩阵

| 行为点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| `---` 语法树识别与阅读态画线 | 已实现 | 低 | 基础文档能显示分隔线 | `markdownDecorations.ts:183-248`；`wysiwyg.css:168-184`；单测与 E2E |
| 段落菜单插入 `---` | 已实现 | 低 | 鼠标用户有稳定创建入口 | `createCommandModels.ts:230-253`；E2E `450-481` |
| 命令面板插入 `---` | 已实现 | 低 | 键盘用户可搜索命令创建 | `createCommandModels.ts:104-115`；E2E `450-481` |
| 空行输入 `---` + Return | 部分实现 | 高 | parser 可识别文本，但没有真实按键与事务级证明 | 仅有整段 `insertText` 和菜单插入测试 |
| 空行输入 `***` + Return | 部分实现 | 高 | parser 已能识别，但装饰可能在 Return 前隐藏当前行源码，逐键体验未证明 | 实际 parser 探针产生 `HorizontalRule`；无持久化 `***` 逐键测试 |
| `___`、带空格、更多 marker 等变体 | 部分实现 | 中 | parser 已能显示所抽样变体，但外部文档保真和 Typora 对齐未覆盖 | `___`、`* * *`、`----` 探针均产生 `HorizontalRule`；fixture 与单测未覆盖 |
| 非焦点阅读态隐藏 marker | 已实现 | 低 | 用户看到视觉线而非 `---` | CSS `color: transparent` 与伪元素；E2E 可见性 |
| 焦点进入后可发现、可编辑源码 | 未实现 | 高 | 点击视觉线后缺少明确编辑反馈，可能形成透明编辑区 | 水平线无活动行分支、widget 或 handler |
| Backspace/Delete、方向键、撤销重做 | 证据不足 | 高 | 可能误删邻段、光标跳转或难以恢复 | 无专题 keymap 与交互测试 |
| 源码模式显示真实 marker | 已实现 | 低 | 用户可进入源码模式查看 `---` | `editorDisplayMode.ts:42-57`；E2E `62-110` |
| 保留 `***`/`___` 与空白风格 | 部分实现 | 高 | 当前无 HR 规范化逻辑，但缺少变体与编辑后门禁，未来改动可能造成无关 diff | decoration 只读；保存存在图片预处理 hook；fixture 只含 `---` |
| 粘贴 Markdown 后解析、撤销与保真 | 证据不足 | 中 | 从其他编辑器迁移内容时可能丢失预期或难撤销 | 无专题粘贴测试 |
| 复制/剪切水平线选区 | 证据不足 | 中 | 透明 marker 的选区边界、默认剪贴板内容和剪切后的撤销行为未知 | 无水平线 clipboard 测试；现有 clipboard E2E 只覆盖表格专用命令 |
| 文首 YAML、正文 HR、Setext 歧义 | 未实现 | 高 | parser 探针把 YAML-like 文首开线判为 HR、后续行判为 Setext，live preview 语义错误；源码仍保留 | 无 Front Matter capability；探针为 `HorizontalRule,SetextHeading2,Paragraph` |
| i18n 菜单文案 | 已实现 | 低 | 中英文入口一致 | 双语 JSON 与 i18n test |
| live-preview 可访问语义 | 未实现 | 中 | 屏幕阅读器可能只遇到透明字符，无法获知分隔语义 | 当前 mark 未提供 separator role、label 或专属语义测试 |
| 主题、缩放与长文性能 | 证据不足 | 中 | 大量水平线时 decoration 成本和视觉对比度未知 | 无专题截图矩阵、a11y 对比度或 perf 基准 |

## 8. 根因与架构影响

首要根因是水平线被当成“一个 CSS class”而不是完整编辑器能力。识别逻辑位于通用 `markdownDecorations.ts`，创建逻辑位于大型格式命令 switch，交互则完全交给 CodeMirror 默认行为。这种组织能快速证明视觉功能，却无法承载焦点状态、精确删除、无障碍语义、变体策略和边界分类。

第二个根因是测试围绕规范化输出 `---`，而不是围绕 Markdown 源码保真矩阵。解析器是成熟依赖，确实降低了自研语法风险，但依赖能力不等于产品行为证明；尤其 `@codemirror/lang-markdown` 实际还通过其依赖链使用 `@lezer/markdown@1.6.4`，而项目直接依赖为 1.7.0，不能仅凭直接依赖版本推断编辑器 parser 的全部边界行为。

第三个根因是 YAML Front Matter 尚无专用 editor capability。若直接在水平线模块里硬编码“文首 `---` 是 YAML”，会让两个专题互相侵入并制造新的解析分叉。正确架构影响是：水平线 capability 消费统一的 Markdown 语法分类结果；Front Matter 应由独立 capability 或 parser extension 提供更高优先级的文首节点；两者通过测试矩阵定义边界，而不是在 UI 层用正则争抢。

该改进触及 editor 热路径、selection、undo、IME 与源码保真，属于高风险编辑器核心工作。不能让 React store 持有 Markdown 全文，也不需要 Rust 或 Tauri command。保存服务只应继续接收 CodeMirror 的真实文本，不承担水平线规范化。

## 9. 详细改进方案

### 9.1 模块归属与成熟依赖优先

在 `src/editor/capabilities/horizontal-rule/` 建立聚焦 capability，至少拆为识别/装饰、交互与测试三个职责；`createLivePreviewCapabilities` 负责注册。继续优先使用 `@codemirror/lang-markdown` / Lezer 的 `HorizontalRule` 节点，不自研 CommonMark parser。只有在实测证明成熟 parser 无法表达 Typora 的文首 YAML 优先级时，才评估 Lezer 官方 extension 机制；不得先写全量正则解析器。菜单继续复用现有 Radix menubar 与 cmdk 命令面板，不新增基础 UI 组件。

### 9.2 数据流

数据流保持单向：键盘、粘贴或菜单产生 CodeMirror transaction → Markdown source 成为唯一状态 → 语法树分类 HR / Setext / Front Matter → horizontal-rule capability 根据模式与 selection 生成 decoration → React shell 只触发稳定 command，不持有文本 → file action 读取 editor 文本，经已授权的保存前处理后写入，且水平线行不被该处理改写。禁止把水平线转换成脱离源码的 React 节点或额外 document model。

### 9.3 创建与焦点编辑

先验证 CodeMirror 默认输入是否已完整满足 `***`/`---` + Return；若已满足，只补测试和明确的 transaction annotation，不重复造 input rule。若 Return 时机与 Typora 明显不同，再实现最小 input handler，且只在非 composing、空行、语法上下文明确时触发。焦点模型应让非当前块显示视觉线，当前块提供清晰的源码或专属可编辑表示；无论采用 marker 展开还是 caret affordance，都必须保证 selection 映射稳定、点击可定位、Esc/方向键可离开、一次 undo 可恢复整个用户动作。

### 9.4 源码保真

装饰只读语法树，不修改 marker。菜单新增的水平线可以固定生成项目约定的 `---`，但打开或编辑已有 `***`、`___`、带空格 marker 时不得自动统一。建立“原文 → live preview → source → save → reopen”逐字节矩阵，以及“只编辑相邻段落，HR 行零 diff”的最小差异断言。Front Matter 和 Setext 的分类也必须在保存前后不变。

### 9.5 i18n 与可访问性

复用现有 `menu.horizontalRule`。若新增“删除分割线”“编辑分割线”或屏幕阅读器标签，英文与简体中文 key 必须同时加入资源与覆盖测试，禁止在 widget 中硬编码。live preview 应评估 CodeMirror decoration 是否能安全暴露 `role="separator"` 和本地化 accessible name；若 role 会干扰 contenteditable，需要采用 CodeMirror 推荐的可访问替代方案，并以 Playwright + axe 或等价成熟工具验证。键盘不应依赖鼠标，视觉焦点不能只靠颜色。

### 9.6 错误处理与边界分类

无法确认 HR 的文本必须保留为普通 Markdown，不抛出 UI 错误，也不静默改写。文首 Front Matter 的失败由 Front Matter capability 报告，水平线模块不显示 YAML 错误。对不完整 marker、组合输入中间态和超长 marker 行，应允许 parser 增量恢复；日志或错误边界只记录真正异常，不能把合法但未识别的 Markdown 当作失败。

## 10. P0 / P1 / P2 分阶段计划

### P0：保真与边界门禁

- 建立 `---`、`***`、`___`、带空格、4+ marker、邻接段落、列表、强调、Setext、文首/正文 YAML 的 parser 与 decoration 表驱动测试。
- 建立逐键输入 marker + Return、Backspace/Delete、方向键、undo/redo、复制/剪切/粘贴与 IME composition 不误触发的集成测试。
- 增加编辑后保存重开的 fixture round-trip 和目标范围零无关 diff 测试。
- 与独立 Front Matter capability 明确文首优先级；在该边界完成前，不宣称水平线体验追平。

### P1：Typora-like 编辑与可访问性

- 抽出 horizontal-rule capability，定义阅读态、当前块态和 source 态。
- 完成点击命中、焦点可见、键盘删除与跨块移动；保持 selection 和 undo 稳定。
- 补充屏幕阅读器语义、键盘可达性、亮暗主题与高缩放视觉回归。
- 补充中英文新增文案与命令可发现性测试。

### P2：体验精修与已核实对齐

- 在本机复核 Typora 1.13.7 的点击展开、删除阶梯、`___`、粘贴及 YAML 歧义，再决定是否逐项对齐。
- 通过截图对比调整线宽、上下留白、主题对比度与焦点反馈，不复制 Typora 专有素材。
- 根据性能数据决定是否需要 viewport 缓存或更细粒度 decoration 更新；没有测量结果前不增加缓存层。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 在普通正文空行逐键输入 `---` 或 `***` 并按 Return，离开当前块后出现水平线；切源码模式仍显示原 marker。
2. 打开包含所有受支持 CommonMark 变体的 fixture，live preview 分类正确；保存重开逐字节一致。
3. 文首 Front Matter、正文 HR、Setext H2 三类样本互不误判；非法或不完整输入安全显示为可编辑文本。
4. 点击水平线可获得明确焦点反馈；Backspace、Delete、方向键、Home/End 行为有确定断言；每个编辑动作可用一次对应 undo/redo 恢复。
5. 粘贴一行或多行含 HR 的 Markdown 后显示正确，撤销只撤销该次粘贴，marker 不被规范化。
6. 中文 IME composition 期间不提前转换或移动 selection，确认上屏后才按最终文本解析。
7. 菜单与命令面板在中英文下名称正确、可键盘操作；新增语义无硬编码文案。
8. 亮色、暗色、200% 缩放下视觉线和焦点反馈可辨，屏幕阅读器能理解分隔语义或获得经验证的等价提示。
9. 在 live preview 与源码模式分别选中水平线及相邻文本，默认复制、显式 Copy as Markdown 与剪切所得内容符合产品约定；剪切可一次撤销，透明 marker 不造成选区丢失或复制多余相邻内容。

### 11.2 Unit

- 对 `collectHorizontalRuleRanges` 或等价纯逻辑做表驱动测试，断言 node kind、from/to、原始 marker 与排除项。
- 对菜单插入函数覆盖文首、文末、空文档、空行、选区跨行、CRLF、相邻 HR，并断言 selection 与单事务 undo。
- 对 Front Matter / Setext / HR 分类写互斥测试，避免多个 capability 同时装饰同一范围。

### 11.3 Integration

- 使用真实 EditorView 分别在 livePreview/source 模式输入、点击、删除、撤销、切换模式，断言文本、selection 与 decoration；对跨越 HR 的 copy/cut 断言底层选区和事务范围。
- 组合输入测试监听 `compositionstart/update/end`，保证中间态不触发结构转换。
- 保存集成测试对编辑前后文本做最小 diff，并模拟写入失败，确认当前文档仍安全且 marker 未被修改。

### 11.4 E2E

- Playwright 逐键执行 `***`/`---` + Enter，而不是一次性 `insertText` 整段文档。
- 覆盖菜单、命令面板、鼠标点击、键盘删除、undo/redo、复制/剪切/粘贴、源码模式切换和保存重开，并直接读取剪贴板断言内容。
- 用可访问 role/name 或等价语义定位水平线，避免只以 CSS class 证明用户体验。
- 亮暗主题各保留关键截图，单独验证焦点态与阅读态。

### 11.5 Fixture 与 perf

- 新增专属 `horizontal-rules.md` fixture，覆盖 marker 变体、空白、相邻结构、YAML/Setext 和中英文邻接文本，并进入 byte-for-byte round-trip。
- 增加包含 1,000 条水平线的合成长文基准，分别测量首次打开、在文末输入一个字符、滚动与模式切换；与普通同等行数文档对照。
- 性能基准必须通过独立 `pnpm perf:bench` 串行运行，不能与 E2E、构建或 typecheck 并行。验收门槛是新增 capability 不让普通输入事务明显偏离项目 `<16ms` 目标，且 decoration 仅处理 viewport 或有等价的受测增量策略。

## 12. 风险与未核实项

- Typora 点击水平线后是否展开源码、精确删除阶梯、`___` 是否与 `***`/`---` 同等、粘贴后的即时渲染时机仍未本机复核；这些只能列为对齐研究项。
- 本次只读探针已证明五个代表性 marker 的当前分类，并确认 YAML-like 样本会被分成 `HorizontalRule` 与 `SetextHeading2`；它仍不能覆盖全部 CommonMark 边界，也不是持久化回归门禁，必须补正式 syntax-tree 测试。
- CSS `color: transparent` 可能让当前块中的 caret 与透明字符关系难以理解，但未进行浏览器手动点击录屏，具体落点风险仍需交互测试。
- 现有 round-trip 是未编辑 sourceText 的写回，能证明保存链路不主动改写 `---`，不能证明编辑器操作后 `***`/`___` 保真。
- 本次未运行全量 typecheck、lint、构建、全部 E2E 或性能基准；报告是静态分析与专题现有门禁核查，不是新实现的完成声明。

## 13. 证据索引

| 类别 | 文件与位置 | 证明范围 |
|---|---|---|
| 项目契约 | `AGENTS.md`；`DEVELOPMENT_PROCESS.md` | 源码唯一事实、架构分层、i18n、成熟依赖、测试与性能门禁 |
| Typora 专题 | `docs/product/typora-baseline/13-horizontal-rules.md` | `***`/`---` + Return、阅读态、保真与未核实项 |
| 横切模型 | `docs/product/typora-baseline/00-live-preview-model.md` | live preview/source、焦点、粘贴、IME、符号显隐 |
| 歧义基线 | `docs/product/typora-baseline/14-yaml-front-matter.md` | 文首 YAML 与正文 HR 边界 |
| parser | `src/editor/markdown/markdownLanguage.ts:1-18`；`package.json:30-55`；`pnpm-lock.yaml:20-46,300-302,547-551,3015-3023` | 成熟 Markdown/Lezer 依赖与实际锁定关系 |
| decoration | `src/editor/wysiwyg/markdownDecorations.ts:121-170,183-248,453-524` | 语法树到 class、显隐逻辑和 live-preview plugin |
| 样式 | `src/editor/wysiwyg/wysiwyg.css:168-184` | 透明源码与 1px 视觉线 |
| 模式 | `src/editor/core/editorDisplayMode.ts:40-57`；`src/editor/core/editorApi.ts:151-161` | source/live-preview 重配置 |
| 插入命令 | `src/editor/commands/markdownFormatCommands.ts:5-44,143-179` | 生成 `---`、空行与 selection |
| UI 命令 | `src/features/commands/createCommandModels.ts:104-115,230-253`；`src/app/controllers/useAppCommandModels.ts:16-36` | 命令面板和段落菜单接线 |
| i18n | `src/shared/i18n/locales/en.json:81`；`zh-CN.json:81`；`src/shared/i18n/i18n.test.ts:4-110` | 双语文案与 key 门禁 |
| 单元测试 | `src/editor/wysiwyg/markdownDecorations.test.ts:85-149`；`src/editor/commands/markdownFormatCommands.test.ts:106-127` | `---` 识别与插入布局 |
| E2E | `tests/e2e/editor-markdown.spec.ts:3-110,450-481` | 视觉线、源码模式、菜单与命令面板 |
| 保存与 fixture | `src/features/file-actions/fileActions.ts:91-99,126-169`；`src/app/controllers/useAppDocumentModel.ts:62-64`；`tests/fixtures/markdown/basic.md:6-10`；`tests/fixtures/markdown/comprehensive.md:12`；`tests/fixtures/markdownFixtureManifest.ts:76-95`；`tests/fixtures/roundTrip.test.ts:8-71` | 保存前 hook、`---` 样本与未编辑逐字节写回；仅 comprehensive 显式标 thematic-break tag |

### 本次核查验证与结论

本次在当前工作树上实际运行 `pnpm exec vitest run src/editor/wysiwyg/markdownDecorations.test.ts src/editor/commands/markdownFormatCommands.test.ts src/shared/i18n/i18n.test.ts tests/fixtures/fixtureCoverage.test.ts tests/fixtures/roundTrip.test.ts`，最新结果为 5 个测试文件、97 个测试全部通过；随后运行 `pnpm exec playwright test tests/e2e/editor-markdown.spec.ts --grep "horizontal rule|foundational markdown source|renders basic markdown visually"`，结果为 Chromium 下 3 个测试全部通过。另以 `node --input-type=module` 加载 `@codemirror/state`、`@codemirror/language` 与 `@codemirror/lang-markdown`，对 `---`、`***`、`___`、`* * *`、`----`、Setext 与 YAML-like 文本输出语法树：五个 HR marker 均为 `HorizontalRule`，Setext 为 `SetextHeading2`，YAML-like 样本为 `HorizontalRule,SetextHeading2,Paragraph`。前两项自动化验证只支持现有 `---` 主路径；只读探针补充当前 parser 事实，但不替代持久化变体、真实逐键与 Typora 实机体验测试。

最终判定：基础语法显示（含已探针的 marker 变体）、源码模式、菜单/命令面板和规范化 `---` 插入为**已实现**；真实逐键时机、焦点编辑、变体保存门禁、复制/剪切/粘贴、删除、可访问性与 YAML/Setext 边界尚有实质缺口。只有 P0 保真/歧义门禁与 P1 焦点交互均通过新鲜验证后，才能把本专题从“功能存在”提升为“体验追平”。
