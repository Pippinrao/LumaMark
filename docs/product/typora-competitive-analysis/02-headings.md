# 标题（Headings）竞品差距分析

## 用途、范围与非目标

本文用于把 Typora 1.13.7 的 ATX 标题体验基线，与 LumaMark 当前仓库中可由代码、自动化测试、fixture 和依赖清单证明的能力逐项对照，并形成可实施、可验收的改进路径。结论刻意区分“功能存在”与“体验追平”：能解析或能插入 `#` 不等于已达到 Typora 的焦点切换、键盘连续输入、源码保真和可访问性体验。

范围包括 ATX H1–H6 的创建、阅读态、焦点编辑态、源码模式、键盘、鼠标、文本粘贴、保存及边界行为。Setext 标题、大纲侧栏和 TOC 不作为本专题的竞品范围；但当它们暴露当前标题架构的事实（例如 fixture 已包含 Setext、outline 只识别 ATX）时，会作为架构风险记录，不把它们扩张为本轮交付需求。本文不修改产品代码，不替代真实 Typora GUI 复核，也不把规划文档当成实现证据。

## 执行摘要

LumaMark 已具备可用的 ATX 标题主路径，但尚不能判定体验追平。基于 CodeMirror 6 Markdown/Lezer 语法树，实时预览会识别 `ATXHeading1`–`ATXHeading6`，为整段加级别样式；非当前行用 replacement decoration 隐藏 `HeaderMark`，光标回到该行时恢复源码标记。H1、H2、H3 使用递减字号，H4–H6 共用同一字号和视觉规则；Ctrl/Cmd+1–6、段落菜单和命令面板都能写入或改变标题级别。源码模式通过移除实时预览扩展完整显示 Markdown。专用 `headings.md` fixture 覆盖 H1–H6、中文和行内代码，并进入字节级 round-trip 门禁。这些是“功能存在”的扎实证据。

体验仍有四个关键空洞。第一，键入 `#` + 内容 + Return 的连续创建路径没有标题专题 E2E，现有测试主要用整段 `insertText` 或格式命令，不能证明 Return 后光标、下一段落、撤销粒度及 IME 均稳定。第二，普通文本粘贴依赖 CodeMirror 默认行为，没有标题专用粘贴测试；无法从仓库证据确认多行粘贴、混合换行和粘贴后焦点模型。第三，当前视觉装饰只是 CodeMirror 内的 `span/div` 样式，未发现把标题暴露为可导航 heading 语义的实现或测试，因此视觉像标题不等于辅助技术可将其当作标题。第四，空标题、闭合 `#`、1–3 个前导空格、Tab/多空格、超过六个 `#`、复制粘贴和保存后的原样保留缺少集中边界矩阵。

因此总体判断是：ATX H1–H6 基础编辑和 live preview 为“已实现”；Typora-like 标题完整交互为“部分实现”；可访问语义和若干边界为“证据不足”或“未实现”。P0 应先补测试和焦点/保真闭环，不应另造 Markdown 解析器或自研基础编辑组件。

## Typora 完整功能与体验基线

### 创建

Typora 支持在行首输入 1–6 个 `#`、标题内容并按 Return 创建 H1–H6；标准落盘形态是 `#{1,6}`、空格和文本。基线还确认 Ctrl/Cmd+1–6 可直接应用对应级别。横切基线证明 Typora 对普通段落一次 Return 会创建新段落并落盘为空行分隔，但标题退出时究竟写入一个还是两个换行未做标题专项录制，不能把段落结论直接外推。菜单通常提供标题级别入口，但具体本地化菜单路径在基线中未完成 GUI 核实，不能把习惯性推断写成事实。

### 阅读态

非当前标题按级别排版，行首 `#` 通常隐藏。本机 Typora 截图已观察到 `# H1 Title` 以大号标题显示且 `#` 不可见。标题内的强调、链接、行内代码等 span 应遵循各自的阅读态规则。这里的核心体验不是简单改字号，而是正文阅读不被 Markdown 标记打扰，同时源文本仍是唯一事实来源。

### 焦点编辑态

