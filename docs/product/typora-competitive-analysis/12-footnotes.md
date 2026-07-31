# 1. LumaMark 脚注（Footnotes）竞品差距分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - protected-source 分析现能识别脚注引用与定义，并阻止通用链接装饰误处理；单元与 UI 测试证明这些源码在 live preview 中保持可见。
> - 这只是安全降级，不是脚注功能。语义解析、编号、阅读态部件、悬停/导航及完整 fixture 仍在共享 heading identity 之后的 Next 阶段。

## 2. 用途、范围与非目标

本文用于回答一个严格限定的问题：LumaMark 当前对 MultiMarkdown 风格脚注的真实支持程度，与 Typora 1.13.7 的公开脚注体验相比还差什么，以及应如何在不牺牲 Markdown 源码保真、编辑器响应速度和长期架构边界的前提下补齐。

范围包括正文引用 `[^id]`、定义 `[^id]: content`、定义内行内 Markdown、实时预览阅读态、焦点编辑态、源码模式、键盘与鼠标路径、粘贴、保存、悬空或重复标识符等错误与边界，以及对应的测试与性能门禁。本文以 `docs/product/typora-baseline/12-footnotes.md` 和其直接引用的 `00-live-preview-model.md` 为 Typora 基线，再以当前 `src/`、`tests/`、`package.json` 与 `pnpm-lock.yaml` 为 LumaMark 实现证据。

非目标：不分析导出 PDF/HTML 时的脚注排版，不扩展到引用链接、数学公式、TOC 或 Callouts，不臆造 Typora 未经基线核实的点击跳转、回链、自动编号算法或定义区自动整理行为，不把规划文档当作功能已经存在的证明，也不提出更换 CodeMirror 6 主编辑器核心。

## 3. 执行摘要

LumaMark 当前可以把脚注源码当作普通文本输入、编辑、切到源码模式查看，并通过通用文件保存链路写回磁盘。这说明“原文可承载”存在，但不等于“脚注功能存在”。仓库没有脚注专属语法扩展、capability、引用—定义索引、上标 widget、悬停预览、跳转命令、脚注文案、fixture 或自动化行为测试。

更重要的是，现状并非仅仅“没有美化”。当前编辑器以 `@codemirror/lang-markdown` 的 GFM 基础语言解析文档；定点解析探针显示，正文 `[^fn1]` 会进入普通 `Link` 节点。通用 WYSIWYG 装饰器又会把所有 `Link` 标成 `.lm-md-link`，并在非活动行隐藏 `LinkMark`。因此脚注引用可能呈现为去掉方括号、带下划线和强调色的普通链接文本，而不是上标脚注；复杂定义也可能退化为普通段落中的同类伪链接。这是误呈现风险，而非单纯缺少增强效果。

综合判断：脚注源码输入与通用保存为“部分实现”；脚注语义识别、Typora-like 阅读与编辑体验、创建入口、键盘/鼠标交互、异常反馈和专属验证均为“未实现”；对于 Typora 的点击跳转、自动编号显示、定义区整理、复杂粘贴和若干错误行为，现有基线只能判为“证据不足”。首要工作不是立即堆叠 tooltip，而是先建立脚注语法边界与引用—定义模型，阻止它落入普通链接装饰，再在同一能力模块上增量实现上标、预览和导航。

## 4. Typora 功能与完整体验基线

### 4.1 创建

基线已确认 Typora 支持 MultiMarkdown 风格的正文引用 `[^id]` 与定义 `[^id]:`，标识符需要唯一并与引用匹配；定义内容可以包含强调、粗体等行内 Markdown。公开基线没有记载专用菜单、命令面板或快捷键，因此不能把这些入口当作追平要求。可确认的创建主路径是直接键入源码语法。行内脚注的另一种 MultiMarkdown 写法未在基线展开，本文不纳入承诺。

### 4.2 阅读态

