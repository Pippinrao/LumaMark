# 08：代码块竞品分析

## 1. 用途、范围与非目标

本文用于判断 LumaMark 普通 Markdown 代码块相对 Typora 1.13.7 的真实完成度，并把“仓库中已有代码”与“用户体验已经追平”严格分开。范围包括 GFM fenced code block、info string、语法高亮、创建与编辑、阅读态与源码模式、键盘、鼠标、粘贴、保存、异常输入、源码保真和性能风险。

非目标：行内代码由专题 05 负责；Mermaid、sequence、flow 等图表围栏由专题 11 负责；本文不评价完整 Markdown 导出链路，不把路线图、PRD 或架构规划单独当作实现证据，也不主张复制 Typora 的专有视觉资产或内部实现。

## 2. 执行摘要

LumaMark 的代码块能力不是空壳：CodeMirror 6 Markdown 语言服务负责 fenced code 解析，官方 `@codemirror/language-data` 与 JavaScript 语言包提供语言识别和高亮；独立 `codeBlock` capability 提供逐行块面装饰、段落菜单所调用的包装命令、末尾围栏后的退出处理；中英文菜单、source/live preview 切换、未编辑 UTF-8 fixture 的原字节 round-trip 和三条真实浏览器编辑路径均有证据。本次复核实际运行的 6 个 Vitest 文件共 101 个测试以及 3 个代码块 Playwright 用例均通过。这些通过结果只证明被断言的路径，不等于未知语言、粘贴、IME、可访问性或专项性能已经追平。

但当前只能判为“基础功能存在、体验部分追平”。Typora 的核心感觉来自完整闭环：` ``` `+Return 直接进入代码块、`Ctrl+Shift+K` 快捷创建、非焦点隐藏围栏并保留高亮、焦点内稳定编辑、源码模式显示完整原文、粘贴与保存不破坏字节。LumaMark 已覆盖其中的渲染、焦点编辑、源码模式和未编辑 fixture 保存主干，却没有注册代码块快捷键，命令面板也没有代码块入口；同时没有对真实 ` ``` `+Return 创建路径、语言修改、未知语言、未闭合围栏、块内多行粘贴、IME、撤销重做和复制语义形成专题验收。代码块 decoration 还会在每次文档变化时遍历整棵语法树，现有大文档基准不是代码块密集场景，不能证明该热路径满足长期性能目标。

结论：用户已经能通过菜单把选区包成 fenced block，也能打开、阅读、编辑并切换源码模式；未编辑 UTF-8 fixture 另有原字节写回证据。但若以 Typora-like 的无摩擦创建、焦点切换细节和边界稳定性为标准，当前状态为“部分实现”，优先级应放在创建入口、交互状态机与专项回归，而不是重写解析器或自研高亮引擎。

## 3. Typora 功能与完整体验基线

### 创建

Typora 1.13.7 的公开基线是 GFM 围栏代码块，不把经典四空格缩进块作为支持的创建路径。用户输入三个反引号后按 Return 可创建代码块；反引号后可带可选语言标识。Windows/Linux 公开快捷键为 `Ctrl+Shift+K`。完整体验不只是文档最后出现三行 Markdown，而是创建后光标落点明确、可立即输入代码、闭合与退出路径可预测，并且不会无意改写相邻文本。

### 阅读态

非焦点代码块显示为等宽块级区域；已识别的 info string 驱动语法高亮；围栏定界符通常隐藏。未知语言仍应保持代码块，只是高亮降级。代码内容中的 `#`、`*`、`[ ]`、HTML 等应按字面显示，不能被二次解释为标题、强调、任务列表或页面结构。

### 焦点编辑态

光标进入代码块后直接编辑代码源文本，代码内容仍按字面处理。语言标识必须可修改，焦点进入和离开不能引发光标跳动、行高突变、选区错位或滚动抖动。基线没有充分核实 Typora 是按当前行还是整个块露出全部围栏，因此像素级显隐范围属于未核实项，不能反向臆造为 LumaMark 必须复制的规则。

### 源码模式