光标进入标题块后必须能直接修改标题文本。基线对 `#` 与空格是否始终可见标注为未核实，因此本文不要求 LumaMark 机械复制未知细节；但至少应保证进入当前行后结构标记可发现、光标位置稳定、离开后重新隐藏，并且切换过程不改写文档。

### 源码模式

源码模式应完整显示 ATX 标记，且从实时预览切换到源码模式、再切回时不得改变 Markdown。闭合 `#` 是否被 Typora 自动规范化尚未核实；依据 LumaMark 的源码保真原则，应默认保留用户输入，直到有明确产品决策和兼容证据支持规范化。

### 键盘

基线明确 Ctrl/Cmd+1–6 应用 H1–H6，以及 Return 完成键入创建。高质量体验还要求格式命令可撤销、级别切换不吞掉标题文字或空白、焦点仍留在编辑器。IME 组合态、选区跨行时的行为和是否存在“普通段落”快捷键不在已核实基线内，需单独验证，不能推断。

### 鼠标

标题应可像普通文本一样点击定位、拖选和编辑；点击当前标题所触发的标记显隐不应引发布局抖动或错位。基线没有证实拖拽创建标题，故拖拽不作为能力要求。菜单点击应用级别属于已知入口类别，但 Typora 具体菜单文案仍属未核实项。

### 粘贴

把以 `#` 开头的纯文本行粘贴进编辑器后，Markdown 解析结果应成为标题；标题基线没有核实 Typora 的精确解析时机。横切基线还确认 Typora Smart Paste 可从 HTML 剪贴板保留标题语义，这与“原样插入 Markdown 纯文本”是两条不同路径。LumaMark 的对齐目标应先保证纯文本不改写空格、闭合标记、换行或行内 span，再单独决定是否及何时支持 HTML 标题到 ATX 的受控转换，不能把 Smart Paste 与源码保真混成同一事务。

### 复制

Typora 默认 Copy 是 Copy as HTML，另提供 Ctrl/Cmd+Shift+C 显式 Copy as Markdown，并在 1.13 提供 Copy as Plain Text。对标题而言，这意味着复制结果可能携带 HTML heading 语义、ATX 源码或仅标题文本三种不同格式。LumaMark 是否刻意采用“默认复制 Markdown 源”的差异化策略应由产品决策确认；当前专题不能只验证可见文字复制后就宣称追平 Typora。

### 保存

标题应以 Markdown 源码落盘，而非保存渲染后的 DOM。未经明确规则，不应把多空格、Tab、闭合 `#` 或换行风格自动归一化。打开、编辑、保存、重开后，标题层级、文字和无关字节都应保持可预测。

### 错误与边界

基线将超过六个 `#`、空标题以及闭合 `#` 的详细 Typora 行为标为未核实。它们不能被假定为 Typora 事实，但 LumaMark 仍需定义安全行为：解析器不应崩溃，非标题不应被误装饰，保存不得静默丢失源码。Setext 明确在本专题竞品范围外。

## LumaMark 当前功能与精确证据

