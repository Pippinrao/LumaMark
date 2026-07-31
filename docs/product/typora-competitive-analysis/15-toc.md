# 文内目录（TOC）竞品差距分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - protected-source 分析现识别独占一行且不区分大小写的 `[toc]`，阻止通用链接装饰误处理；单元与 UI 测试证明标记在 live preview 中保持可见。
> - 这只是安全降级，不是文内 TOC。共享增量 heading identity、目录生成、自动更新与键盘/鼠标导航仍在 Next，因此正文中的“被显示成普通链接”推断已过期，但“没有 TOC 语义”仍成立。

## 用途、范围与非目标

本文用于回答一个限定问题：LumaMark 与 Typora 1.13.7 的文内 `[toc]` 目录体验相比，当前有哪些真实能力、哪些只是侧栏大纲的相邻能力、距离可验收追平还差什么。范围覆盖创建、阅读态、焦点编辑态、源码模式、键盘、鼠标、粘贴、保存、错误与边界，以及实现该能力所需的标题索引、源码保真、i18n、可访问性和性能约束。

非目标包括侧栏 Outline 本身的完整竞品分析、HTML/PDF 导出目录、任意 Markdown 静态目录生成器、标题专题的全部格式行为，以及未经证据支持的 Typora 私有实现推测。本文不修改产品代码，也不把路线图、设计稿或旧差距汇总中的计划描述当成“功能已存在”的证据；规划文档只用于核对架构约束与阶段意图。

## 执行摘要

结论是：LumaMark 当前没有文内 TOC 功能，不能把已有侧栏大纲称为体验追平。现有通用编辑与文件链路可以输入、切换源码模式并保存字面 `[toc]`；粘贴含该标记的专项行为尚无测试证据。即使这些通用路径可用，它们也不是 TOC 语义。仓库使用的 Lezer Markdown 解析器会把当前样例 `[toc]` 解析成普通 `Link`；通用 WYSIWYG decoration 随后为整段添加链接样式，并在非活动行隐藏方括号，因此按代码路径推断，live preview 会显示一个带下划线的 `toc` 文本，而不是由标题生成的目录。该推断尚缺真实 UI 专项断言，但可以确定当前没有自动更新、文内层级列表、点击跳转、空态、专用焦点模型或专项错误处理。

当前侧栏大纲提供了一部分可复用基础：它提取 ATX H1–H6、忽略 fenced code 内伪标题、120ms debounce、虚拟化渲染、点击后滚动并聚焦编辑器，同时已有中英文空态和大文档性能测试。然而它仍是 React feature 层对全文字符串的独立正则扫描，只识别 ATX 标题；它与 CodeMirror 的增量语法树、Setext 标题和文内锚点身份并不统一。直接复制这套扫描逻辑到 TOC 会产生第二套甚至第三套标题定义，并在每次标题编辑后增加全文读取与重建成本。

建议把 TOC 作为 `editor/capabilities/toc/` 的独立编辑器能力，以现有 `@lezer/markdown` 扩展和 CodeMirror `WidgetType`/decoration 为成熟基础设施，不新增 Markdown 解析依赖。先建立共享、增量、只读的 heading identity，再让侧栏 Outline 和文内 TOC 消费同一轻量快照。Markdown 源文始终保留 `[toc]`，生成列表只存在于派生视图；P0 先完成语法、渲染、自动更新、源码保真和专项测试，P1 补导航、焦点、可访问性和统一标题身份，P2 再处理大量标题、跨平台与 Typora 未核实细节。

## Typora 功能与完整体验基线

以下基线以 `docs/product/typora-baseline/15-toc.md` 和其直接引用的 `00-live-preview-model.md` 为仓库事实入口，并用 Typora 官方 Markdown Reference、Quick Start、Shortcut Keys 交叉核对。明确标为未核实的项目不能转写成 Typora 已有行为。

### 创建

官方 Markdown Reference 明确说明：在独立位置输入 `[toc]` 并按 `Return`，会创建 “Table of Contents” 区块；该目录抽取文档中的标题，并在继续添加内容时自动更新。公开文档没有给出菜单、拖拽或独立默认快捷键创建路径。`[toc]` 尚未通过 `Return` 确认时的精确触发时机、大小写容忍、前后空格和同一文档多个 TOC 块行为均未核实。

### 阅读态

阅读态的核心不是隐藏一对方括号，而是把源文标记投影为由文档标题生成的目录列表。官方说明确认“抽取所有标题”和“自动更新”；基线中的本机弱证据显示 `[toc]` 所在位置出现生成的标题项而非字面标记。目录项的确切 DOM 语义、缩进像素、编号样式、超长标题折行和无标题空态仍未完成 GUI 复核。

### 焦点编辑态