非焦点阅读态的已确认行为是：正文引用显示为上标，并可通过悬停查看脚注内容。其体验价值在于作者无需滚动到定义处即可阅读注释，同时正文视觉噪音低。定义区究竟是否折叠、是否自动汇总到末尾、上标显示采用标识符还是自动数字，基线没有完成 GUI 复核，均应保持“证据不足”，不能据此设计成强制重排源码的功能。

### 4.3 焦点编辑态

用户必须能编辑 `[^id]` 和定义文本。横切 live preview 模型说明，一般行内元素在阅读态渲染，光标进入 span 时会展开必要源码；但脚注定界符何时、以何种粒度展开，脚注基线明确未逐步核实。因此追平目标可以要求“焦点进入后无障碍编辑原始引用和定义，离开后恢复阅读态”，但不能宣称 Typora 对脚注精确采用了哪一种 span 展开动画或选区规则。

### 4.4 源码模式

源码模式应完整显示引用和定义的原始 Markdown，live preview 与源码模式编辑同一份文档。横切基线还要求模式切换不改写文档，并记录 Typora 1.13 对滚动位置保留的改进。脚注专题的刚性底线是：切换模式、编辑、撤销重做与保存都不得重编号、移动定义、规范化空白或重写无关文本。

### 4.5 键盘

已确认创建可依靠直接键入；未记载脚注专用快捷键。键盘体验的合理验收边界应来自可访问性和通用编辑器纪律：Tab 不应被脚注预览困住，Escape 可关闭预览，引用可获得键盘等价的查看与导航路径，撤销重做保持单一历史，IME 组合输入期间不得提前把尚未确认的 `[^` 序列替换成 widget。这些是 LumaMark 应达到的质量要求，不是对 Typora 已实测细节的断言。

### 4.6 鼠标

基线确认悬停上标查看内容；是否单击跳到定义、定义处是否提供回链尚未核实。因而鼠标追平的最低范围是稳定悬停预览、移入弹层时不意外关闭、选中文本时不劫持拖拽。点击导航可作为增强项，但在报告中仍需与已确认的 Typora 行为分开。

### 4.7 粘贴

横切模型确认 Typora 有普通粘贴、Smart Paste 和粘贴为纯文本等通用路径，但脚注基线未实测粘贴含引用与定义时的配对、编号或重排行为。最低保真要求是粘贴 Markdown 文本时保持其字符与换行，并在语法完成后建立语义；从富文本粘贴是否应生成脚注没有证据，不应在首期自动推断。

### 4.8 保存

基线确认落盘形态保留 `[^id]` 标记与定义行，定义内可保留行内 Markdown。保存不得为了显示编号而修改 id，不得把定义移动到文末，也不得因 hover 缓存生成隐藏内容。打开—编辑—保存—重开后，仅用户明确编辑的范围允许发生变化。

### 4.9 错误与边界

缺失定义、重复 id、多个引用指向一个定义、大小写是否敏感、空定义、多段定义、定义内嵌套结构、转义和代码区中的 `[^id]`，Typora 基线均未完整核实。竞品事实应标为“证据不足”；但 LumaMark 仍须定义自己的安全行为：不崩溃、不错误打开链接、不吞字符、不静默改写，无法解析时退化为可编辑源码，并以非阻塞方式提示可修复问题。

## 5. LumaMark 当前功能清单与证据

