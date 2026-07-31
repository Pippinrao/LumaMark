# 列表与任务列表竞争差距分析

> **Parity Reliability 实施更新（2026-07-31）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - characterization tests 已固定 CodeMirror 官方无序、有序、任务和嵌套列表的续写、退出与 Backspace 行为；列表专用 Tab/Shift+Tab 复用官方 `indentMore`/`indentLess`，并有精确 transaction、组合态/只读拒绝、单次撤销及 Playwright 证据。
> - 任务 checkbox 现为可聚焦的原生控件，具备可动态重配的本地化可访问名称和只读禁用态；DOM 更新会保留控件身份与焦点，连续 Space 或 Enter 切换已有 DOM 与 Playwright 回归。
> - 点击、Enter 与 `Mod-Enter` 统一通过 Lezer `ListItem → Task → TaskMarker` 路径，只替换 `[ ]` / `[x]` / `[X]` 内的状态字符；深层嵌套、引用内任务、围栏排除、选区稳定与单次撤销均有自动化证据。混合选区菜单转换、重编号、复杂粘贴及原生 IME 仍未全面追平。

## 用途、范围与非目标

本文把 Typora 1.13.7 的公开列表体验基线与当前工作区中的 LumaMark 实现逐项对照，服务于产品验收、编辑器架构判断和后续测试设计。结论只认源码、自动化测试、fixture、依赖锁定与已记录的 Typora Support/本机观测证据；路线图、V1 设计和架构规划只能说明目标，不能证明功能已经存在。

范围包括无序列表 `*`/`+`/`-`、有序列表、任务列表 `[ ]`/`[x]`、创建与取消格式、阅读态与焦点编辑态、键盘和鼠标、粘贴、源码模式、保存、撤销、嵌套及源码保真。引用内列表只作为交叉风险，不展开 blockquote 专题；缩进代码块、定义列表、Callout 内完整嵌套规则及导出排版不是本文目标。本文不推断 Typora 私有实现，也不把尚未进行的 GUI 复核写成竞品事实。

## 执行摘要

LumaMark 已有一条可用的基础路径：`@codemirror/lang-markdown`/Lezer 识别普通列表和 GFM task marker；live preview 为非当前无序列表项替换 bullet，为任务项放置可点击 widget；当前无序列表行保留源码 marker；任务可通过点击或 `Mod-Enter` 翻转；段落菜单可把选中行切换为无序、有序或任务列表；源码模式展示原文；`lists.md` 与 `task-list.md` 进入统一字节级 round-trip fixture 门禁。单元测试和 E2E 已证明部分 marker 渲染、点击、快捷键、撤销、围栏排除与保存写出。

但“功能存在”尚不等于“体验追平”。最关键缺口是连续写作手感没有项目级专题契约：`src/editor/markdown/markdownLanguage.ts` 调用的 `markdown()` 默认装配 `@codemirror/lang-markdown` 高优先级 `markdownKeymap`，其 `insertNewlineContinueMarkup` 已提供列表续项、空 marker 退出与有序数字递增；然而仓库未发现这些行为的 LumaMark 专项测试，也未发现 Tab/Shift+Tab 列表嵌套与反缩进接线、Shift+Return 列表语义、跨项选择和粘贴测试。任务 checkbox 是 `button` 却设置 `aria-hidden="true"` 且 `tabIndex=-1`，控件本身只能鼠标点击，辅助技术无法把它当 checkbox 操作；有序 marker 在阅读态并未像无序 bullet 那样替换或隐藏，现有 E2E 只证明源码文字存在；格式命令会把多行有序列表统一插入 `1.`，也会在“部分行已有 marker”的混合选区前再加 marker，尚未定义重编号和最小改动策略。`createCommandPaletteModels` 只有有序列表入口，无序列表和任务列表只见于段落菜单，发现性不一致。

因此当前总体判断是：基础解析、显示、依赖提供的 Return 续项/退出、任务切换和未编辑保存路径已形成，但 Return 的应用级键位、撤销、IME 与源码保真仍未被专题验收；Typora-like 嵌套、焦点切换、粘贴、可访问交互和编辑后全链路保真仍是部分实现、未实现或证据不足。优先级应先落在行为契约与自动化，而不是仅调整列表 CSS。

## Typora 功能与体验基线

### 创建

