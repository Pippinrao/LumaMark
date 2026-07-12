# 1. Callouts / GitHub Style Alerts 竞争体验与实现差距分析

## 2. 用途、范围与非目标

本文面向 LumaMark 的产品、编辑器与质量工程维护者，以 Typora 1.13.7 的公开 Callouts / GitHub Style Alerts 体验为基线，核对当前工作区中的真实代码、测试、fixture 与依赖锁定结果，形成可直接进入后续实现计划的差距、架构边界与验收门禁。本文只记录 `> [!TYPE]` 这一专题，不把规划文档写成已经交付的事实；代码、可执行测试和 fixture 的证据强度高于路线或差距规划。

范围包括五种 GitHub 风格类型 `NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`，键入与菜单创建、阅读态、焦点编辑态、源码模式、键盘、鼠标、粘贴、保存、设置门控、非法输入、嵌套内容、源码保真、i18n、可访问性和性能影响。普通引用只作为 Callout 的底层依赖与降级路径进行交叉分析；普通引用的完整行为属于 `03-blockquotes.md`。

非目标包括复述全部 CommonMark 引用规则、自定义 CSS 主题工程、HTML/PDF 导出视觉复刻、复制 Typora 的专有图标或品牌素材，以及在本文中直接决定尚未验证的 Typora GUI 细节。本文也不主张 Callout 已进入 V1：基线将其列为 Parity 阶段能力，是否调整产品优先级应由版本事实来源决定。

## 3. 执行摘要

LumaMark 当前 Callout 产品功能总体状态是 **未实现**。仓库没有任何 Callout 专属识别、渲染、设置或命令闭环；不能因为通用 Markdown 基础设施能够容纳这段文本，就把专题功能判为“部分实现”。已经存在的是底层通用能力：CodeMirror 6 持有唯一 Markdown 文本，默认 live preview 与 source mode 编辑同一份文档；`> [!NOTE]\n> body` 能作为普通引用文本输入，源码模式能显示原始字符，保存链路默认把编辑器文本交给文件写入。因此，用户手写或粘贴 Callout 源码后，通用编辑与未变换保存路径已经存在，但这只是后续实现基础。

这不等于体验追平。当前 `markdownLanguage()` 只启用 `@codemirror/lang-markdown` 的 GFM base；本次只读语法树探针把 `> [!NOTE]\n> body` 解析为 `Document(Blockquote(QuoteMark,Paragraph(Link(LinkMark,LinkMark),QuoteMark)))`，没有 Callout 类型节点。真实 live preview 路径只给整个范围添加普通 `lm-md-blockquote`，CSS 也只有统一引用样式。仓库没有 Callout capability、五类型模型、首行标签隐藏/展开规则、图标与色彩 token、Markdown 设置开关、Paragraph → Alert 命令、Callout fixture、专项 unit/integration/E2E 或性能门禁。

因此当前真实体验是“可编辑和保存这种文本，但只按普通引用显示”。功能存在与体验追平必须分开判断：源码容器与文件 round-trip 的基础能力存在；类型化识别、可发现的创建路径、专属阅读视觉、设置门控、可访问语义和边界质量尚未形成产品闭环。最优实现方向不是把正则和 DOM 拼装堆进现有 `markdownDecorations.ts`，而是在 `editor/capabilities/callout/` 建立薄 capability，以语法树限定的 Blockquote 范围解析首行标记，复用成熟 CodeMirror decoration、现有 Lucide 图标、i18next 和主题 token，并始终让 Markdown 原文保持唯一真实数据。

## 4. Typora 功能与完整体验基线

以下基线来自 `docs/product/typora-baseline/16-callouts.md`，并受其直接引用的 `00-live-preview-model.md` 与 `03-blockquotes.md` 约束。每条内容必须区分“Typora 已记录事实”“由横切模型推得但尚未做 Callout 专项观察的推论”和“LumaMark 质量要求”；不能用合理预期替代本机观察。

### 4.1 创建

- 在 Preferences → Markdown 启用 **Github Style Alert** 后，输入以引用块开头的 `> [!TYPE]`，其中 TYPE 为五种固定英文标识之一；内容续行仍使用 `>`。
- Typora 1.10 的公开说明给出 Paragraph → Alert 转换入口，并说明 View 菜单切换逻辑与 blockquote 同类。基线没有记录独立默认快捷键，因此不能声称存在专用快捷键。
- 已有段落转换后，落盘仍应是引用加标签的 Markdown，而不是私有节点、HTML 或二进制结构。

### 4.2 阅读态

