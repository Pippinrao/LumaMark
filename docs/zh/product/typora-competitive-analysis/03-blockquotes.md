> 语言：**中文** · [English](../../../product/typora-competitive-analysis/03-blockquotes.md)

# 引用块竞争体验与实现差距分析

> **Parity Reliability 实施更新（2026-07-31）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - 已用 characterization tests 固定 CodeMirror 官方引用续写、空引用退出和 Backspace 删除 marker 的行为，Playwright 覆盖续写与退出。
> - 段落菜单现委托引用专用命令：多段转换会给空行写入结构性的 bare `>`，混合选区增加或移除一个共同外层并可精确还原，正反选区、行首边界、多选区和单次撤销均有回归测试。
> - interaction context 会暴露活动结构通往外层引用的精确定界符路径；嵌套引用与引用内任务行能恢复完整 marker，同时不展开无关祖先行，并有 DOM 与 Playwright 证据。
> - 复杂粘贴、引用内全部组合编辑及 Windows 原生 IME 仍是未闭合差距，不能把上述代表路径写成引用能力全面追平。

## 1. 用途、范围与非目标

### 用途

本文面向 LumaMark 的产品、编辑器与质量工程维护者，以 Typora 1.13.7 的公开引用块体验为基线，核对当前工作区中的真实代码、测试、fixture 与依赖配置，给出可直接进入实现计划的差距、架构边界和验收门禁。本文是专题分析，不替代 `AGENTS.md`、`DEVELOPMENT_PROCESS.md`、V1 设计或详细架构；当实现变化时，应重新核对本文证据，而不能把本文的目标方案当成现状。

### 范围

- CommonMark 风格 `>` 引用的键入创建、菜单转换、连续输入、退出与降级。
- 单段、多段、多层嵌套引用，以及引用内列表、强调、链接和 fenced code 等组合内容。
- live preview 中引用线、文字样式、marker 显隐、光标与选区行为。
- source mode 与文件保存时的 Markdown 源码保真。
- 与引用相关的命令入口、i18n、键盘、可访问性、错误边界和性能验证。

### 非目标

- GitHub Style Alerts / callouts；该能力属于 `16-callouts.md`。
- 全面定义引用内部每一种子语法的编辑器能力；列表、代码块、链接分别由对应专题负责，本文只覆盖交叉契约。
- 复制 Typora 的主题资产、品牌外观或私有实现。
- 把 roadmap、产品宣言或依赖可能提供的行为直接认定为 LumaMark 已通过验收的功能。

## 2. 执行摘要

LumaMark 引用块的总体状态是 **部分实现**。可见主路径已经成立：`@codemirror/lang-markdown` 解析 `Blockquote` / `QuoteMark`；live preview 为引用范围增加左侧强调线和弱化文字色；活动行显示 `>`，离开活动行后隐藏 `>`；source mode 恢复完整源码；段落菜单、命令动作和中英文文案已接线；格式命令可给当前行或多行增加/移除一层 `>`；独立 fixture 覆盖多段、嵌套、引用内列表与代码围栏，并进入逐字节 round-trip。

最关键的差距不在“能否显示一个引用”，而在连续写作契约是否可信。项目通过 `markdown()` 的默认配置间接安装了成熟的 CodeMirror Markdown keymap，依赖代码明确将 Enter 绑定到 `insertNewlineContinueMarkup`、Backspace 绑定到 `deleteMarkupBackward`，因此续写和 marker 降级存在真实运行路径；然而仓库没有针对引用的单元、集成或 E2E 断言，不能证明当前扩展顺序、live preview replacement、IME 和多光标条件下仍符合产品预期。菜单转换还会跳过选区中的空行，使“选中两个段落并转为一个多段引用”落成两个分离引用块，而不是含 `>` 空行的单一引用结构。当前 marker 显隐仅以 selection head 所在行判断，无法表达 Typora-like 的“当前引用块/当前可编辑 span”模型。

