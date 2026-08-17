> 语言：**中文** · [English](../../../product/typora-competitive-analysis/05-emphasis-and-inline-spans.md)

# 强调与行内 Span 竞争差距分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - `EditorInteractionContext` 现按每个选区派生最小 inline owner 与 delimiter，live preview 只展开当前粗体、斜体、删除线、行内代码或链接 span；嵌套、相邻、多反引号、转义、多选区、链接目标/标题和 composition 映射均有单元测试，Playwright 覆盖相邻与嵌套 owner。
> - 旧“按活动行统一展开”的结论已过期；格式命令完整度、剪贴板、Windows 原生中文 IME，以及高亮、上下标等扩展能力仍不属于已追平范围。

## 用途、范围与非目标

本文把 Typora 1.13.7 的强调与行内 span 公开体验基线，同当前工作区内 LumaMark 的实际代码、自动化测试、fixture 与依赖逐项对照，用于确定产品验收口径、编辑器边界和后续实现顺序。状态只允许使用“已实现 / 部分实现 / 未实现 / 证据不足”，严重度只允许使用“阻断 / 高 / 中 / 低”。规划文档和目标描述不能证明功能存在；本文的 LumaMark 结论以可定位的运行时代码、测试和 fixture 为准。

范围包括 `*`/`_` 斜体、`**`/`__` 粗体、粗斜体嵌套、`` `code` `` 行内代码、`~~strike~~` 删除线、反斜杠转义、词内下划线、焦点进入与离开、菜单/命令面板/快捷键、粘贴、源码模式、撤销重做、保存及源码保真；也记录 Typora 可选的 `==highlight==`、`~sub~`、`^sup^`、emoji 短码和行内公式在本专题中的表面边界。行内公式的完整解析与渲染归入数学专题，链接和图片分别归入对应专题，`<u>` 等 HTML span 归入 HTML 专题。

本文不推断 Typora 私有实现，不把尚未完成的 GUI 复核写成事实，不要求 LumaMark 自动统一 `*` 与 `_` 风格，也不在本专题实施功能、引入依赖或改变架构。高亮、下标、上标、emoji 和行内公式不是当前 V1 P0 的既定范围；但必须记录它们与 Typora 的迁移差距及未来开关边界。

## 执行摘要

LumaMark 已经具备基础可用链路：CodeMirror 6 的 Markdown/GFM 语言与 Lezer 语法树识别粗体、斜体、删除线和行内代码；live preview 对整个语法范围施加样式，并在光标不同行时替换隐藏 `EmphasisMark`、`StrikethroughMark` 与 `CodeMark`；格式菜单能创建四种基础格式，`Mod-B`/`Mod-I` 能切换粗体/斜体，命令面板能创建删除线；格式 transaction 可撤销，源码模式能显示原 marker；`emphasis.md` 已进入字节级未编辑 round-trip 门禁。现有单元测试还证明星号与下划线变体会形成语法节点，`editorApi.test.ts` 证明 source/live 重配不改变全文且保留 undo history，E2E 证明粗体非当前行隐藏 marker、模式切换后源码仍在，以及粗斜体快捷键的创建、移除和撤销。

然而，这条链路只达到“基础格式存在”，没有达到 Typora-like 行内编辑的精细程度。当前显隐判定是 `isRangeOnActiveLine`：光标只要位于某一行，该行内所有强调、删除线和代码 marker 都保持源码可见；Typora baseline 描述的是光标进入具体 span 中部时才展开该 span。这会让包含多个 span 的长段落在编辑其中普通文本时突然暴露全行标记，是本专题最明显的体验差距。仓库也没有直接测试嵌套 `***...***`、不配对 marker、转义、词内 `_`、多反引号 code span、空格规则、跨 span 选区、IME、复制粘贴、编辑后保存重开和仅目标范围 diff。

此外，`emphasisDecorations.ts` 与 `collectInlineCodeDecorations` 仍保留未被运行时引用的正则收集器，而实际 live preview 走 `markdownDecorations.ts` 的 Lezer 树；两套接受规则可能分叉。`==highlight==` 虽出现在 fixture 文本中，但当前没有 parser extension、样式、设置或命令，所以不能据 fixture 推断为支持；sub/sup、emoji 自动完成和行内公式也未实现。总体判断：粗体、斜体、删除线、行内代码均为“部分实现”；扩展 span 为“未实现”；基础源码保真有窄门禁，但完整编辑体验仍需 P0 收口。