Typora 的横切 live preview 模型是：非当前块显示阅读结果，当前块在需要编辑时露出源码或专用输入 UI。但官方 TOC 小节没有逐步说明点击目录块后是否直接露出 `[toc]`、是否先选中整个块、方向键如何进入和退出、`Backspace`/`Delete` 如何删除。因此，本专题只能确认 TOC 是可删除的文档块，不能声称其精确焦点键序已经核实。

### 源码模式

基线本机观测确认：切换到源码模式后仍是字面 `[toc]`，不是展开后的链接列表；`Ctrl+S` 后磁盘也仍保留 `[toc]`。这与横切模型一致：live preview 和源码模式编辑同一份 Markdown，生成目录属于派生视图。Windows/Linux 使用 `Ctrl+/` 切换源码模式，macOS 使用 `Command+/`。

### 键盘

创建的唯一已确认键序是 `[toc]` 后按 `Return`。保存沿用 `Ctrl+S`/`Command+S`，源码模式沿用 `Ctrl+/`/`Command+/`。官方快捷键表未列出 TOC 专用快捷键。目录项之间能否用 `Tab`、方向键或文档阅读光标导航，以及焦点进入后 `Enter` 是否跳转标题，证据不足。

### 鼠标

官方 TOC 小节没有明确写出单击目录项是否跳转标题，也没有说明右键菜单。虽然目录的产品意义通常包含导航，但不能用常识替代 Typora GUI 证据。鼠标点击、光标落点、悬停反馈和多级项目命中范围均列入未核实项。

### 粘贴

Typora 的通用粘贴链路允许把 Markdown 源文作为纯文本粘贴；因此含独立 `[toc]` 的源码可进入文档。普通 `Paste` 默认还可能执行 Smart Paste，而 `Ctrl+Shift+V`/`Command+Shift+V` 是粘贴为纯文本。粘贴完成后是否立即生成 TOC，还是必须将光标置于该行并再按 `Return`，公开证据不足。

### 保存

本机 1.13.7 观测表明保存前后 `[toc]` 标记保持不变，生成项不写回磁盘。可据此建立对齐底线：打开、编辑标题、保存、重新打开后，除用户主动编辑外不得把 `[toc]` 展开成静态链接、规范化空白或重排无关文本。

### 错误与边界

已确认的行为只有“标题变化后预览自动更新”和“源码保留标记”。无标题文档的空态、`[toc]` 位于 fenced code、行内句子、引用、列表项或表格单元格时是否触发，多个 `[toc]` 是否同步更新，重复标题如何显示和跳转，均证据不足。Typora 官方说明说目录抽取所有标题，但未在 TOC 小节细分 ATX 与 Setext；因此不能把 Setext 收录当成已经逐项核实的 GUI 事实。

## LumaMark 当前功能清单

