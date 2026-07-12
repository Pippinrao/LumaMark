# 09 数学公式竞品分析

## 1. 用途、范围与非目标

本文用于回答一个严格限定的问题：LumaMark 当前在数学公式专题上具备哪些可由代码、测试和 fixture 证明的能力，与 Typora 1.13.7 的完整数学写作体验相比还差什么，以及后续应如何在不破坏 Markdown 源码保真和编辑器性能的前提下补齐。本文把“通用编辑器能够保存包含美元符号和 TeX 字符的文本”与“产品已经提供数学公式功能”明确分开；前者存在不代表后者存在，更不代表体验已经追平。

范围包括块级 `$$...$$`、行内 `$...$`、创建和退出编辑、阅读态与焦点编辑态、源码模式、键盘与鼠标路径、粘贴与保存、解析规则、渲染错误、公式扩展包、编号和交叉引用、国际化、可访问性以及性能。非目标包括复述完整 TeX 宏手册、讨论数学公式导出的全部格式差异、实现代码、改动依赖或替代本专题基线。Typora 事实以 `docs/product/typora-baseline/09-math.md` 及其直接引用的 `00-live-preview-model.md` 为主；LumaMark 事实只以当前代码、测试、fixture 和依赖清单为实现证据，路线图与架构文档仅用于说明意图。

## 2. 执行摘要

结论是：LumaMark 的数学公式产品能力目前为**未实现**。当前 CodeMirror 编辑器可以把 `$$`、`$...$` 和反斜杠命令当作普通 Markdown 文本编辑，源码模式与 live preview 模式切换时文档文本保持不变，文件动作也会把编辑器当前文本交给写入层；但仓库没有数学语法扩展、math capability、公式 widget、渲染适配器、调度器、设置、命令、i18n 文案、专项测试或 `math.md` fixture。因此，块公式不会变成居中的阅读态公式，行内公式不会渲染，`$$`+Return 不会进入专用输入区，`Ctrl+Shift+M`、`Ctrl+Return`、✓ 和 Math Tools 均不存在。

这一区分非常重要：通用保存链路为未来源码保真提供了可复用基础，却没有对 TeX 做专项 round-trip 验证，也没有覆盖转义美元符号、货币文本、未闭合定界符、嵌套环境、跨模式编辑和错误恢复，所以连“所有数学源码均可保真”也只能判为**证据不足**。架构文档把 KaTeX 列为默认候选，并要求公式批量渲染走冷路径；这属于设计方向，不是依赖已接入或功能已完成的证据。`pnpm-lock.yaml` 中虽出现 KaTeX，它是 Mermaid 的传递依赖，`package.json` 没有直接声明数学渲染引擎，不能据此认定公式渲染可用。

优先策略应是先锁定语法与源码保真，再用真实 Typora 迁移语料对 KaTeX 和 MathJax v4 做兼容性小样。KaTeX 官方提供定界符配置、错误回调和支持函数清单，适合速度优先的候选；MathJax v4 官方则提供标准/最小 TeX 输入组件、扩展包与异步加载机制，更接近 Typora 当前的 MathJax v4 兼容面。最终选型必须由兼容语料、包体积、首次渲染、增量渲染、可访问输出和离线桌面分发数据决定，不能只沿用规划文字。

## 3. Typora 功能与完整体验基线

### 3.1 创建

- 块级公式以独立 `$$` 定界。用户在空行输入 `$$` 后按 Return，会进入接受 TeX/LaTeX 的专用输入区；Windows/Linux 还可用 `Ctrl+Shift+M` 插入数学块。
- 行内公式使用 `$...$`，但默认受 Preferences → Markdown 中 Inline Math 开关控制。公开基线还记录 `$` 后按 Esc 再输入 TeX 的触发路径。
- 行内默认接近 Pandoc 规则：开定界符后不能立即空白，闭定界符前不能空白，闭定界符后不能紧跟数字，以减少 `$2` 等货币文本误识别；Legacy 模式可放宽规则。

### 3.2 阅读态

- 非焦点块公式只显示居中的渲染结果，结构性的 `$$` 被隐藏；开启行内数学后，行内 TeX 显示为公式字形。
- 阅读态仍是同一份 Markdown 的 live preview，不是另建一份富文本副本。用户回到源码模式时应看到原始定界符和 TeX。
- Typora 1.13 使用 MathJax v4，并以当前版本规则处理 `\\` 换行；MathJax 只实现 LaTeX 子集，不能把“接受 TeX 输入”理解为支持任意 LaTeX 文档。