1. **ATX H1–H6 解析与分级装饰——已实现。** `src/editor/wysiwyg/markdownDecorations.ts` 从 `syntaxTree` 识别 `ATXHeading1`–`ATXHeading6`，生成 `lm-md-heading-{1..6}`。`markdownDecorations.test.ts` 用中文 H1 与 H3 校验精确范围。依赖证据为 `package.json` 中 `@codemirror/lang-markdown`、`@codemirror/language`、`@codemirror/state`、`@codemirror/view` 和 `@lezer/markdown`。
2. **标题视觉层级——已实现，但体验追平证据不足。** `wysiwyg.css` 给 H1、H2、H3 设置递减字号与间距，H4–H6 共用较小、柔和样式。代码证明有层级设计，但没有六级视觉截图断言、暗色主题和不同字体/缩放下的截图证据，不能据此宣称与 Typora 观感追平。
3. **阅读态隐藏 `#`——已实现。** `shouldHideSyntaxNode` 包含 `HeaderMark`；`collectHiddenMarkdownMarks` 仅在非当前行创建 `Decoration.replace`。单元测试“rehides markdown marks when the cursor leaves the active line”证明光标离开标题后生成隐藏标记；E2E“switches between live preview and source mode”证明非当前 H1 中看不到 `#`。
4. **焦点编辑态显示源码标记——已实现，交互覆盖部分。** 同一选择行判定 `isRangeOnActiveLine` 会阻止隐藏当前行标记；单元测试从标题行移动到正文，验证当前行无隐藏 widget、离开后恢复隐藏。尚无标题专用鼠标点击、跨选区、方向键和 IME E2E。
5. **Ctrl/Cmd+1–6——已实现。** `markdownFormatKeymap.ts` 注册 `Mod-1` 至 `Mod-6`；`createEditorState.ts` 把该 keymap 放入编辑器。E2E 验证 Control+1、Control+2 和撤销，单元参数化测试覆盖六级命令结果。
6. **菜单和命令面板——已实现。** `createCommandModels.ts` 同时生成六个 palette command 和段落菜单项；`useAppCommandModels.ts` 将六个 action 接到编辑器命令。E2E 已通过段落菜单创建 H3、命令面板创建 H6，并切到源码模式确认 `###### Title`。中英文 `menu.heading1`–`menu.heading6` 资源齐全；i18n 测试显式列出 H3–H6，资源一致性机制还需结合全量测试判断，本文未运行。
7. **命令写入与空白保真——部分实现。** `replaceHeadingPrefix` 对普通行插入 `${marker} `；对已有 ATX 标题仅替换 `#{1,6}`，保留其后的空格或 Tab。单元测试覆盖 `#   Title` 与 `##\t\tTitle`，并验证 undo 恢复原文。它只处理选择起点所在单行，且没有闭合标记、空标题、多行选区和光标边界测试。
8. **源码模式——已实现。** `editorDisplayMode.ts` 在 source 模式只加模式类，不装载 live-preview decorations；`editorApi.ts` 通过 compartment reconfigure 切换。E2E 验证切换后标题 decoration 消失、`# Title` 完整可见，再切回仍是隐藏标记的 H1。
9. **键入创建——部分实现。** CodeMirror 文档变化会重新计算语法树与 decorations，因此直接键入合法 ATX 行具备即时标题能力；多项 E2E 用 `insertText('# Title...')` 后观察到 H1。然而没有逐键输入 `#`、空格、内容、Return 的专门测试，也没有断言 Return 后下一行是普通段落、撤销粒度、输入法组合态和六级全部路径。
10. **普通文本粘贴——证据不足。** 仓库只发现图片 paste 的专门扩展和 E2E；未发现标题文本 ClipboardEvent/Control+V 回归。CodeMirror 默认编辑能力可能可用，但“可能可用”不是实现验收证据。
11. **HTML Smart Paste 标题语义——未实现。** 对 `src/` 的检索只发现图片粘贴扩展读取 `clipboardData.items`；未发现读取 `text/html`、把 HTML heading 转换为 ATX，或对应命令/测试。该结论只针对 Typora Smart Paste 的标题语义，不否定浏览器/CodeMirror 的普通文本粘贴能力。
12. **标题复制格式——部分实现/证据不足。** 编辑器依赖 CodeMirror 的原生选择与复制，未发现标题专用 Copy as HTML、Copy as Markdown 或 Copy as Plain Text 命令和测试；当前仅能从默认编辑器能力推断基本复制可能存在，不能证明 HTML heading 语义、隐藏 marker 与 ATX 源码三种结果符合产品策略。
13. **保存与源码 round-trip——已实现于基础路径。** `tests/fixtures/markdown/headings.md` 包含 H1–H6、Setext、行内代码和中文；manifest 标记 `commonmark:heading`，fixture coverage 要求该 tag。`roundTrip.test.ts` 对清单内每个 fixture 调用文件 action 保存并逐字节比较，因此标题 fixture 进入统一保真门禁。该测试使用未编辑的 `getDocumentText`，并不覆盖先用命令改级别再保存重开的路径。
14. **标题边界与语义——部分实现/证据不足。** 语法树避免 fenced code 内的伪标题被误识别，装饰测试也有相关排除用例；但空标题、闭合 `#`、前导空格、超过六个标记未形成标题专项断言。对 `src/` 的定点检索没有发现标题 decoration 设置 `role="heading"`、`aria-level` 或等价编辑区 heading 语义，因此编辑区按标题级别导航的实现状态为“未实现”；不同屏幕阅读器最终如何朗读普通文本仍需设备复核，不能由静态代码推断。
15. **重复实现风险——已存在。** `headingDecorations.ts` 另有正则 `^(#{1,6})\s+\S` 的行扫描器，但 `rg` 未发现调用；运行时实际走 `markdownDecorations.ts` 的 Lezer 语法树。这不是用户功能缺失，却会造成空标题、空白和 CommonMark 边界规则在未来分叉。