- Typora Support 记录 `*`、`+`、`-` 加空格创建无序列表，`1.` 加空格创建有序列表，`- [ ] ` 创建任务项；三种无序 marker 与 GFM task syntax 都在专题范围内。
- 任务项允许行内格式，官方示例含 `**formatting**`。菜单名称、列表快捷键和多行粘贴转换规则在 baseline 中仍为 `unknown`，不可据此断言。
- Return 通常续出下一项，但精确的空项退出、Shift+Return 和撤销粒度尚未由 baseline GUI 逐步核实。Tab/Shift+Tab 的嵌套细节和有序列表中间插入后的自动重编号也未核实。

### 阅读态

- 非当前列表项呈项目符号、数字或任务控件，结构性 Markdown marker 通常隐藏。横切 live-preview 基线明确把列表 marker 和 `- [x]` 列为块级隐藏对象。
- 本机 Typora 1.13.7 观测到任务源码 `[ ]`/`[x]` 不可见：未完成项为空心圆，完成项为实心圆加白色勾；部分主题中完成项文本呈删除线。
- 阅读态 checkbox 仍可点击，这是“隐藏源码但保留交互”的明确例外。

### 焦点编辑态

- 光标进入列表项后可编辑文本，必要 marker 应重新可见；离开后回到阅读样式。焦点显隐的像素级范围仍需 GUI 复核。
- 焦点变化不应改写 Markdown 文档，不应破坏选区、IME、复制或撤销历史。中文 IME 在列表边界的时序属于横切未核实项。

### 源码与落盘

- 源码模式显示完整列表与任务 marker；无序项应保留用户选择的 `*`/`+`/`-`，任务项落盘为无序或有序 marker 加 `[ ]`/`[x]`。
- 点击 checkbox 的本机观测证明 `- [ ]` 会翻转为 `- [x]`。基线的保真意图是只改变完成态，不重排无关文本；Typora 是否会在其它编辑动作中统一无序 marker 尚未核实，因此 LumaMark 不应以竞品推测为由规范化源码。

### 键鼠、粘贴与保存

- 已观测的鼠标主路径是直接点击任务控件；checkbox 点击能否被一次 Ctrl+Z 撤销仍在 Typora 未核实清单。
- 列表专用快捷键、Return/Shift+Return、Tab/Shift+Tab 和有序重编号都不能从当前 baseline 写成确定事实。
- 横切基线说明 Typora 有 Smart Paste、Paste as Plain Text 与 Copy as Markdown，但列表多行粘贴的转换边界仍为 `unknown`。
- 保存应保留列表层级、空行、marker 风格与无关文本。紧凑/松散列表视觉、混合列表、深层缩进和 1.13 曾修复的列表/引用缩进渲染都是敏感边界。

### 错误与边界

- 不完整任务语法、任务样式文字出现在 fenced code、紧凑/松散列表、有序 marker `n.`/`n)`、深层嵌套、列表内行内 span 与引用交叉都需要按语法保留，而非静默“修复”。
- 竞品对这些边界的部分行为尚未核实；对齐策略应先保证 LumaMark 源码可恢复、行为可预测，再决定是否复刻具体视觉或重编号策略。

## LumaMark 当前能力清单与精确证据