## Typora 完整功能与体验基线

### 语法与创建

- 斜体接受 `*text*` 与 `_text_`，粗体接受 `**text**` 与 `__text__`；Typora Support 推荐星号写法，但推荐不代表保存时自动改写用户选择。
- 行内代码使用反引号，删除线使用 `~~text~~`。键入已配对定界符后形成阅读样式，粘贴已有 Markdown 源码也应能被解析。
- GFM 规则要求 `wow_great_stuff` 一类词内下划线不触发强调；反斜杠转义应保留字面 `*`/`_`。
- baseline 记录 emoji `:smile:` 和自动完成入口；也记录需在 Preferences → Markdown 开启的 `==highlight==`、`~sub~`、`^sup^` 与 `$...$` 行内公式。关闭开关后的逐项 GUI 回退仍未完全核实，因此只能要求保留字面源码，不能臆测具体样式。
- 格式菜单和常见粗斜体快捷键属于用户创建入口；Typora 1.13.7 的具体全部键位尚在 baseline 未核实清单中。

### 阅读态与焦点编辑态

- 非焦点 span 只显示语义样式：粗体、斜体、等宽代码和删除线等，定界符隐藏。baseline 的本机观测确认 `**boldspan**` 阅读态仅显示加粗正文。
- 光标进入具体 span 中部时，定界符展开为可编辑源码；离开后重新回到阅读态。展开是视图行为，不应修改文档、制造撤销记录或改变保存内容。
- 同一段落含多个 span 时，合理的对齐目标是只展开与光标/选区相交的 span，而不是暴露整行所有 marker；跨 span 选区应优先保证选区稳定和可编辑性。
- 源码模式必须展示全部原始 marker。用户从 `_`、`__`、不同反引号长度或转义写法进入 live preview 再返回，不应被静默规范化。

### 键鼠、粘贴、撤销与保存

- 选择文本后执行格式命令，应包裹目标文本；再次切换应只移除紧邻选区的对应 marker，且能以一次清晰 transaction 撤销。
- 无选区时的占位文本、空 span 行为、嵌套格式切换和多选区行为，在 baseline 中没有足够 GUI 事实，不能冒充 Typora 已核实行为。
- Typora 默认 Copy 面向 HTML；Copy as Markdown 在 Windows/Linux 为 `Ctrl+Shift+C`、macOS 为 `Shift+Command+C`，1.13 还提供 Copy as Plain Text。Smart Paste 会尝试保留来源语义，Paste as Plain Text 在 Windows/Linux 为 `Ctrl+Shift+V`、macOS 为 `Shift+Command+V`。这些是横切基线已记录的入口；强调专题的 HTML `<strong>/<em>/<code>` 转换细节、剪贴板 MIME 优先级及复制隐藏 marker 的精确表现仍需复核。
- 粘贴 Markdown 源文本应沿语法解析；源码模式切换入口在 Windows/Linux 为 `Ctrl+/`、macOS 为 `Command+/`。切换后复制的是可见源码还是仍遵循 Copy as HTML 的逐选区规则，baseline 尚未系统对比，不能自行推断。
- 保存必须以 Markdown 源文为唯一事实来源；视图隐藏不能依赖 DOM 反序列化。除用户明确格式命令修改的范围外，无关字符、空白、换行、marker 风格和文件换行约定都应保持。

## LumaMark 当前功能与精确证据