### 3.3 焦点编辑态

- 光标进入块公式时出现灰色源码输入区，区内展示 `$$`、TeX 和结束定界符，同块下方即时显示渲染预览；右上角有“公式”标签与 ✓。
- 离开公式块后回到阅读态。可用 Up/Down、`Ctrl+Return`/`Command+Return`、点击 ✓ 或点击块外结束编辑。
- 行内公式遵循 live preview 的 span 展开模型：阅读时渲染，进入对应 span 时应能回到可编辑的 TeX 源。基线尚未完全核实美元定界符在光标进入时的精确显隐细节。

### 3.4 源码模式

- 块公式以独立行 `$$`、中间原始 TeX、结束行 `$$` 落盘；行内公式以段落中的 `$...$` 落盘。
- 源码模式显示完整原文，live preview 与源码模式编辑同一文档。Typora 1.13 的横切基线要求模式切换保留滚动位置；“光标和公式内选区也保持”是本报告提出的追平验收要求，不是已获得的 Typora 实测结论。

### 3.5 键盘、鼠标与粘贴

- 键盘覆盖 `$$`+Return 创建、`Ctrl+Shift+M` 插入块、`Ctrl+Return` 退出块、方向键退出以及 `$`+Esc 行内触发。
- 鼠标覆盖点击已渲染公式进入编辑、点击 ✓ 确认、点击块外退出；菜单有 Edit → Math Tools，可用于强制刷新等操作。
- 向公式输入区粘贴 TeX 的精确行为尚无基线实测证据；完整追平验收仍应覆盖纯文本 TeX、带换行环境、来自网页的富文本和仅含 `$` 的剪贴板，确保不会错误套用 Smart Paste 或改变反斜杠。

### 3.6 保存、错误与边界

- 保存必须逐字符保留定界符、空白、换行、宏、标签和转义，不得因为渲染成功或失败重写无关源码。
- 非法 TeX 的具体 Typora 错误样式尚未逐条核实；可确认的产品边界是 MathJax 只支持 LaTeX 子集，并提供 Math Tools 强制刷新入口。
- 进阶能力包括自动编号、Physics、mhchem、`\label`/`\ref`。这些能力可能受偏好和 MathJax 包配置控制，不能只验证简单的 `E=mc^2` 就宣称体验追平。
- 基线中仍未核实的项目包括非法 TeX 的错误 UI、行内焦点展开时定界符显隐、行内设置变更是否要求重载窗口，以及公式输入区粘贴细节；本文在风险章节继续保留这些未知项。

## 4. LumaMark 当前功能清单与证据

### 4.1 通用 Markdown 文本编辑：已实现，但不是数学功能

`src/editor/core/createEditorState.ts:97-120` 创建 CodeMirror 状态，加载通用 Markdown language、历史、自动补全、搜索和通用 keymap。`src/editor/markdown/markdownLanguage.ts:14-18` 仅配置 GFM Markdown 与 fenced code language，没有注册数学解析扩展。因此用户可以键入 `$`、`$$` 和 TeX 字符，但它们只进入普通文本文档；没有证据表明语法树会产生 MathBlock/InlineMath 节点。

`src/editor/markdown/markdownLanguage.test.ts:6-26` 唯一专项 language 测试验证 TypeScript fenced code 高亮，不包含数学定界符、货币歧义或 TeX。当前状态为**部分实现**：文本输入基础可复用，数学语义未实现。

### 4.2 live preview 与源码模式：通用切换已实现

`src/editor/core/editorDisplayMode.ts:42-57` 在 source 模式只附加源码模式 class，在 live preview 模式加载 `createLivePreviewExtensions`。`src/editor/core/editorApi.ts:78-80` 从 CodeMirror 文档直接返回字符串，`src/editor/core/editorApi.ts:151-161` 用 compartment 重配显示模式。`src/editor/core/editorApi.test.ts:129-158` 证明一般 Markdown 在 live preview/source 间切换时文本和撤销历史保持；测试输入是粗体，不是公式。

因此，源码模式基础为**已实现**，但公式在 live preview 中仍没有阅读态与焦点编辑态之分，数学体验为**未实现**。