源码模式显示完整开始围栏、info string、代码正文和闭合围栏；live preview 与源码模式编辑同一份 Markdown。切换后应保持文本、撤销历史和合理的阅读位置；代码块不能被转换成另一种私有模型。

### 键盘、鼠标与粘贴

键盘必须覆盖键入触发、快捷创建、块内 Return、退出到块后正文、方向键越过末尾围栏、撤销和重做。鼠标点击代码行应把光标落到对应源码位置，点击焦点前后布局稳定。向代码块粘贴普通文本时应保持字面内容，不能把其中 Markdown 重新渲染或静默规范化；多行、制表符、CRLF、尾随空格和包含围栏字符的文本都应有明确规则。

### 保存、错误与边界

落盘形态必须仍是 fence + 可选 info string + 原代码文本 + closing fence。保存不应改变换行、缩进、尾随空格、围栏字符或无关段落。未知语言应可编辑可保存；未闭合围栏不能拖垮编辑器；较长围栏、波浪线围栏、空代码块、代码中出现三个反引号、文档末尾无换行、超长行和大规模代码块都应可恢复。Typora 对缩进代码块打开后的精确呈现以及未闭合围栏的 GUI 恢复策略仍缺少实测证据。

## 4. LumaMark 当前功能清单

1. **fenced code 解析与语言分派：已实现。** `src/editor/markdown/markdownLanguage.ts:14-43` 以 CodeMirror Markdown/GFM 语言为基础，把 info string 首词转为语言名；`js/javascript/jsx/ts/typescript/tsx` 有直接映射，其它语言由 `@codemirror/language-data` 的名称和 alias 查找，找不到时返回 `null`。`src/editor/markdown/markdownLanguage.test.ts:7-26` 以 TypeScript fence 断言 `const` 获得关键字 token。
2. **成熟语法高亮链路：已实现。** `package.json:33-45` 声明 CodeMirror Markdown、JavaScript、language-data、Lezer 依赖；`pnpm-lock.yaml` 锁定对应解析与语言包版本。`markdownLanguage.ts:46-74` 只定义主题 class，不自研词法分析；`src/editor/wysiwyg/wysiwyg.css:135-158` 给关键字、字符串、数字、注释、函数等 token 使用主题变量着色。
3. **独立 capability 边界：已实现。** `src/editor/capabilities/index.ts:20-39` 只在 live preview 组合 `codeBlock` capability；`src/editor/core/editorDisplayMode.ts:42-57` 在 source mode 移除 live-preview capability，仅保留源码编辑器 class。`tests/quality/architectureBoundaries.test.ts:165-230,261-285` 约束入口存在、模块体积和跨层依赖。
4. **稳定块面样式：已实现。** `codeBlockDecorations.ts:144-185` 从语法树找到 `FencedCode`，为每一行添加 `lm-md-code-block-line`，首尾再加 start/end；`wysiwyg.css:100-133` 用行级 background、inset border 和圆角构造整块表面。`codeBlockCommands.test.ts:89-110` 断言三行均被装饰且首尾 class 存在；`editor-markdown.spec.ts:112-154` 在浏览器中编辑代码并检查所有代码行高度不超过普通行的 1.2 倍。
5. **阅读态隐藏围栏、代码内容保持字面：已实现。** `markdownDecorations.ts:30-34,453-500` 把 `CodeMark` 和 `CodeInfo` 纳入非活动行隐藏，同时依赖 Lezer 语法树避免在 fenced code 内生成标题、列表和任务控件。`markdownDecorations.test.ts:151-167` 以波浪线 fence 断言内部伪标题/伪任务不进入通用装饰；`markdownDecorations.test.ts:417-447` 断言光标在块外时页面文本不含反引号围栏而仍含代码正文。
6. **焦点源码编辑与鼠标路径：部分实现。** `markdownDecorations.ts:496-500` 以“选区所在行”判断 active line，活动行不隐藏结构标记；`editor-markdown.spec.ts:126-153` 点击代码行后输入分号并验证文本变化与行高稳定。现有证据证明当前代码行可编辑，不足以证明点击 info string、跨行选择、开始/闭合 fence 焦点和整块焦点切换均达到 Typora 体验。
7. **段落菜单和底层包装命令：已实现。** `src/features/commands/createCommandModels.ts:233-253` 在“段落”菜单加入 `codeBlock`；`src/shared/i18n/locales/en.json:87` 和 `zh-CN.json:87` 提供双语标签。`codeBlockCommands.ts:32-51` 用三反引号包装选区，无选区时插入 `code` 默认正文并选中它；两组单元测试分别在 `codeBlockCommands.test.ts:57-75` 和 `markdownFormatCommands.test.ts:206-213` 验证结果。
8. **命令面板代码块入口：未实现。** `src/features/commands/createCommandModels.ts:35-150` 构造命令面板模型，但没有 `codeBlock`/“Code Block”项目；因此底层命令存在不能推导出命令面板可发现或可执行该能力。
9. **Typora 快捷键：未实现。** `src/editor/commands/markdownFormatKeymap.ts:4-36` 仅注册粗体、斜体和六级标题，没有 `Mod-Shift-k` 或等价代码块绑定；命令模型中的代码块菜单项也没有 shortcut 字段。仓库定点检索未发现其它 `Ctrl+Shift+K` 注册。
10. **真实 ` ``` `+Return 创建：证据不足。** CodeMirror/Lezer 能解析已存在或未闭合 fence，但当前代码块测试主要用 `insertText` 一次注入完整文档或直接执行包装命令，没有从普通段落逐键输入三个反引号再按 Return 的断言，也没有自动补闭合 fence、光标落点或退出规则的专题契约。
11. **末尾围栏后的退出：部分实现。** `createCodeBlockCapability.ts:10-36` 通过 transaction filter 检测“文档以闭合 fence 结束且随后纯追加文本”，自动在追加内容前插入换行；`codeBlockCommands.ts:12-29` 识别三反引号或波浪线 closing fence。`editor-markdown.spec.ts:156-197` 验证 Enter 和 ArrowDown 后能在块外输入。不过该过滤器覆盖所有末尾纯追加 transaction，尚无多行粘贴、IME、undo/redo、程序化追加或用户原本想留在末尾行的专项测试。
12. **源码模式与撤销历史：已实现。** `editorApi.ts:151-161` 用 Compartment 重配置模式，不替换文档；`editorApi.test.ts:129-162` 断言两次模式切换文本不变并能撤销此前编辑；`editor-markdown.spec.ts:90-110` 验证 source mode 可见完整 ` ```js `。
13. **未编辑 fixture 保存保真：已实现。** `tests/fixtures/markdown/code-blocks.md:5-31` 覆盖 ts/json/bash 三种 fence、空行与四空格缩进样本；manifest 在 `markdownFixtureManifest.ts:37-39` 登记 `commonmark:code`。`roundTrip.test.ts:8-72` 把 UTF-8 fixture 解码为文本，经 mock 文件命令调用前端 `saveCurrentFile` 后再按 UTF-8 写出并比较原始字节；本次实际运行包含该 fixture 并通过。它不证明编辑后只改一个字节、非 UTF-8 编码、真实 Tauri IO 或换行策略的全部路径。
14. **未知语言、未闭合 fence 和粘贴：证据不足。** 代码路径暗示未知语言返回 `null` 后仍由 Markdown 解析器保留块；辅助收集函数也会把未闭合 fence 延伸到文末，但主运行时没有对应断言。没有代码块专项测试证明多行粘贴、制表符、CRLF、尾随空格、未知 info string 与未闭合 fence 在编辑和保存全链路都稳定。
15. **专项性能保障：证据不足。** `tests/perf/editorLargeDocument.bench.test.ts:28-67` 测量通用 1/5/10MB 文档加载与末尾输入，但 `codeBlockDecorations.ts:149-183` 每次 docChanged 都遍历整棵语法树并为全部 fenced code 行重建 decoration；没有代码块密集、超长代码行、频繁输入或 viewport 滚动基准。