## 当前真实体验路径

用户启动应用后默认处于 `livePreview`。在编辑器输入 `# Title` 时，底层 `EditorState` 保留原始字符串，Markdown language 解析为 ATXHeading，WYSIWYG 插件给整段加 H1 class。光标仍在该行，`HeaderMark` 不被替换，因此用户可以看到并编辑 `#`；点击其他正文行或移动光标后，插件因 `selectionSet` 重建 decorations，`#` 被 aria-hidden 的空 widget 替换，标题文字按 H1 样式阅读。用户也可以在任意当前行按 Ctrl+1–6，或从“段落”菜单/命令面板选择级别；命令直接向 CodeMirror transaction 写入或替换前缀，并把焦点返回编辑器，可由历史栈撤销。

选择“源码模式”后，display-mode compartment 卸载 live preview 扩展，文档字符串不变，`#` 重新完整显示；切回后重新建立 decorations。保存时 app 层读取 `editor.getDocumentText()` 并经 file action/service 写出，标题不是从 DOM 反序列化，因此基础设计符合“Markdown 源文件唯一事实来源”。真实路径已能完成日常标题写作，但仓库证据还不能证明逐键 Return、文本粘贴、跨行选择、屏幕阅读器导航及所有保真边界。

## 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| ATX H1–H6 解析 | 已实现 | 低 | 六级合法标题可识别 | `markdownDecorations.ts`；分级 decoration 单测 |
| 六级视觉层级 | 部分实现 | 中 | H4–H6 区分偏弱，跨主题观感未证实 | `wysiwyg.css`；缺六级视觉回归 |
| 非焦点隐藏 `#` | 已实现 | 低 | 阅读态干净 | 隐藏逻辑单测；模式切换 E2E |
| 当前行恢复标记 | 已实现 | 中 | 可直接编辑源码结构 | selection 单测；缺鼠标/IME E2E |
| 键入 `#` + 内容 + Return | 部分实现 | 高 | 连续写作可能出现段落延续、光标或撤销差异 | 语法树动态装饰存在；无专项 Return 用例 |
| Ctrl/Cmd+1–6 | 已实现 | 低 | 快速改级别可用 | keymap、六级 command 单测、Control E2E |
| 菜单 H1–H6 | 已实现 | 低 | 鼠标用户可创建标题 | command model；H3 E2E |
| 命令面板 H1–H6 | 已实现 | 低 | 键盘发现性较好 | palette models；H6 E2E |
| 普通文本粘贴为标题 | 证据不足 | 高 | 从网页/其他编辑器迁入内容的结果不可保证 | 仅发现图片 paste 专项测试 |
| HTML Smart Paste 保留标题语义 | 未实现 | 中 | 从富文本来源粘贴标题时无法按 Typora 路径保留层级 | 未发现 `text/html`→ATX 转换或测试 |
| 标题复制格式 | 证据不足 | 中 | 隐藏 marker 时复制结果及 HTML/Markdown/纯文本格式不可预测 | 未发现三种复制入口或标题剪贴板断言 |
| 源码模式完整标记 | 已实现 | 低 | 用户可审阅原始 Markdown | display compartment；模式 E2E |
| 模式切换不改源码 | 已实现 | 中 | 避免查看模式造成内容变更 | `editorApi.test.ts` 精确比较文本并验证 undo 历史；E2E 旁证显示往返 |
| 级别命令保留多空格/Tab | 已实现 | 中 | 降低无关 diff | command 单测覆盖两种空白 |
| 闭合 `#` 保真 | 证据不足 | 高 | 可能产生静默格式变化或显示错误 | fixture/测试无闭合 ATX 专项 |
| 空标题与超六级边界 | 证据不足 | 中 | 极端输入可能误装饰或样式跳变 | 无专项 unit/E2E |
| 标题内 inline span | 部分实现 | 中 | 标题中的代码/强调可见，但组合焦点未系统验证 | headings fixture 有 inline code；通用 span decoration |
| 编辑后保存并重开 | 部分实现 | 高 | 命令修改后是否全链路保真未被专题覆盖 | fixture 是未编辑字节 round-trip；V1 E2E 仅 contains |
| 撤销/重做 | 部分实现 | 中 | Control 路径已覆盖，Return/菜单六级未全覆盖 | command 单测与快捷键 E2E |
| 鼠标定位与拖选稳定 | 证据不足 | 中 | 标记显隐可能造成选区或布局跳动 | 只有程序化 selection 测试 |
| IME 组合态 | 证据不足 | 高 | 中文标题输入可能被 decoration 更新干扰 | 未发现标题 IME 测试 |
| 可访问标题语义 | 未实现 | 高 | 编辑区未提供可验证的 heading/level 导航语义 | `src/` 无 `role=heading`、`aria-level` 或等价实现；设备表现未核实 |
| 大文档标题装饰性能 | 证据不足 | 中 | 大量标题滚动/选区更新可能卡顿 | 仅可见范围构建；无标题 decoration 专项 perf |