### 4.3 capability 注册：数学能力未实现

`src/editor/capabilities/editorCapability.ts:3-20` 把 capability ID 限定为 `codeBlock | image | mermaid | table`，命令接口也没有插入公式、退出公式或刷新公式。`src/editor/capabilities/index.ts:20-49` 实际只注册 code block、image、table 和 mermaid，并且命令聚合也只包含 image、table 和 code block。仓库 `src/editor/capabilities/` 下也只有这四个目录。由此可直接判定 math capability、block widget、inline decoration 和 math commands 均为**未实现**。

### 4.4 数学渲染引擎：未直接接入

`package.json:33-64` 的直接依赖有 CodeMirror、Mermaid 和 markdown-it，但没有 KaTeX 或 MathJax。`pnpm-lock.yaml:4954-4970` 显示 Mermaid 11.16.0 的依赖项中包含 `katex: 0.16.47`；这只证明安装 Mermaid 时带入 KaTeX，不能证明 LumaMark 直接调用它，也不应依赖传递依赖的内部版本。

`docs/architecture/DETAILED_ARCHITECTURE.md:141` 建议数学公式默认选 KaTeX、兼容性不足再评估 MathJax，`docs/architecture/DETAILED_ARCHITECTURE.md:677` 又要求实现前做小样验证。二者都是规划证据，所以当前渲染状态仍为**未实现**。

### 4.5 异步渲染基础：可借鉴，不等于公式已实现

Mermaid 已建立独立 capability。`src/editor/capabilities/mermaid/mermaidRenderScheduler.ts:38-85` 实现 debounce、缓存命中、按 block ID 代际取消，`109-144` 丢弃过期结果并显式回调错误。`src/editor/capabilities/mermaid/mermaidPreviewExtension.ts:126-132` 配置 120ms debounce。这证明仓库有可参考的复杂块调度模式，但现有 scheduler 的类型、缓存键和错误模型均绑定 Mermaid，不应直接把数学逻辑塞入该文件。公式调度本身为**未实现**。

### 4.6 保存链路与源码保真：通用链路已实现，数学证据不足

`src/features/file-actions/fileActions.ts:139-157` 从 `editor.getDocumentText()` 取原文，经过可选 `prepareTextForSave` 后调用 `writeText`，并在保存期间文档未变化时把准备后的文本回载到编辑器。实际应用组装在 `src/app/controllers/useAppDocumentModel.ts:64-66` 注入 `finalizeAllDraftImages`，所以生产保存并非始终走恒等准备函数。`tests/fixtures/roundTrip.test.ts:8-70` 则遍历 `fixturePaths.ts` 导出的路径，未注入 `prepareTextForSave`，对当前 fixture 做默认恒等准备路径的字节级保存对比。

然而，`tests/fixtures/fixturePaths.ts:5-26` 和 `tests/fixtures/markdownFixtureManifest.ts:7-167` 均没有 `math.md`；实际 fixture 目录也没有该文件。前者是字节级 round-trip 的直接输入源，后者只为 fixture 覆盖标签测试提供清单。因此只能说“默认恒等准备的通用保存路径有字节级回归测试”，不能说 TeX、宏、标签、美元歧义、数学编辑路径或生产 `prepareTextForSave` 注入已通过 round-trip。数学源码保真状态为**证据不足**。

### 4.7 设置、命令、i18n 与可访问性：未实现

对 `src/features/settings`、`src/features/commands`、`src/shared/i18n/locales` 与应用命令控制器的定点检索没有发现 math、formula、LaTeX 或 TeX 用户界面项。当前没有 Inline Math 门控、Pandoc/Legacy 解析选择、自动编号、包配置、插入/刷新命令、公式错误文案、公式可访问名称或屏幕阅读器替代描述。以上均为**未实现**。

## 5. 当前真实体验路径

当前用户打开或新建 Markdown 后，在编辑器中输入：

```markdown
$$
E = mc^2
$$

价格是 $2，行内表达式是 $x^2$。
```