| 能力项 | 状态 | 精确证据 | 结论 |
|---|---|---|---|
| 原始脚注文本可装入编辑器 | 部分实现 | `src/editor/core/createEditorState.ts:97-122` 创建 CodeMirror 文档；`src/editor/core/createEditorState.test.ts:8-14` 证明一般 Markdown 字符串原样进入 state | 通用文本能力可承载脚注字符，但测试样本不是脚注 |
| GFM Markdown 解析底座 | 已实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 使用 `markdown({ base: gfmMarkdownLanguage })`；`package.json:34-45` 声明 CodeMirror 与 Lezer Markdown 依赖 | 存在成熟解析底座，但未注册脚注扩展 |
| 脚注专属语法识别 | 未实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 只有 base 与代码语言；在 `src/`、`tests/` 中定点检索无 `footnote`、`脚注` 命中 | 没有 FootnoteReference/Definition 语义层 |
| 引用误当普通链接的防护 | 未实现 | 定点解析探针把 `Text[^fn1].` 输出为 `Paragraph(Link(LinkMark,LinkMark))`；`src/editor/wysiwyg/markdownDecorations.ts:234-241` 将所有 `Link` 标为 `.lm-md-link` | 现状存在错误分类与错误视觉语义 |
| 阅读态上标 | 未实现 | `src/editor/wysiwyg/markdownDecorations.ts:211-340` 的节点映射没有 footnote 分支；`src/editor/wysiwyg/wysiwyg.css:160-164` 只有普通链接样式 | 不会形成上标引用 |
| 非焦点标记显隐 | 部分实现 | `src/editor/wysiwyg/markdownDecorations.ts:453-500` 在非活动行隐藏 `LinkMark`、在活动行保留 | 通用显隐存在，但会把脚注方括号按链接规则隐藏，不能视为脚注体验 |
| 定义配对与索引 | 未实现 | `src/editor/capabilities/index.ts:20-31` 仅注册 codeBlock、image、table、mermaid；`src/editor/capabilities/editorCapability.ts:3-20` 的 capability id 与命令均无 footnote | 无法从引用解析定义，也不能检测悬空或重复 id |
| 悬停预览 | 未实现 | capability 注册、WYSIWYG widget 与 CSS 均无脚注预览；`src/editor/core/EditorViewHost.tsx:107-119` 只提供通用编辑器容器 | 没有内容弹层、定位、焦点管理或关闭规则 |
| 引用与定义导航 | 未实现 | `src/editor/capabilities/editorCapability.ts:5-15` 无脚注导航命令；命令与 UI/i18n 定点检索无脚注命中 | 鼠标和键盘都没有跳转/回链 |
| 专用创建入口 | 未实现 | `src/features/commands/`、`src/editor/commands/` 及中英文 i18n 资源无 footnote/脚注命中 | 只能手工键入，且没有配对辅助 |
| 源码模式完整可见 | 部分实现 | `src/editor/core/editorDisplayMode.ts:42-57` 源码模式只附加 class、live preview 才注册能力；`tests/e2e/editor-markdown.spec.ts:529-560` 验证一般 Markdown 切换不改源码 | 架构上会显示原文，但没有脚注专属 E2E 证据 |
| 通用保存源码 | 部分实现 | `src/editor/core/editorApi.ts:78-80` 返回 state 文本；`src/features/file-actions/fileActions.ts:139-157` 在写入前调用 `prepareTextForSave`；生产 wiring 在 `src/app/controllers/useAppDocumentModel.ts:62-64` 用它完成草稿图片 URL 收口；`tests/fixtures/roundTrip.test.ts:8-72` 对已登记 fixture 做字节级 round-trip | 保存链路具备保真基础，但存在明确的保存期图片转换，且 fixture 清单没有脚注样本，不能宣称脚注已专项保真 |
| 脚注 fixture 与自动化测试 | 未实现 | `tests/fixtures/markdownFixtureManifest.ts:7-167` 没有 footnotes 条目；非 large fixture 定点检索无 `[^`；`src/`、`tests/` 无脚注命中 | 当前没有证据证明引用、定义、粘贴、保存或错误边界正确 |
| 脚注性能门禁 | 未实现 | 现有 `tests/perf/` 有大文档与 Mermaid 基准，但定点检索无脚注；解析和 decoration 当前是编辑热路径 | 无法判断大量引用、长定义或 hover 索引成本 |

## 6. 当前真实体验路径