| 能力 | 状态 | 代码、测试与 fixture 证据 | 事实判定 |
|---|---|---|---|
| 输入 `[toc]` 字面文本并换行 | 已实现 | `src/editor/core/createEditorState.ts:97-120` 装配 CodeMirror 文档与默认键位；`tests/e2e/app-shell.spec.ts:182-195` 已证明中英文和换行可输入，但没有 TOC input handler 或命令 | 通用文本输入存在，但 `Return` 不创建 TOC 语义块；功能存在不等于体验追平 |
| `[toc]` 语法识别 | 未实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 仅启用 GFM base 与代码语言；只读解析探针得到 `Document(Paragraph(Link(LinkMark,LinkMark)),ATXHeading1(HeaderMark))` | 当前被识别为普通链接，不是 TOC 节点 |
| 文内 TOC capability | 未实现 | `src/editor/capabilities/editorCapability.ts:3` 的能力 ID 只有 `codeBlock/image/mermaid/table`；`src/editor/capabilities/index.ts:20-28` 的组装列表也只有四项 | 没有 detection、state、widget、command 或 lifecycle |
| live preview 生成目录 | 未实现 | `src/editor/wysiwyg/markdownDecorations.ts:234-241` 把 `Link` 映射为 `lm-md-link`；`src/editor/wysiwyg/wysiwyg.css:160-164` 添加强调色与下划线 | 按当前代码路径会套用链接样式而不是生成标题列表；尚缺真实 UI 专项断言 |
| 非焦点隐藏方括号 | 已实现 | `src/editor/wysiwyg/markdownDecorations.ts:453-493` 在非活动行隐藏 `LinkMark`；`wysiwyg.css:210-214` 把 hidden mark 压缩为零宽 | 这是通用链接外观，不能证明 TOC 存在 |
| 源码模式显示 `[toc]` | 已实现 | `src/editor/core/editorDisplayMode.ts:42-57` 在 source 模式不加载 live preview capability；`editorApi.ts:78-79` 直接读取 CodeMirror 文档字符串 | 字面源文可见，符合保真方向 |
| 粘贴含 `[toc]` 的文本 | 证据不足 | 仓库没有 TOC 粘贴专项处理或测试；`createEditorState.ts:114-119` 的 keymap 不是剪贴板行为证据 | CodeMirror 通常可接收纯文本粘贴，但当前只能把它作为待验收的通用路径，不能升级为专题实现证据 |
| 保存 `[toc]` 字面源文 | 部分实现 | `src/features/file-actions/fileActions.ts:139-141` 读取当前文档后写出；默认 `prepareTextForSave` 在 `:95` 原样返回；`tests/fixtures/roundTrip.test.ts:8-67` 验证通用 fixture 精确字节 round-trip | 通用保存路径支持保真，但 fixture 集合没有 `[toc]`，不能声称专项验证 |
| 标题提取 | 部分实现 | `src/features/outline/outlineParser.ts:15-51` 用正则提取 ATX H1–H6并忽略 fenced code；`outlineParser.test.ts:5-58` 覆盖层级、位置与 fenced code | 可服务侧栏大纲，但漏掉 `headings.md:15-19` 已存在的 Setext fixture |
| 标题文本清洗与 ID | 部分实现 | `outlineParser.ts:78-99` 去除部分 inline 标记并生成 Unicode slug、重复项后缀 | 是侧栏私有算法，尚未成为编辑器、内部链接与 TOC 的共享契约 |
| 标题变化后刷新侧栏大纲 | 已实现 | `useDebouncedOutline.ts:9-31` 在 120ms 后读取全文并解析；`useDebouncedOutline.test.tsx:27-44` 验证突发请求只读取一次 | 有自动刷新基础，但仍是全文字符串扫描且不是文内 TOC 更新 |
| 侧栏层级列表与点击跳转 | 已实现 | `OutlinePanel.tsx:25-35` 使用 TanStack Virtual；`:72-83` 用按钮触发选择；`editorCommandPort.ts:78-85` 滚动、选区并聚焦 | 是相邻能力，不位于 `[toc]` 源文位置 |
| 侧栏 i18n 与空态 | 已实现 | `src/shared/i18n/locales/en.json:105-106`、`zh-CN.json:105-106`；`OutlinePanel.tsx:39-48,89-90` | 只有 Outline 文案，没有 TOC 名称、空态或错误文案 |
| TOC unit/integration/E2E/fixture/perf | 未实现 | 对 `src`、`tests`、`docs`、`package.json`、`pnpm-lock.yaml` 的定点检索未找到生产 TOC 实现或专项测试；`tests/fixtures/fixturePaths.ts:5-25` 不含 `toc.md` | 测试盲区使通用保存能力不能升级为 TOC 体验证据 |

现有相关测试的真实状态：本次运行 `pnpm exec vitest run src/features/outline/outlineParser.test.ts src/features/outline/useDebouncedOutline.test.tsx src/features/outline/activeOutlineHeading.test.ts --exclude tests/perf/**`，结果为 3 个测试文件、5 个测试通过。该结果只证明侧栏大纲的现有单元行为，不证明 `[toc]` 功能。

## 当前真实体验路径

1. 用户在 live preview 中键入 `[toc]`。CodeMirror 接受这五个字符，Lezer 当前把它们视为一个未验证引用目标的 `Link`，没有产生 TOC block。
2. 光标仍在该行时，通用 active-line 规则不会隐藏 `LinkMark`，用户看到字面 `[toc]`，整段可能带链接样式。
3. 用户按 `Return` 后只发生普通文本换行。光标离开原行后，通用 decoration 隐藏 `[` 与 `]`，留下带强调色和下划线的 `toc`；页面不会出现 H1–H6 层级列表。
4. 用户新增、删除或重命名标题时，壳层会安排侧栏 Outline 在 120ms 后读取完整文档并刷新。文内 `toc` 文本没有订阅标题快照，也不会变化。
5. 用户点击侧栏大纲项目时，应用会把选区移动到标题起始位置、滚动并聚焦编辑器；点击文内 `toc` 则没有 TOC 导航处理。
6. 用户切换源码模式时看到完整 `[toc]`。这一点与目标保真方向一致，但只是因为源码模式不加载 live preview decoration。
7. 用户粘贴含 `[toc]` 的 Markdown 后，预期仍只会走通用文本编辑路径，因为仓库没有 TOC detection 或 paste handler；但当前没有剪贴板专项测试，连“字面文本完整进入文档”也必须保留为证据不足，不能冒充已验证体验。
8. 用户保存时，文件动作从 CodeMirror 读取文本并写出。没有图片草稿路径需要迁移时，`[toc]` 通常会原样保留；由于缺少 TOC fixture 和专项保存断言，此处只能判定为通用路径支持，不能判定体验已追平。

## 逐项差距矩阵