根据上述当前装配可静态判定：CodeMirror 会接收这些字符并将其放入同一文本缓冲区。按 Return 只执行通用 CodeMirror/Markdown 键盘行为，不会创建灰色公式输入区；live preview capability 注册表没有数学扩展，所以离开该行后不会隐藏 `$$`、不会居中渲染、不会生成行内公式。点击文本仍是普通光标定位；`Ctrl+Shift+M` 没有数学命令映射，`Ctrl+Return` 不承担退出公式语义，也没有 ✓ 或 Math Tools。本轮未启动应用做手动体验，因此这里的“当前路径”是由实际注册代码和命令映射推导的可重复静态结论，不冒充运行时观测。

切到源码模式时仍能看到原始字符，这来自通用模式重配而非数学专用实现。保存时当前文档字符串会进入通用写入链路；若未经过额外文本准备，简单示例预期会原样写出，但仓库没有数学 fixture 或真实 open → edit → save → reopen 测试来证明复杂 TeX 保真。换言之，当前真实路径是“编辑普通文本”，不是“编辑并预览数学公式”。

## 6. 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 块级 `$$...$$` 语法识别 | 未实现 | 阻断 | 无法进入任何块公式产品流程 | `markdownLanguage.ts:14-18` 无数学扩展；capability 列表无 math |
| `$$`+Return 创建专用输入区 | 未实现 | 阻断 | Typora 用户最常用的创建路径失效 | `createEditorState.ts:114-119` 仅通用 keymap |
| 块公式阅读态渲染 | 未实现 | 阻断 | 文档始终显示 TeX 源，无法阅读公式 | `capabilities/index.ts:20-39` 未注册 math |
| 块公式焦点编辑态与即时预览 | 未实现 | 阻断 | 无灰框、源码区、预览或确认动作 | 无 math widget/extension 目录 |
| 行内 `$...$` 解析与渲染 | 未实现 | 阻断 | 学术和技术正文不能获得行内排版 | 无 InlineMath parser/decorations |
| Inline Math 设置门控 | 未实现 | 高 | 无法控制货币文本与公式语法冲突 | 设置与 i18n 资源无数学项 |
| Pandoc 美元规则 | 未实现 | 高 | `$2` 等文本未来容易被误渲染 | 无定界符解析测试 |
| Legacy 行内兼容模式 | 未实现 | 中 | 迁移旧 Typora 文档时兼容性不可控 | 无偏好模型与 parser 配置 |
| MathJax v4 兼容面与 `\\` 换行 | 未实现 | 高 | Typora 1.13 文档迁移可能渲染不同 | 无 MathJax 直接依赖或适配器 |
| `Ctrl+Shift+M` 插入块 | 未实现 | 高 | 键盘工作流中断 | capability commands 无数学命令 |
| `Ctrl+Return`、方向键、✓、失焦退出 | 未实现 | 高 | 无法形成可预测的焦点状态机 | 无 math interaction 测试或 UI |
| 点击渲染结果回到源码 | 未实现 | 高 | 无法在 WYSIWYG 路径中修正公式 | 无 block/inline math widget |
| TeX 粘贴 | 证据不足 | 中 | 反斜杠、换行与富文本粘贴可能偏离预期 | 无 math paste 单测或 E2E |
| 源码模式显示原始 TeX | 部分实现 | 中 | 通用源码模式可显示字符，但无公式专项验证 | `editorApi.test.ts:129-158` 仅覆盖普通 Markdown |
| 保存与 reopen 的 TeX 字节保真 | 证据不足 | 阻断 | 宏、空白或标签若被改变会损坏文档 | round-trip 存在，但 fixture 列表无 `math.md` |
| 非法 TeX 错误隔离与恢复 | 未实现 | 高 | 一个错误公式可能造成空白、卡顿或无反馈 | 无 renderer/error UI |
| 异步、缓存、取消 | 未实现 | 高 | 多公式文档可能阻塞输入或显示过期结果 | 仅 Mermaid 有专用 scheduler |
| 自动编号、`\label`/`\ref` | 未实现 | 中 | 学术长文交叉引用不可用 | 无渲染配置、索引或测试 |
| Physics 与 mhchem | 未实现 | 中 | 物理、化学文档迁移不完整 | 无包配置与兼容语料 |
| 公式可访问名称与语义输出 | 未实现 | 高 | 屏幕阅读器用户无法理解或定位公式 | 无 math DOM/a11y 契约 |
| 数学 i18n 文案 | 未实现 | 中 | 设置、错误、命令无法中英文一致呈现 | locale 无相关 key |
| 多公式/大文档性能门禁 | 未实现 | 高 | 无法证明输入延迟和滚动不退化 | `tests/perf` 无 math benchmark |