1. 用户在 live preview 中键入 `Text[^fn1].`。字符进入 CodeMirror 文档，因没有脚注扩展，基础 GFM 解析器把 `[^fn1]` 归入普通 `Link`。
2. 光标仍在当前行时，通用活动行规则不隐藏方括号，用户主要看到可编辑源码片段；没有配对建议、自动创建定义或错误提示。
3. 光标离开该行后，通用装饰器给整个片段应用 `.lm-md-link` 的强调色和下划线，并隐藏 `LinkMark`。用户可能看到类似 `^fn1` 的普通链接文本，而非脚注上标。它没有可用的真实 URL，也没有脚注点击语义。
4. 用户键入 `[^fn1]: Here is *note*.`。复杂定义不会建立脚注定义节点与引用关系；其中的 `[^fn1]` 仍可能按普通链接片段装饰，后续强调可由通用强调装饰处理，但这不构成“定义内容已作为脚注渲染”。
5. 悬停引用时没有脚注内容预览；键盘也没有查看、跳转、返回或错误定位命令。悬空引用和重复定义不会得到脚注级诊断。
6. 切换源码模式后，live preview capability 被移除，用户可直接看到和编辑原始字符。现有通用模式测试支持“源码模式保留一般 Markdown”的判断，但未覆盖脚注。
7. 保存时，编辑器把当前完整字符串交给文件动作；生产链路随后通过 `prepareTextForSave` 调用 `finalizeAllDraftImages`，会收口文档中的草稿图片 URL。普通脚注标记没有专属保存转换，但定义内同样可能包含图片，因此不能假设整个脚注定义在所有保存场景都逐字直通。现有字节级 round-trip 遍历的 manifest 又没有脚注 fixture，所以不能把通用链路推演为已通过脚注专项验证。

## 7. 逐项差距矩阵

| 差距 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 正文引用被识别为普通 Link，而非脚注引用 | 未实现 | 阻断 | 阅读语义错误，脚注看起来像不可用链接 | `markdownLanguage.ts:14-18`；解析探针；`markdownDecorations.ts:234-241` |
| `[^id]:` 定义未形成可索引定义 | 未实现 | 阻断 | 无法配对、预览、导航或诊断 | `capabilities/index.ts:20-31` 无脚注能力 |
| 阅读态上标渲染 | 未实现 | 高 | 文档密度和可读性未达到 Typora 基线 | `markdownDecorations.ts:211-340` 无映射；CSS 无脚注样式 |
| 悬停内容预览 | 未实现 | 高 | 阅读脚注必须手动搜索定义 | 无 widget、tooltip 或 popover 证据 |
| 焦点态可靠展开并编辑源码 | 部分实现 | 高 | 原文可编辑，但显隐以“活动行”而非脚注 span 为边界，体验粗糙且可能跳变 | `markdownDecorations.ts:453-500` |
| 定义内强调等行内 Markdown 的脚注预览 | 未实现 | 中 | 即使定义中源码能保留，也无法在预览层显示格式 | 无脚注渲染链路；仅通用强调装饰 |
| 悬空引用、重复 id、空定义诊断 | 未实现 | 高 | 错误静默存在，用户难以发现发布前问题 | 无索引、lint 或错误文案 |
| 多引用指向同一定义 | 未实现 | 中 | 不能稳定编号、导航或生成回链 | 无引用集合模型 |
| 代码围栏、行内代码中的伪脚注隔离 | 证据不足 | 高 | 若用正则补丁易误识别并破坏源码 | 当前没有脚注实现与专项测试 |
| 鼠标点击跳转和定义回链与 Typora 精确一致 | 证据不足 | 中 | 无法确定“追平”应包含哪种点击细节 | Typora 基线明确列为未核实 |
| 键盘查看、跳转、关闭预览 | 未实现 | 高 | 键盘与辅助技术用户无法使用等价交互 | 无命令、ARIA 和 i18n 证据 |
| 粘贴包含完整脚注时的配对与保真 | 证据不足 | 高 | 迁移已有 Markdown 文档时结果不可证明 | 无脚注 paste 集成/E2E |
| 保存与重开后的脚注专项字节保真 | 证据不足 | 阻断 | Markdown 源文件唯一事实来源的门禁未建立 | round-trip 有通用机制，但 manifest 无脚注 fixture |
| 中英文可见文案与错误消息 | 未实现 | 中 | 未来错误、命令或预览辅助文本会违反 i18n 契约 | 中英文资源无脚注 key |
| 大量脚注的输入延迟、滚动与内存预算 | 证据不足 | 高 | 全文重建索引或 DOM 弹层可能拖慢长文档 | 无脚注 perf 基准 |