因此，P0 应先锁定 Enter 续写、连续空引用退出、Backspace 降级、多段菜单转换、撤销重做和逐字节源码断言；P1 再完善嵌套组合、块级焦点、视觉层级、a11y 与 IME；P2 才处理低频深层嵌套、主题细化和进一步性能优化。现阶段不需要引入新的解析器或基础组件，优先复用已安装的 CodeMirror Markdown 语言支持，并只为 LumaMark 的源码保真与 live preview 差异化契约增加薄封装和测试。

## 3. Typora 完整体验基线

依据 `docs/product/typora-baseline/03-blockquotes.md` 及其横切 live preview 模型，可归纳出以下完整用户体验：

1. 用户输入 `>` 并继续输入内容即可创建引用。Markdown 源文件仍以 `>` marker 表达结构，空引用行通常是独立的 `>`。
2. 在引用末尾按 Return 时，编辑器自动插入合适的 `>` 或换行，让用户连续写作而不必重复键入 marker。
3. 多段引用通过引用范围内的空 `>` 行保持在同一结构中；阅读态需要保留清晰的段落间距。
4. 增加更多层 `>` 可形成嵌套引用。引用内部可组合段落、列表、强调、链接、代码围栏等 Markdown 内容。
5. 非当前引用以主题控制的缩进、左侧引用线和文字样式呈现，源码 marker 通常隐藏；光标进入相关编辑位置时，marker 应可见且可直接编辑。
6. source mode 展示全部 `>`，保存结果保持 Markdown 源码形态，不应因视觉呈现重排无关空格、换行或相邻文本。
7. 基线公开资料没有逐步确认空引用退出、Backspace 行为、菜单准确文案、快捷键和复杂嵌套组合的所有手势。对这些项目只能设置实机复核任务，不能把常见编辑器习惯写成 Typora 已核实事实。

理想的连续体验是：键入创建后可自然续写；再次 Return 能结束空引用而回到普通段落；在 marker 后 Backspace 可逐级降级；离焦后阅读噪音消失；重新进入时源码位置稳定；切换 source mode 和保存不会改变任何未主动编辑的字节。这里“再次 Return 退出”和“Backspace 降级”是 LumaMark 应采用并自动化的产品契约，但在 Typora 侧仍须真实 GUI 复核，不能伪装成公开资料已经证明的竞品事实。

## 4. LumaMark 当前功能及精确证据