## 7. 根因与架构影响

第一根因是语法层空白。当前 Markdown language 使用 GFM 基线，数学不是 CommonMark/GFM 标准节点；若不增加受控 parser extension，后续 widget 只能用正则全量扫描，容易误识别代码、转义美元、货币和未闭合块，并在每次输入时制造全篇成本。

第二根因是 capability 纵向切片不存在。现有复杂块均沿 `editor/capabilities/<feature>` 组织，而 math 没有 ID、命令、检测、widget、renderer、scheduler、样式和测试。直接把公式塞进 `markdownDecorations.ts` 会扩大通用热路径职责，并让行内显隐、块状态机和异步渲染相互耦合，违反当前模块边界。

第三根因是渲染引擎尚未经过产品语料决策。架构文档偏向 KaTeX 的速度，但 Typora 基线是 MathJax v4，且涉及扩展包、自动编号、`\label`/`\ref` 和换行行为。KaTeX 官方文档表明它有明确的支持函数集合与可配置定界符；MathJax v4 官方文档表明标准 TeX 组件会携带常用扩展并可异步加载其它包。二者都属于成熟依赖候选，但兼容性、体积和可访问性取舍需实测。

第四根因是质量证据空白。通用 round-trip 只遍历 `fixturePaths.ts` 的现有路径清单；该清单缺 `math.md`，所以自动门禁天然看不到数学文档，fixture manifest 的覆盖标签也同样没有数学项。性能基准也没有多公式场景。若先做视觉 widget 后补 fixture，会让源码保真和输入延迟风险推迟到集成末期。

架构影响集中在 `editor`、`features`、`shared` 三层：语法识别、状态机、decorations/widgets 和渲染调度归 `editor/capabilities/math`；设置和用户动作归 `features/settings` 与命令模型；渲染错误、命令、tooltip 和设置标签归 `shared/i18n`。Markdown 全文应继续只存在于 CodeMirror state，React store 不应持有全文或高频公式结果。首期不需要 Rust；只有基准证明 WebView 主线程无法承担批量转换时，才评估 worker 或 Rust 调度，且 Rust command 必须保持薄入口。

## 8. 详细改进方案

### 8.1 模块归属与边界

新增 `src/editor/capabilities/math/`，内部按职责拆为 `mathSyntax`、`mathBlockDetection`、`mathDecorations`、`MathBlockWidget`、`mathRenderAdapter`、`mathRenderScheduler`、`mathCommands` 和样式。把 `math` 加入 `EditorCapabilityId` 并由 `createLivePreviewCapabilities` 注册；源码模式不挂载渲染扩展。行内与块级共享解析契约和渲染适配器，但使用不同 decoration：块级 widget 提供焦点源码区与预览，行内 replacement decoration 只在光标不在 span 内时替换。

公式交互状态应从 CodeMirror selection 和语法范围派生，不在 React store 复制“当前公式”。状态转换至少包含阅读态、焦点编辑态、渲染中、渲染成功和渲染错误；焦点移动、文档 transaction、模式切换和异步结果都要带文档版本/范围身份，过期结果不得写回当前 widget。

### 8.2 成熟依赖优先

先建立同一份兼容语料，分别对 KaTeX 与 MathJax v4 做小样：基础算式、AMS 环境、多行 `\\`、Unicode、宏、自动编号、Physics、mhchem、`\label`/`\ref`、非法命令和超长输入。KaTeX 候选依据是官方支持函数表、定界符配置和错误回调；MathJax v4 候选依据是标准/最小 TeX 组件、扩展包和 promise 异步加载。不得调用 Mermaid 的传递 KaTeX；选定后必须在 `package.json` 直接声明并锁定版本。

如果 KaTeX 满足 P0/P1 语料，可将高级 MathJax 兼容项明确留在 P2；如果 Typora 迁移语料在 P0 即依赖 MathJax 特性，则选择可裁剪的 MathJax v4 组件并懒加载。只有两个成熟引擎都经基准证明无法满足源码兼容、离线、性能或可访问性目标时，才形成自研例外记录并请求批准；当前没有任何证据支持自研 TeX 引擎。

### 8.3 数据流与性能