## 8. 根因与架构影响

第一根因是语法层缺口。`markdownLanguage()` 只使用 GFM 基础语法，没有脚注扩展。脚注字符形状与引用链接定义高度相似，缺少显式 grammar 时会被现有链接规则抢占。若仅在 CSS 中把 `^` 文本改为上标，既不能可靠识别定义，也无法排除代码区、转义文本和普通链接引用，反而会固化错误语义。

第二根因是能力边界缺口。当前复杂编辑体验通过 `editor/capabilities` 注册，但 capability id 只有 codeBlock、image、mermaid、table。脚注同时涉及解析、文档级索引、视图 decoration、交互与诊断，不能继续塞进 `markdownDecorations.ts` 的大 switch；否则普通链接和脚注会共享脆弱条件，文档每次输入还可能触发全量配对扫描。

第三根因是验证样本缺口。通用 round-trip 测试设计正确，却只能覆盖 manifest 中已有文件。没有脚注 fixture，意味着最关键的“打开—保存无关 diff 为零”没有输入样本；更没有 edit—save—reopen、IME、复制粘贴、定义变更后预览刷新、重复 id 或长文档压力测试。

架构上应维持单一 Markdown 文档事实源：React store 不持有脚注正文或全文，脚注索引作为 CodeMirror state field/derived cache 存在；UI shell 只调用稳定命令，不解析 Markdown；文件 services 和 Rust command 无需理解脚注；source mode 不挂载脚注 widget。若未来导出需要脚注，可复用明确的语义模型或成熟渲染插件，但不能让导出解析器反向成为编辑器事实源。

## 9. 详细改进方案

### 9.1 模块归属

在 `src/editor/capabilities/footnote/` 建立独立纵向切片，至少分为语法/索引、decorations、preview widget、commands 与 diagnostics。`createFootnoteCapability()` 只向 live preview 注册扩展；源码模式继续展示原文。通用 `markdownDecorations.ts` 应增加明确的脚注排除或交由语法节点优先级解决，避免 `FootnoteReference` 再进入普通 `Link` 分支。`EditorCapabilityId` 可新增 `footnote`，若首期没有公共命令，commands 仍可保持最小。

### 9.2 成熟依赖优先

首选沿用已安装的 `@lezer/markdown` / `@codemirror/lang-markdown` 扩展机制，在同一语法树中识别脚注，而不是并行维护一套正则解析器。实现前应以本仓库锁定版本做小型 grammar 原型，验证节点优先级、增量解析和 GFM 链接兼容性。仓库已有 `markdown-it` 仅用于表格预览，不能未经评估就扩展为编辑器第二事实源。若评估 `markdown-it-footnote` 或其它插件，必须先记录维护状态、许可证、Typora/MultiMarkdown 方言匹配、包体与解析差异；在这些证据完成前不把它写成既定依赖，也不自研通用 popover。`package.json:50` 虽已安装 Radix Tooltip，但当前生产 `src/` 没有可直接复用的 Tooltip 封装，只有 prototype 用例；实现前必须按内容语义评估成熟浮层：纯只读短文本可用 tooltip，包含链接、滚动或其它可交互内容时应采用支持焦点管理的 popover/dialog 类组件，不能用 tooltip 语义承载交互控件。

### 9.3 数据流与增量更新