1. **成熟解析基础已经接入。** `src/editor/markdown/markdownLanguage.ts` 以 `@codemirror/lang-markdown` 的 GFM language 为 base；`package.json` 与 `pnpm-lock.yaml` 锁定 CodeMirror 6、`@lezer/markdown`。运行时 `markdownDecorations.ts` 直接遍历 Lezer `ListMark`、`ListItem`、`TaskMarker`，而不是用 React DOM 反序列化 Markdown。
2. **普通列表与任务列表识别已实现。** `syntaxNodeToDecorationRange` 区分 ordered/unordered，并把含 `TaskMarker` 的整行标为 task list。`markdownDecorations.test.ts` 覆盖无序、有序、有序任务项及 fenced code 排除。
3. **无序列表阅读态 bullet 已实现但只覆盖部分体验。** `collectUnorderedListMarkers` 在非当前行把 `-`/`*`/`+` 替换为 `ListBulletWidget`，并排除任务项；当前行通过 `isRangeOnActiveLine` 保留 marker。单元测试覆盖嵌套两个 bullet 与当前行源码可见，E2E 覆盖两个无序行出现两个 preview bullet。
4. **有序列表阅读态未见等价 replacement。** 代码会给 `ListMark` 生成 ordered range/class，但 `buildDecorations` 对 ordered/unordered/task range 都跳过普通 mark，随后只有无序 marker 和 task marker 专用 widget。未发现 ordered-number widget 或隐藏逻辑；E2E 只在 source mode 断言 `1. item`。因此“可解析/可写入”已存在，但“非焦点阅读态隐藏源码并显示排版数字”未被证明。
5. **任务 checkbox 点击已实现。** `TaskCheckboxWidget` 对 Lezer `TaskMarker` 插入按钮，点击只替换三个字符 `[ ]`/`[x]`，标注 `input.toggle-task` 并把焦点还给编辑器。E2E 验证点击后变 `[x]`、Ctrl+Z 回到 `[ ]`；V1 workflow 验证点击后保存文本含 `[x]`。
6. **任务键盘切换已实现一条路径。** `markdownWysiwygExtension` 注册 `Mod-Enter` 到 `toggleTaskListCommand`；命令通过语法树排除 fenced code，只替换当前行 marker。单元测试覆盖 unchecked、checked、ordered task、普通方括号、不合法无空格和 fenced code；E2E 覆盖 Control+Enter 及 fenced literal 不变。
7. **checkbox 可访问性未实现。** widget DOM 虽为 `button`，却设置 `aria-hidden=true`、`tabIndex=-1`，没有 `role=checkbox`、可访问名称或 `aria-checked`。键盘用户可以在已知快捷键且光标处于任务行时用 `Mod-Enter`，但不能 Tab 到控件，也无法由屏幕阅读器发现其状态。
8. **段落菜单格式化已实现。** `createTopMenuModels` 暴露有序、无序和任务列表；`useAppCommandModels` 把三者接到统一 `runFormat`。`markdownFormatCommands.ts` 的 `prefixSelectedLines` 支持单行、多行、嵌套缩进后插入和“所有非空行均已格式化时”移除。单元测试覆盖三类列表创建/移除、嵌套、任务 alternate markers 与 undo；E2E 覆盖菜单切换无序列表和菜单创建有序列表。
9. **命令面板入口不完整。** `createCommandPaletteModels` 只有 `insert-ordered-list`，没有无序列表和任务列表 command model。E2E 证明有序列表可从命令面板创建并撤销，不能据此推及另外两种列表。
10. **Return 有成熟依赖实现，但项目级验收与缩进 keymap 不完整。** `src/editor/markdown/markdownLanguage.ts` 调用 `markdown()` 且未关闭 `addKeymap`；锁定的 `@codemirror/lang-markdown` 因而装配 `markdownKeymap`，Enter 运行 `insertNewlineContinueMarkup`，其实现会续写无序、有序、任务 marker，并在光标紧跟空 marker 时移除该 marker。`src/editor/core/createEditorState.ts` 的 `defaultKeymap` 还为 Shift+Enter 提供通用 `insertNewlineAndIndent`。这些是功能存在证据，但仓库没有 LumaMark 列表专题测试来锁定键位优先级、紧凑/松散列表、撤销、selection、IME 和 exact source；同时未发现 Tab/Shift+Tab、`indentMore`/`indentLess` 的列表接线。`src/editor/commands/markdownFormatKeymap.ts` 只有粗体、斜体和 H1–H6，列表专项键位只有 task toggle 的 `Mod-Enter`。
11. **焦点模型只对无序 marker 有专项证据。** 当前无序行不会显示 replacement bullet；任务 checkbox 无论当前行与否都会创建，源码 task marker 也未像 HeaderMark 那样由通用隐藏函数控制，而是 widget 与原 marker 同时参与 DOM 表示。现有 E2E 用 `toContainText('- [ ] task')` 证明源码仍可在 editor 文本中找到，并未精确证明当前/非当前任务 marker 的视觉显隐。
12. **普通文本粘贴证据不足。** 仓库有图片 paste 专项扩展和 E2E，但未发现 lists/task-lists 的 ClipboardEvent、Control+V、HTML list smart paste 或 paste-as-plain-text 回归。`insertText` 构造多行文档不等价于真实剪贴板路径。
13. **源码模式基础路径已实现。** display-mode capability 在 source 模式不装载 live-preview decoration；`editor-markdown.spec.ts` 切到源码模式后断言 `- bullet` 可见。任务源码完整性更多由编辑器 state、命令测试和保存测试旁证，缺列表专题的 live/source 往返全文相等断言。
14. **未编辑 fixture 字节 round-trip 已实现。** `lists.md` 覆盖三层无序、嵌套有序、混合列表和中文；`task-list.md` 覆盖完成/未完成、嵌套、ordered task、中文与 inline code。manifest 分别标记 `commonmark:list` 和 `gfm:task-list`，coverage test 要求两 tag；`roundTrip.test.ts` 对清单文件经 file action 保存后 `Buffer.compare` 为零。
15. **编辑后保存只覆盖窄路径。** `v1-workflow.spec.ts` 证明追加任务、点击完成、保存后写出内容包含 `- [x] verified task`。它没有重开后全文比较，也没有验证 marker 风格、嵌套、空行、CRLF、末尾换行和无关字节不变。
16. **存在重复事实来源债务。** 运行时走 `markdownDecorations.ts` 的语法树；`listDecorations.ts` 另有行正则收集器，`rg` 未发现调用。`taskListMarkers.ts` 又用正则服务命令。这些规则对有序 `n)`、缩进深度、task 边界的接受集合并不完全一致，未来可能出现“能解析但不能切换/装饰不同”的分叉。
17. **i18n 菜单资源存在。** `en.json`/`zh-CN.json` 包含 ordered/unordered/task list 标签，菜单使用翻译 key；任务 widget 没有可见提示或可访问名称，因此目前不存在漏翻译提示，但也缺少应有的可本地化可访问文案。