transaction 发生后，只对变更覆盖的语法块和相邻定界符边界增量重算；不可在每次按键时扫描全文。渲染请求包含 source、displayMode、engineVersion、packageConfig、theme 和宏配置的稳定缓存键。调度器支持 debounce、并发上限、显式取消、代际校验和可观测耗时，复用 Mermaid 的设计思想但不复用其特定类型。

优先渲染视口内公式；离屏块延迟处理。行内短公式可在测量后走更轻路径，批量打开文档必须异步分片。渲染引擎和字体按需加载，不进入首屏关键 chunk。主题变化只使相关渲染缓存失效，不改动 Markdown 文本。

### 8.4 源码保真与解析规则

CodeMirror 文档始终是唯一事实来源；widget 只读源范围并通过 transaction 修改局部文本。不得把渲染 HTML/SVG/MathML 写回 Markdown。解析器必须排除 fenced/inline code、转义美元、货币场景和未闭合定界符；行内默认实现基线中的 Pandoc 约束，Legacy 作为显式设置。创建、退出和点击编辑只能改变 selection/decorations，不能规范化用户宏、空白、换行或定界符。

新增 `tests/fixtures/markdown/math.md` 及 manifest/path 注册，覆盖 CRLF/LF、中文与英文、美元金额、反斜杠、空行、宏、环境、标签、错误 TeX 和未闭合输入。open → save → byte diff 必须为零；编辑单一公式后，只允许目标范围产生预期 diff。

### 8.5 i18n、可访问性与错误处理

所有“插入公式”“刷新公式”“行内公式”“公式渲染失败”“重试”“公式编辑完成”等文案进入英文和简体中文资源。✓ 不能只靠图形表达，应有本地化 accessible name 与 tooltip。公式 widget 应可通过键盘进入/退出，焦点顺序稳定，Escape 不与行内创建语义冲突；阅读态输出优先使用引擎提供的 MathML/语义辅助能力，并为错误态提供可聚焦、可朗读但不抢焦点的说明。

渲染异常只影响当前公式：保留并展示可编辑源码，提供简短本地化错误和重试/刷新入口，不以空白替代内容，不向文档写入错误信息。捕获异步错误后记录公式身份、引擎版本、耗时和错误类别，禁止记录完整私密文档。超长输入、递归宏或包加载失败需有上限和取消路径。

## 9. P0/P1/P2 分阶段计划

### P0：正确性与安全基础

1. 建立数学语法契约与 `math.md` fixture，先让解析、美元歧义、未闭合定界符和字节级 round-trip 测试失败，再做最小实现。
2. 用统一语料完成 KaTeX/MathJax v4 小样，记录兼容差异、直接依赖体积、首次/缓存渲染耗时、错误隔离和可访问输出，形成依赖决策记录。
3. 建立独立 math capability、块/行内范围检测、渲染适配器、可取消调度器和错误模型；不在通用 markdown decoration 热路径堆逻辑。
4. 完成最小块公式阅读态、焦点编辑态、源码模式和 save/reopen；保证非法 TeX 不破坏编辑与保存。

### P1：日常 Typora 迁移体验

1. 补齐 `$$`+Return、`Ctrl+Shift+M`、`Ctrl+Return`、方向键、点击外部和确认按钮的状态机。
2. 实现 Inline Math 设置、Pandoc 默认规则、行内阅读/焦点展开和 `$`+Esc，并对货币、转义和中英文相邻字符做系统测试。
3. 完成 TeX 纯文本粘贴、undo/redo、IME、选区、复制、模式切换光标/滚动保持、主题切换和中英文 i18n。
4. 建立视口优先、缓存、取消和多公式性能门禁；增加关键 E2E 与亮/暗主题截图回归。

### P2：完整度与高级学术能力

1. 依据引擎能力补自动编号、Physics、mhchem、`\label`/`\ref` 和 Math Tools 刷新。
2. 增加 Legacy 行内解析模式、宏/包配置迁移策略和更完整的 Typora 1.13 MathJax v4 兼容语料。
3. 完成多公式大文档、跨平台字体、辅助技术、导出一致性和长期缓存治理。

## 10. 可执行验收标准与测试计划

### 10.1 验收标准