## 5. 当前真实体验路径

当前可靠路径是：用户在 live preview 打开含 fenced code 的 Markdown，CodeMirror 解析 info string；js/ts 等直接映射使用已安装语言，其它已登记语言可通过 `LanguageDescription` 按需加载，未知语言返回 `null`。code-block capability 为整块每行添加表面 class，通用 WYSIWYG 层在光标离开 fence 行后隐藏 `CodeMark`/`CodeInfo`，代码内容保留字面并显示已有语言支持产生的 token 高亮。用户点击代码正文行即可直接编辑；输入 transaction 更新同一 CodeMirror 文档并重建代码块行 decoration。用户也可从“段落 → 代码块”执行包装命令，把选区变成三反引号围栏，但当前命令面板没有这一入口。文档以 closing fence 结束时，Enter 或向下后输入会被过滤器推到新的一行，从而离开代码块。切换源码模式后 live-preview capability 被卸载，完整 fence、info string 和正文仍在同一文档、同一撤销历史中。保存时文件动作读取编辑器原文；现有 round-trip 只证明未编辑 UTF-8 fixture 可经前端 file action 原字节写回。

不可靠或尚未证明的路径包括：通过命令面板或键盘快捷键创建；从空段落逐键 ` ``` `+Return 后的自动闭合和光标落点；点击或修改语言标识；未知语言回退视觉；未闭合 fence 恢复；向块内粘贴含 fence/CRLF/tab 的多行代码；焦点跨首行、正文、末行移动时的显隐一致性；代码块内 IME、跨行选区和 undo/redo；编辑后仅预期字节变化的真实文件保存；代码块密集大文档的输入与滚动性能。

## 6. 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| GFM fenced code 解析 | 已实现 | 低 | 常见反引号/波浪线代码块可进入独立语法节点 | `markdownLanguage.ts`；Lezer/CM 依赖 |
| info string 驱动高亮 | 已实现 | 低 | ts/js 等常见语言有可见 token 着色 | `markdownLanguage.ts:21-43`；语言单测 |
| 未知语言降级 | 部分实现 | 中 | 代码路径可降级无高亮，但没有真实视觉与保存回归 | `codeLanguageForInfo` 返回 `null`；无专项测试 |
| 阅读态块面与围栏隐藏 | 已实现 | 低 | 离焦可读性接近 Typora-like 基线 | 行级 decoration、CSS、WYSIWYG 单测 |
| 焦点内直接编辑 | 部分实现 | 中 | 正文行可编辑，但首尾 fence/info/跨行焦点细节未锁定 | E2E 仅点击正文行 |
| ` ``` `+Return 创建 | 证据不足 | 高 | 用户最自然的创建路径可能缺自动闭合或落点一致性 | 无逐键输入测试 |
| `Ctrl+Shift+K` 创建 | 未实现 | 高 | Typora 迁移用户快捷操作失效 | keymap 无绑定，菜单无 shortcut |
| 菜单创建与选区包装 | 已实现 | 低 | 可用鼠标或命令入口创建基础 fence | 命令代码、双语菜单、两组单测 |
| 命令面板创建 | 未实现 | 中 | 键盘优先用户无法从命令面板发现或执行代码块创建 | `createCommandPaletteModels` 无代码块项目 |
| 退出最终代码块 | 部分实现 | 中 | Enter/向下可退出，但通用追加过滤器可能干扰粘贴或撤销 | transaction filter；3 条 E2E 中 2 条退出用例 |
| 代码内 Markdown 字面化 | 已实现 | 低 | 伪标题、伪任务不会错误渲染或可操作 | WYSIWYG 排除单测与 task E2E |
| 源码模式完整 fence | 已实现 | 低 | 可检查和编辑真实 Markdown | display mode 代码、unit/E2E |
| 未编辑 UTF-8 fixture round-trip | 已实现 | 低 | 当前语料经前端 file action 保存无无关字节变化 | `code-blocks.md` + `roundTrip.test.ts` |
| 编辑后真实文件保存保真 | 证据不足 | 高 | CRLF、尾随空格、非 UTF-8 或只改一处时仍可能出现非预期 diff | 现有 round-trip 不编辑内容且 mock 文件命令 |
| 块内粘贴保真 | 证据不足 | 高 | 复杂代码可能丢失制表符、换行或被退出过滤器改变 | 无代码块 paste 测试 |
| 未闭合/超长/嵌套 fence | 证据不足 | 中 | 异常文件的恢复与边界可能不稳定 | 辅助正则存在，主路径无断言 |
| 缩进代码兼容 | 证据不足 | 低 | fixture 能保存，但 Typora 阅读态对齐与 LumaMark 呈现均未专项验证 | fixture 仅有四空格样本 |
| 键盘、鼠标、IME、选区、undo 综合稳定 | 部分实现 | 高 | 基础点击编辑可用，复杂写作仍可能跳光标或产生意外 transaction | 单点 E2E；缺组合态矩阵 |
| 代码块专项性能 | 证据不足 | 高 | 代码密集大文档可能因全树重建出现输入或滚动卡顿 | 全树 decoration；仅通用 perf |
| 可访问语义 | 证据不足 | 中 | 屏幕阅读器能否识别代码区域、语言和阅读顺序未证明 | 未发现代码块 ARIA/role 专项实现或测试 |