## 当前真实体验路径

用户可直接输入或粘入 Markdown 源字符串，CodeMirror state 保存原文，Lezer 增量语法树识别列表节点。离开无序列表行后，marker 被替换成圆点 widget；回到该行时源码 marker 保留。任务项生成一个视觉按钮，用户点击后 transaction 仅翻转方括号三字符并回焦编辑器，也可把光标放在任务行按 Ctrl/Cmd+Enter。用户还能选中普通文本，从“段落”菜单创建无序、有序或任务列表；若选区内所有非空行已有对应 marker，再执行会移除 marker。

切换源码模式后 decoration 被卸载，底层文档不经 DOM 反序列化，保存读取 editor 原文交给 file action/service。基础日常路径因此能够创建、查看、完成任务并保存。但是连续输入 `- item` 后按 Return 和空项退出目前只有锁定依赖实现、没有 LumaMark 专题体验证明；Tab 嵌套、Shift+Tab 回退、真实粘贴、混合选区格式化、ordered number 阅读态、键盘访问 checkbox 和深层列表保存重开也未形成可执行的完整证明。前两项不能再写成“功能不存在”，后续项则仍可能让用户在高频动作上感知到与 Typora-like 写作流的差距。

## 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| `*`/`+`/`-` 解析 | 已实现 | 低 | 三种无序 marker 可形成语法节点 | Lezer `ListMark`；decoration 单测 |
| 有序列表解析与命令创建 | 已实现 | 低 | `1.` 列表可显示源码并由菜单/palette 创建 | `markdownDecorations.ts`、format command、E2E |
| 非焦点无序 bullet | 已实现 | 低 | 阅读态更接近排版列表 | `collectUnorderedListMarkers`；unit/E2E |
| 非焦点有序数字排版 | 未实现 | 高 | 有序列表仍像源码，live preview 不一致 | 无 ordered replacement；仅 source 断言 |
| 当前无序行恢复 marker | 已实现 | 中 | 可直接编辑 marker | active-line 单测 |
| 任务 marker 当前/非当前精确显隐 | 证据不足 | 高 | 可能同时看到控件和源码，焦点手感不确定 | widget 存在；无显隐专项断言 |
| 点击 checkbox 翻转源码 | 已实现 | 低 | 鼠标可完成/取消任务 | widget 代码、E2E、保存 workflow |
| checkbox 点击单步撤销 | 已实现 | 中 | 误点可恢复 | E2E Ctrl+Z |
| `Mod-Enter` 任务切换 | 已实现 | 低 | 已知快捷键用户可操作 | keymap、unit、E2E |
| checkbox 可访问语义与键盘焦点 | 未实现 | 阻断 | 屏幕阅读器/仅 Tab 用户无法发现和操作 | `aria-hidden=true`、`tabIndex=-1` |
| 段落菜单三类列表 | 已实现 | 低 | 鼠标可创建/移除格式 | command models、unit/E2E |
| 命令面板三类列表一致性 | 部分实现 | 中 | 只能发现有序列表 | palette 仅 `insert-ordered-list` |
| 逐键 marker+空格创建 | 部分实现 | 高 | 解析会更新，但触发时机和撤销未验证 | insertText 旁证；无逐键专项测试 |
| Return 自动续项与空项退出 | 部分实现 | 高 | 依赖命令可续项/退出，但应用级键位、撤销、IME 与保真未验收 | `markdown()` 默认 `markdownKeymap`；`insertNewlineContinueMarkup`；无项目专项测试 |
| Shift+Return 列表项内换行 | 部分实现 | 高 | 通用换行命令存在，列表续行缩进、撤销和源码形态未验收 | `defaultKeymap` 的 Shift+Enter；无列表专项测试 |
| Tab/Shift+Tab 嵌套与反缩进 | 未实现 | 阻断 | 无法可靠用键盘构建层级 | 未发现列表缩进 keymap 或 `indentMore`/`indentLess` 接线 |
| 嵌套列表阅读态 | 部分实现 | 中 | 嵌套无序 bullet 有覆盖，ordered/task 深层交互不足 | nested bullet unit；fixture 仅保真 |
| 多行格式化与 undo | 已实现 | 中 | 可批量切换同类列表 | command unit |
| 混合选区最小改动 | 部分实现 | 高 | 部分已有 marker 时可能产生双 marker | `prefixSelectedLines` 仅 all-or-add 策略 |
| 有序自动编号/重编号策略 | 证据不足 | 高 | 中间插入、删除后编号可能与预期不符 | 无实现契约和测试 |
| 保留用户无序 marker 风格 | 部分实现 | 高 | 不编辑保存保真；菜单转换会固定 `-` | fixture round-trip；command 固定 prefix |
| 任务项内 inline span | 部分实现 | 中 | fixture 有 inline code，焦点组合未验收 | `task-list.md`；无交互 E2E |
| fenced code 排除 | 已实现 | 低 | 伪 task 不会生成控件或被快捷键切换 | unit/E2E |
| 普通文本/Markdown 粘贴 | 证据不足 | 高 | 从外部迁入列表的换行和 marker 不可保证 | 无列表 Clipboard 测试 |
| HTML list Smart Paste | 未实现 | 中 | 网页列表无法证明保留语义 | 仅图片 paste 专项实现 |
| 源码模式完整 marker | 部分实现 | 中 | 无序有 E2E，任务/嵌套往返缺全文断言 | source-mode E2E、state 旁证 |
| 未编辑 open-save 字节保真 | 已实现 | 低 | fixture 不产生无关 diff | round-trip + lists/task fixtures |
| 编辑后保存重开全文保真 | 部分实现 | 高 | 点击任务保存可用，复杂列表仍可能漂移 | workflow 仅 contains，不重开全文比对 |
| 中文 IME、选区与鼠标拖选 | 证据不足 | 高 | 中文清单输入可能丢选区或跳动 | 未发现列表专项测试 |
| 大列表 decoration 性能 | 证据不足 | 中 | 大文档滚动/光标移动可能卡顿 | visibleRanges 优化；无列表专项 perf |