| 行为点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| `[toc]` + `Return` 创建语义块 | 未实现 | 阻断 | 核心入口不可用，用户得到普通文本 | capability 列表无 TOC；解析探针为 `Link` |
| 阅读态显示标题层级列表 | 未实现 | 阻断 | 文档内不能阅读或分享可见目录 | 通用 decoration 只生成链接样式 |
| 标题增删改后自动更新 | 未实现 | 阻断 | 即使手工模拟目录也会立刻过期 | 只有侧栏 `scheduleOutlineRefresh`，无 TOC state |
| 源文和保存保留 `[toc]` | 部分实现 | 高 | 通用保存大概率保真，但缺专项回归会留下展开写回或规范化风险 | `fileActions.ts:95,139-141`；fixture 无 TOC |
| 源码模式显示完整标记 | 已实现 | 低 | 用户可直接编辑和删除字面标记 | `editorDisplayMode.ts:42-57` |
| 焦点进入时可预测地编辑/删除 TOC 块 | 未实现 | 高 | 当前只是普通链接样式文本，没有块级焦点模型 | `markdownDecorations.ts:234-241,453-493` |
| 粘贴已有 `[toc]` 文档后恢复生成视图 | 未实现 | 高 | 从 Typora 或仓库打开文档时目录退化为 `toc` 文本 | 无 detection/widget/E2E |
| 目录项点击跳转 | 未实现 | 中 | LumaMark 没有文内目录项可点击；Typora 鼠标行为另列为证据不足，不能改变 LumaMark 状态 | 无 TOC widget/handler；仅侧栏按钮有跳转代码 |
| 键盘遍历与激活目录项 | 未实现 | 中 | LumaMark 没有目录项及其键盘契约；Typora 精确键序另列为证据不足 | 无 TOC 可访问结构或键盘测试；官方快捷键无 TOC 专项说明 |
| 无标题空态 | 未实现 | 中 | 用户看不出目录为空、语法无效还是渲染失败 | 无 TOC i18n、widget 与状态模型 |
| ATX/Setext/inline span 标题身份统一 | 部分实现 | 高 | 侧栏、文内 TOC 与 `#anchor` 可能列出或跳到不同标题 | outline 正则仅 ATX；fixture 已含 Setext |
| fenced code、行内、列表、引用中的误触发防护 | 未实现 | 高 | 简单正则方案可能把代码示例变成目录，破坏源码编辑 | 当前无 TOC parser extension 或边界测试 |
| 重复标题与中文标题的稳定身份 | 部分实现 | 高 | 侧栏有私有 slug，但编辑器跳转和 TOC 没有共享身份，标题改名后可能错跳 | `outlineParser.ts:85-99` |
| 多个 TOC 块共享同一标题快照 | 未实现 | 中 | 多目录文档会重复解析或出现不同步 | 无共享 heading state |
| TOC i18n | 未实现 | 中 | “目录”、空态、错误和辅助说明无法中英文一致 | locale 仅有 `outline.*` |
| TOC 可访问语义 | 未实现 | 高 | 屏幕阅读器无法识别目录导航，键盘焦点也没有契约 | 无 `nav/list` widget 与专项测试 |
| 大文档增量更新与性能门禁 | 未实现 | 高 | 若照搬现有全文扫描，每次标题编辑可能增加主线程停顿 | `useDebouncedOutline.ts:28-30`；架构文档把大纲全量重建列为高成本任务 |
| 保存失败时 TOC 源文不受影响 | 部分实现 | 中 | 通用文件错误链路存在，但没有 TOC 场景断言 | `fileActions` 错误路径有测试，TOC 无 fixture |

## 根因与架构影响

第一根因是语法层没有 Typora `[toc]` 扩展。`markdownLanguage()` 只传入 GFM base 和代码语言，没有向 `@codemirror/lang-markdown` 提供 `extensions`；当前 `@lezer/markdown` 又会在不验证引用定义的情况下把类似 `[a][b]` 的结构解析为链接，因此 `[toc]` 落入普通 `Link` 是可解释的现状。继续在通用 WYSIWYG 文件里加字符串特判，会让语法树、视觉 decoration 和输入规则互相不一致。

第二根因是标题数据有两个事实路径：编辑器渲染依赖 CodeMirror 增量语法树，侧栏大纲却在 React feature 层读取全文并用自有正则扫描。后者已有 debounce 与性能门禁，但仍不识别 Setext，清洗 inline Markdown 的规则也不等价于语法树。TOC 如果再复制 `parseMarkdownOutline()`，会形成多个 heading identity，影响侧栏高亮、TOC 跳转、内部链接、重复标题和中文 slug。