1. **成熟语法基础已接入。** `src/editor/markdown/markdownLanguage.ts` 以 `@codemirror/lang-markdown` 的 GFM Markdown language 为 base；`package.json` 锁定 CodeMirror 6、`@lezer/markdown` 与 `@lezer/highlight`。基础 span 不需要另造 parser。
2. **四种基础 span 能被语法树识别。** `markdownDecorations.ts` 将 `StrongEmphasis`、`Emphasis`、`Strikethrough`、`InlineCode` 映射为明确 range/class。`markdownDecorations.test.ts` 覆盖星号粗体/斜体、下划线粗体/斜体、删除线及行内代码 range。
3. **基础视觉样式已实现。** `wysiwyg.css` 为 strong 设置 700 字重、emphasis 设置斜体、strikethrough 设置删除线、inline code 设置等宽字体、边框、背景与内边距；样式使用主题 token，未硬编码用户文案。
4. **非当前行 marker 隐藏已实现。** `INLINE_MARK_NODE_NAMES` 包含 `CodeMark`、`EmphasisMark`、`StrikethroughMark`；`collectHiddenMarkdownMarks` 用 `Decoration.replace` 和 `HiddenMarkdownMarkWidget` 隐藏它们。E2E 验证非当前粗体行不包含 `**`，源码模式则再次包含 `**bold**`。
5. **显隐粒度只到整行。** `isRangeOnActiveLine` 仅判断 marker 是否落在任一 selection head 所在行；活动行的全部 inline marker 都不隐藏。没有“selection 与所属 span 相交”的判断或 span ownership 模型，状态为“部分实现”。
6. **格式菜单入口已实现。** `createTopMenuModels` 的“格式”菜单包含粗体、斜体、删除线和行内代码；`useAppCommandModels` 将其连接到统一 `runFormat`，中英文资源含 `menu.bold`、`menu.italic`、`menu.strikethrough`、`menu.inlineCode`。
7. **快捷键覆盖不一致。** `markdownFormatKeymap.ts` 提供 `Mod-b` 与 `Mod-i`，E2E 覆盖 Control+B 的创建/移除/两次撤销以及 Control+I 创建/撤销。删除线与行内代码没有专用 keymap 证据。
8. **命令面板覆盖不一致。** `createCommandPaletteModels` 仅为删除线提供 `toggle-strikethrough`，未发现粗体、斜体或行内代码 palette model。E2E 证明删除线可从命令面板创建，不能外推另外三种。
9. **格式 transaction 与窄范围撤销已实现。** `markdownFormatCommands.ts` 的 `wrapSelection` 只替换当前主选区，四种基础格式允许在紧邻 marker 时 unwrap，使用 `input.format` 并恢复选择；单元测试覆盖 wrap、unwrap、选区保持和 undo。无选区时会插入英文占位词 `bold`、`italic`、`strikethrough`、`code`，这些是文档内容而非 UI 标签，但是否适合作为本地化写作体验仍未形成产品决策。
10. **多选区、嵌套与边界处理证据不足。** 实现只使用 `selection.main`；没有测试交叉/嵌套 marker、部分选中已有 span、粗斜体切换、相邻 span、空内容或跨行选择。现状可能生成嵌套 marker，但不能声称行为符合 Typora。
11. **源码模式路径与 undo 连续性已实现，selection/scroll 验收仍不完整。** `createEditorState.ts` 按 display mode 仅在 live preview 装载 `markdownWysiwygExtension`；E2E 验证 live → source → live 后粗体源码和阅读样式切换。`editorApi.test.ts` 直接断言模式切换不改变全文且切回后仍可撤销切换前编辑；`setDisplayMode` 通过 compartment reconfigure 而非重建 EditorState。当前没有模式切换专项断言 selection 与 scroll anchor，因此不能把这两项一并判为已验收。
12. **未编辑字节 round-trip 已实现。** `tests/fixtures/markdown/emphasis.md` 包含星号/下划线变体、粗斜体、转义、code literal、删除线、`==` 字面样本、中英混排和嵌套强调；manifest 标记 `commonmark:emphasis` 与 `gfm:strikethrough`，统一 `roundTrip.test.ts` 用 `Buffer.compare` 要求保存前后为零。
13. **fixture 不等于渲染验收。** round-trip 的 mock editor 始终返回原 `sourceText`，它只证明未编辑保存链路保留字节，不证明 `==highlight==` 已渲染，也不证明真实编辑后只产生目标 diff。
14. **存在重复解析债务。** `emphasisDecorations.ts` 用自定义正则收集 strong/emphasis/strike，`codeBlockDecorations.ts` 另有反引号正则；`rg` 未发现这些收集函数进入主编辑器运行时。正则无法天然覆盖 CommonMark delimiter-run、多反引号 code span、转义和嵌套全部规则，未来不应与 Lezer 路径并行演化。
15. **扩展 span 未实现。** 仓库未发现 highlight/sub/sup/emoji/inline-math 的 editor capability、parser extension、setting、command、样式或专项测试；Settings 当前只有外观、语言和图片。`==highlight-like text==` 出现在 fixture 只能证明文本可保存。
16. **复制粘贴与可访问性证据不足。** 没有强调专题的 ClipboardEvent/Control+V/HTML 粘贴或复制隐藏 marker 测试；隐藏 marker widget 设为 `aria-hidden=true`，正文仍在 CodeMirror contenteditable 中，但屏幕阅读器是否读出正确语义、是否意外读出 marker，以及高对比模式的删除线/代码可辨识度均未验收。