## 根因与架构影响

根因不是缺 Markdown parser，而是列表能力散落且没有统一行为契约。解析和运行时 decoration 位于通用 `markdownDecorations.ts`，task marker/command 分为两个小文件，格式转换又在通用 `markdownFormatCommands.ts`，另有未调用的 `listDecorations.ts` 正则实现。三处对语法边界、缩进、ordered `)` 与 task marker 的理解不同；继续在通用文件追加 Return、嵌套、批量操作会扩大热路径和双重事实来源。

按项目分层，列表解析、编辑 transaction、keymap、decorations、IME/selection 保护与性能观测应归 `editor`；菜单和命令面板只归 `features/commands` 并调用稳定 command port；app 只负责编排，不能持有 Markdown 全文；保存仍沿 `services`/Tauri 文件能力，不能从 widget DOM 序列化。架构文档已经指出任务 checkbox、`Mod-Enter` 与 list marker 是待治理债务：当增加 toolbar、批量任务或嵌套专门逻辑时，应建立 `editor/capabilities/list` 或 `task-list`，不能继续膨胀通用 WYSIWYG 文件。

每次 selection 或 viewport 变化都会重建可见范围 decorations。`visibleRanges` 是正确的成熟 CodeMirror 优化边界，但新增 ordered widget、可访问属性或完成态样式不能引入全量文档扫描、React 高频状态或布局抖动。源码保真必须继续以 CodeMirror state 为唯一事实来源，所有编辑都以最小 transaction 修改 marker/缩进；如决定自动重编号或规范化 marker，属于源码行为决策，必须先形成书面规则与决策记录。

## 详细改进方案

### 模块归属与成熟依赖优先