第三根因是 capability 边界尚未为 TOC 建立。项目现行架构要求复杂编辑能力放入独立 `editor/capabilities/<name>/`，`capabilities/index.ts` 只负责组装，通用 `markdownDecorations.ts` 不拥有专属 block widget lifecycle。TOC 同时涉及自定义语法节点、派生标题状态、块级 widget、焦点和导航，必须是独立 capability；把它塞进 app shell、OutlinePanel 或通用 decoration 都会违反现有边界。

第四根因是测试和 fixture 没有定义 TOC 契约。通用 round-trip 测试很强，但 fixture 清单没有 `[toc]`，所以无法证明生成视图绝不写回。现有 E2E 证明侧栏 Outline 可见、可滚动和保存标题，却没有覆盖文内 marker、自动更新、源模式和重新打开。这也是“相邻能力存在”容易被误读成“专题体验追平”的主要原因。

架构上的正面约束已经明确：Markdown 源文是唯一真实数据，AST、outline 和预览都是派生数据；React 不应订阅全文；高成本大纲重建不能阻塞输入。因此 TOC 不需要 Rust 或新的全局 store，也不应生成静态 Markdown 列表。它应在 CodeMirror 内消费增量语法树，只向 React 暴露必要的轻量事件或快照，并与保存链路完全解耦。

## 详细改进方案

### 模块归属与成熟依赖优先

新增 `src/editor/capabilities/toc/`，至少拆分为：`tocMarkdownExtension.ts` 识别独立 `[toc]` 块；`headingIndex.ts` 或共享的 `src/editor/markdown/headingIndex.ts` 从语法树产生标题快照；`tocState.ts` 保存 TOC block 与 heading snapshot 的派生状态；`TocWidget.ts` 负责只读目录 DOM、焦点与点击；`tocExtension.ts` 负责 StateField/decoration/lifecycle；`createTocCapability.ts` 提供薄入口；`toc.css` 只定义专题样式。随后在 `EditorCapabilityId` 和 `createLivePreviewCapabilities()` 中注册 `toc`。

成熟依赖选择优先复用仓库已有的 `@codemirror/lang-markdown`、`@lezer/markdown`、`@codemirror/state` 和 `@codemirror/view`。Lezer 包公开接口支持 `defineNodes` 与额外 `parseBlock`，CodeMirror Markdown 配置也直接接受 `extensions`；这比再引入 `markdown-it`、`remark` 或第二棵 AST 更符合增量解析和包体积约束。TOC widget 是编辑器差异化能力，可基于官方 `WidgetType` 实现，不属于重新手搓通用菜单或列表基础组件。现有 `@tanstack/react-virtual` 适合固定高度侧栏，不应未经验证直接嵌入文档流，因为虚拟化会改变 TOC 自然高度、浏览器查找、复制和辅助技术可见性；大量标题场景先通过增量更新、DOM 复用和明确上限测试解决，只有数据证明需要时再评估虚拟化。

### 数据流

建议数据流为：CodeMirror transaction → 增量 syntax tree → heading index StateField 更新受影响标题 → TOC block StateField 判断标题快照或 marker 是否变化 → `Decoration.replace` 在非活动 TOC 行展示 `TocWidget` → 点击或键盘激活项目时用当前 heading `from` 派发 selection 与 `scrollIntoView`。普通段落编辑且未改变标题节点时，不重建标题数组和 TOC DOM；标题变化时，多个 TOC block 共享同一不可变快照，不各自扫描全文。

侧栏 Outline 应逐步改为消费同一 `HeadingSnapshot[]`，而不是每次调用 `getDocumentText()`。React 只接收 `{id, level, text, from, to}` 这类轻量数据；Markdown 全文仍留在 CodeMirror。迁移期可以保留现有 debounce 作为兼容层，但必须用一致性测试证明新旧解析结果，再删除正则事实源，避免长期双轨。

### 源码保真

文档中唯一持久内容始终是用户输入的 `[toc]`。TOC 列表通过 decoration/widget 投影，不派发替换源文的 transaction，也不进入 `prepareTextForSave`。live preview 中仅在 marker 所在行非活动时替换显示；光标进入该行时恢复字面 `[toc]`，使删除、复制、撤销、重做和 IME 都沿用 CodeMirror 原生文本模型。source 模式不装载 TOC widget，完整显示标记。

fixture 必须覆盖 LF/CRLF、文件末尾无换行、前后空格、多个 TOC、中文标题、重复标题、inline formatting、ATX/Setext、代码围栏中的 `[toc]` 和标题，以及无关段落。open → 不编辑 → save 的字节差必须为零；只改一个标题时，保存 diff 只能包含该标题编辑，不能出现静态目录、slug 或空白规范化。

### i18n 与可访问性