- 开关启用且类型合法时，非焦点块呈现强调式提示块；类型图标、色条和具体色值受主题影响，但五种类型应可辨识。
- 横切 live preview 模型表明非当前块通常隐藏或弱化结构符号，呈现接近阅读结果的样式；但 Callout 的 `[!TYPE]` 精确显隐尚无专项本机记录。将该 marker 在阅读态隐藏或弱化是 LumaMark 对齐目标，不是已观察到的 Typora 像素事实。
- 图标与颜色不能成为唯一的信息通道；虽然 Typora 基线没有给出屏幕阅读器细节，LumaMark 的追平验收必须补上类型名称或等价可访问语义。

### 4.3 焦点编辑态

- 已记录事实是 Callout 可像引用块一样编辑；“光标进入后 `[!TYPE]` 以何种范围、时机和样式显露”尚未做专项本机观察。LumaMark 必须保证用户能从同一文档视图修改类型与原文，但不能把拟议交互写成 Typora 已确认细节。
- Return 的续写与退出继承普通引用模型。基线未逐步核实空 Callout、嵌套列表、围栏代码和多段内容的精确退出手势，这些属于未核实项，不能写成 Typora 已确认事实。
- 选区、IME 组合态、撤销重做和焦点移动不得因 marker replacement 产生跳动或无关源码变换；这是 LumaMark 一级质量门禁，Typora 基线没有逐项证明这些 Callout 边界。

### 4.4 源码模式

- source mode 显示完整 `>`、`[!TYPE]`、空引用行和内容；live preview 与 source mode 编辑同一份 Markdown。
- 模式切换不得改写大小写、空格、换行或未知类型，且撤销历史应保持连续；这是 LumaMark 源码保真要求。横切基线确认 Typora 的源码模式入口，但跨模式撤销与未知类型保真的全部细节仍未核实。

### 4.5 键盘

- 键入 `> [!NOTE]` 等是主创建路径；Callout 内 Enter、Backspace、方向键、Home/End、Tab/Shift+Tab 应与引用和嵌套内容规则协调。
- 没有已核实的 Callout 专用默认快捷键。产品实现不应擅自占用快捷键；如新增命令，先进入命令面板和菜单，再基于冲突审计决定快捷键。

### 4.6 鼠标

- 已核实入口是 Preferences 开关和 Paragraph / View 菜单。基线没有证明块内存在鼠标类型选择器、折叠按钮或拖拽手柄。
- LumaMark 若提供类型切换控件，必须是可选增强，不能把点击控件变成编辑源码的唯一方法。

### 4.7 粘贴

- 基线仅记录“可粘贴 GFM Alert 源码”，未系统核实 Typora 的 HTML、纯文本和多行剪贴板分支。LumaMark 的验收目标是保留 `> [!TYPE]` 结构、在开关启用时进入类型化预览，并且不凭普通单词误判。
- Smart Paste 的跨应用 HTML 转换属于横切能力，基线没有证明任意 HTML 提示框都应自动转换成 Callout，故不作为追平硬要求。

### 4.8 保存

- Typora 已记录的落盘形态是引用加标签的 Markdown，而不是专有二进制；基线没有提供逐字节 round-trip 观察记录。
- “渲染装饰不得进入文件、打开后不编辑再保存逐字节一致、编辑或撤销只产生动作对应的最小 diff”属于 LumaMark 源码保真验收要求，不应反向写成 Typora 已实测事实。

### 4.9 错误与边界

- 未开启 Preferences 时的确切 Typora 视觉、未知 `[!FOO]` 的降级、大小写是否接受、嵌套 Callout、列表/围栏和空内容行为均未完整核实。可靠策略是保留源码并降级为普通引用，不崩溃、不丢文，但在实测前不能宣称与 Typora 完全一致。
- Callout 并非 CommonMark 核心语法，跨解析器兼容性有限；错误提示不应阻止保存合法 Markdown 文本。
- 自定义 CSS 改显示文案在导出 HTML/PDF 中可能不保留，这是 Typora 基线记录的导出边界，本专题不扩展导出实现。

## 5. LumaMark 当前功能清单与证据