继续使用 `@codemirror/lang-markdown`/Lezer 作为解析事实来源，先用项目测试锁定已经接入的 `insertNewlineContinueMarkup`，再评估 `@codemirror/commands` 的 `insertNewlineAndIndent`、`indentMore`、`indentLess` 和 language indentation 能力；只有现有成熟命令经失败用例证明不能满足列表续项/退出、marker 保真、IME 或嵌套要求时，才在 list capability 内写最小定制 command。不要引入第二个 Markdown parser，也不要手搓 React 镜像列表。将运行时 marker decoration、task widget、Return/缩进命令和行为测试收拢为明确 capability；删除或明确废弃未调用的行正则收集器，或者把它降为纯测试 helper，避免双重规则。

### 数据流

输入、粘贴、菜单、快捷键与 checkbox 都必须落到 CodeMirror transaction：源码变化 → Lezer 增量解析 → visible-range decoration → app 只接收轻量 documentChanged → 保存读取原文。焦点/viewport 变化只能更新 decoration，不触发 docChanged。task 点击与键盘切换应复用同一个 `toggleTaskAtPosition` 领域函数，统一 fenced code、selection、undo annotation 和错误返回。菜单、palette、右键若增加入口，只传 command id，不复制正则。

### 源码保真

定义并测试以下最小改动规则：续项继承当前无序 marker；ordered 项是否沿用显式数字由产品决策固定；空任务只在明确退出动作移除当前 marker；Tab/Shift+Tab 只改当前项及其子树所需缩进；点击只翻转 `x`/空格，不更改 `X` 大小写之外的其它字节；格式命令不得静默把 `*`/`+` 变为 `-`，除非用户明确执行转换。fixture 覆盖紧凑/松散、CRLF、末尾无换行、1–3 空格缩进、nested mixed list、ordered `)`、大写 `[X]`、空 task、inline span 与 fenced literal。

### i18n 与可访问性

补齐 palette 的有序/无序/任务列表中英文名称及快捷键标签；新增错误、tooltip 或可访问名称必须进入 `en.json`/`zh-CN.json`，不得拼接翻译片段。任务控件应采用可验证的 checkbox 语义（原生 checkbox 或 `role=checkbox` + `aria-checked`），有本地化名称，支持 Space/Enter，并保持 CodeMirror 光标不被意外移走。不能简单移除 `aria-hidden` 后宣称完成：需要 NVDA/Narrator、Tab 顺序、编辑器 contenteditable、200% 缩放、高对比与暗色主题验证。若可聚焦 widget 会破坏编辑输入，应先评估 CodeMirror 官方 widget/accessibility 模式，并记录取舍。

### 错误处理

不完整 marker 应作为普通源码继续可编辑，不弹窗也不静默改写。命令不适用时返回 `false`/结构化失败，不能吞异常；粘贴无法识别 HTML list 时应保留纯文本或明确采用 paste-as-plain-text 策略。保存错误继续走现有 file error notice，保留 dirty 文档和 undo history。深度过大或解析异常不得冻结输入，高成本处理应可取消并退回安全源码显示。

## 分阶段优先级

### P0

建立 list/task-list capability 行为契约；先为现有 Return 续项、空项退出和 Shift+Return 写 characterization test，确认成熟依赖的实际结果，只对与已批准契约不符的用例形成失败测试和最小修复；再为缺失的 Tab/Shift+Tab、逐键输入、任务焦点显隐、checkbox 可访问操作、混合选区和编辑后保存重开补失败测试。补齐 palette 三类入口，统一或移除重复正则事实来源。P0 的完成标准是高频写清单路径可被自动化证明且无无关源码 diff，不是仅看到列表样式，也不是无证据重写依赖已提供的 Return 命令。

### P1

补有序数字的非焦点排版、完成态视觉、鼠标拖选、跨项 selection、真实 ClipboardEvent/HTML list paste、inline span 与中文 IME；明确有序重编号及 marker 继承策略。建立亮暗主题、200% 缩放和高对比截图，并加入 NVDA/Narrator 抽检。

### P2

在真实写作测试后打磨紧凑/松散列表间距、深层嵌套视觉、跨平台 Mod 键、列表与引用/Callout/表格的交叉行为；评估批量完成、任务过滤等创新能力，但不能让扩展功能反向污染基础 list capability 或 Markdown 原文。

## 可执行验收标准与测试计划

### Unit

- 参数化 Lezer 节点：`*`/`+`/`-`、`1.`/`2)`、task `[ ]`/`[x]`/`[X]`、1–3 空格缩进、嵌套、空项、fenced literal；断言 range、kind 与不误识别。
- Return：非空无序/有序/task 续项；空项退出；列表末/中间、紧凑/松散行为；一次 undo 精确恢复。
- Tab/Shift+Tab：当前项及子树缩进、首项/末项、混合嵌套、selection 与光标位置；无效动作返回 false。
- decoration：当前/非当前无序、有序、task marker 的精确 DOM 可见性；selection-only 更新不改 `doc`；ordered numbering widget 不制造重复文本。
- task toggle：点击与键盘共用相同 change spec，只翻转 marker；fenced code/普通 `[ ]` 不处理；undo/redo 保留原文。
- format command：单行、多行、空行、混合已格式化选区、嵌套、marker 风格；每个测试断言 exact string 而非 contains。