## 当前真实体验路径

用户可以直接输入 `**粗体**`、`*斜体*`、`~~删除~~` 或 `` `代码` ``，底层 CodeMirror 文档保存原字符串，Lezer 增量语法树产生 span 节点，decoration 给整个节点施加视觉 class。光标移到别行时，定界符节点被 replacement widget 隐藏；回到该行时，该行所有行内 marker 一并显示。用户也可选中文本，从格式菜单创建四种基础 span，用 Ctrl/Cmd+B 或 Ctrl/Cmd+I 创建/移除粗斜体，或从命令面板创建删除线。命令聚焦回编辑器，并能通过撤销恢复。

随后用户可切到源码模式查看全部 marker；保存读取 CodeMirror 文本而不是 DOM。这个路径足以完成简单写作，但长段落中只编辑普通文字也会暴露同一行所有 marker。真实剪贴板、中文 IME 在 marker 边界、嵌套粗斜体、反引号内含反引号、跨 span 选择、编辑后保存重开及辅助技术朗读都没有端到端证明。输入 `==高亮==`、`H~2~O`、`X^2^` 或 `:smile:` 时，当前只能按普通文本保留，不能得到 Typora 对应增强体验。

## 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响与依据 |
|---|---|---|---|
| `*`/`_` 斜体解析与样式 | 已实现 | 低 | Lezer range、CSS、单测均有直接证据 |
| `**`/`__` 粗体解析与样式 | 已实现 | 低 | Lezer range、CSS、unit/E2E 均有证据 |
| `~~` 删除线解析与样式 | 已实现 | 低 | GFM base、CSS、unit/E2E 入口有证据 |
| 基础反引号行内代码样式 | 已实现 | 低 | `InlineCode` range、CSS 与 range 单测存在 |
| 非活动行 marker 隐藏 | 已实现 | 中 | replacement widget、unit 与 E2E 证明离开整行后可隐藏；这不等同 Typora 的非焦点 span 模型 |
| 光标进入具体 span 才展开 | 未实现 | 高 | 当前按活动行整体展开，长段落视觉噪音明显 |
| 同行多个 span 独立显隐 | 未实现 | 高 | 无 span ownership/selection intersection 逻辑 |
| 格式菜单四项 | 已实现 | 低 | 菜单模型、i18n、handler 链路存在 |
| 粗体/斜体标准快捷键 | 已实现 | 低 | keymap 与 E2E 存在 |
| 删除线/行内代码专用快捷键 | 未实现 | 中 | `markdownFormatKeymap.ts` 只有 `Mod-b`/`Mod-i`，全仓命令与 E2E 未定义这两项按键入口 |
| 命令面板格式入口一致性 | 部分实现 | 中 | 只有删除线进入 palette |
| 基础 wrap/unwrap/undo | 已实现 | 低 | 单元测试覆盖四项与 undo |
| 粗斜体嵌套与交叉选区 | 证据不足 | 高 | fixture 有文本，行为测试缺失 |
| 词内 `_`、转义和不配对 marker | 证据不足 | 高 | 未编辑 fixture 存在，解析/编辑断言缺失 |
| CommonMark 多反引号 code span | 证据不足 | 高 | 主 parser 可能支持，但命令与专项测试未覆盖 |
| 多选区格式化 | 未实现 | 中 | 命令只读 `selection.main` |
| 源码模式显示原 marker | 已实现 | 低 | E2E 有直接证据 |
| 模式切换全文与 undo 连续性 | 已实现 | 低 | `editorApi.test.ts` 直接断言全文不变且切回后可撤销切换前编辑 |
| 模式切换 selection/scroll 稳定 | 证据不足 | 高 | reconfigure 路径不重建 EditorState，但缺少模式切换前后的 selection 与 scroll anchor 断言 |
| 未编辑 fixture 字节保真 | 已实现 | 低 | `Buffer.compare` 为零的统一门禁 |
| 编辑后 save/reopen 目标 diff | 证据不足 | 阻断 | 这是可信编辑器的发布门禁，当前无专题闭环 |
| Markdown/HTML 剪贴板路径 | 证据不足 | 高 | 无真实 clipboard 专题测试 |
| 中文 IME marker 边界 | 证据不足 | 阻断 | 编辑器一级门禁，无组合态证据 |
| `==highlight==` | 未实现 | 中 | 无 parser/capability/setting/command/style |
| `~sub~` / `^sup^` | 未实现 | 中 | 无 parser/capability/setting/command/style |
| Emoji 短码与自动完成 | 未实现 | 中 | 无数据源、completion source 或设置 |
| 行内公式表面与开关 | 未实现 | 中 | 数学专题待建设，本专题只记录边界 |
| 屏幕阅读器/高对比体验 | 证据不足 | 高 | 无语义朗读、aria snapshot 或高对比视觉验收 |