| 功能点 | 状态 | 精确代码证据 | 测试与 fixture 证据 |
|---|---|---|---|
| Markdown 唯一文本与默认 live preview | 已实现 | `src/editor/core/createEditorState.ts:41-52,97-122` 用 CodeMirror `EditorState` 持有 `doc`，默认 `displayMode = 'livePreview'`；`src/editor/core/editorApi.ts:78-80` 直接从 state 读取全文。 | `src/editor/core/createEditorState.test.ts` 与 `src/editor/core/editorApi.test.ts` 覆盖通用状态和 API；没有 Callout 专项断言。 |
| source mode 显示完整原文 | 已实现 | `src/editor/core/editorDisplayMode.ts:40-57` 在 source mode 只设置类名，不安装 live preview extensions；`src/editor/core/editorApi.ts:151-161` 通过 Compartment 重配置同一 EditorView。 | `src/editor/core/editorApi.test.ts:129-160` 验证模式切换不改通用文本与 undo history；`tests/e2e/editor-markdown.spec.ts:62-105` 对普通引用等基础语法验证源码存在，但均未包含 `[!TYPE]`。 |
| `> [!TYPE]` 文本可输入 | 已实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 使用成熟 GFM base；编辑器本身接受任意文本。只读探针显示该样本被解析为普通 `Blockquote` 内的 `Link`，而非 Callout。 | 当前没有专门测试；这项只证明文本容器能力，不证明 Callout 语义。 |
| 普通引用阅读样式 | 已实现 | `src/editor/wysiwyg/markdownDecorations.ts:226-233` 将所有 `Blockquote` 统一映射到 `lm-md-blockquote`；`wysiwyg.css:53-58` 提供统一左边线、弱化色和 padding。 | `markdownDecorations.test.ts:85-113` 断言普通 blockquote range；`editor-markdown.spec.ts:3-41` 断言普通引用可见。 |
| 普通引用 marker 焦点显隐 | 部分实现 | `src/editor/wysiwyg/markdownDecorations.ts:485-500` 隐藏非活动行的 `QuoteMark`，只用 selection head 所在行判断活动态，不理解 Callout 首行或整个活动块。 | `src/editor/wysiwyg/markdownDecorations.test.ts:387-443` 覆盖普通引用 marker 的活动行显示与非活动行隐藏；无 Callout 首行、跨行选区或 IME 场景。 |
| 五种类型识别 | 未实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 没有 parser extension；`src/editor/capabilities/editorCapability.ts:3` 的 capability ID 仅有 codeBlock、image、mermaid、table。 | `src` 与 `tests` 对五种标记的定点检索无结果。 |
| 类型化图标、色条与主题样式 | 未实现 | `src/editor/wysiwyg/wysiwyg.css:53-58` 只有单一 blockquote 样式；`src/editor/capabilities/index.ts:20-39` 未注册 Callout extension。 | 没有视觉测试、截图或 forced-colors 断言。 |
| Preferences 门控 | 未实现 | `src/features/settings/SettingsDialog.tsx:47-114` 只有外观、语言、图片页；`src/app/controllers/useSettingsModel.ts:4-26` 和 `src/app/stores/appStore.ts:24-44,47-118` 没有 Callout 设置。 | 中英文资源 `src/shared/i18n/locales/en.json:107-117`、`zh-CN.json:107-117` 没有 Callout 文案；无设置测试。 |
| Paragraph → Alert / 类型转换命令 | 未实现 | `src/editor/commands/markdownFormatCommands.ts:5-24` 命令联合没有 Callout；`src/features/commands/createCommandModels.ts:234-266` Paragraph 菜单只有 heading、list、rule、table、quote、code block 等既有项。 | `src/editor/commands/markdownFormatCommands.test.ts:130-203` 覆盖 heading/list/quote，不含 Callout；命令模型测试也没有对应项。 |
| 普通引用命令可作为底层能力 | 部分实现 | `src/editor/commands/markdownFormatCommands.ts:67-68,204-260` 能为非空选中行增加或移除一层 `>`，但不会插入、替换或验证 `[!TYPE]`。 | `src/editor/commands/markdownFormatCommands.test.ts:130-168` 覆盖普通 quote 增删和 undo。 |
| 粘贴 Callout 源码保留 | 部分实现 | 当前无 Callout paste handler，普通文本由 CodeMirror 直接插入；这意味着字符通常可保留，但没有类型化转换和粘贴专项错误处理。 | `tests/e2e` 没有 `[!TYPE]` 粘贴路径，不能证明 HTML/纯文本、多行和剪贴板差异。 |
| 保存原始 Callout 文本 | 部分实现 | `src/features/file-actions/fileActions.ts:126-169` 从 `editor.getDocumentText()` 取文本，默认 `prepareTextForSave` 原样返回后写入。 | `tests/fixtures/roundTrip.test.ts:8-70` 对清单内 fixture 逐字节比较；`fixturePaths.ts:5-26` 没有 callouts fixture，`blockquote.md:1-20` 也不含 `[!TYPE]`，所以只有通用保存机制证据。 |
| Callout 可访问语义 | 证据不足 | 当前 DOM 只有普通 CodeMirror decoration class，没有 Callout 类型对应的可访问名称、role 或说明。 | 无屏幕阅读器、键盘导航、高对比度、颜色非唯一通道专项测试。 |
| Callout 性能预算 | 证据不足 | 当前没有 Callout 解析或 decoration，自然也没有该专题增量扫描、视口限制或缓存实现。 | `tests/perf` 没有 Callout 密集文档场景；不能从通用编辑器预算推导专题无退化。 |