### Integration

- 用真实 `createEditorState` 验证 default/live/source compartment 往返，`doc.toString()` 完全相等，decorations 仅改变展示。
- composition event 序列验证中文 IME 在 marker 后、task 文本内和嵌套行不提前续项、不丢候选、不异常拆分 undo。
- command port 验证菜单、palette、快捷键最终调用同一 list command；i18n 资源两种语言齐全。
- ClipboardEvent 分别覆盖 Markdown 纯文本、HTML `<ul>/<ol>/<input type=checkbox>` 和 paste-as-plain-text；不能被图片 paste 拦截。
- file action 保存修改后的 lists/task fixture，再读取并逐字节比较预期结果，保存失败保留 dirty/source/undo。

### E2E

- 逐键输入 `- 中文项目`，按 Enter 连续两项，再用空项退出；源码模式断言每行精确文本，执行 undo/redo。
- 对 ordered、task 重复上述流程，包含 Shift+Return、Tab/Shift+Tab 和中间插入；断言光标、编号策略与无布局跳动。
- 点击、Tab/Space/Enter、`Mod-Enter` 三条 task 路径均翻转同一项；屏幕阅读器查询能获得 checkbox 名称和 checked 状态；fenced literal 不可操作。
- 段落菜单和 command palette 分别创建/移除三类列表；混合多行选区只产生规定的最小变化。
- 真实粘贴多行 Markdown/HTML 列表，切换 live/source，再保存、关闭、重开，对全文做 exact 比较。
- 亮暗主题、高对比、200% 缩放截图覆盖普通、有序、嵌套和完成/未完成 task；拖选、复制与中文 IME 无跳动。

### Fixture

- 保留现有 `lists.md`、`task-list.md` 的字节 round-trip，并扩充 marker 多样性、紧凑/松散、ordered `)`、`[X]`、空项、CRLF、无末尾换行与引用交叉样本。
- 除“打开→不编辑→保存”外，新增“执行一个明确列表动作→只有预期字节变化→重开”的 golden diff 测试。
- fixture coverage tag 只能证明样本存在；必须由行为测试证明样本被正确编辑和显示。

### Perf

- 性能基准必须单独运行，不与 E2E、build、lint 或 typecheck 并行。构造含大量普通/任务/深层嵌套列表的 1MB、5MB、10MB 文档，测打开、首次 decoration、滚动、连续上下移动光标、批量缩进和 task toggle transaction。
- 沿用项目预算：1MB 打开小于 300ms、5MB 小于 1s、10MB 可编辑不冻结、普通输入尽量小于 16ms、滚动接近 60 FPS；另记录 visible-range decoration 节点数、DOM widget 数和 selection-only transaction P95，防止 checkbox/ordered widget 引入布局抖动或内存持续增长。

本次报告审查执行了定点依赖探针，并运行 `pnpm exec vitest run src/editor/wysiwyg/markdownDecorations.test.ts src/editor/commands/markdownFormatCommands.test.ts tests/fixtures/roundTrip.test.ts tests/fixtures/fixtureCoverage.test.ts`，结果为 4 个测试文件、95 项测试通过；探针确认 `insertNewlineContinueMarkup` 对无序项、有序项、任务项和空 marker 分别产生续项、递增、续任务和退出行为。这些结果只证明锁定依赖命令及现有窄路径，与上文拟新增的应用级 Unit、Integration、E2E、Fixture 和 Perf 验收不是同一件事。后续实现必须按 TDD 先确认真实缺口对应的测试因目标行为缺失而失败，再做最小实现，并新鲜运行 unit、integration、E2E、fixture、typecheck/lint 与独立 perf 后才能声明体验完成。

## 风险与未核实项