| 能力 | 状态 | 精确证据与判断 |
|---|---|---|
| CommonMark 引用解析 | 已实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 调用成熟的 `markdown()` 并以 GFM Markdown language 为 base；`markdownDecorations.ts:226-233` 将语法树 `Blockquote` 映射为 `lm-md-blockquote`。 |
| 阅读态引用样式 | 已实现 | `src/editor/wysiwyg/wysiwyg.css:53-58` 提供 3px 左边线、弱化文字色、字号与内边距；`tests/quality/editorVisualStyle.test.ts:39-40` 静态约束选择器和边线 token。 |
| marker 离焦隐藏、活动行恢复 | 部分实现 | `markdownDecorations.ts:453-500` 隐藏 `QuoteMark`，但豁免条件只是 selection head 所在行；`markdownDecorations.test.ts:387-447` 覆盖简单引用活动行显示与离焦隐藏，没有多行块、选区和嵌套用例。 |
| 键入 `> ` 创建并立即呈现 | 部分实现 | 解析与 decoration 会响应文档 transaction；E2E `tests/e2e/editor-markdown.spec.ts:3-41` 使用一次性 `insertText` 注入 `> 引用内容` 并断言呈现，但没有逐键输入触发、空 marker 或撤销测试。 |
| Enter 自动续写 | 部分实现 | `markdownLanguage.ts:14-18` 未关闭默认 keymap；安装包 `@codemirror/lang-markdown` 的 `markdown()` 默认加入 `markdownKeymap`，其 `dist/index.js:391-398` 明确将 Enter 绑定到 `insertNewlineContinueMarkup`。这是实际依赖路径，但仓库没有 LumaMark 专项回归。 |
| 空引用退出 | 部分实现 | 同一成熟命令在依赖实现 `dist/index.js:248-294` 包含空 Blockquote 处理；项目没有明确产品契约或自动化断言，尚不能证明一次/两次 Return 的最终文本、选区和撤销边界。 |
| Backspace marker 降级 | 部分实现 | 依赖 `dist/index.js:344-398` 提供 `deleteMarkupBackward` 并由 Markdown keymap 安装；项目没有单层、嵌套、缩进、行首或 IME 后场景测试。 |
| 菜单创建/移除引用 | 已实现 | `createCommandModels.ts:233-253` 在段落菜单加入本地化 quote action；`useAppCommandModels.ts:16-36` 将 `quote` 纳入编辑器命令；`markdownFormatCommands.ts:67-68` 进入行前缀转换。 |
| 当前行与多行转换、撤销 | 部分实现 | `markdownFormatCommands.test.ts:130-168` 覆盖当前行创建、多行全部移除和 undo；没有引用嵌套、混合选区或空行语义。`prefixSelectedLines` 在 `markdownFormatCommands.ts:218-252` 明确跳过空行。 |
| 多段与嵌套内容呈现 | 部分实现 | `tests/fixtures/markdown/blockquote.md:3-20` 含空 `>`、二层引用、引用内列表与 fenced code；但 E2E 只有单行引用，未断言多段间距、嵌套引用线数量和组合编辑。 |
| source mode 显示完整 marker | 已实现 | `tests/e2e/editor-markdown.spec.ts:62-105` 在 live preview 后切到 source mode，并断言 `> quote` 可见。 |
| 文件 round-trip | 已实现 | `tests/fixtures/fixturePaths.ts` 纳入 `blockquote.md`；`tests/fixtures/roundTrip.test.ts:8-70` 对每个 fixture 执行保存并以 `Buffer.compare` 断言逐字节相同。该测试证明“未修改文本的保存”，不证明交互编辑后的精确 diff。 |
| 中英文 UI 文案 | 已实现 | `src/shared/i18n/locales/zh-CN.json:85` 为“引用”，`en.json:85` 为“Quote”；菜单通过 `t('menu.quote')` 读取，没有在功能代码硬编码可见文案。 |
| 引用快捷键 | 未实现 | `src/editor/commands/markdownFormatKeymap.ts:4-37` 只有粗体、斜体和标题快捷键；菜单 quote item 也没有 shortcut 字段。Typora 侧快捷键同样未核实。 |
| 引用专项 a11y | 证据不足 | 阅读态仍由 CodeMirror content DOM 承载，但仓库没有 blockquote 语义、屏幕阅读器宣告、键盘焦点、forced-colors 或高对比度专项断言。 |
| 引用专项性能预算 | 证据不足 | 大文档 fixture 中包含大量引用，通用编辑器性能基准存在；没有隔离统计引用 decoration、深层嵌套或 marker 显隐的 transaction 成本。 |

另有一个必须说明的代码事实：`src/editor/wysiwyg/blockquoteDecorations.ts:4-20` 提供基于行正则的 `collectBlockquoteDecorations`，但全仓检索没有发现调用方；当前真实渲染路径是 `markdownDecorations.ts` 的语法树遍历。不能把这个孤立模块当作额外实现证据，它反而说明引用职责存在重复边界和陈旧代码风险。

## 5. 真实体验路径

### 路径 A：直接键入并离焦

1. 用户在普通空行输入 `> ` 和中文或英文内容。
2. CodeMirror transaction 更新唯一 Markdown 文本；Lezer Markdown parser 产生 `Blockquote` 与 `QuoteMark`。
3. live preview 插件为引用范围增加 `lm-md-blockquote`，活动行因 `isRangeOnActiveLine` 保留 `>`。
4. 用户移动到普通段落后，`QuoteMark` 被 replace decoration 隐藏，内容继续显示引用线和弱化颜色。
5. 用户切换 source mode 时，WYSIWYG decoration 被移除，原始 `>` 重新可见；这一路径有简单 E2E 证据。

### 路径 B：连续写作与退出