`package.json:37,45-50,55-57` 与 `pnpm-lock.yaml:20,44-80,300,550,659,1929,2135,2147` 表明项目声明并锁定 CodeMirror Markdown、Lezer Markdown、Radix、i18next、Lucide 和 markdown-it。`markdown-it` 当前只在 `src/editor/capabilities/table/tablePreviewExtension.ts:17-22` 用于表格单元格的行内渲染，不能被当作 Callout 已解析的证据。

## 6. 当前真实体验路径

1. 用户在默认 live preview 中键入或粘贴 `> [!NOTE]` 与后续 `> body`。
2. CodeMirror transaction 把字符写入唯一文档；GFM parser 识别外层 Blockquote，但把 `[!NOTE]` 当作普通链接样式结构，没有 Callout 类型。
3. 通用 WYSIWYG 插件给整个范围添加 `lm-md-blockquote`，非活动行隐藏 `>`；`[!NOTE]` 没有专属隐藏或标签组件，也没有 Note 图标和类型配色。
4. 光标进入某行时，只因“活动行”规则恢复该行的 `>`。系统不会按完整 Callout 范围展开结构，也没有类型选择器或非法类型反馈。
5. Paragraph 菜单只能把选中内容切为普通引用；用户必须手工补 `[!TYPE]`。Settings 中没有 GitHub Style Alert 开关。
6. 切到 source mode 后，用户能看到并编辑完整字符，因为 live preview decorations 被移除。
7. 保存时，文件动作读取当前全文并默认原样写入；只要没有其他保存预处理改变文本，Callout 字符会被保留。现有 fixture 门禁未用 Callout 样本证明这条路径。
8. 若类型未知、大小写不同、结构不完整或包含复杂嵌套，当前系统仍按普通引用/文本处理，不会丢弃字符；但产品没有显式降级契约与专项测试。

这条路径说明“能写这段 Markdown”和“具备 Callout 体验”是两个层次。前者可用，后者尚未追平。

## 7. 逐项差距矩阵

| ID | 行为点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|---|
| CA-01 | Preferences 门控 | 未实现 | 高 | 无法选择启用，也无法获得与 Typora 一致的显式降级路径。 | `SettingsDialog.tsx:47-114`；`appStore.ts:24-44,47-118` |
| CA-02 | 五种合法类型识别 | 未实现 | 阻断 | 所有 Callout 都只是普通引用，核心语义与视觉不存在。 | `markdownLanguage.ts:14-18`；语法树探针 |
| CA-03 | 类型化阅读态 | 未实现 | 阻断 | 扫读时不能区分信息、技巧、重要、警告和谨慎。 | `markdownDecorations.ts:226-233`；`wysiwyg.css:53-58` |
| CA-04 | 焦点进入时可编辑 marker | 未实现 | 高 | 通用 `>` 能按活动行显示，但 `[!TYPE]` 没有任何 Callout 专用展开规则；不能把普通引用能力计为 Callout 功能实现。 | `markdownDecorations.ts:485-500` |
| CA-05 | 键入创建 | 部分实现 | 中 | 可以手工键入源码，却没有完成识别后的视觉反馈。 | CodeMirror 文本输入；无 Callout parser |
| CA-06 | Paragraph → Alert | 未实现 | 高 | 鼠标/菜单用户不能把已有段落可靠转换成 Callout。 | `createCommandModels.ts:234-253`；`markdownFormatCommands.ts:5-24` |
| CA-07 | 类型切换与撤销 | 未实现 | 高 | 改类型只能手改源码，无法保证单 transaction、选区和撤销体验。 | 命令联合与测试均无 Callout |
| CA-08 | 源码模式完整显示 | 已实现 | 低 | 用户可回到原始字符编辑，这是后续实现的保真基础，但仍无 `[!TYPE]` 专项回归。 | `editorDisplayMode.ts:40-57`；`editorApi.ts:151-161`；`editorApi.test.ts:129-160` |
| CA-09 | 粘贴 GFM Alert 源码 | 部分实现 | 中 | 字符可插入，但不会进入类型化预览，HTML/多行粘贴未验证。 | tests 中无 `[!TYPE]` |
| CA-10 | 保存与重新打开 | 部分实现 | 高 | 通用链路倾向保留文本，但没有 Callout fixture 证明逐字节 round-trip。 | `fileActions.ts:126-169`；`fixturePaths.ts:5-26` |
| CA-11 | 未知类型降级 | 证据不足 | 中 | 现状看似普通引用，但没有产品契约；未来 parser 容易误删或误渲染。 | 基线标记未核实；当前无类型层 |
| CA-12 | 未开启时表现 | 证据不足 | 中 | Typora 精确表现未实测，无法定义像素级追平标准。 | `typora-baseline/16-callouts.md` 未核实清单 |
| CA-13 | 列表、代码、多段与嵌套 | 证据不足 | 高 | 复杂 Callout 可能出现范围截断、marker 隐藏错位或命令冲突。 | 只有普通 `blockquote.md` fixture |
| CA-14 | i18n | 未实现 | 中 | 设置、菜单、类型可访问名称无法双语呈现。 | 两份 locale 无 Callout key |
| CA-15 | 可访问性 | 证据不足 | 高 | 仅靠颜色或装饰可能使屏幕阅读器和高对比度用户无法识别类型。 | 无语义实现与专项测试 |
| CA-16 | 密集文档性能 | 证据不足 | 中 | 若未来全量正则扫描，每次输入可能增加延迟；当前无预算证明。 | 无 capability 与 perf case |