- Typora 的 Return/Shift+Return、Tab/Shift+Tab、自动重编号、菜单路径、粘贴规则、checkbox 撤销粒度与焦点 marker 精确显隐仍在 baseline 未核实清单；本文没有把建议冒充竞品事实。
- 锁定版本的 `@codemirror/lang-markdown` 已通过默认 `markdownKeymap` 提供 Enter 列表续项/空 marker 退出，`defaultKeymap` 也提供 Shift+Enter 通用换行；尚未核实的是 LumaMark 应用级键位优先级、紧凑/松散列表、IME、selection、undo 粒度和 exact source，而不是依赖命令是否存在。
- 当前工作区存在大量未提交并行改动；本文依据读取时快照，未把规划文档或未运行的测试当发布基线。
- `listDecorations.ts` 未发现调用，但可能正处于并行重构；实施前应再次检索引用，避免误删他人正在接线的工作。
- E2E 中 `toContainText` 会看到 CodeMirror 文本层，不足以证明 marker 在视觉上隐藏；需要 DOM/截图与 state 双重断言。
- checkbox 改为可聚焦可能影响 contenteditable 的选区和 IME；必须用成熟 CodeMirror widget 机制和设备验证，而不是只改 ARIA 属性。
- 现有 fixture round-trip 使用未编辑的 `sourceText`，不能证明打开后的 CodeMirror、列表命令和重开链路完全保真。

## 证据索引

### Typora 基线

- `docs/product/typora-baseline/04-lists-and-task-lists.md`：Typora 1.13.7 的语法、任务点击观测、阅读/焦点、源码与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：块级焦点、源码符号隐藏、复制粘贴、IME 与源码模式横切规则。
- `docs/product/typora-baseline/README.md`：provenance 约定和任务列表本机观测摘要。

### LumaMark 代码

- `src/editor/markdown/markdownLanguage.ts`：CodeMirror GFM Markdown 解析入口。
- `src/editor/wysiwyg/markdownDecorations.ts`：运行时 Lezer 遍历、list line、无序 bullet、task widget、焦点规则和 `Mod-Enter`。
- `src/editor/wysiwyg/taskListMarkers.ts`、`src/editor/wysiwyg/taskListCommands.ts`：task marker 正则、切换 change spec 与 fenced code 排除。
- `src/editor/wysiwyg/listDecorations.ts`：未发现调用的另一套列表行正则收集器。
- `src/editor/wysiwyg/wysiwyg.css`：list line、bullet 与 task checkbox 视觉。
- `src/editor/commands/markdownFormatCommands.ts`：有序/无序/task 的多行 prefix toggle。
- `src/editor/commands/markdownFormatKeymap.ts`、`src/editor/core/createEditorState.ts`：实际格式快捷键与 default keymap 装配。
- `src/features/commands/createCommandModels.ts`、`src/app/controllers/useAppCommandModels.ts`：菜单、palette 与 editor command 接线。
- `src/shared/i18n/locales/en.json`、`src/shared/i18n/locales/zh-CN.json`：列表菜单文案。
- `src/editor/core/editorDisplayMode.ts`、`src/editor/capabilities/index.ts`：live preview/source capability 装配。

### 测试与 fixture

- `src/editor/wysiwyg/markdownDecorations.test.ts`：列表节点、widget、嵌套、焦点、task toggle 与 fenced 排除。
- `src/editor/commands/markdownFormatCommands.test.ts`：列表创建/移除、嵌套、多行、undo 与 marker 变体。
- `tests/e2e/editor-markdown.spec.ts`：无序视觉、task 点击/撤销、Control+Enter、菜单与 palette 部分路径、source mode。
- `tests/e2e/v1-workflow.spec.ts`：追加任务、点击完成与保存写出旁证。
- `tests/fixtures/markdown/lists.md`、`tests/fixtures/markdown/task-list.md`、`tests/fixtures/markdown/gfm-edge-cases.md`：列表与任务样本。
- `tests/fixtures/markdownFixtureManifest.ts`、`tests/fixtures/fixtureCoverage.test.ts`：tag 清单与存在性门禁。
- `tests/fixtures/roundTrip.test.ts`、`tests/fixtures/fixturePaths.ts`：统一未编辑保存字节比较。

### 依赖、架构与流程

- `package.json`、`pnpm-lock.yaml`：CodeMirror/Lezer、Vitest、Playwright 的直接依赖与锁版本证据；锁定安装物 `node_modules/@codemirror/lang-markdown/dist/index.js` 用于定点核实 `markdownKeymap` 与 `insertNewlineContinueMarkup`，但不替代仓库内应用级回归测试。
- `docs/architecture/DETAILED_ARCHITECTURE.md`：当前列表能力债务与 capability 边界；只用于架构建议，不作为功能存在证据。
- `AGENTS.md`、`DEVELOPMENT_PROCESS.md`：源码保真、成熟依赖、测试分层与性能门禁；只作为分析约束和验收标准来源。