1. 用户在 `> 第一段` 行末按 Enter。
2. 事件优先进入 `@codemirror/lang-markdown` 以高优先级注册的 Markdown keymap，执行 `insertNewlineContinueMarkup`，理论运行结果是继续合适的引用 marker。
3. 用户在空引用行继续按 Enter，成熟命令包含退出引用的处理；按 Backspace 时，`deleteMarkupBackward` 处理 marker 降级。
4. 当前仓库没有针对该路径的产品级测试，因而真实 UI 下的 marker 文本、光标位置、undo 分组、composition 和嵌套结果均只能标记为部分实现。

### 路径 C：菜单把现有段落转为引用

1. 用户选择一行或多行，在“段落 → 引用”触发 `quote` action。
2. app controller 将动作委托给 editor command，`prefixSelectedLines` 在每个非空行的缩进后插入 `> `；若全部非空行已有引用 marker，则移除一层。
3. 对单段或连续非空行，文本变换和 undo 有单元证据。
4. 对含空行的两段选区，命令跳过空行，落盘为 `> 第一段\n\n> 第二段`，而不是 `> 第一段\n>\n> 第二段`。这会改变“一个多段引用”与“两个引用块”的结构语义，是当前最明确的菜单路径缺口。

## 6. 差距矩阵

| ID | 体验点 | LumaMark 状态 | 严重度 | 差距与用户影响 | 主要证据 |
|---|---|---|---|---|---|
| BQ-01 | 单行解析、引用线与离焦隐藏 | 已实现 | 低 | 基础阅读路径可用；仍需防止后续回归。 | `markdownDecorations.ts`、`wysiwyg.css`、简单 E2E |
| BQ-02 | 活动引用的 marker 展开边界 | 部分实现 | 高 | 仅活动行展开，多行引用内移动时同一结构的其他 marker 仍隐藏；跨行选择可能产生不可见 token 歧义。 | `isRangeOnActiveLine` |
| BQ-03 | Enter 续写 | 部分实现 | 阻断 | 依赖能力存在但无项目回归；扩展优先级或未来升级可能静默改变核心写作手感。 | CodeMirror Markdown keymap，无专项测试 |
| BQ-04 | 空引用退出 | 部分实现 | 阻断 | 用户可能被困在引用、产生额外空 `>` 或意外删除上一行；当前最终源码未被锁定。 | 依赖实现，无项目断言 |
| BQ-05 | Backspace 逐层降级 | 部分实现 | 高 | 嵌套引用若一次删除过多或光标错位，会直接破坏源码意图。 | 依赖实现，无项目断言 |
| BQ-06 | 菜单转换多段引用 | 部分实现 | 高 | 空行被跳过，菜单不能稳定产生单一多段引用结构。 | `prefixSelectedLines` 的空行 `continue` |
| BQ-07 | 多层引用视觉层级 | 部分实现 | 中 | fixture 有二层源码，但未证明双层引用线、间距、主题对比与光标编辑均正确。 | fixture 有，E2E 无 |
| BQ-08 | 引用内列表/围栏组合编辑 | 部分实现 | 高 | 解析与 round-trip 样本存在，Return、Tab、围栏退出和嵌套 marker 的命令优先级未验收。 | `blockquote.md` fixture |
| BQ-09 | 源码模式和未编辑保存 | 已实现 | 低 | 简单 source mode 与未编辑逐字节保存有门禁。 | E2E、round-trip test |
| BQ-10 | 交互编辑后的最小 diff | 证据不足 | 阻断 | 没有证明引用命令只改变目标 marker、保留 CRLF、空格风格和无关段落。 | 缺 mutation round-trip fixture |
| BQ-11 | IME、选区、复制粘贴与多光标 | 证据不足 | 高 | 中文组合态期间 decoration 重算可能闪烁或改变选区；复制隐藏 marker 的预期也未定义。 | 无专项测试 |
| BQ-12 | 菜单 i18n | 已实现 | 低 | 中英文 key 和菜单接线存在。 | locale JSON、command model |
| BQ-13 | 键盘直达“切换引用” | 未实现 | 低 | 没有产品快捷键；Typora 对应键位未核实，暂不应自行占用组合键。 | format keymap 无 quote |
| BQ-14 | a11y 与高对比度 | 证据不足 | 高 | 视觉引用线不等于可感知的引用语义；弱化颜色也需满足对比度。 | 无专项门禁 |
| BQ-15 | 引用专项性能 | 证据不足 | 中 | 大量嵌套 range 与 selection 驱动的全可视区重算成本没有隔离测量。 | 仅通用 perf fixture |