## 根因与架构影响

根因不是缺少 Markdown 解析库，而是“已有通用能力、缺专题契约”。运行时使用成熟的 CodeMirror/Lezer 语法树，这是正确边界；标题规则却分散在通用 WYSIWYG 插件、格式命令、通用 command model、CSS 和 fixture 中，没有一个 heading capability 明确描述焦点模型、边界和测试矩阵。另一个未使用的正则收集器进一步制造双重事实来源。

按项目分层，解析、decorations、键盘命令和性能观测应归 `editor`；菜单/命令面板编排归 `features/commands`；模式切换归 editor API 与 app 编排；文件写出仍归 `services`/Rust 薄入口；文案归 `shared/i18n`。不要让 feature store 持有 Markdown 全文，也不要在 React render 中二次正则解析标题。若要提供辅助技术语义，应在 CodeMirror 可访问性能力边界内设计，不能用覆盖 contenteditable 的独立 React 标题 DOM 作为第二份文档，否则会破坏选区、复制和 IME。

标题 decoration 每次文档、选区或 viewport 变化会扫描可见语法树。可见范围限制降低了大文档成本，但焦点移动也重建整个可见 decoration set；改进时需对 decoration 重建本身做独立计时，不能只引用现有通用 transaction 指标，且应避免为了语义或动画增加 DOM widget。源码保真方面，命令应只做最小 marker transaction，禁止读取渲染 DOM 再序列化。若清理 `headingDecorations.ts` 或建立 heading capability，属于内部边界整理；若改变 CommonMark/闭合标记行为，则需要同步架构/决策文档评估。

## 详细改进方案

### 模块归属与成熟依赖优先

继续以 `@codemirror/lang-markdown`/Lezer 为唯一解析事实来源，不引入自研标题正则解析器。将标题特定的 decoration 映射、焦点可见规则和格式命令组合为聚焦的 editor capability（或至少统一到现有 `markdownDecorations` 边界），删除或明确弃用未使用的 `headingDecorations.ts`。菜单和 palette 只调用稳定 command port，不复制 Markdown 规则。无需新基础组件；若 CodeMirror 官方无直接 heading 语义方案，应先调研其 accessibility API、DOM attributes/facets 和社区已验证模式，再提出最小扩展，不能直接自研镜像编辑器。

### 数据流

用户输入/粘贴/命令应统一产生 CodeMirror transaction：文档源码更新 → Lezer 增量语法树更新 → 可见范围 decoration 更新 → app 只接收轻量 documentChanged 事件 → 保存时 service facade 读取 editor 原文。焦点移动只改变 decoration，不触发 docChanged。模式切换只 reconfigure extension，不生成文本 transaction。测试需分别断言文档字符串、selection、DOM 阅读态和保存输出，避免仅用 `toContainText` 混淆源码与视觉。

### 源码保真