语法节点产出引用和定义的精确范围；state field 维护 `id -> definition` 与 `id -> references[]`，transaction 只重算受变更范围影响的条目，并用文档版本使过期预览失效。Decoration 只读取索引，不把定义正文复制到 React state。hover/focus 时按 id 取当前定义并渲染，离开或文档变更后安全关闭或刷新。对于重复 id，索引保留全部定义位置而不是静默覆盖。

### 9.4 源码保真

上标、预览和诊断全部使用 decoration/widget，不改文档文本。自动创建定义若后续提供，必须是用户显式命令且产生单一可撤销 transaction；默认不重编号、不移动定义、不折叠定义、不规范化空格和换行。粘贴直接插入原字符，再由增量语法层解析。所有修改命令需要精确 changes 范围，并用 edit—save—reopen fixture 证明无关 diff 为零。

### 9.5 i18n 与可访问性

所有命令名、悬空/重复定义提示、预览空状态和可见辅助文字同时进入 `zh-CN.json` 与 `en.json`。上标引用需要可聚焦的语义元素或等价键盘路径，accessible name 应表达“脚注引用 + 可见编号/标识符”，不能只读作“链接”。预览必须支持 hover 与 focus；只读说明可关联 `aria-describedby`，含交互内容则使用适当的 popover/dialog 语义与焦点规则，不能混用 tooltip 角色。Escape 关闭，焦点不被偷走，缩放和高对比主题可读。仅装饰性括号隐藏继续 `aria-hidden`，但脚注正文不能对屏幕阅读器重复播报。

### 9.6 错误处理

悬空引用、重复定义、空定义采用非阻塞诊断，编辑仍可继续；预览解析失败时显示本地化错误并保留跳到源码的路径，不用空白弹层掩盖异常。任何未知或不完整语法退化为原始可编辑文本。脚注绝不能调用普通链接打开器，不能把 id 当 URL。多段定义或嵌套语法在未支持时应由 fixture 固定退化行为，而不是启发式吞行。

## 10. P0 / P1 / P2 分阶段计划

### P0：语义正确与源码安全

1. 为锁定版本的 Lezer Markdown 增加脚注语法原型与解析单测，覆盖引用、定义、普通链接引用、代码区、转义、中文 id、悬空和重复 id。
2. 建立 footnote capability 与增量索引，优先阻止 `[^id]` 落入 `.lm-md-link`；不具备脚注语义时安全显示源码。
3. 增加 `footnotes.md` fixture 及 manifest 条目，完成未编辑 round-trip 和 edit—save—reopen 精确 diff 门禁。
4. 加入最小阅读态上标和焦点态源码编辑，验证 IME、撤销重做、选区与复制不回归。
5. 单独运行脚注规模基准，证明索引与 decorations 不在普通输入中全量扫描或制造大量 DOM。

### P1：核心阅读与导航体验

1. 使用经语义评估的成熟可访问浮层实现 hover/focus 预览，渲染定义内强调、粗体、行内代码和链接，同时限制危险 HTML；若内容允许链接交互，必须选用 popover/dialog 类语义而不是 Tooltip。
2. 提供引用跳到定义、定义回到上一引用的键盘与鼠标命令；点击行为与 Typora 未核实项保持产品差异说明。
3. 加入悬空、重复和空定义诊断及中英文文案；定义编辑时实时刷新预览。
4. 覆盖完整 Markdown 粘贴、纯文本粘贴、模式切换和保存重开 E2E。

### P2：完整度与规模化体验