## 7. 架构根因与影响

1. **输入行为依赖被隐式安装。** `markdownLanguage()` 调用 `markdown()`，从而顺带得到 Markdown keymap；项目自身的 `markdownFormatKeymap` 没有显式表达 Enter/Backspace 契约。成熟依赖本身是正确选择，但缺少一层可测试的 LumaMark 契约端口，使依赖升级、扩展顺序和产品语义之间没有稳定边界。
2. **通用格式命令抽象按“非空行前缀”设计。** 列表和引用共享 `prefixSelectedLines`，但多段引用的空行必须拥有 `>` 才能保持一个块；通用抽象无法表达这种结构差异，导致菜单转换改变 Markdown 结构。
3. **live preview 活动态模型仍是行级。** `isRangeOnActiveLine` 对标题和简单行内 marker 足够，却不适合多行、嵌套 blockquote。影响包括 marker 展开不连贯、跨行选区含隐藏 token、嵌套级别难以编辑，以及未来 IME 策略无法按块冻结。
4. **引用职责存在两条实现痕迹。** 未被引用的 `blockquoteDecorations.ts` 使用正则逐行识别，真实路径使用 Lezer 语法树。继续保留两套规则会让测试或未来维护者误用正则路径，并产生与 CommonMark lazy continuation、嵌套语义不一致的结果。
5. **fixture 与交互测试脱节。** fixture 很丰富，但 round-trip 只把原文本原样读出再写回；E2E 又只有单行引用。两层测试之间缺少“加载复杂 fixture → 执行目标编辑 → 保存 → 只允许预期 diff”的集成层。

这些根因位于 `editor` 层，不需要把 Markdown 全文放入 React store，也不需要 Tauri/Rust 参与输入热路径。若把修复散落进 app controller、React context 或文件 service，将违反现有依赖方向并增加输入延迟与源码保真风险。

## 8. 详细改进方案

### 8.1 模块边界

- 在 `src/editor/commands/` 内建立引用专用的薄命令模块，例如 `blockquoteCommands.ts`，只负责 selection 到 CodeMirror transaction 的纯编辑规则：菜单切换一层、Enter 续写契约、空引用退出和 Backspace 降级的适配。不要让 feature 或 app 持有文档全文。
- `markdownFormatCommands.ts` 的 `quote` 分支委托引用命令，不再让通用 `prefixSelectedLines` 决定空行语义；列表继续复用适合列表的通用逻辑。
- 在 `src/editor/wysiwyg/` 保持一个真实引用 decoration 来源。优先由 `markdownDecorations.ts` 组合一个以语法树 node 为输入的 builder；删除或接入当前孤立的正则模块前先补测试，避免无证据清理。
- 在通用 live preview 层引入“活动结构范围”查询接口，返回最内层 Blockquote 的 `{from,to,depth}`，供 marker 显隐使用；不要让引用模块依赖具体 React shell。

### 8.2 成熟依赖策略

- 继续使用 `@codemirror/lang-markdown` 的 `insertNewlineContinueMarkup`、`deleteMarkupBackward` 和 Lezer 语法树，不引入第二套 Markdown parser，也不手写键盘基础设施。
- 以显式 import、薄包装或契约测试固定依赖行为；若默认命令与 LumaMark 的多段源码保真目标冲突，只在差异点增加最小 transaction，不复制整套上游算法。
- 引用不需要 Radix、React widget 或 Rust command。若未来计划自研整套 Markdown continuation，必须先记录上游能力不足的可复现证据、维护成本并获得批准。

### 8.3 数据流

推荐数据流为：键盘/菜单事件 → editor command port → CodeMirror command/transaction → 单一 `EditorState.doc` → Lezer 增量语法树 → 可视区 decoration → EditorView DOM。保存路径仅从 editor API 读取当前 Markdown 文本并交给 file service。任何 visual class、React menu model 或 app store 都不得反向生成另一份引用内容。