建立 ATX 边界 fixture：H1–H6、中文/英文、行内 span、1–3 个前导空格、多空格、Tab、闭合 `#`、空标题、转义、超过六个 `#`、CRLF 与末尾无换行。对“打开→不编辑→保存”做字节对比；对“命令只改级别”做精确 expected diff；对模式切换做 `getDocumentText()` 前后相等。未经书面决策，不自动规范化空白或闭合标记。

### i18n 与可访问性

保持 H1–H6 菜单/palette 名称使用完整 i18n key，并把快捷键可见标签按平台渲染。新增错误/提示时中英文同步，不能拼接翻译片段。可访问性验收至少包括：编辑器仍有明确 label；标题级别能被辅助技术识别或有经过验证的等价导航；隐藏 marker 不造成标题文字缺失；高对比/暗色模式下六级可区分；200% 缩放不裁切；键盘无需鼠标即可创建、修改、退出标题。若 CodeMirror contenteditable 语义约束使原位 `role=heading` 不安全，应记录证据并评估大纲作为补充导航，但不能把补充导航伪称为编辑区语义已实现。

### 错误处理

标题解析本身不应弹错：非法或不完整输入保留为普通源码，等待用户继续编辑。格式命令必须先定义支持的选区形态；对尚未定义的跨行选区不得只修改第一行后仍返回成功，应明确拒绝或按书面决策原子修改全部目标行。保存错误沿现有 file error notice 路径呈现，不在 editor 层静默 fallback。粘贴的普通文本必须保持原文；只有图片等已识别专用路径可以拦截 paste，且不得误拦截含 `#` 的纯文本。

## 分阶段优先级

### P0

补齐标题行为契约与自动化：逐键键入 H1/H6 + Return、当前行/非当前行 marker、Ctrl/Cmd 六级、纯文本多行粘贴、默认复制结果、源码模式前后原文相等、编辑后保存重开、闭合标记/空白精确保真、IME 中文组合与撤销。标题专项复核并记录 Typora Return 后的精确换行字节；在复核前，LumaMark 至少保证单次 Enter 不丢标题或吞正文。以语法树为唯一事实来源，处理未使用正则实现的去留。P0 完成条件是基础写作路径可被测试证明，不是仅增加 CSS。

### P1

完成鼠标点击/拖选、跨行 selection、Copy as Markdown/HTML/Plain Text 的产品决策与入口、HTML Smart Paste、行内 span 组合、空标题/超过六级/前导空格边界；建立六级亮暗主题视觉截图和 200% 缩放检查；实现或经证据评估标题可访问语义。增加针对可见范围内大量标题与频繁光标移动的独立性能基准。

### P2

在真实用户测试后微调 H4–H6 层级、段前段后距和中英文字体表现；补 macOS/Linux 的 Mod 键与字体抽检；根据后续产品决策考虑普通段落快捷键、Setext 的显示策略及与大纲导航的统一，但不得让这些扩展阻塞 P0 的 ATX 可靠性。

## 可执行验收标准与测试计划

### Unit

- 对 Lezer 节点映射验证 H1–H6 精确 range/class，代码围栏内 `#` 不生成标题。
- 对焦点规则验证当前行 `HeaderMark` 可见、离开后隐藏、跨选区时选中的结构标记可编辑，且 selection-only transaction 不改变源码。
- 参数化验证六级格式命令：普通行插入、已有标题只替换 marker、空白/Tab/闭合 `#` 保留、undo/redo 精确恢复。单光标路径必须有精确字符串与 selection 断言；跨行选区在产品决策落盘前必须返回失败且不改文档，决策后再用原子 expected diff 替换该保护测试。
- 按 CommonMark 解析边界验证：0–3 个前导空格仍可成为标题，四个前导空格不成为 ATX 标题；1–6 个 `#` 后接空格、Tab 或行尾可形成标题，七个 `#` 与转义的 `\#` 不形成标题；合法闭合序列、空标题和行内 span 均保留原始源码。每项同时断言 decoration 种类/range 与 `doc.toString()` 未被解析过程改写。

### Integration