## 7. 根因与架构影响

第一，当前实现把“解析与显示”做得比“创建与交互契约”完整。成熟 CodeMirror 语言链路天然解决了 fence、info string 与 token 高亮，但产品级创建仍只有段落菜单可达的通用包装命令和一个末尾追加过滤器；快捷键与命令面板没有复用同一入口，也缺少明确的 code-block editing state machine，因此真实键入、自动闭合、退出、粘贴和撤销之间的优先级没有统一契约。

第二，焦点模型沿用了通用“活动行”规则，而 Typora-like 代码块是多行块级对象。活动行足以隐藏当前行标记，却不能自然表达“正文聚焦时是否显示 info string”“跨行选区如何处理”“点击边框落到哪里”等块级状态。若继续把例外堆进通用 WYSIWYG 文件，会扩大编辑器热路径并模糊 capability 边界。

第三，`codeBlockPreviewExtension` 的 StateField 在每次 docChanged 时遍历整棵 syntax tree、逐行重建所有 fenced code decoration。架构上它位于正确的 `editor/capabilities/code-block` 层，但算法边界仍需改为 viewport/changed-range 感知，否则代码块密集的大文档会把普通输入成本与文档总规模绑定。

第四，保存层没有代码块私有模型，这是正确方向：Markdown 仍是唯一事实来源，菜单、键盘、粘贴都应产生 CodeMirror transaction，文件服务只读取最终源文。后续不能为了视觉追平引入 React store 持有代码全文，也不能将代码块转换成 React 富文本节点。