1. 在实测 Typora 后决定自动显示编号、定义整理、多引用回链和多段定义的精确兼容范围。
2. 评估显式“插入脚注”命令和命令面板入口；不新增未经需求证明的专用菜单层级。
3. 补齐大文档、数百/数千脚注、超长定义、跨平台字体与高对比主题验证。
4. 若导出链路纳入范围，再单独决策编辑语法模型与导出插件的共享边界。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. `Sentence[^a].` 在非焦点 live preview 显示为可辨识上标，不带普通链接下划线；聚焦后可无损编辑全部源码字符。
2. `[^a]: **bold** and *emphasis*` 与引用建立配对，hover 和键盘 focus 均能查看格式化内容；编辑定义后预览更新且光标不跳。
3. 悬空引用、两个同 id 定义、空定义不会崩溃或打开链接，均给出本地化、非阻塞诊断，并保留源码编辑。
4. 行内代码、代码围栏、转义文本中的 `[^a]` 不被识别为脚注；标准 `[label](url)` 和 `[label]: url` 行为不回归。
5. live preview 与 source 反复切换、撤销重做、中文 IME 组合、选择、复制和粘贴后文档文本符合预期；跨越上标与正文的选区不跳位，Copy as Markdown/底层源码复制保留 `[^id]`，普通可见文本复制不重复脚注正文，且无 widget 字符进入源码或剪贴板。
6. `footnotes.md` 未编辑 open—save 的字节 diff 为零；定点编辑一个定义后，除目标范围外 diff 为零；重开后引用仍配对。
7. 中英文模式下命令、诊断和预览辅助文本均完整，键盘可达，Escape 关闭预览，屏幕阅读器获得正确语义。
8. 1MB 文档含至少 1,000 个引用时，输入延迟预算沿用项目普通输入尽量低于 16ms 的门禁；基准必须独立运行并报告 p95、索引更新时间与 DOM/widget 数量。

### 11.2 Unit

- grammar：引用、定义、合法 id、中文与符号 id、转义、代码上下文、普通链接冲突、多段定义。
- index：新增、删除、改名、重复、悬空、多引用同定义、transaction 增量更新与缓存失效。
- decoration：非焦点上标、活动 span 源码展开、普通链接不回归、未知语法退化。
- commands/diagnostics：跳转目标、返回引用、错误范围、i18n key 完整性。

### 11.3 Integration

- CodeMirror state + capability：输入引用与定义、编辑定义、撤销重做、模式 compartment 切换。
- 预览浮层：hover/focus 打开、移入保持、Escape 关闭、文档变更刷新、销毁无泄漏。
- 文件动作：打开 fixture、编辑指定范围、保存、重开，比较原始文本和语义索引。
- 粘贴：完整引用+定义、仅引用、纯文本、含 CRLF 文档，并验证换行不被规范化。

### 11.4 E2E

- 从空文档手工键入脚注，离开行后看到上标，悬停和键盘查看定义，再进入源码模式核对原文。
- 打开脚注 fixture，验证普通链接与脚注视觉不混淆；点击普通链接路径不会被脚注劫持。
- 切换中英文、明暗主题和高缩放，验证诊断、预览定位、焦点环与对比度。
- 粘贴含中文正文、多个引用和定义的 Markdown，保存并重开，确认内容和交互保持。

### 11.5 Fixture

新增单一职责 `footnotes.md`，包含基础配对、多引用、定义内强调/粗体/代码/链接、中文、CRLF 变体、悬空、重复、空定义、代码围栏伪语法和转义。fixture manifest 标注 footnote 与 source-fidelity 标签；未编辑 round-trip 与定点编辑 diff 分开测试，避免通用 round-trip 的 mock 文本掩盖编辑器变换。

### 11.6 Perf

单独建立 `tests/perf/footnoteInputLatency.bench.test.ts`，串行测试 100、1,000、5,000 个引用下的初始解析、单字符输入、定义更新、viewport 滚动、首次 hover 与连续 hover；记录 p50/p95、索引条目数、重算范围、widget 数和内存近似值。不得与 E2E、构建、lint、typecheck 并行，以免把资源争用误判为退化。

## 12. 风险与未核实项