- 用真实 `createEditorState` 和 display compartment 验证 livePreview/source 往返时 `doc.toString()` 完全相等，decorations 只在预览模式存在。
- 从 command port 调用 H1–H6，验证菜单/palette 与快捷键最终进入同一 editor command，不复制规则。
- 用 compositionstart/update/end 合成事件覆盖中文组合回归：组合期间不错误隐藏当前行 marker，结束后文本与 selection 精确匹配，一次 undo 恢复组合前文本；该自动化只证明事件处理契约，不能替代 Windows 原生 IME 设备抽检。
- 普通文本 paste 不被图片扩展拦截；多行 ATX 文本保持换行与字节内容并被语法树识别。

### E2E

- 逐键输入 `# 中文标题`、按 Enter、继续输入正文；断言标题样式、非当前行无 `#`、正文不是标题、撤销/重做与光标位置，并直接比较源码中的换行字节。Typora 标题专项录制完成前，测试先锁定 LumaMark 当前安全行为，不把普通段落的双换行事实伪装成标题事实；录制后再按产品决策更新 expected string。
- 对 H1–H6 各执行平台快捷键；至少抽测菜单、命令面板，切源码后断言精确 marker。
- 真实 ClipboardEvent 粘贴含 H1、H6、普通段落和闭合 marker 的文本；断言 live preview 与 source 两种显示。
- 分别提供 `text/plain` 与 `text/html` 剪贴板：纯文本路径逐字节保持 ATX；HTML `<h1>`/`<h6>` 在 Smart Paste 未实现时必须走明确、可预测的降级结果，实施后再断言转换为对应 ATX 且不引入无关 HTML。
- 点击标题、拖选部分文字后分别验证产品定义的默认 Copy、Copy as Markdown 与 Copy as Plain Text；若支持 Copy as HTML，再断言剪贴板包含对应 heading level。点击正文后确认 marker 隐藏且页面无布局跳动。
- 保存并重开修改后的 fixture，直接比较完整文本，不只 `contains`；保存失败时确认错误可见且编辑器内容未丢失。
- 用现有 Playwright 先验证编辑器 label 与纯键盘创建/修改/退出路径；若项目经依赖评估采纳 axe，再增加自动扫描。无论是否采用 axe，都需对最终 heading 语义方案断言可访问树中的 level，并用 Windows Narrator/NVDA 各抽检一次；视觉截图覆盖亮/暗主题和六级标题。

### Fixture

- 扩充 `headings.md` 或新增有独立生命周期的边界 fixture 前，先遵守文档/fixture治理；样本至少覆盖六级、行内 span、中文、空白、闭合标记和异常标记。
- `pnpm test:fixtures` 必须证明 open/save 字节一致；再增加“编辑指定 marker 后仅预期字节变化”的测试。
- CRLF、UTF-8、末尾换行分别校验，避免测试读取成字符串后掩盖换行归一化。

### Perf

- 单独运行性能门禁，不与 E2E/build 并行。构造含大量 H1–H6 的 1MB/5MB/10MB 文档，分别测打开、首次 decoration、滚动和连续上下移动光标的 transaction duration。
- 验收沿用项目预算：1MB 打开小于 300ms、5MB 小于 1s、10MB 可编辑不冻结、普通输入尽量小于 16ms、滚动接近 60 FPS；同时记录标题插件自身的可见范围处理成本，不能仅看整应用均值。

本文是静态分析任务，未运行上述测试。实施阶段必须按 TDD 先看到正确失败，再做最小实现，并在完成声明前新鲜运行相关 unit、E2E、fixture、typecheck/lint 与独立 perf。

## 风险与未核实项