1. 在 live preview 空行输入 `$$`+Return 后进入块公式编辑态，源码仍为合法的成对定界符；输入 `E=mc^2` 后同块出现预览，退出后只显示阅读态公式。
2. `Ctrl+Shift+M` 创建块，`Ctrl+Return`、方向键、确认按钮和点击块外均按明确状态转换退出；每条路径可撤销、重做，且不移动无关文本。
3. Inline Math 关闭时 `$x$` 保持文本；开启时合法 `$x$` 渲染，`$  x$`、`$x $`、`$2`、转义美元和 code span 按规则不误渲染；Legacy 仅在对应设置开启后改变解析。
4. live preview/source 往返不改变任何字符，光标与滚动落在同一公式附近；保存再打开后 fixture 字节完全一致。
5. 非法 TeX 显示局部、本地化、可访问错误，源码仍可编辑和保存；修正后可恢复渲染，无需重启应用。
6. 渲染任务可取消，旧结果不会覆盖新输入；主题或设置变化不会修改 Markdown。
7. 英文和简体中文包含完整命令、设置、tooltip 与错误文案；键盘可完成创建、进入、编辑、退出和重试。
8. 1MB 含公式文档打开目标低于项目 300ms 基线需要拆分为“文本可编辑时间”和“公式逐步完成时间”；输入 transaction 的 P95 尽量低于 16ms，渲染不得阻塞输入，滚动体验接近 60 FPS。预算若需调整，必须用独立基准与决策记录说明，不得直接放宽门禁。

### 10.2 Unit

- parser：块/行内范围、Pandoc/Legacy、转义、货币、代码区、未闭合定界符、CRLF、Unicode、宏和环境。
- commands：插入块、结束编辑、selection 映射、局部修改与 undo/redo。
- scheduler/cache：缓存键、debounce、并发、取消、过期代际、错误重试、主题/引擎/包配置失效。
- renderer adapter：基础公式、错误对象归一化、危险输入边界、MathML/可访问输出。

### 10.3 Integration

- CodeMirror state + math capability：阅读态/焦点态切换、行内 span 展开、源码模式重配、IME composition、选区和剪贴板。
- 设置热更新：Inline Math、Legacy、编号和包配置变化后只重配数学扩展；若必须重载，显示本地化提示。
- 文件链路：open → edit one formula → save → reopen，断言只有目标范围变化；未编辑 `math.md` 做字节对比。

### 10.4 E2E 与视觉

- 真实用户路径覆盖新建、键入块公式、键盘退出、点击再编辑、行内门控、粘贴 TeX、保存、重开、切源码、切语言和切主题。
- 对亮色/暗色的块阅读态、焦点灰框、行内公式、错误态、长公式横向溢出做截图回归。
- Windows 中文 IME 为必测项，并在 macOS/Linux 抽检快捷键映射、字体和屏幕阅读器语义。

### 10.5 Fixture 与 perf

- `math.md` 覆盖简单/复杂/错误/歧义/跨平台换行；另建可生成的多公式性能语料，避免把巨大生成文件人工维护进专题报告。
- 独立 `pnpm perf:bench` 场景覆盖 1MB 文档首个可输入时间、视口 20 个公式完成时间、100/1000 个公式调度、持续输入时 P50/P95 transaction、快速修改同一公式的取消率、滚动与内存峰值。性能测试不得与构建、E2E、typecheck 或 lint 并行。

本文是纯文档分析，没有运行上述未来测试，也不声称任何数学功能通过自动化验证。

## 11. 风险与未核实项

- Typora 非法 TeX 的精确视觉、错误文本和恢复动作仍未本机复核；实现时应先观察再定义像素级追平范围。
- Typora 行内公式点击后是否总是显露两个 `$`、`$`+Esc 的精确时序、Inline Math 设置在 1.13.7 是否要求窗口重载，当前证据仍不完整。
- 公式输入区粘贴普通文本、HTML 和多行环境的 Typora 行为未核实；不能把通用 Smart Paste 规则直接套用。
- KaTeX 与 MathJax v4 的最终选择未核实。架构文档偏向 KaTeX，但 Typora 兼容语料可能迫使 P1 使用 MathJax；反之，若常用语料完全覆盖，MathJax 的体积和异步包加载成本可能没有必要。
- MathJax/KaTeX 的当前官方版本与仓库 lockfile 传递版本不同；引入直接依赖时必须重新核对发布版本、安全公告、许可证、字体许可和阿里云镜像可用性。
- 生产组装已向 `prepareTextForSave` 注入图片草稿归档转换，而当前 fixture round-trip 没有注入它；数学 fixture 必须同时覆盖默认恒等路径与生产准备路径，并证明不含图片草稿的 TeX 文档不被意外改写。
- 公式是 decorations/widgets 与异步渲染的性能敏感专题。若沿用 Mermaid 当前全篇 decoration 重建方式，可能在多公式大文档中产生输入退化；应以增量范围与独立 perf 数据约束实现。
- 本报告没有运行产品、单元测试、E2E 或性能基准；当前结论来自静态仓库证据和既有 Typora 基线。