## 8. 详细改进方案

### 模块归属与成熟依赖优先

继续保留 `src/editor/capabilities/code-block/` 作为唯一专题边界：新增输入规则、焦点状态、退出命令和 decoration 增量逻辑均在此目录；`src/editor/commands/markdownFormatKeymap.ts` 只注册公共快捷键并调用 capability command；`features/commands` 只负责本地化菜单/命令模型；文件读写仍走现有 file action/service。解析和高亮继续使用 `@codemirror/lang-markdown`、`@codemirror/language-data` 与官方语言包，不自研解析器、语言选择器或 tokenizer。若未来需要语言下拉，优先评估 Radix Popover/Select 或项目既有 headless 组件，并先记录可访问性、包体积和编辑器焦点兼容证据。

### 数据流与交互状态

把所有入口统一到明确 command：`wrapCodeBlock` 负责选区包装；`insertCodeBlock` 负责空选区创建、默认 fence 与光标落点；输入规则只识别当前行恰为 0–3 空格加至少三个反引号/波浪线及可选 info string，并在非组合输入提交后生成最小 transaction。`Ctrl+Shift+K`、菜单和 command palette 复用同一 command，不复制字符串拼接。退出逻辑应基于语法节点、选区和 userEvent，而不是“文档末尾有 closing fence + 任意纯追加”这一宽条件；Enter、ArrowDown、粘贴和程序化 load 必须可区分。

### 源码保真