所有可见字符串进入 `en.json` 与 `zh-CN.json`，建议完整 key 包括 `toc.label`、`toc.empty`、`toc.renderError` 和必要的导航提示，不能复用语义不同的 `outline.*`。生成结构应具有明确的 `nav` 或等价 landmark，并以本地化 label 标识；层级列表保留标题次序和嵌套关系。若使用 button，应保证 `Tab` 可到达、`Enter`/`Space` 激活、焦点样式在亮暗主题和高对比下可见；若使用 anchor-like 元素，应阻止把派生 href 写回源码，并验证屏幕阅读器名称来自标题纯文本。

活动 TOC 行恢复源码时不得造成焦点丢失或把光标移入不可编辑 widget。点击生成项跳转后焦点应进入目标标题，撤销栈不增加无内容 transaction。200% 缩放、窄窗口、长中文标题、双向文本和六级嵌套不得裁切或形成横向页面溢出。

### 错误处理

无标题时显示本地化空态，但仍保留可编辑 `[toc]` 源文。若 heading snapshot 或 widget 更新失败，必须降级为可见字面 `[toc]`，记录可诊断错误并保持编辑、保存可用；不得静默显示旧目录。点击项前重新校验位置或通过 transaction mapping 更新位置，避免并发编辑后跳到错误字符。

非法位置的 `[toc]` 应按普通 Markdown 文本处理：fenced/indented code、行内句子和其他不满足独立块条件的场景不创建 widget。解析规则先严格对齐已确认的独立小写 `[toc]` + `Return`，大小写、空格和容器块扩展在 Typora 实测后再决定。任何新容忍规则都要有明确 fixture，不能用宽松正则吞掉用户原文。

## P0/P1/P2 分阶段计划

### P0

建立最小完整纵向切片：用 Lezer block extension 识别独立 `[toc]`；建立共享 heading snapshot 的首版数据结构；在 `editor/capabilities/toc/` 注册 inactive-line widget；支持 ATX H1–H6、标题增删改自动更新、本地化无标题空态与 label、基础 `nav/list` 语义、源码模式字面标记和 live preview 焦点恢复源码；新增 `toc.md` fixture、语法 unit、EditorState integration、保存 round-trip 和核心 E2E。P0 完成标准不是“能看到列表”，而是创建、更新、切换源码、撤销重做、保存重开均可证明且无无关 diff；不得把 i18n 或基础可访问语义推迟到后续阶段。

### P1

统一侧栏 Outline、TOC 和内部标题跳转的 heading identity；补 Setext、inline span 清洗、重复标题、中文/emoji、多个 TOC block；实现鼠标点击和完整键盘导航；接入中英文文案、landmark/list 语义、200% 缩放和高对比验收；移除侧栏长期全文正则事实源。Typora 焦点和鼠标细节完成 GUI 复核后，记录明确的 align 或有理由的产品差异。

### P2

针对数千标题和 1/5/10MB 文档优化增量更新、DOM 复用与内存；补 Windows/macOS/Linux 的 Mod 键、字体和滚动抽检；评估导出链路是否需要把 `[toc]` 解释为导出目录，但不得改变编辑文件源文；补极端嵌套、双向文本、超长标题和外部文件变更后的恢复。只有性能数据证明自然 DOM 无法满足预算时，才对文内 TOC 评估分段或虚拟化方案。

## 可执行验收标准与 unit/integration/E2E/fixture 测试计划

### Unit

- `tocMarkdownExtension.test.ts`：独立 `[toc]` 被解析为专用 block；行内 `before [toc] after`、fenced code、indented code、链接文本、表格单元格不触发；未按 `Return` 的活动行只显示源码。
- `headingIndex.test.ts`：ATX H1–H6、Setext、fenced code 排除、inline code/emphasis/link 纯文本、中文、emoji、空标题边界、重复标题稳定 ID、位置范围全部精确断言。
- `tocState.test.ts`：非标题编辑保持 heading snapshot 引用稳定；标题插入、删除、改级别、改名只更新受影响数据；多个 TOC 共享同一快照；transaction mapping 后位置正确。
- `TocWidget.test.ts`：生成层级、空态、i18n label、键盘激活、点击回调、长标题与六级缩进语义可查询；render error 降级为 marker 而非旧内容。

### Integration

- 用真实 `EditorState` 和 `EditorView` 验证 `[toc]` + `Enter` 后 inactive 行出现 widget，active 行恢复字面标记；source/live preview 往返不改变 `state.doc`。
- 修改标题后目录在一次可控更新内变化；撤销恢复旧标题和旧目录，重做再次更新；TOC 更新不向 history 增加独立事务。
- 粘贴含 `[toc]` 的完整 Markdown、中文 IME 在 marker 相邻位置组合输入、跨块选择复制、删除 TOC、多个光标、拖选经过 widget 均不破坏选区和源码。
- Outline 与 TOC 对同一 fixture 产出完全一致的 heading snapshot；点击目录项滚动并聚焦目标标题，随后输入发生在目标位置。

### E2E