## 8. 根因与架构影响

1. **语法层只有通用 GFM。** 当前 Lezer 树没有 Callout 节点，`[!NOTE]` 甚至呈现为普通 Link 结构。若直接依据 Link 节点着色，会误伤普通链接；识别必须以 Blockquote 的第一条内容行和完整 marker 语法为边界。
2. **live preview 基础层职责已经偏重。** `markdownDecorations.ts` 同时处理多种基础语法与 marker 隐藏。把五类型解析、图标 widget、设置读取和错误降级继续塞入该文件，会扩大热路径、测试矩阵和跨专题耦合。
3. **能力注册缺少 Callout 边界。** capability 系统已经为 code block、image、table、Mermaid 提供模块化接入，Callout 应沿用该方向，而不是在 React shell 或全局 store 中持有文档文本。
4. **缺少 Callout 设置契约与通用设置持久化边界。** `appStore` 当前没有 Callout 开关；定点检索只发现 recent files、panel layout 与 recovery draft 等各自的 localStorage 存储，没有可复用的 Settings 持久化服务。Callout 设置若直接散落在 Dialog、store 和 editor props，会形成三处事实来源；应先定义稳定设置契约和热重配置路径。
5. **命令层只有普通引用前缀操作。** Callout 转换需要处理已有引用、空行、多段选区、合法类型替换、取消 Callout但保留引用/正文等语义，不能简单复用 `prefixSelectedLines` 后再字符串拼接。
6. **源码保真风险集中在 decoration 与命令。** 阅读态应只加 decoration；任何“修复”非法 marker 的自动格式化都会改变用户原文。转换命令必须产生最小、可撤销的 transaction，并明确空白策略。
7. **性能影响位于编辑器热路径。** 每次 transaction 对整篇文档用正则搜索所有 `[!TYPE]` 不符合大文档目标。应利用语法树变更范围、可见区和增量 decoration，仅对受影响 Blockquote 重算。

当前证据不支持为 Callout 新增 Rust 解析或系统能力：识别、装饰、命令和设置热重配置均可留在前端编辑器边界，文件服务继续保存唯一 Markdown 文本。若后续 benchmark 证明前端增量解析无法满足预算，再以测量结果复审边界；若改变通用源码保真或引入主要 parser 依赖，则需要单独决策记录。

## 9. 详细改进方案

### 9.1 模块归属

- 在 `src/editor/capabilities/callout/` 建立 `calloutTypes.ts`、`calloutParser.ts`、`calloutDecorations.ts`、`calloutCommands.ts` 与 `createCalloutCapability.ts`。类型模块只定义五种合法值和结构范围；parser 从 Lezer Blockquote 边界读取首行，不复制完整 Markdown parser。
- 在 `editorCapability.ts` 增加 `callout` ID，在 `capabilities/index.ts` 注册扩展与命令。React UI 只调用稳定 command port；`features/settings` 只管理用户选择，不读取文档全文。
- 将“当前活动结构范围”做成可复用 editor 查询，而非继续以活动行判断；普通引用与 Callout 可共享最内层 Blockquote `{from,to,depth}`，但类型化 decoration 保持独立。

### 9.2 成熟依赖优先

- 继续使用 `@codemirror/lang-markdown` / `@lezer/markdown` 提供 Blockquote 边界和增量语法树，使用 CodeMirror `ViewPlugin`、`Decoration.mark`、`Decoration.line` 或轻量 widget；不自研编辑器、树解析器或 DOM diff。
- 图标复用已安装的 `lucide-react`，例如信息、灯泡、重要、警告、谨慎的通用图形，但不得复制 Typora 专有素材。设置控件优先采用项目既有 Radix 体系；若需要 Switch，应先评估对应成熟 Radix 组件，不手搓基础交互。
- 不因 Callout 引入新的全量 Markdown renderer。现有 `markdown-it` 仅服务表格行内渲染；除非原型和 benchmark 证明 Lezer 范围识别不足，否则不扩展依赖。