1. Typora 的上标显示编号映射、单击跳转、定义回链、定义区自动整理、重复/悬空 id 行为尚未由基线实测；这些项目只能标为“证据不足”，P2 前应在指定版本逐项录屏并保存样本。
2. `@lezer/markdown` 锁定版本对自定义脚注 grammar 的扩展优先级和增量解析成本尚未做实现原型；若与 GFM LinkReference 冲突，需要先完成依赖能力评估，不能退回全文件正则扫描。
3. 通用保存链路会经过 `prepareTextForSave`，生产 wiring 在 `useAppDocumentModel.ts:62-64` 调用 `finalizeAllDraftImages` 收口草稿图片 URL。普通脚注标记没有已知专属转换，但定义内可包含 Markdown 图片；没有脚注 fixture 与含图片定义样本时，仍不能证明所有保存场景字节级无差异。
4. 预览定义内容可能包含链接、原始 HTML 或极长文本，必须限定安全渲染与尺寸，避免 XSS、意外导航、布局抖动和大 DOM。
5. 活动行显隐是现有通用模型，脚注更需要 span 级焦点行为；改动共享装饰器可能回归普通链接、强调、任务列表的选区与 IME，必须以现有测试加专项回归共同约束。
6. 本报告没有运行 GUI 手工体验或 Playwright 脚注用例，因为仓库当前不存在该用例；结论来自静态代码、测试/fixture检索与本地解析器探针，不把未运行测试写成已通过。

## 13. 证据索引

| 证据 | 用途 |
|---|---|
| `AGENTS.md` | 架构分层、源码保真、成熟依赖、i18n、性能与测试约束 |
| `DEVELOPMENT_PROCESS.md` | 文档例外、验证门禁、fixture round-trip、性能独立运行规则 |
| `docs/product/typora-baseline/12-footnotes.md` | Typora 脚注直接基线与未核实边界 |
| `docs/product/typora-baseline/00-live-preview-model.md` | 阅读/焦点/源码模式、粘贴、IME 与标记显隐横切模型 |
| `src/editor/markdown/markdownLanguage.ts:14-18` | 当前 GFM 解析入口，无脚注扩展 |
| `src/editor/wysiwyg/markdownDecorations.ts:211-241` | 普通 Link 装饰映射 |
| `src/editor/wysiwyg/markdownDecorations.ts:453-500` | 非活动行 LinkMark 隐藏与活动行规则 |
| `src/editor/wysiwyg/wysiwyg.css:160-164` | 普通链接强调色与下划线样式 |
| `src/editor/capabilities/index.ts:20-50` | live preview capability 与命令注册清单无脚注 |
| `src/editor/capabilities/editorCapability.ts:3-20` | capability id 和命令契约无脚注 |
| `src/editor/core/editorDisplayMode.ts:40-57` | source/live preview extension 边界 |
| `src/editor/core/editorApi.ts:78-80` | 保存所取的文档原始字符串 |
| `src/features/file-actions/fileActions.ts:126-169` | 保存数据流、保存前转换入口与结果处理 |
| `src/app/controllers/useAppDocumentModel.ts:62-64` | 生产保存期转换实际调用 `finalizeAllDraftImages` |
| `tests/fixtures/roundTrip.test.ts:8-72` | 已登记 fixture 的字节级通用 round-trip 门禁 |
| `tests/fixtures/markdownFixtureManifest.ts:7-167` | 当前 fixture 清单无脚注专题 |
| `src/editor/wysiwyg/markdownDecorations.test.ts:85-142,417-449` | 现有链接装饰和标记隐藏测试范围，不含脚注 |
| `tests/e2e/editor-markdown.spec.ts:529-560` | 一般 Markdown live preview/source 切换证据，不含脚注 |
| `package.json:34-57`、`pnpm-lock.yaml` | CodeMirror、Lezer、Radix、markdown-it 的实际依赖与锁定版本；Radix Tooltip 已安装不等于生产已有可复用浮层封装 |
| 本地只读 Lezer 解析探针 | `Text[^fn1].` 被解析为普通 `Link`；复杂定义未形成脚注语义。该探针不是产品自动化测试 |