命令只能修改用户明确选择的范围：保留 fence 字符类型、长度、info string 大小写、代码缩进、空行、尾随空格、CRLF 和末尾换行。粘贴不得把 tab 改空格，不得解析块内 Markdown，也不得为已有未闭合 fence 静默补写 closing fence。自动补闭合仅能发生在明确创建动作，并且一次 undo 应完整撤销该动作。fixture 增加反引号长度 4/5、波浪线、未知语言、空块、未闭合块、代码内三反引号、CRLF、无末尾换行、尾随空格、中文注释与超长行。

### i18n、可访问性与错误处理

快捷键展示、新增语言控件文案、语言包加载失败提示和必要的创建/恢复错误都进入 `en.json` 与 `zh-CN.json`，不在 capability 硬编码可见文案。普通未知语言不应弹错或强制提示，只降级为无高亮；语言包动态加载失败应保留可编辑代码并提供非阻塞、本地化状态，不能清空内容。代码块阅读态应验证 CodeMirror 生成 DOM 的可读顺序；若新增语言按钮或复制按钮，必须有本地化 accessible name、键盘焦点、Escape 返回编辑器、tooltip 和高对比主题。不要给每行伪造独立代码语义；应评估块级 `role`/描述是否与 CodeMirror contenteditable 冲突，并以 NVDA/VoiceOver 实测和自动化 axe 检查决定。

### 性能

避免继续让当前 `StateField` 在每次 `docChanged` 时全树重建。可执行方案二选一并以基准决定：改为 `ViewPlugin`，仅为 `visibleRanges` 加固定行数缓冲构建行 decoration，并在 `docChanged`/`viewportChanged` 时更新；或保留 `StateField`，先 `map(transaction.changes)`，再只重算语法树变化覆盖的 fenced block 范围并合并 `RangeSet`。两种方案都必须验证滚动进入先前不可见代码块时装饰完整、闭合/删除 fence 后旧装饰被清理。语言支持保持按需加载，不把 language-data 的所有实现同步打入启动热路径。性能报告分别测量启动、1/5/10MB 打开、代码块内单字符输入、连续 200 次输入、脚本化滚动、峰值内存和首次语言高亮；记录 p50/p95、处理的语法节点/行数和长任务数，基准必须单独串行运行，不能与 E2E、构建或 typecheck 并行。

## 9. P0/P1/P2 分阶段计划

### P0

- 锁定 ` ``` `+Return、段落菜单、命令面板、`Ctrl+Shift+K`、Enter/ArrowDown 退出的统一 transaction 契约。
- 收窄末尾 transaction filter，补粘贴、IME、undo/redo 和 programmatic load 防回归。
- 补未知语言、未闭合 fence、波浪线/长 fence、CRLF、尾随空格与代码内 fence fixture，并确保 open → edit → save 无无关 diff。
- 建立代码块密集 1/5/10MB 独立性能基准，先测量现状再决定增量 decoration 方案。

### P1

- 完成块级焦点模型：正文、info string、首尾 fence、跨行选区和鼠标落点均可预测。
- 增加可本地化、可访问的语言查看/修改入口；未知语言无损降级。
- 补 live preview ↔ source 的光标/滚动/undo 连续性 E2E，以及亮暗主题视觉快照。
- 将 code-block decoration 改为 viewport 或 changed-range 感知，并以独立 perf 预算验收。

### P2

- 评估复制代码、行号、语言搜索和更多语言别名；这些是增强项，不阻塞基础追平。
- 结合真实用户数据决定是否提供“保留原 fence”与“创建默认 fence”的设置，避免无证据增加偏好项。
- 做 Windows/macOS/Linux 与 NVDA/VoiceOver 的跨平台抽检，记录字体、滚动和剪贴板差异。

## 10. 可执行验收标准与测试计划

### 验收标准

1. 在空段落逐键输入 ` ```ts ` 后按 Return，生成可立即编辑的 fenced block；一次 undo 恢复精确原文。
2. `Ctrl+Shift+K`、菜单和 command palette 对相同选区产生完全相同的 transaction 与光标范围，中英文 UI 均显示正确。
3. 非焦点隐藏 fence/info string 并保留高亮；点击正文、info 和 closing fence 后光标位置与源码 offset 一致，行高变化不导致滚动跳动。
4. 未知语言、未闭合 fence、波浪线和更长 fence 仍可编辑、切换 source、保存并再次打开；除明确编辑字节外无其它 diff。
5. 块内粘贴含 tab、CRLF、尾随空格、Markdown 标记和反引号的多行文本，保存后字节符合明确的换行策略且不触发错误退出。
6. IME 组合期间不自动闭合、不移动光标；提交后解析一次；undo/redo、跨行选择、复制粘贴保持稳定。
7. 代码块密集 1/5/10MB fixture 满足项目既定打开与输入预算；同一脚本化滚动轨迹记录帧间隔、长任务和峰值内存并与锁定基线比较，输入 transaction 处理行数不得随文档中不可见代码块总行数线性增长，连续 200 次输入后内存应回落到预先写入测试配置的容差内。首次建立基线时必须把机器、fixture 生成参数和预算写入测试，不能用“接近 60 FPS”作为人工判断。