### 9.3 数据流与设置

1. 持久化设置服务提供 `githubStyleAlertsEnabled: boolean`，默认值应由产品决策明确；UI 通过 feature model 修改。
2. app 编排把小型布尔设置传入 editor API，Editor API 通过独立 Compartment 热重配置 Callout capability，不重建 EditorView、不复制 Markdown 全文。
3. parser 只从 editor state 派生 `{type, markerFrom, markerTo, blockFrom, blockTo}`；派生状态不进入 Zustand。
4. 开关关闭时不删除源码，只移除 Callout decoration 并回到普通引用呈现。开关打开时对可见和变更范围增量识别。

### 9.4 源码保真与交互

- 合法识别条件应严格限定为 Blockquote 第一内容行的 `[!TYPE]`，TYPE 使用已确认的五值；未知值、缺右括号、标签不在首行、普通正文中的 `[!NOTE]` 一律保留并降级。
- 阅读态隐藏或弱化 marker，显示本地化类型名称与图标；焦点进入该 Callout 的 marker 行或执行编辑命令时恢复原文。多行选区穿过 marker 时不得生成不可复制的幽灵文本。
- 转换命令一次 transaction 完成：普通段落先转换为引用并插入首行 marker；普通引用只插入 marker；已有合法 Callout 切换类型只替换 TYPE；取消时由明确命令决定“保留普通引用”或“转为正文”，两个动作不可混为一个隐式切换。
- 粘贴只插入剪贴板提供的 Markdown；识别由 parser 派生。不要在 paste handler 中重写大小写或空格。

### 9.5 i18n 与可访问性

- 中英文资源同步增加设置页标题/说明、启用标签、五种类型显示名、命令名、非法类型非阻断提示和 tooltip。源码 TYPE 保持英文固定值，显示名称可本地化，禁止拼接句子片段。
- decoration 根范围提供可识别的类型类或 data 属性；图标 `aria-hidden`，可见类型文本保留。若 widget 进入可访问树，应提供稳定标签，避免重复朗读正文。
- 亮/暗主题和 forced-colors 下均需非颜色区分：图标、类型文本、边线形态至少保留两种线索。鼠标类型选择器若存在，必须有键盘等价路径、焦点顺序和 Escape 行为。

### 9.6 错误处理

- 非法或未知 TYPE 不弹阻断对话框，不丢文本，降级为普通引用；可在编辑态提供本地化、可关闭的轻提示。
- parser 或 decoration 异常应记录可诊断信息并安全退回普通引用，不能用静默 catch 掩盖持续错误。设置加载失败时保留明确默认值并向应用错误通道报告。
- 保存错误继续走现有文件错误模型；Callout 层不得吞并或重新包装文件 IO 错误。

## 10. P0 / P1 / P2 分阶段计划

### P0：保真识别与最小闭环

1. 固化五类型、合法/非法 marker、普通引用降级和活动范围的纯逻辑测试。
2. 建立 Callout capability，以 decoration 实现五类型阅读态和 marker 焦点展开；不改原文。
3. 增加独立 `callouts.md` fixture，覆盖五类型、未知类型、多段、中文、列表、围栏、嵌套和尾部无换行，并进入逐字节 round-trip。
4. 增加源码模式与 undo/redo 集成测试，确认开关重配置不改 doc。

### P1：创建、设置与可访问体验

1. 建立可持久化 Markdown 设置契约和 Settings → Markdown 页面，支持热重配置；中英文 i18n 同步。
2. 增加 Paragraph → Alert、五类型命令与普通引用互转；命令面板和菜单接线，单 transaction 保证最小 diff。
3. 完成键盘、鼠标、粘贴、IME、跨行选区、屏幕阅读器与 forced-colors 验收。
4. 增加真实浏览器 E2E 和亮/暗主题截图门禁。

### P2：边界打磨与追平复核