菜单转换应先按语法树和 selection 确定目标块，再构造一批原子 changes；一个用户动作使用一个 transaction 与明确的 `userEvent`，确保一次 undo 完整恢复。多光标场景使用 `changeByRange` 或等价映射，不能用未映射的绝对坐标循环修改。

### 8.4 源码保真

- 新增引用时采用项目明确的规范输出 `> `；对已有源码执行退出或降级时，只删除目标层 marker 及其至多一个约定空格，不规范化其他层的空格、缩进或换行。
- 菜单把跨空行选择转换为一个多段引用时，目标范围内的结构性空行写为 `>`；若产品决定保留为两个块，菜单名称或交互必须明确，不能由通用 helper 偶然决定。
- 测试 `>text`、`> text`、`>  text`、一至三格前导空格、CRLF、末尾无换行、lazy continuation、多层混合空格和引用前后相邻段落。
- 交互后保存必须只产生目标 marker diff；切换 live/source、移动光标、离焦和主题切换必须产生零文本 diff。

### 8.5 i18n 与可访问性

- 现有 `menu.quote` 中英文 key 继续复用。若新增错误提示、快捷键说明、tooltip 或命令描述，必须同步加入 `zh-CN.json` 与 `en.json`，不得拼接句子片段。
- 明确阅读态 DOM 的可访问性策略。优先保持 CodeMirror 的可编辑文本与原生选区，不因视觉隐藏添加不可聚焦的平行内容。评估是否可通过语义属性或屏幕阅读器友好描述表达引用边界，同时避免每一行重复宣告“引用”。
- forced-colors 下引用线必须可见，弱化文本需满足主题对比度；键盘用户应能完成创建、续写、退出、降级、undo/redo 和 source mode 切换。
- 复制行为要写成契约：从编辑器复制应以真实选区文本为准，不能因为 replace decoration 丢失 `>`；若阅读态复制希望输出纯文本，应作为独立命令，不改变默认源码复制。

### 8.6 错误处理

- 引用是本地同步 transaction，不应增加 toast 或静默 fallback。命令无法识别目标结构时返回 `false`，让后续通用 keymap 处理，并在开发测试中暴露预期分支。
- 对解析暂时不完整的输入（仅 `>`、未完成嵌套、composition 中间态）不得抛异常、重写整块或清空选区；保留源码并在下一 transaction 增量重算。
- 若依赖升级改变 continuation 输出，应让契约测试失败，而不是捕获异常后回退到普通换行。错误必须定位到命令边界，避免用户在不知情时得到不同 Markdown。

## 9. 优先级

### P0

1. 建立引用专用命令契约测试，覆盖 Enter 续写、连续空引用退出、Backspace 单层降级、嵌套逐层降级、撤销重做和光标位置。
2. 修正菜单多段转换的空行语义，并覆盖混合选区、已有引用、嵌套一层和反向选择。
3. 增加复杂引用 fixture 的交互后保存最小 diff 测试，覆盖 LF/CRLF、空格风格与末尾换行。
4. 增加真实浏览器路径，证明 live preview 中键入、续写、退出、source mode 和 undo 共同工作。

### P1

1. 将 marker 展开从“活动行”提升为可测试的活动 Blockquote/span 模型，覆盖跨行选区和嵌套层级。
2. 完善多段段距、嵌套引用线、引用内列表/围栏的视觉与交互 E2E。
3. 补中文 IME、复制粘贴、多光标、屏幕阅读器、高对比度和双主题验收。
4. 统一引用 decoration 的唯一事实来源，处理孤立正则模块并用架构测试防止重复入口。

### P2

1. 在核实 Typora GUI 和平台快捷键冲突后，决定是否提供“切换引用”快捷键及可发现提示。
2. 补 10 层以上嵌套、超长引用和超大文档的专项性能样本与预算。
3. 在不改变源码与 DOM 可访问性的前提下细化主题层级、打印和导出视觉。

## 10. 可执行验收标准与测试计划

### 验收标准