## 根因与架构影响

根因不是缺几条 CSS，而是通用 WYSIWYG 层当前把“可见范围、语法节点、活动行”直接组合成一个大粒度规则。`collectHiddenMarkdownMarks` 不知道 marker 所属 span，也不知道 selection 是否落在 span 内容、边缘或跨越多个 span，因此只能用活动行近似。若继续在这个函数里堆 highlight、sub/sup、emoji 和 math 特例，`markdownDecorations.ts` 会变成行内语法杂物箱，并增加 selectionSet 时重建可见区 decoration 的热路径成本。

建议保持 `editor` 层负责全部行为：建立聚焦的 `editor/capabilities/inline-spans/` 边界，包含语法节点分类、span/marker 关联、显隐策略和测试；通用 WYSIWYG 只组合 capability 暴露的 decoration builder。格式文本修改仍走 `editor/commands` 的稳定端口，UI 菜单和 palette 只调用 action，不持有 Markdown 全文。基础 CommonMark/GFM 继续依赖 CodeMirror/Lezer，删除未引用正则前先补等价测试；不要为基础强调再写一套正则 parser。

可选扩展必须另设 `features/settings` 的 Markdown preferences 模型，由 app 持久化轻量布尔设置，再通过 editor compartment/reconfigure 注入 parser extension 与 decoration；不得让 React store 持有语法树或全文。Highlight/sub/sup 如果现有 `@lezer/markdown` 没有成熟官方 extension，应先评估维护活跃、类型安全且与 CodeMirror 增量解析兼容的扩展；若仍需自定义 Lezer inline extension，这属于 LumaMark 差异化 Markdown 兼容层，不是基础 UI 自研，但要写决策记录、边界样例和 benchmark。Emoji 自动完成应复用已安装的 `@codemirror/autocomplete`，另选维护活跃、许可清晰的 emoji 数据集，避免手搓弹层和硬编码名称表。

## 详细改进方案

### 数据流与源码保真

1. 从语法树收集 `InlineSpanDescriptor { kind, from, to, markerRanges }`，只覆盖 visible ranges，并把 marker 与父 span 精确关联。
2. 显隐函数输入 CodeMirror selection：光标或任一选区与 span 内容/marker 相交时只展开该 span；跨越多个 span 时展开所有相交 span；组合输入期间不得替换 composition 涉及的 DOM 范围。
3. decoration 永不修改文档。格式命令只派发目标范围 changes，保留用户既有 `*`/`_` 与反引号长度；unwrap 只在语法树确认选区属于完整对应 span 时执行，无法确认时保持文档不变并返回显式不可操作结果，不以再次包裹掩盖歧义，也不做静默猜测。
4. 多选区使用 `changeByRange` 或等价 CodeMirror API，按从后向前的稳定 change set 处理，选择映射由 transaction 完成。每次用户格式动作形成一个 undo step。
5. 保存和 source/live 切换始终读取同一 EditorState；新增 edit → save → reopen 字符级断言，规定除目标 marker 外 diff 为零。

### 命令、i18n、可访问性与错误处理

- 统一菜单、命令面板与快捷键能力清单：粗体/斜体明确展示平台快捷键；删除线/行内代码是否设快捷键先依据跨平台惯例与冲突测试决策。所有可见标签、tooltip、不可用原因与设置说明进入 `en.json`/`zh-CN.json`。
- 无选区占位词建议不再自动写入英文业务词，优先插入空 marker 并把光标置中，或由产品明确可本地化占位策略；这是会写入用户文档的内容，不能悄悄随 UI 语言产生不可预测源码。
- 视觉语义不能只靠颜色：删除线保持足够厚度，inline code 保持边框/背景/等宽多重线索，亮暗主题与 Windows 高对比模式均验收。marker 隐藏 widget 继续从辅助树排除，但必须用屏幕阅读器/aria snapshot 验证正文朗读顺序和 source mode 的标点可读性。
- 对不配对 marker、非法 delimiter run 和关闭的扩展语法，错误策略是按普通文本保留，不自动补齐、不弹噪声 toast。格式命令遇到不可安全 unwrap 的嵌套/交叉选择时保持文档不变并通过可测试结果返回；若未来 UI 提示，必须可本地化。
- HTML paste 转 Markdown 应由共享 clipboard pipeline 负责并复用成熟 sanitizer/parser；本专题只消费规范化文本，不在 inline-span capability 中直接信任或插入 HTML。