1. 在 Typora 1.13.7 本机复核开关关闭、未知类型、大小写、空块、嵌套 Callout、列表和围栏，收敛差异契约。
2. 基于真实写作测试调整间距、图标、色彩和深层嵌套视觉，但保持类型 token 与主题解耦。
3. 增加密集 Callout 大文档独立性能基准，并根据测量决定是否需要范围缓存；不与其他重 CPU 门禁并行运行。
4. 评估导出对 Callout 语义与本地化显示名的处理，另立导出专题，不污染编辑器源码模型。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 开关启用时，五种合法源码各产生对应类型 decoration、图标和可见类型名；开关关闭时同一 doc 逐字符不变并呈普通引用。
2. 光标离开块时 marker 隐藏或弱化；进入 marker/活动 Blockquote 时原文可编辑；跨行选区、复制、中文 IME、撤销重做不跳位、不丢字符。
3. source mode 始终显示完整源码；live preview ↔ source 往返后 `state.doc.toString()` 完全相同，undo 栈连续。
4. Paragraph → Alert、普通引用 → Alert、类型切换和取消各自只产生预期 diff，并可一次撤销。
5. 未知 TYPE、残缺 marker、非首行 marker、普通正文 `[!NOTE]` 安全降级，不误渲染、不阻止保存。
6. `callouts.md` 打开后不编辑再保存逐字节相同；执行指定 mutation 后只有期望行变化。
7. 中文和英文设置、菜单、类型名、提示均存在；i18n key 对称检查通过。
8. 亮色、暗色和 forced-colors 下，五类型不只依赖颜色区分；键盘可到达所有新增控件，焦点清晰。
9. 1MB 密集 Callout fixture 打开耗时小于 300ms、普通单字符输入 transaction 尽量小于 16ms、滚动接近 60 FPS；以 capability 关闭的同一 fixture 作为 A/B 基线，报告 p50/p95 与内存峰值，不能只写“无明显退化”。

### 11.2 Unit

- `calloutParser.test.ts`：五类型、大小写、空格、残缺括号、未知类型、非首行、nested Blockquote、lazy continuation、相邻引用、CRLF 与尾部无换行。
- `calloutCommands.test.ts`：段落/引用/已有 Callout 转换，空行、多选区、反向选区、嵌套、类型切换、取消、selection mapping、单次 undo。
- `calloutDecorations.test.ts`：类型 class、marker 范围、活动块展开、非活动块隐藏、代码围栏内不误识别、视口外不构建 widget。
- 设置和 i18n 单测：默认值、持久化迁移、热重配置、两语言 key 对称、类型显示名完整。

### 11.3 Integration

- EditorApi 载入含五类型文档，切换设置与显示模式，断言 doc、selection、history 和 decoration。
- CodeMirror keymap 与 Callout 组合：Enter 续写、空引用退出、Backspace 降级、Tab 嵌套、IME composition 期间不提前替换 marker；跨 marker 选区执行 Copy 后，Markdown/纯文本剪贴板结果符合明确契约，复制动作不改变 doc、selection 或 undo history。
- 文件动作执行 open → edit body/type → save → reopen，比较期望源码和 dirty revision；保存失败时正文不变且错误可见。

### 11.4 E2E

- 从空文档键入五种 Callout，离焦后检查类型化阅读态；重新聚焦检查 marker；菜单转换、类型切换、撤销和 source mode 往返。
- 粘贴合法/非法 GFM Alert、多段中文、列表和围栏；分别覆盖普通 Paste 与 Paste as Plain Text，保存并重新打开。再覆盖跨 Callout 选区的默认 Copy、Copy as Markdown/Plain Text（若产品提供）并断言剪贴板 MIME/文本契约，避免只验证视觉文本。
- Settings 开关在同一文档即时生效且不改源码；重启后按持久化契约恢复。
- 亮/暗主题截图、键盘-only 操作、可访问名称、高对比度抽检。视觉断言避免仅比较脆弱色值，应同时检查类型 class、文本和关键布局。

### 11.5 Fixture

- 新增 `tests/fixtures/markdown/callouts.md`，进入 `fixturePaths.ts`；覆盖五类型、未知类型、残缺 marker、多段、嵌套列表、代码围栏、链接、中文、相邻普通引用、CRLF 派生样本。
- 保留现有逐字节 round-trip，并增加 mutation fixture：输入、动作、期望输出和允许 diff。普通 `blockquote.md` 继续验证降级依赖，不能替代 Callout fixture。

### 11.6 Perf

- 单独运行 `pnpm perf:bench`，增加普通文档与密集 Callout 文档 A/B：初次解析、单字符输入、滚动、开关重配置、source/live 切换和内存峰值。
- 预算沿用项目门禁：普通输入尽量小于 16ms；1MB 打开小于 300ms、5MB 小于 1s 的总目标不因 Callout 明显退化。基准必须串行、独立运行，失败后单独复现再判断。
- 记录 decoration 数量、重算范围与 transaction duration；若每次编辑扫描全文即判为架构问题，而不是靠 debounce 掩盖。

## 12. 风险与未核实项