- 在真实 app shell 输入 `# 标题`、空行、`[toc]`、`Return`，断言文内出现本地化目录而不是带下划线的 `toc`；新增、重命名、删除标题后列表自动更新。
- 点击二级目录项跳到对应标题；只用键盘遍历并激活目录项；跳转不改变 dirty 状态，标题编辑才改变 dirty 状态。
- 切换 source 模式断言完整 `[toc]` 可见且生成列表消失；切回后列表恢复，滚动与选区保持在可接受范围。
- 通过 E2E 文件命令保存并检查 mock Tauri 最后写入文本严格保留 `[toc]`、不含生成链接；重载和重新打开后生成视图恢复。
- 覆盖英文/简体中文、亮色/暗色、200% 缩放、无标题空态、保存失败、外部文件重载，以及 fenced code 中字面 `[toc]` 不误渲染。

### Fixture

新增 `tests/fixtures/markdown/toc.md` 并在 manifest 标记 `typora-like:toc`。fixture 至少包含：文首/文中/文末 TOC、多个 TOC、ATX 六级、Setext 两级、重复中英文标题、inline formatting、代码围栏内标题和 `[toc]`、普通行内 `[toc]`、空标题集合、CRLF 派生副本。`fixtureCoverage.test.ts` 要求新 tag 存在；`roundTrip.test.ts` 对原文件逐字节相等；另加“只改标题”的期望 diff，证明生成内容从不落盘。

### Perf

- 新增独立串行的 TOC/heading-index benchmark，不与 typecheck、构建或 E2E 并行。1MB、5MB、10MB 继续使用现有大文件 fixture，另生成大量标题密度样本但不写入长期大文件。
- 首次 heading index 构建至少不劣于现有 outline 预算：1MB 50ms、5MB 150ms、10MB 300ms；打开文件总预算沿用 300ms、1s、2s。若实现切换到真正增量语法树，应以更低实测基线收紧，而不是放宽门禁。
- 非标题单字符输入不得触发全文 `getDocumentText()` 或全量 TOC DOM 重建；标题单字符编辑的同步主线程增量以普通输入延迟尽量低于 16ms 为目标，并记录 p50/p95 与长任务数量。
- 含 1、10、100、1000 个标题及 1、10 个 TOC block 时记录更新时间、DOM 节点数和内存增量；多个 TOC 不得重复构建 heading index。滚动接近 60 FPS，TOC widget 不应造成 editor viewport 抖动。

## 风险与未核实项

1. Typora 的 TOC 焦点进入、鼠标点击、键盘遍历、无标题空态、多个 TOC、大小写与空格容忍仍未完成本机逐步复核；这些项目在报告中保持证据不足，不能作为像素或键序追平声明。
2. Typora 官方页面写“all headings”，但没有在 TOC 小节逐项证明 Setext；LumaMark 仍应因自身 fixture 与统一 heading identity 需要支持 Setext，但这属于产品完整性决策，不冒充已核实的 Typora GUI 事实。
3. 当前探针已直接调用项目同款 `@codemirror/lang-markdown` 的 GFM `markdownLanguage.parser`，明确把 `[toc]` 产出为 `Link`。实现前仍应补真实 `EditorState` 回归测试，把该现状和新增 TOC extension 的目标树形共同锁定，避免后续依赖升级改变语义而无人察觉。
4. 现有大纲解析器已经被多处代码和性能测试使用，迁移到共享 heading index 时存在行为变化风险；必须先做双跑一致性测试，再移除旧正则，不能一次性替换后仅靠视觉检查。
5. 当前工作树包含大量其他未提交改动，本报告按读取时状态取证。后续合并若改变 capability、outline 或文件保存链路，应重新核对行号与结论。
6. 本次只运行了三个相关 outline 单元测试，没有运行全量 `pnpm test`、E2E、fixture round-trip 或性能基准；报告不声称这些门禁当前整体通过，也不声称任何 TOC 自动化测试已经存在。

## 证据索引

### Typora 基线与官方来源