## 优先级

### P0：基础写作可信度

1. 把整行显隐改为具体 span 相交显隐，并覆盖同行多个 span、边缘光标、跨 span 选区与 selection 映射。
2. 为嵌套/相邻/转义/词内下划线/不配对 marker/多反引号建立语法与行为契约，消除或隔离未引用正则收集器的重复规则。
3. 建立中文 IME、undo/redo、copy/paste、source/live 切换、edit → save → reopen 与仅目标 diff 门禁。
4. 明确无选区命令和复杂 unwrap 策略，防止英文占位或错误剥离污染源码。

### P1：入口一致性与扩展基础

1. 统一四种基础格式的菜单、palette、平台快捷键展示和中英文可发现性。
2. 实现多选区格式化、键盘/屏幕阅读器与高对比验收。
3. 建立 Markdown Preferences 的持久化、热重配与关闭回退架构；先以 `==highlight==` 做最小纵向切片，并写依赖/自研决策证据。

### P2：Parity 扩展

1. 在开关架构稳定后实现 sub/sup、emoji 短码自动完成；行内公式由数学专题交付，本专题只复用其 span 显隐模型。
2. 补 Smart Paste、Copy as Markdown/Plain Text 的细粒度兼容和跨平台快捷键。
3. 对极长单行、密集嵌套 span、大量可见 decoration 做独立性能优化与内存基准。

## 可执行验收测试

### Unit