- Typora 当前标题行的 `#`/空格精确显隐、菜单文案、粘贴解析时机、空标题、闭合 `#` 和超过六级行为仍未由 GUI 复核；不得把建议误写成竞品事实。
- Typora 普通段落的一次 Return/双换行落盘已有横切证据，但标题退出后的精确换行字节仍未专项录制；不得直接把普通段落结果套到标题。
- Typora Smart Paste 与三种 Copy 语义来自横切基线；本轮未做标题样本的剪贴板 MIME 实测，HTML heading level、纯文本内容和隐藏 marker 的精确结果仍待核实。
- CodeMirror 对 Setext 的实际节点名与渲染表现未在本文运行时探测；fixture 有 Setext，不代表 live preview 已装饰。Setext 仍属本专题非目标。
- `HeaderMark` replacement widget 标为 `aria-hidden`；静态证据只能证明隐藏节点属性，不能证明屏幕阅读器最终朗读与光标行为，其对 Windows Narrator/NVDA 的真实影响仍需设备抽检。
- 当前 E2E 使用 `Control`，仓库静态 keymap 使用 `Mod`；macOS Command 路径只有代码推导，没有本轮运行证据。
- H4–H6 共用视觉规则可能是有意的安静设计，也可能层级不足；应以六级截图和用户任务测试判断，不能仅凭字号差异下结论。
- 仓库工作树已有大量其他任务改动；本文只新增本报告，没有把这些未提交状态当成稳定发布基线。

## 证据索引

### Typora 基线

- `docs/product/typora-baseline/02-headings.md`：Typora 1.13.7 的 ATX 范围、支持文档、观察截图、快捷键及未核实边界。
- `docs/product/typora-baseline/00-live-preview-model.md`：Return、选择/复制/Smart Paste、IME 与源码符号显隐的横切基线。
- `docs/product/typora-baseline/05-emphasis-and-inline-spans.md`：标题内行内 span 的阅读态与焦点展开旁证。

### LumaMark 代码

- `src/editor/wysiwyg/markdownDecorations.ts`：语法树标题映射、HeaderMark 隐藏、焦点行判定和可见范围 decoration。
- `src/editor/wysiwyg/headingDecorations.ts`：未发现调用的重复正则收集器。
- `src/editor/wysiwyg/wysiwyg.css`：H1–H6 视觉规则。
- `src/editor/markdown/markdownLanguage.ts`：CodeMirror Markdown 语言与语法高亮入口。
- `src/editor/commands/markdownFormatCommands.ts`：六级标题 marker transaction。
- `src/editor/commands/markdownFormatKeymap.ts`、`src/editor/core/createEditorState.ts`：Mod+1–6 注册与编辑器装配。
- `src/editor/core/editorDisplayMode.ts`、`src/editor/core/editorApi.ts`、`src/editor/core/editorApi.test.ts`、`src/editor/capabilities/index.ts`：实时预览/源码模式切换和 capability 装配；测试提供文本与 undo 历史不变的精确证据。
- `src/editor/capabilities/image/imageInputExtension.ts`：当前 paste 专用处理只识别图片文件，作为未发现 HTML heading Smart Paste 的边界证据。
- `src/features/commands/createCommandModels.ts`、`src/app/controllers/useAppCommandModels.ts`：菜单、命令面板与 action 接线。
- `src/shared/i18n/locales/en.json`、`src/shared/i18n/locales/zh-CN.json`：六级标题本地化文案。
- `src/features/outline/outlineParser.ts`：只作为架构旁证的 ATX outline 正则，不作为编辑器渲染实现证据。

### 测试与 fixture

- `src/editor/wysiwyg/markdownDecorations.test.ts`：分级范围、当前行/非当前行显隐及代码围栏排除。
- `src/editor/commands/markdownFormatCommands.test.ts`：H1–H6、空白/Tab 保留、undo。
- `tests/e2e/editor-markdown.spec.ts`：Ctrl+1/2、菜单 H3、命令面板 H6、live preview/source 往返。
- `tests/e2e/v1-workflow.spec.ts`：编辑和保存标题的广义工作流旁证，但仅做 contains 断言。
- `tests/fixtures/markdown/headings.md`、`tests/fixtures/markdownFixtureManifest.ts`、`tests/fixtures/fixtureCoverage.test.ts`：标题样本及覆盖标签。
- `tests/fixtures/roundTrip.test.ts`、`tests/fixtures/fixturePaths.ts`：fixture 文件保存后的逐字节比较入口。
- `src/shared/i18n/i18n.test.ts`：标题菜单 key 的部分显式覆盖。

### 依赖与流程

- `package.json`、`pnpm-lock.yaml`：CodeMirror/Lezer、Vitest、Playwright 的成熟依赖证据。
- `DEVELOPMENT_PROCESS.md`：测试分层、fixture round-trip、性能预算和完成门禁；仅作为改进方案约束，不作为功能已实现证据。