- 输入 `> quote` 后，活动行显示源码 marker；光标移至普通段落后只隐藏 marker，不改变 `EditorState.doc`。
- 在 `> quote|` 按 Enter 后得到 `> quote\n> |`；一次 undo 恢复原文与原光标。
- 在约定的空引用退出手势后得到普通空行，引用前一行和相邻段落不变；嵌套引用只退出当前层。
- 光标紧随单层或嵌套 marker 时按 Backspace，只删除一层并保持其余缩进与空格风格；undo/redo 可逆。
- 选择 `first\n\nsecond` 执行“引用”，结果符合明确产品契约并由测试逐字符断言；再次执行可恢复原文。
- 多段、二层嵌套、引用内列表与 fenced code 在 live preview 中视觉层级清晰，进入目标位置可编辑正确 marker，source mode 展示全部原文。
- 切换模式、移动光标、改变主题、离焦再聚焦、打开后直接保存均为零无关 diff。
- 中文 IME composition 期间不重复插入 `>`、不提交半成品、不跳动光标；完成 composition 后 decoration 一次稳定更新。
- 1MB/5MB/10MB 引用混合文档继续满足项目通用打开与输入目标，引用专项 transaction 的基线与后续结果可复现。

### Unit

- 对引用命令纯逻辑做表驱动测试：单层、多层、空 marker、空行、mixed selection、缩进、`>text` 与 `>  text`、多 selection、selection direction。
- 直接对成熟 CodeMirror command 在 LumaMark `createEditorState` 上执行，锁定 Enter/Backspace 的文本、selection、transaction 和 undo 分组，而不是只测试上游函数本身。
- 对活动 Blockquote range 查询测试语法树边界、nested depth、lazy continuation、相邻引用和未闭合输入。

### Integration

- 创建真实 `EditorView`，装载 `markdownLanguage()`、live preview extension 与 history，派发键盘命令并断言 DOM marker 显隐及 `state.doc` 不变。
- 从复杂 fixture 加载到 editor API，执行一次引用编辑，再经 file action 保存到临时文件，逐字节比较并只允许预期 diff。
- 验证 app command action → editor command port → transaction 的菜单接线，中英文切换后 action 不变、label 更新。

### E2E

- Playwright 使用逐键 `keyboard.type`/`press`，不要只用一次性 `insertText` 注入最终 Markdown；覆盖创建、两次 Enter、Backspace、undo/redo、菜单多段转换和 source mode。
- 增加亮色、暗色与 forced-colors 截图或结构断言：单层、多层、多段、引用内列表/代码。
- 使用中文输入法可稳定自动化的 composition fixture；若平台级 IME 无法稳定驱动，至少用浏览器 composition events 做集成门禁，并保留 Windows 实机抽检记录。

### Fixture

- 扩充或新增专用样本，包含 LF/CRLF、BOM 决策、末尾无换行、空 `>`、三层嵌套、不同 marker 空格、lazy continuation、列表、task、围栏、强调、链接和中英混排。
- 保留现有 `blockquote.md` 的逐字节 round-trip，同时增加 mutation fixture：输入文件、编辑动作描述、期望输出文件和允许 diff。

### Perf

- 单独运行性能测试，不与 E2E、构建、lint 或 typecheck 并行。
- 为 1MB/5MB/10MB 混合文档记录打开时间、单字符输入 transaction、Enter continuation、selection 跨越大引用、滚动 FPS 与峰值内存。
- 增加深层嵌套与大量短引用两个极端样本，分别暴露语法树深度和 decoration range 数量成本；普通输入延迟目标仍尽量小于 16ms，并对结果记录机器与运行条件。

## 11. 风险与未核实项