- 语法表驱动：`*a*`、`_a_`、`**a**`、`__a__`、`***a***`、嵌套、相邻、转义、词内 `_`、不配对 marker、空白边界、中文标点、```` ``a`b`` ````、删除线及 code 内伪 marker。
- span 显隐纯逻辑：selection 在外部、内容中、左/右 marker、边界、跨两个 span、多 selection、composition 范围时返回精确 marker ranges。
- command：四种 wrap/unwrap、空选区、部分选中、嵌套、反向选择、多选区、一次 undo/redo、仅目标 changes；失败分支不改文档。
- preferences：开关解析、默认值、持久化迁移、关闭时字面回退；i18n key 双语覆盖。

### Integration

- 真实 EditorView 同行放置三个 span：光标在普通文本时三者隐藏，进入其中一个时仅该 span 展开；移动、选择和撤销后光标不跳。
- compositionstart → 中文输入 → compositionend 横跨 marker 边界，期间不替换组合 DOM，最终源码准确且一次可撤销。
- live/source 往返保留全文、selection、scroll anchor 与 undo history；复制阅读态文本和源码模式文本分别符合明确契约。
- 通过 editor command port、菜单 action 与 palette action 执行同一格式，得到同样 transaction 结果。

### E2E

- 键入中英文混排段落与四种基础 span，离焦截图确认 marker 隐藏；点击每个 span，逐一确认只展开目标；亮色、暗色和高对比各一组关键截图。
- 选中文本用 Ctrl/Cmd+B、Ctrl/Cmd+I、菜单、palette 创建/取消，随后 undo/redo；Windows 与 macOS 项目分别验证平台键位。
- 使用真实 clipboard 粘贴 Markdown plain text 与 HTML strong/em/code，验证契约化结果；复制后检查 `text/plain`，不依赖 DOM 视觉文本猜测。
- 保存到临时文件、关闭/重开，比较目标变化与未编辑区域；切换语言后格式入口和可访问名称同步变化。
- Playwright 结合可访问性快照检查编辑区朗读顺序、格式菜单名称和焦点恢复；如引入自动完成，覆盖方向键、Enter、Escape 与屏幕阅读器状态。

### Fixture

- 扩充 `emphasis.md` 的 delimiter-run、Unicode/CJK、CRLF、末尾换行、多反引号和非法字面矩阵；新增“编辑操作 + expected output”清单，而非只做未编辑 round-trip。
- 每个用例执行 open → 定位 → 编辑 → save → reopen → exact compare，并断言允许 diff 区间。`==`、sub/sup、emoji 在开关关闭时必须保持字面字节。

### Performance

- 性能命令单独运行，不与 E2E/build 并行：1MB/5MB 文档打开预算沿用项目门禁，另测 10,000 个可见 span 的初始 decoration、单字符输入、selection move 与 viewport scroll。
- 普通输入/光标移动 P95 目标尽量低于 16ms；selection-only 更新只重算受影响可见 span，记录 decoration 数、主线程耗时与峰值内存。
- 极长单行（至少 100KB）密集 span 单独设用例，验证不冻结；若无法达到预算，应先以可见区/增量索引优化，不把全文复制进 React store。

## 风险与未核实项

| 项目 | 状态 | 严重度 | 后续核实 |
|---|---|---|---|
| Typora 全部格式快捷键 | 证据不足 | 中 | 在 1.13.7 菜单逐项记录 Windows/macOS 标注 |
| Typora 同行多个 span 的精确展开边界 | 证据不足 | 高 | GUI 逐点点击内容、marker、间隙并录屏 |
| Typora 粗斜体嵌套展开顺序 | 证据不足 | 高 | 复核 `***x***` 与交错嵌套 |
| Typora 关闭 highlight/sub/sup 的确切回退 | 证据不足 | 中 | 开关前后重载同一文件并检查源码/视觉 |
| Typora HTML/Markdown paste 优先级 | 证据不足 | 高 | 从浏览器、纯文本和另一编辑器分别粘贴 |
| LumaMark CodeMirror parser 的完整 CommonMark delimiter 行为 | 证据不足 | 高 | 用规范例表和当前锁定版本执行 parser test |
| 隐藏 replacement 对复制与屏幕阅读器的影响 | 证据不足 | 高 | Windows Narrator/NVDA 与 clipboard 自动化 |
| selectionSet 重建 decoration 的密集 span 成本 | 证据不足 | 高 | 独立 perf benchmark，禁止凭感觉判断 |
| 无选区英文占位是否为既定产品行为 | 证据不足 | 中 | 产品决策后固化双语/源码策略 |

## 证据索引

- Typora 事实：`docs/product/typora-baseline/05-emphasis-and-inline-spans.md`；横切模型：`docs/product/typora-baseline/00-live-preview-model.md`。
- 产品范围：`docs/product/V1_VERSION_DESIGN.md`；总体差距入口：`docs/product/TYPORA_FEATURE_GAP_ANALYSIS.md`。
- 架构边界：`AGENTS.md`、`DEVELOPMENT_PROCESS.md`、`docs/architecture/DETAILED_ARCHITECTURE.md`。
- Parser/依赖：`src/editor/markdown/markdownLanguage.ts`、`src/editor/core/createEditorState.ts`、`package.json`、`pnpm-lock.yaml`。
- Live preview：`src/editor/wysiwyg/markdownDecorations.ts`、`src/editor/wysiwyg/wysiwyg.css`、`src/editor/wysiwyg/emphasisDecorations.ts`、`src/editor/capabilities/code-block/codeBlockDecorations.ts`。
- 命令与入口：`src/editor/commands/markdownFormatCommands.ts`、`src/editor/commands/markdownFormatKeymap.ts`、`src/editor/commands/editorCommandPort.ts`、`src/features/commands/createCommandModels.ts`、`src/app/controllers/useAppCommandModels.ts`。
- i18n/设置：`src/shared/i18n/locales/en.json`、`src/shared/i18n/locales/zh-CN.json`、`src/shared/i18n/i18n.test.ts`、`src/features/settings/SettingsDialog.tsx`。
- Unit/integration：`src/editor/wysiwyg/markdownDecorations.test.ts`、`src/editor/commands/markdownFormatCommands.test.ts`、`src/editor/commands/editorCommandPort.test.ts`、`src/editor/core/editorApi.test.ts`、`src/editor/capabilities/code-block/codeBlockCommands.test.ts`。
- E2E：`tests/e2e/editor-markdown.spec.ts`。
- Fixture：`tests/fixtures/markdown/emphasis.md`、`tests/fixtures/markdownFixtureManifest.ts`、`tests/fixtures/fixtureCoverage.test.ts`、`tests/fixtures/roundTrip.test.ts`。

本文为规划与竞争分析，不是实现完成声明。只有上述验收产生新鲜自动化证据后，才可把相应状态提升为“已实现”。