### Unit

- 参数化 info string alias、未知/空语言、反引号/波浪线及不同 fence 长度。
- 对 `insertCodeBlock`、`wrapCodeBlock`、退出 command 和 input rule 断言 change spec、selection、userEvent 与一次 undo。
- 对 paste/IME transaction 明确断言过滤器不误插换行；对 programmatic load 不改文档。
- 对 decoration 断言可见范围、active block/line、首尾 class、未知语言无 token 但仍有块面。

### Integration

- CodeMirror 实例中逐键创建、修改 info、正文多行编辑、跨行选择、undo/redo、source/live preview 切换。
- 语言加载成功/失败、未知语言、文档上下文切换后源码不变。
- 文件动作执行 open → edit one byte → save → byte diff，只允许预期变化。

### E2E

- Chromium 中覆盖 Typora 主路径：逐键 ` ``` `+Return、快捷键、菜单、鼠标点击、粘贴、退出、保存、重开。
- 中文 IME 用可重复 composition event 测试并辅以 Windows 真机抽检。
- 亮暗主题截图比较非焦点、正文焦点、info 焦点、source mode；断言 token 对比度和行盒稳定。
- 可访问性检查语言控件、复制控件、焦点返回和读屏顺序；无控件时至少验证编辑器内代码文本可达。

### Fixture

- 扩展 `code-blocks.md` 或建立职责清晰的边界 fixture，覆盖长 fence、tilde、空块、未知语言、未闭合、CRLF、无末尾换行、尾随空格、tab、中文和块内伪 Markdown。
- 每次 code-block capability、Markdown parser 或保存逻辑变化都运行 `pnpm test:fixtures`，无关字节 diff 必须为 0。

### Perf

- 新建 code-block-dense 1/5/10MB 生成 fixture，分别测创建 editor、首次高亮、块内单键 transaction、200 次连续输入、滚动和 mode switch。
- 记录 decoration 构建次数、处理节点/行数、主线程耗时和峰值内存；输入基准单独串行运行。
- 预算沿用项目 1MB <300ms、5MB <1s、10MB 可编辑不冻结；普通输入目标 <16ms，并为 5/10MB 明确可复现的分级预算。

## 11. 风险与未核实项

- Typora 焦点进入代码块时究竟露出整块 fence、只露出当前行，还是使用语言专用控件，基线仍未完全核实；改造前应在 1.13.7 对首行、正文、末行和跨行选区逐步截图。
- Typora 对四空格缩进代码、未闭合 fence、未知语言和块内粘贴含 closing fence 的精确行为缺少本机实测，不应把推测写成追平标准。
- 当前工作树存在大量未提交并行改动；本文按读取时的现状取证，后续代码变动可能使行号漂移，证据应以文件和符号为主。
- 本次只运行了下方列出的聚焦 Vitest 与 Playwright；没有运行完整 `pnpm test`、完整 `pnpm test:e2e`、`pnpm perf:bench`、typecheck、lint 或 build，报告不能据此声称全仓质量门禁通过。
- 本次没有做 Typora 新的 GUI 实测，也没有执行 NVDA/VoiceOver、IME 真机、跨平台剪贴板或代码块专项性能测量；对应结论保持“证据不足”或“部分实现”。

## 12. 证据索引

### Typora 基线与横切规则

- `docs/product/typora-baseline/08-code-blocks.md`：Typora 1.13.7 fenced code、创建、高亮、源码与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：阅读态/焦点态、源码模式、粘贴、IME 和符号显隐横切模型。
- `docs/product/typora-baseline/11-mermaid-and-diagrams.md`：普通代码 fence 与图表 fence 的范围边界。

### 实现与架构

- `src/editor/capabilities/code-block/codeBlockDecorations.ts`：围栏辅助识别、语法节点映射、逐行 preview decoration。
- `src/editor/capabilities/code-block/codeBlockCommands.ts`：包装命令与 closing fence 判断。
- `src/editor/capabilities/code-block/createCodeBlockCapability.ts`：capability 入口与末尾退出 transaction filter。
- `src/editor/markdown/markdownLanguage.ts`：CodeMirror Markdown、语言映射与高亮主题。
- `src/editor/wysiwyg/markdownDecorations.ts`、`wysiwyg.css`：符号显隐、字面隔离和视觉样式。
- `src/editor/core/editorDisplayMode.ts`、`editorApi.ts`：live preview/source 切换及同一文档状态。
- `src/editor/commands/markdownFormatKeymap.ts`、`markdownFormatCommands.ts`：快捷键现状与命令路由。
- `src/features/commands/createCommandModels.ts`、`src/shared/i18n/locales/en.json`、`zh-CN.json`：菜单和双语文案。
- `docs/decisions/0003-live-preview-assets-code-and-table-inline.md`：成熟高亮依赖与行级 decoration 决策；该 ADR 只解释决策，不单独证明运行结果。
- `package.json`、`pnpm-lock.yaml`：CodeMirror/Lezer 依赖声明与锁定。

### 测试、fixture 与性能

- `src/editor/capabilities/code-block/codeBlockCommands.test.ts`：收集、节点映射、包装、closing fence 和块面行测试。
- `src/editor/markdown/markdownLanguage.test.ts`：TypeScript fence 高亮。
- `src/editor/wysiwyg/markdownDecorations.test.ts`：代码内伪 Markdown 排除、非焦点 fence 隐藏。
- `src/editor/commands/markdownFormatCommands.test.ts`：格式命令包装 fence。
- `src/editor/core/editorApi.test.ts`：模式切换文本与撤销历史。
- `tests/e2e/editor-markdown.spec.ts`：代码正文点击编辑、行高、Enter/ArrowDown 退出、source fence。
- `tests/e2e/editor-live-preview-visual.spec.ts` 与 `tests/e2e/fixtures/livePreviewData.ts`：代码高亮与焦点截图生成路径。
- `tests/fixtures/markdown/code-blocks.md`、`markdownFixtureManifest.ts`、`roundTrip.test.ts`、`fixtureCoverage.test.ts`：语料登记、存在性与原字节 round-trip。
- `tests/perf/editorLargeDocument.bench.test.ts`：通用大文档门禁；不是代码块专项性能证明。

### 验证记录

- 已完整读取：`AGENTS.md`、`DEVELOPMENT_PROCESS.md`、专题基线 `08-code-blocks.md`，以及其必要横切文档 `00-live-preview-model.md`、`11-mermaid-and-diagrams.md`。
- 已定点检索并复读本文证据索引中的 `src`、`tests`、`docs`、`package.json` 与 `pnpm-lock.yaml`；检索时排除 `node_modules` 和 `large-*.md` 正文。
- 实际运行 `pnpm exec vitest run src/editor/capabilities/code-block/codeBlockCommands.test.ts src/editor/markdown/markdownLanguage.test.ts src/editor/wysiwyg/markdownDecorations.test.ts src/editor/commands/markdownFormatCommands.test.ts tests/fixtures/roundTrip.test.ts tests/fixtures/fixtureCoverage.test.ts`：6 个测试文件、101 个测试通过。
- 实际运行 `pnpm exec playwright test tests/e2e/editor-markdown.spec.ts --grep "fenced code block|final fenced code block"`：Chromium 3 个用例通过。
- 本文是纯文档分析，没有修改生产代码或测试，因此未执行 TDD；功能状态只依据已读取代码、已有测试与本次实际运行结果。