- `docs/product/typora-baseline/15-toc.md`：专题唯一行为基线；记录 `[toc]` + Return、自动更新、源码/保存保留标记及未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：阅读态/活动块、源码模式、复制粘贴和 IME 的横切模型。
- [Typora Markdown Reference — Table of Contents](https://support.typora.io/Markdown-Reference/)：官方确认 `[toc]` + Return、抽取所有标题并自动更新。
- [Typora Quick Start](https://support.typora.io/Quick-Start/)：官方 live preview、Copy 与 Smart Paste 横切说明。
- [Typora Shortcut Keys](https://support.typora.io/Shortcut-Keys/)：保存、源码模式、复制/粘贴相关快捷键；未列 TOC 专用快捷键。

### LumaMark 代码

- `src/editor/markdown/markdownLanguage.ts:14-18`：当前 GFM Markdown 配置没有 TOC 扩展。
- `src/editor/capabilities/editorCapability.ts:3-20`、`src/editor/capabilities/index.ts:20-39`：能力 ID 与 live preview 组装均没有 TOC。
- `src/editor/wysiwyg/markdownDecorations.ts:217-241,453-500`、`src/editor/wysiwyg/wysiwyg.css:160-164,210-214`：`[toc]` 当前落入普通 Link 的样式和 marker 隐藏路径。
- `src/editor/core/editorDisplayMode.ts:42-57`、`src/editor/core/createEditorState.ts:97-120`、`src/editor/core/editorApi.ts:78-79`：live/source 模式、基础键位和源文读取。
- `src/features/outline/outlineParser.ts:15-99`：ATX-only 标题提取、fence 排除、文本清洗和私有 slug。
- `src/features/outline/useDebouncedOutline.ts:9-31`：120ms debounce 后读取全文。
- `src/features/outline/OutlinePanel.tsx:25-90`、`src/editor/commands/editorCommandPort.ts:78-85`：虚拟化侧栏、按钮与跳转。
- `src/features/file-actions/fileActions.ts:95,100-166`、`src/app/controllers/useAppDocumentModel.ts:59-65`：打开/保存读写源文及图片草稿保存前处理边界。
- `src/shared/i18n/locales/en.json:105-106`、`src/shared/i18n/locales/zh-CN.json:105-106`：只有 Outline 文案。

### 测试、fixture 与运行证据

- `src/features/outline/outlineParser.test.ts:5-58`：ATX 层级、位置与 fenced code 排除。
- `src/features/outline/useDebouncedOutline.test.tsx:27-44`：突发刷新只读取一次全文。
- `src/features/outline/activeOutlineHeading.test.ts:4-17`：当前标题定位纯逻辑。
- `tests/e2e/app-shell.spec.ts:182-195,287-347`：通用中英文/换行输入、侧栏 Outline 长列表滚动与编辑器滚动隔离；不是粘贴或文内 TOC 证据。
- `tests/e2e/v1-workflow.spec.ts:103-135`：打开文件、侧栏标题、编辑与保存相邻路径；没有 `[toc]` 断言。
- `tests/fixtures/markdown/headings.md:1-23`：包含 ATX、Setext、inline code 与中文标题，暴露 outline 当前覆盖差距。
- `tests/fixtures/fixturePaths.ts:5-25`、`markdownFixtureManifest.ts:7-167`、`fixtureCoverage.test.ts:9-62`：现有 fixture 与 tag 中没有 TOC。
- `tests/fixtures/roundTrip.test.ts:8-67`：通用精确字节 round-trip；由于 fixture 无 `[toc]`，不能当作专项验证。
- 只读解析探针：`node --input-type=module -e "import { markdownLanguage } from '@codemirror/lang-markdown'; ..."` 对 `[toc]\n\n# Heading` 输出 `Document(Paragraph(Link(LinkMark,LinkMark)),ATXHeading1(HeaderMark))`，与项目 GFM base 直接一致。
- 本次测试命令：`pnpm exec vitest run src/features/outline/outlineParser.test.ts src/features/outline/useDebouncedOutline.test.tsx src/features/outline/activeOutlineHeading.test.ts --exclude tests/perf/**`；结果 3 个文件、5 个测试通过。

### 依赖、架构与性能约束

- `package.json:37,45,51,62` 与 `pnpm-lock.yaml:300,550,1031,2318`：已安装 `@codemirror/lang-markdown 6.5.0`、`@lezer/markdown 1.7.0`、`@tanstack/react-virtual 3.14.5`、`react-i18next 17.0.8` 等成熟依赖。
- [Lezer Markdown 包接口](https://www.npmjs.com/package/@lezer/markdown)：说明增量解析、`defineNodes`、`parseBlock` 与 Markdown extension；可在现有解析链路内增加 TOC block，无需第二个 Markdown parser。原 GitHub 仓库已归档并迁移，不再把旧仓库地址写成当前官方入口。
- `docs/architecture/DETAILED_ARCHITECTURE.md:68-71,216-219,266-271,636-641`：Markdown 所有权、轻量事件、capability 边界与大纲全量重建风险。
- `docs/product/COMPETITOR_STRATEGY.md:19-31`：增量更新、派生数据与源码保真约束。
- `tests/perf/openFileActionLargeDocument.bench.test.ts:14-23`、`outlinePanelLargeDocument.bench.test.tsx:17-20`：现有打开、outline 解析与侧栏渲染预算。
- `docs/product/TYPORA_FEATURE_GAP_ANALYSIS.md:224-234`：旧汇总也判断 TOC 不存在，但它仅是规划/审计旁证，本报告的实现结论以代码、测试、fixture 和运行探针为准。