- Typora 开关关闭时是否原样显示 `[!NOTE]`、未知 `[!FOO]` 的精确视觉、TYPE 大小写、空 Callout、嵌套 Callout、列表/围栏编辑手势尚未本机对比；这些只可写为待复核风险，不能作为已确认差异。
- 本次没有启动 LumaMark UI、没有运行 Vitest、Playwright、fixture round-trip 或性能基准；报告中的现状结论来自代码、测试文件、fixture、依赖清单、定点检索和一次只读 Node 语法树探针。测试文件证明已有门禁意图，不等于本次执行结果。
- 工作树包含大量既有未提交改动，当前证据反映 2026-07-12 工作区快照，后续实现合并前需重新检索，避免与并行中的编辑器和文档改动冲突。
- `blockquoteDecorations.ts` 存在但全仓没有调用方；未来 Callout 不应误接这条正则痕迹，应以真实 `markdownDecorations.ts` / capability 路径为准。
- 本次对 `persist(`、`localStorage`、`saveSettings`、`loadSettings` 等定点检索未发现通用 Settings 持久化服务；只发现 recent files、panel layout 与 recovery draft 的专题存储。并行工作可能改变这一快照，Callout 落地前仍需复检，避免新增第二套持久化事实来源。
- GitHub Alerts 与 Typora 的显示细节不是完全标准化协议。LumaMark 应首先保证源文兼容和稳定降级，再追平视觉；像素风格不能凌驾于源码保真、IME、撤销和大文档性能。

## 13. 证据索引

### 竞品与横切基线

- `docs/product/typora-baseline/16-callouts.md:1-101`：Typora 1.13.7 Callout 语法、设置门控、阅读/编辑、保存和未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md:1-132`：live preview、焦点模型、源码模式、键盘、粘贴、IME 与 marker 显隐横切契约。
- `docs/product/typora-baseline/03-blockquotes.md:1-93`：Callout 底层引用创建、续写、阅读态、源码与边界。

### 真实实现

- `src/editor/markdown/markdownLanguage.ts:14-18`：当前 GFM Markdown parser 配置，无 Callout extension。
- `src/editor/core/createEditorState.ts:41-52,97-122`：唯一文档状态、默认 live preview 与扩展装配。
- `src/editor/core/editorDisplayMode.ts:40-57`：source / live preview Compartment 分支。
- `src/editor/core/editorApi.ts:78-80,151-161`：读取唯一文本与同 EditorView 模式切换。
- `src/editor/capabilities/index.ts:20-49`、`editorCapability.ts:3-20`：现有 capability 与命令边界，没有 Callout。
- `src/editor/wysiwyg/markdownDecorations.ts:183-233,485-500`：语法树 decoration、普通 Blockquote 样式与活动行 marker 隐藏路径。
- `src/editor/wysiwyg/wysiwyg.css:53-58`：单一普通引用视觉。
- `src/editor/commands/markdownFormatCommands.ts:5-24,67-73,204-260`：命令联合与普通引用前缀操作。
- `src/features/commands/createCommandModels.ts:234-287`：Paragraph / View 菜单，无 Alert 转换。
- `src/features/settings/SettingsDialog.tsx:47-114`、`src/app/controllers/useSettingsModel.ts:4-26`、`src/app/stores/appStore.ts:24-44,47-118`：当前设置 UI、模型与 store，无 Alert 开关。
- `src/features/file-actions/fileActions.ts:126-169`：从 editor 取全文、预处理并写入的保存路径。
- `src/shared/i18n/locales/en.json:81-117`、`zh-CN.json:81-117`：普通引用、源码和现有设置文案，无 Callout key。

### 测试、fixture 与依赖

- `src/editor/wysiwyg/markdownDecorations.test.ts:85-113,247-263,387-443`：普通引用识别、代码块排除和通用 marker 显隐。
- `src/editor/core/editorApi.test.ts:129-160`：模式切换保留通用文本与 undo history；样本不含 Callout。
- `src/editor/commands/markdownFormatCommands.test.ts:130-203`：普通引用/list 命令与 undo，无 Callout。
- `tests/e2e/editor-markdown.spec.ts:3-105`：普通引用视觉与 source mode 路径，无 Callout。
- `tests/fixtures/fixturePaths.ts:5-26`：fixture 清单没有 Callout 专项。
- `tests/fixtures/roundTrip.test.ts:8-70`：清单内 fixture 的逐字节 round-trip 机制。
- `tests/fixtures/markdown/blockquote.md:1-20`、`comprehensive.md:1-30`：普通引用复杂样本，不含 `[!TYPE]`。
- `package.json:37,45-50,55-57` 与 `pnpm-lock.yaml:20,44-80,300,550,659,1929,2135,2147`：CodeMirror、Lezer、Radix、i18next、Lucide、markdown-it 的声明与锁定证据。
- 只读 Node 探针：`markdownLanguage.parser.parse('> [!NOTE]\\n> body')` 输出 `Document(Blockquote(QuoteMark,Paragraph(Link(LinkMark,LinkMark),QuoteMark)))`，直接证明当前语法树没有 Callout 类型节点；该探针不是自动化测试。