## 12. 证据索引

### 12.1 必读契约与 Typora 基线

- `AGENTS.md`：架构分层、成熟组件优先、源码保真、i18n、性能与文档治理。
- `DEVELOPMENT_PROCESS.md`：测试先行、fixture round-trip、数学公式性能纪律与完成门禁。
- `docs/product/typora-baseline/09-math.md`：Typora 1.13.7 数学创建、阅读/编辑、MathJax v4、设置、快捷键与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：live preview/source、块焦点、span 展开、复制粘贴、IME 与模式切换横切模型。

### 12.2 LumaMark 代码、测试与 fixture

- `package.json:33-64`：没有直接 KaTeX/MathJax 依赖。
- `pnpm-lock.yaml:2020-2022,4841-4843,4954-4970`：KaTeX 由 Mermaid 传递引入。
- `src/editor/markdown/markdownLanguage.ts:14-18`：仅通用 GFM Markdown 配置。
- `src/editor/markdown/markdownLanguage.test.ts:6-26`：language 测试只覆盖 fenced TypeScript 高亮。
- `src/editor/core/createEditorState.ts:97-120`：通用语言、历史和 keymap 装配。
- `src/editor/core/editorDisplayMode.ts:42-57`：source/live preview 扩展边界。
- `src/editor/core/editorApi.ts:78-80,151-161`：文档字符串读取与模式重配。
- `src/editor/core/editorApi.test.ts:129-158`：一般 Markdown 跨模式文本与 undo 保持。
- `src/editor/capabilities/editorCapability.ts:3-20`：capability/commands 无 math。
- `src/editor/capabilities/index.ts:20-49`：只注册 code block、image、table、mermaid。
- `src/editor/capabilities/mermaid/mermaidRenderScheduler.ts:38-85,109-144`：可借鉴的缓存、取消、过期结果和错误模型。
- `src/editor/capabilities/mermaid/mermaidPreviewExtension.ts:126-132`：现有复杂块 debounce 示例。
- `src/features/file-actions/fileActions.ts:139-157`：保存取 CodeMirror 当前文本，经可选准备函数后写入。
- `src/app/controllers/useAppDocumentModel.ts:64-66`：生产组装注入图片草稿归档准备函数。
- `tests/fixtures/roundTrip.test.ts:8-70`：对 `fixturePaths.ts` 路径执行默认恒等准备的字节级 round-trip。
- `tests/fixtures/fixturePaths.ts:5-26`、`tests/fixtures/markdownFixtureManifest.ts:7-167`：均无 `math.md`；前者直接驱动 round-trip，后者驱动覆盖标签检查。
- `docs/product/V1_VERSION_DESIGN.md:163-170`：数学公式在 V1 设计中延后，不能证明实现。
- `docs/architecture/DETAILED_ARCHITECTURE.md:141,583-587,632-637,672-680`：KaTeX 候选、capability/cold path 和小样验证要求，均属规划。

### 12.3 官方依赖资料

- [KaTeX Auto-render Extension](https://katex.org/docs/autorender.html)：定界符顺序、行内 `$` 需显式配置、错误回调与忽略 code/pre 等边界。
- [KaTeX Supported Functions](https://katex.org/docs/supported)：受支持 TeX 函数集合，适合作为兼容语料对照。
- [MathJax 4 Input Components](https://docs.mathjax.org/en/v4.0/web/components/input.html)：标准/最小 TeX 组件、扩展包与异步加载差异。
- [MathJax TeX and LaTeX Support](https://docs.mathjax.org/en/latest/input/tex/index.html)：定界符、TeX 子集、扩展、编号和宏能力边界。