- Typora 1.13.7 的空引用退出、Backspace、菜单文案和可能快捷键尚未经过本项目真实 GUI 逐步复核；本文将其列为 LumaMark 产品契约建议，而非竞品既成事实。
- 当前工作区有大量未提交改动；本文引用的是 2026-07-12 工作区现状，不等同于某个已发布版本或干净提交。
- `@codemirror/lang-markdown` 的默认 keymap 是当前安装版本的实际能力，但项目未对其版本升级行为建立契约门禁；未来 lockfile 更新可能改变细节。
- CSS 对嵌套语法树 range 的实际 DOM 分片和边线叠加需要浏览器截图核实，静态选择器不能证明视觉层级正确。
- 现有 round-trip 测试使用 editor mock 返回原始 `sourceText`，能证明文件 action 不改未编辑文本，但不能替代真实 EditorView 编辑后的保存测试。
- 未核实 clipboard 在 replace decoration 下复制隐藏 marker 的平台差异，也未核实 Windows/macOS/Linux 的原生键盘与 IME 差异。
- `blockquoteDecorations.ts` 当前无调用方；删除、整合或保留都应先查明其创建背景，避免误伤其他正在进行的工作区改动。

## 12. 证据索引

### 必读规则与竞品基线

- `AGENTS.md`：架构、成熟组件、源码保真、i18n、性能、测试与文档治理规则。
- `DEVELOPMENT_PROCESS.md`：TDD、fixture、E2E、性能和完成门禁。
- `docs/product/typora-baseline/03-blockquotes.md`：Typora 1.13.7 引用块公开行为与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：marker 显隐、源码模式、复制粘贴和 IME 横切模型。

### 代码与依赖

- `package.json:33-64`：CodeMirror、Lezer、i18next 等成熟依赖。
- `src/editor/markdown/markdownLanguage.ts:14-18`：Markdown language support 接入。
- `src/editor/core/createEditorState.ts:97-120`：语言、history、display mode 与 keymap 的实际组合顺序。
- `node_modules/@codemirror/lang-markdown/dist/index.js:201-398`：当前安装版本的 continuation、空引用处理、Backspace 和 Markdown keymap 辅助证据。
- `src/editor/wysiwyg/markdownDecorations.ts:211-250,453-500`：Blockquote range 与 QuoteMark 显隐真实路径。
- `src/editor/wysiwyg/blockquoteDecorations.ts:4-20`：当前无调用方的行正则实现痕迹。
- `src/editor/wysiwyg/wysiwyg.css:53-58`：引用视觉样式。
- `src/editor/commands/markdownFormatCommands.ts:67-68,204-260`：quote 命令与通用行前缀逻辑。
- `src/editor/commands/markdownFormatKeymap.ts:4-37`：项目自定义格式快捷键范围。
- `src/features/commands/createCommandModels.ts:233-253`、`src/app/controllers/useAppCommandModels.ts:16-36`：菜单到编辑器命令的接线。
- `src/shared/i18n/locales/zh-CN.json:85`、`en.json:85`：双语 label。

### 测试与 fixture

- `src/editor/wysiwyg/markdownDecorations.test.ts:85-114,387-447`：解析 range、活动行显示与离焦隐藏。
- `src/editor/commands/markdownFormatCommands.test.ts:130-168`：当前行 quote、多行移除和 undo。
- `tests/e2e/editor-markdown.spec.ts:3-110`：单行引用阅读态与 source mode。
- `tests/quality/editorVisualStyle.test.ts:39-40`：引用 CSS token 静态门禁。
- `tests/fixtures/markdown/blockquote.md:1-20`：多段、嵌套、引用内列表与 fenced code 样本。
- `tests/fixtures/markdownFixtureManifest.ts:28-31`、`tests/fixtures/fixtureCoverage.test.ts:9-20`：fixture 注册与 CommonMark tag 覆盖。
- `tests/fixtures/roundTrip.test.ts:8-70`：未编辑内容的逐字节保存门禁。
- `tests/perf/editorLargeDocument.bench.test.ts` 与 `large-1mb.md`、`large-5mb.md`、`large-10mb.md`：通用大文档基准和含引用样本，当前并非引用专项预算。

本文没有把 `docs/roadmap/V1_IMPLEMENTATION_PLAN.md`、`docs/product/V1_VERSION_DESIGN.md` 或 `docs/product/TYPORA_FEATURE_GAP_ANALYSIS.md` 中的规划性表述当成实现证据；它们只用于核对目标范围与避免事实源冲突。
