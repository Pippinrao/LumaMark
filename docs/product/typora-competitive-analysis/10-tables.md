# 1. 表格竞品差距分析

## 2. 用途、范围与非目标

本文用于回答一个限定问题：以 Typora 1.13.7 的 GFM 表格体验为基线，LumaMark 当前已经具备哪些真实可用能力，哪些只是代码入口或依赖能力，距离“体验追平”还差什么。结论依据当前工作树中的代码、测试、fixture、依赖锁定与新鲜验证；路线图和 ADR 只用于解释意图与边界，不能单独证明功能已经可用。

范围包括 GFM 管道表的创建、阅读态、焦点编辑态、源码模式、键盘、鼠标、粘贴、保存、源码保真、错误与边界，以及表格内粗体、斜体、链接、删除线和行内代码。非目标包括合并单元格、富文本表格设计器、专有列宽元数据、像素级复刻 Typora 品牌素材，以及分析表格之外的 Markdown 功能。

## 3. 执行摘要

LumaMark 的表格能力不是空壳。当前 live preview 默认启用 `codemirror-markdown-tables`，能够把合法 GFM 管道表显示为结构化表格；单元格非编辑时可渲染部分行内 Markdown，悬停会露出源标记，单击进入组件提供的单元格编辑器；菜单、命令面板、编辑器右键菜单和 `Ctrl+Alt+T/C/Backspace` 已接入插入、复制源码、删除整表；源码模式会卸载表格 widget 并显示完整 Markdown；表格 fixture 已纳入字节级 open→save→diff 门禁。本次新鲜验证中，4 个表格相关 Vitest 文件 65 项通过，Playwright 命令选中的 6 项通过，fixture 24 项通过；但包含架构门禁的 8 文件组合验证为 92/93 通过，失败来自与表格无直接关系的 `useAppShellModel.ts` 行数超限。因此可以证明表格定点路径通过，不能把整个聚焦组合门禁写成全绿。

但“功能存在”不等于“体验追平”。Typora 的核心路径是输入管道表头后按 Return 自动建表，并在焦点表格上通过工具栏和上下文菜单调整尺寸、对齐、行列；其 Windows/Linux 标准快捷键为 `Ctrl+T`、`Ctrl+L`、`Ctrl+E`、`Ctrl+Shift+Backspace`。LumaMark 目前没有测试证明 Return 自动建表、选行、选单元格、删行、对齐与尺寸操作达到 Typora 路径，也没有表格粘贴、IME、撤销重做、键盘无鼠标、错误反馈和表格专项性能证据。结论是：基础 GFM 表格与若干编辑路径为**已实现**，整体 Typora-like 表格体验为**部分实现**，尚不能声称追平。

## 4. Typora 功能与完整体验基线

### 4.1 创建

Typora 支持直接手写 GFM 源码，也支持在空白行输入 `| First Header | Second Header |` 后按 Return，将该行转换成两列表格。创建后的 Markdown 仍是标准表头、分隔行、数据行组成的管道表。官方资料还确认可通过图形界面创建，Windows/Linux 可用 `Ctrl+T`，macOS 可用 `Command+Option+T`。基线没有核实菜单在中文 UI 中的精确文案，因此菜单文字属于未核实项。

### 4.2 阅读态

非焦点表格以排版后的表格阅读，管道与分隔线通常隐藏；分隔行中的左冒号、右冒号或双侧冒号决定左、右、居中对齐。单元格内链接、粗体、斜体、删除线等行内 Markdown 应显示为渲染结果。该体验属于 Typora 同视图 live preview，而不是左右分栏预览。

### 4.3 焦点编辑态

焦点进入表格后，Typora 打开表格工具栏，可调整表格尺寸、列对齐或删除表格；右键上下文菜单可复制并增删单独的行、列。单元格可直接编辑文本和行内 Markdown。基线本机截图观察到表格上方浮动工具栏，但按钮全集与逐项交互没有全部复核，因此“有工具栏”是证据，“每个按钮的像素与行为”仍不确定。

### 4.4 源码模式

源码模式显示完整管道、分隔行、冒号与行内定界符。live preview 与源码模式编辑同一 Markdown 文档；Typora 1.13 公布模式切换保留滚动位置。表格 UI 操作会回写 Markdown，但 UI 是否会规范化列宽空格、是否只修改目标行，基线尚未通过前后 diff 证实。

### 4.5 键盘

Typora Windows/Linux 的表格相关公开快捷键包括：`Ctrl+T` 插入表格、`Ctrl+L` 选择表格行、`Ctrl+E` 选择单元格、`Ctrl+Shift+Backspace` 删除表格行；macOS 有对应 Command 组合。Return 创建、Tab/方向键如何跨单元格移动以及边界处是否新增行，官方专题未给出完整逐步规范，需实机补证。

### 4.6 鼠标

鼠标可将焦点放入表格、进入单元格编辑、操作焦点工具栏和右键行列菜单。非焦点阅读态与焦点编辑态的切换应稳定，不应导致选区跳动或无关源码重排。列宽拖拽是否持久化到 Markdown 没有可靠证据；标准 GFM 也没有列宽字段，因此不把专有列宽落盘作为追平要求。

### 4.7 粘贴

Typora 横切体验包含 Smart Paste、普通粘贴和粘贴为纯文本，但“从 Excel/TSV/HTML 粘贴是否自动生成表格、如何处理换行和转义管道”在专题基线中未核实。因而竞品基线只能要求不破坏普通 Markdown 粘贴，并把结构化表格粘贴列为待实测能力，不能把未经观察的行为写成 Typora 事实。

### 4.8 保存

表格以 GFM Markdown 落盘。对已有源码，合理的完整体验要求是编辑一个单元格、对齐或行列时只产生意图内差异；不触碰表格时 open→save 不应变化任何字节。Typora 的自动生成会形成可读管道表，但空格规范化策略仍未核实。

### 4.9 错误与边界

基线明确的边界包括：GFM 不支持标准合并单元格；单元格内字面量管道需要转义；列数不一致、空表头、空单元格、宽表、超长内容、嵌套行内语法的容错行为未完整核实。完整体验还应覆盖剪贴板权限失败、无表格时执行表格命令、输入法组合态、撤销重做、焦点退出和大文档性能，但 Typora 的具体错误文案与恢复方式没有公开证据。

## 5. LumaMark 当前功能清单

1. **GFM 解析与结构化阅读：已实现。** `src/editor/markdown/markdownLanguage.ts:14-18` 使用 CodeMirror GFM Markdown 语言；`src/editor/capabilities/table/tablePreviewExtension.ts:29-96` 在 live preview 注入成熟表格组件、自动补全、主题和键位。`tablePreviewExtension.test.ts:43-76` 证明合法表格渲染为 `.tbl-table-widget`，即使选区位于表内也保持结构化 widget；`editorApi.test.ts:220-235` 证明编辑器默认启用成熟组件并保留管道源码。

2. **明暗主题与基础视觉适配：已实现。** `tablePreviewExtension.ts:53-93` 把组件主题映射到 LumaMark token；`table.css:1-91` 定义表格、单元格、句柄、菜单和 tooltip 的适配样式。现有证据证明样式入口存在，不证明已与 Typora 像素一致。

3. **单元格行内 Markdown 阅读/露源/编辑：部分实现。** `tablePreviewExtension.ts:99-274` 通过 `markdown-it` sibling overlay 渲染 inactive cell，hover/focus 露出原源码，保留成熟组件的 `.tbl-cell-view`；`tablePreviewExtension.test.ts:78-176` 覆盖粗体、行内代码、hover 露源和管道文本误识别前置场景；`editor-markdown.spec.ts:662-734` 真实浏览器覆盖粗体、链接、代码、单元格编辑和切源码模式后的源文。删除线在配置和 fixture 中存在，但没有同等精度的交互断言；图片、HTML 等并非本专题承诺的 cell inline 范围。

4. **菜单/命令面板/右键插入表格：已实现。** `tableCommands.ts:10-12` 复用依赖的 `insertEmptyMarkdownTable()`；`markdownFormatCommands.ts:71-72` 将通用 `table` 命令路由到 capability；`createCommandModels.ts:117-149,247-250,306-329` 提供命令面板、顶栏和编辑器上下文菜单模型；`AppShell.test.tsx:334-389,481-503` 覆盖三类入口；`editor-markdown.spec.ts:755-793` 覆盖顶栏与右键实际路径。

5. **插入快捷键：已实现，但未追平 Typora。** `tableCommands.ts:60-64` 和 `useGlobalCommandShortcuts.ts:75-83` 接入 `Alt-Mod-t`，Windows 展示为 `Ctrl Alt T`；`editor-markdown.spec.ts:736-753` 验证该快捷键会插入合法 2×2 starter table。Typora Windows/Linux 是 `Ctrl+T`，当前键位不等价。

6. **复制当前表格 Markdown：已实现。** `tableCommands.ts:14-28,85-104` 通过语法树定位光标所在 Table 并写入完整源码；`tableCommands.test.ts:37-49` 验证复制内容；`editor-markdown.spec.ts:617-647` 在授予剪贴板权限后验证 UI 复制结果。该路径复制 Markdown，不是 Typora 默认 Copy as HTML 的完全复刻。

7. **删除整表：已实现。** `tableCommands.ts:30-46` 只删除语法树定位到的当前 Table；`tableCommands.test.ts:51-74` 验证相邻第二张表和前后文本保留；`editor-markdown.spec.ts:649-660` 验证菜单删除。Typora 的“删除行”是另一项能力，不能用删除整表代替。

8. **源码模式完整显示：已实现。** `editorDisplayMode.ts:37-52` 在 source 模式仅增加源码类，不加载 live preview capabilities；`createEditorState.ts:97-120` 让 Markdown 语言、history 与模式 compartment 共存；`editorApi.test.ts:129-162` 验证模式切换不改变文档且共享撤销历史；`editor-markdown.spec.ts:728-734` 验证表格行内源码仍完整可见。

9. **中英文可见文案：部分实现。** `en.json:85,118-122` 与 `zh-CN.json:85,118-122` 提供 LumaMark 的表格、复制、删除和快捷键资源；`i18n.test.ts:84-88` 把相关 key 纳入资源一致性门禁。但当前 `markdownTables()` 配置没有文案注入，已安装 `codemirror-markdown-tables@1.0.0` 的编译产物仍包含 `Delete`、`Align left`、`Move row up` 等硬编码英文菜单/tooltip。应用层入口已双语化，不等于组件内部操作已满足中英文一等支持。

10. **源码字节级保存保真：已实现。** `tests/fixtures/markdown/table.md:1-9` 包含中英文、三种对齐和空单元格；`fixturePaths.ts:5-31` 将其列入保存集合；`roundTrip.test.ts:8-72` 对每个 fixture 执行打开、保存、字节比较。本次 `pnpm test:fixtures` 24 项通过。该证据证明“不编辑直接保存”，不证明行列操作后的最小 diff。

11. **转义管道和混合内容 fixture：部分实现。** `gfm-edge-cases.md:3-6` 包含 `\|`、中文和对齐；`markdownFixtureManifest.ts:98-107` 声明 `gfm:escaped-pipe-table`；fixture 覆盖与 round-trip 已通过，但没有浏览器交互测试证明 widget 中编辑转义管道后仍正确。

12. **架构边界与成熟依赖：已实现。** `package.json:54` 声明 `codemirror-markdown-tables` 的 `^1.0.0` 范围，`pnpm-lock.yaml:71-73,1491` 将当前解析版本固定为 `1.0.0`；ADR 0002 规定成熟组件承担行列、选择与序列化，LumaMark 只做薄适配；`architectureBoundaries.test.ts:165-230,261-290` 约束 capability 入口及跨层依赖。本项证明架构选择与接入，不自动证明依赖的每项交互都达到产品验收。新鲜组合验证还暴露了同一测试文件中的非表格架构门禁失败，不能据该文件整体声称当前架构门禁全绿。

## 6. 当前真实体验路径

当前用户可通过四类入口开始：在“段落”菜单、命令面板或编辑器右键菜单选择“表格”，或按 `Ctrl+Alt+T`。命令最终到达 `insertEmptyMarkdownTable()`，在 CodeMirror 文档中插入标准 2×2 管道表，live preview 随即把源码呈现为成熟组件的表格 widget。也可直接输入或粘贴完整合法 GFM 表源码，随后由解析器识别并显示。

阅读时，单元格内的粗体、链接和行内代码由 overlay 显示为渲染结果。鼠标悬停单元格会隐藏 overlay、露出原始定界符；单击后进入 `.tbl-cell-editor`，编辑会回写 CodeMirror 文档；离开表格后恢复阅读态。用户可从编辑菜单复制当前表格的完整 Markdown，或删除整张表；右键菜单也提供同样的三项 LumaMark 命令。切换“视图→源码模式”后 widget 消失，完整管道、对齐行与行内定界符可直接编辑。

这条路径已经被浏览器测试覆盖，但尚未形成同等可靠的纯键盘选行/选格/删行路径，也没有现有测试演示 Typora 式 `| ... |`+Return 自动转换、表格工具栏对齐/尺寸、行列菜单、Excel/TSV 粘贴或失败提示。因此真实路径可用，却仍窄于 Typora 基线。

## 7. 逐项差距矩阵

本矩阵的状态只使用**已实现、部分实现、未实现、证据不足**：已实现表示存在可执行路径且有对应实现证据，部分实现表示仅覆盖目标体验的一部分，未实现表示代码检索和运行路径均明确缺失，证据不足表示依赖或配置可能提供能力但缺少 LumaMark 产品级验证。严重度只使用**阻断、高、中、低**，表示对源码真相、核心编辑安全、主路径效率或体验完整性的影响，不表示实现进度。

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 合法 GFM 管道表解析与阅读 | 已实现 | 低 | 可阅读常规表格 | `tablePreviewExtension.ts:29-96`；组件/E2E 测试通过 |
| 直接手写完整源码 | 已实现 | 低 | 熟悉 Markdown 的用户可建表 | `markdownLanguage.ts:14-18`；E2E 插入源码后渲染 |
| 管道表头加 Return 自动建表 | 证据不足 | 高 | Typora 最自然的输入流无法确认 | 仅有 autocompleter 配置，无对应测试 |
| 菜单/命令面板插入 | 已实现 | 低 | 有明确替代创建入口 | `createCommandModels.ts` 与 AppShell/E2E |
| Typora `Ctrl+T` 键位 | 未实现 | 中 | 迁移用户肌肉记忆中断 | 当前为 `Ctrl+Alt+T` |
| 非焦点管道隐藏与表格渲染 | 已实现 | 低 | 阅读噪音较低 | `.tbl-table-widget` 单元/E2E 断言 |
| 三种对齐语法解析与显示 | 部分实现 | 中 | 源码可保存，但 UI 对齐效果未专项断言 | `table.md:3-7`；theme 默认左对齐；无三列视觉断言 |
| 单元格粗体/代码/链接阅读 | 已实现 | 低 | 常见内联内容可读 | preview 单元测试及 E2E |
| 斜体/删除线完整交互 | 部分实现 | 中 | 部分嵌套样式可能退化或露源 | MarkdownIt/Strikethrough 配置和 fixture 有证据，交互断言不足 |
| 焦点单元格直接编辑 | 已实现 | 低 | 可修改 cell 原 Markdown | `editor-markdown.spec.ts:706-726` |
| 焦点浮动工具栏等价体验 | 部分实现 | 高 | 操作发现性和位置可能不同 | 成熟组件句柄/菜单已启用，但无 Typora 对照验收 |
| 增删/移动行列 | 证据不足 | 高 | 复杂表格维护效率无法确认 | ADR 写明依赖承担，LumaMark 无聚焦测试 |
| 选择表格行 `Ctrl+L` | 未实现 | 高 | 无 Typora 键盘等价路径 | 当前 keymap 未定义 |
| 选择单元格 `Ctrl+E` | 未实现 | 高 | 键盘操作效率与可访问性受限 | 当前 keymap 未定义 |
| 删除表格行 `Ctrl+Shift+Backspace` | 未实现 | 高 | 现有快捷键删除整表，语义不同且风险高 | 当前为 `Ctrl+Alt+Backspace` 整表删除 |
| 复制完整 Markdown 表 | 已实现 | 低 | 可保真复制到其他 Markdown 工具 | command 单元/E2E 通过 |
| 剪贴板拒绝后的用户反馈 | 未实现 | 中 | 复制失败可能无可见解释 | `tableCommands.ts:19-27` 无 catch/result detail，port 丢弃 Promise |
| 组件内部菜单/tooltip 双语化 | 未实现 | 高 | 中文界面进入行列/对齐操作时会暴露英文，违反可见文案 i18n 契约 | 应用资源只覆盖 LumaMark 命令；已安装依赖编译产物含硬编码英文文本，当前配置无文案注入 |
| TSV/Excel/HTML 粘贴成表 | 证据不足 | 中 | 跨表格工具迁移效率未知 | 基线和仓库均无验证 |
| 普通 Markdown 粘贴不破坏源文 | 部分实现 | 中 | 常规粘贴可能可用，但表格边界未专项覆盖 | E2E 通过 `insertText`，无 clipboard matrix |
| source mode 完整源文 | 已实现 | 低 | 可审查和修正所有管道与冒号 | `editorDisplayMode.ts:37-52`；E2E |
| 模式切换保持文档/撤销历史 | 已实现 | 中 | 跨模式编辑连续 | `editorApi.test.ts:129-162` |
| 模式切换滚动与选区连续 | 证据不足 | 中 | 长表切换可能跳位 | 无表格专项断言 |
| 不编辑 open→save 字节一致 | 已实现 | 低 | 打开保存不会重排表格 | `roundTrip.test.ts`；fixture 门禁通过 |
| 单元格/行列编辑后的最小 diff | 证据不足 | 阻断 | 可能重排无关列宽空格，触及源码真相原则 | 无操作前后 diff fixture |
| 转义管道 | 部分实现 | 高 | 含 `\|` 内容编辑可能损坏列结构 | fixture 保真有证据，widget 编辑无证据 |
| IME 组合输入 | 证据不足 | 阻断 | 中文 cell 编辑可能出现候选中断或提交错位 | 无 composition 测试 |
| 撤销/重做表格结构操作 | 证据不足 | 阻断 | 行列或单元格误操作难恢复 | 仅通用 history 与模式测试，无结构操作测试 |
| 键盘可访问性与语义 | 证据不足 | 高 | 无鼠标用户和读屏用户可能受阻 | 未见 grid/cell 语义与焦点顺序验收 |
| 大文档/大量表格性能 | 证据不足 | 高 | widget 与 DOM overlay 扫描可能影响输入、滚动 | `tests/perf` 无表格专项用例 |

## 8. 根因与架构影响

第一，项目正确选择了成熟组件，但当前验收把“依赖已接入”与“产品体验已证明”混在了一起。ADR 0002 声明行列、选择、复制粘贴由依赖承担，代码确实启用了组件；然而 LumaMark 的测试主要覆盖整表渲染、单格编辑、整表复制和整表删除，没有把依赖能力转化为产品级契约。依赖升级或默认键位变化时，现有门禁可能无法发现行列、对齐、IME 和粘贴退化。

第二，表格命令边界过于粗。`EditorCapabilityCommands` 暴露插入、复制、删除整表，却没有“选择行/格、增删行列、设置对齐”的稳定产品命令，也没有结构化失败结果。`EditorCommandPort.copyTable()` 返回 `void` 并丢弃异步结果，导致剪贴板拒绝无法进入 app 层的本地化错误通知。若直接把更多行为塞进 React shell 或通用 format command，会违反 editor 与 app 分层；正确方向应是在 table capability 内定义薄命令适配和可判别结果，再由 app 编排 UI。

第三，inline overlay 是必要的差异化薄层，但当前实现通过 `setTimeout(0)`、全 widget DOM 查询、逐 cell 读取与 `innerHTML` 更新工作。它没有改写 CodeMirror 文档，这是源码保真优点；同时它可能随 viewport、selection 和每次 doc change 扫描大量 cell，且 `tablePreviewExtension.ts` 同时承担组件配置、调度、DOM 状态和 Markdown 渲染，职责开始膨胀。没有 perf 数据前不能断言已退化，但这条路径必须被测量。组件编译产物虽然给表格和菜单项提供了部分 `role`，却也把行列/对齐菜单文案写死为英文；因此 i18n 与 a11y 都需要以当前锁定版本建立产品契约，不能仅依赖组件自述。

第四，源码保真目前只锁定“未编辑保存”。结构化组件通常会格式化目标表格，这是可接受的前提仅是范围和规则明确；项目尚未定义“编辑一个 cell 允许改哪些空格、是否保留冒号、转义管道如何序列化”。这直接影响 Markdown 唯一真实数据原则，应先以 fixture 契约固定行为，再扩大 UI 操作。

## 9. 详细改进方案

### 9.1 模块归属与成熟依赖优先

继续以 `codemirror-markdown-tables` 为整表交互核心，不自研 grid、cell editor、行列状态机或序列化器。先针对当前锁定版本建立产品契约测试，并查验其维护状态、公开 API、IME、a11y、粘贴和升级兼容性。只有出现可复现的阻断证据，且成熟替代方案评估失败后，才进入 ADR 复审和用户批准的自研例外。

将 `tablePreviewExtension.ts` 按真实职责拆为：组件配置入口、inline preview renderer、DOM interaction adapter、可测试的 cell source/preview policy；公共入口仍由 `createTableCapability.ts` 聚合，避免 app、features 或 services 直接依赖内部实现。表格不需要 Rust 或 service 层；保存继续走现有文件 service，不复制 Markdown 全文到 React store。

### 9.2 数据流与命令契约

唯一数据流应是：用户输入/组件操作→CodeMirror transaction→Markdown 文档→现有 dirty/save 流程。overlay 只能读源码并渲染视觉 sibling，禁止把 HTML 当状态或反向序列化。新增 `TableCommandResult` 可判别结果，例如成功、光标不在表格、剪贴板不可用、剪贴板拒绝、组件操作不支持；editor capability 返回结果，app controller 将失败映射到可本地化 notice。顶栏、命令面板、右键和快捷键必须复用同一 command model，不能各写一套逻辑。

对 Typora 键位先做冲突审计。Windows/Linux 提供 `Ctrl+T` 插表、`Ctrl+L` 选行、`Ctrl+E` 选格、`Ctrl+Shift+Backspace` 删行；macOS 使用官方对应键。若 `Ctrl+T` 与应用标签页计划冲突，应形成明确产品决策并允许用户重映射，而不是静默采用不兼容键位。整表删除保留为独立、语义清晰且不易误触的命令。

### 9.3 源码保真

建立操作级 before/after fixture：改单格、加行、删行、加列、删列、改左/中/右对齐、含 `\|`、空 cell、中英混排、行内代码和链接。每例声明允许变化的表格范围，并断言表外字节零差异；模式切换、hover 和只读预览必须全文件零差异。若成熟组件会格式化整张目标表，需把规范化规则写成短决策并让用户可预期，不能把无关段落或相邻表格一起重排。

### 9.4 i18n、可访问性与错误处理

补齐中英文 key：行/列插入删除、左右/居中对齐、选择行/格、复制失败、操作不适用、粘贴无法解析。不得继续接受组件硬编码英文 tooltip。当前锁定版本的公开 `MarkdownTablesConfig` 未见 locale/label 注入口，应先向上游确认或贡献可注入文案的 API，并同时评估仍在维护、可满足源码保真与性能要求的成熟替代方案；基于 DOM 文本替换的薄适配只能作为有回归测试的临时方案，不能直接 fork 或自研基础表格组件。

以键盘和读屏实际验收表格：可进入/退出表格，不困住 Tab；焦点指示清晰；行、列、cell 与选中状态具有可读语义；菜单支持方向键、Escape 和焦点返回；overlay 为 `aria-hidden` 时底层内容仍有可访问名称。剪贴板拒绝、非表格位置执行命令、非法表结构、组件异常都应返回显式结果并显示非阻塞、本地化反馈，不使用静默 fallback。

### 9.5 创建、粘贴和性能

为 `| ... |`+Return 建立真实 keyboard transaction 测试，确认只在合法上下文触发，不把普通含管道段落或代码块转成表。对 TSV、HTML table、纯文本 Markdown 三类剪贴板格式先实测 Typora，再决定 LumaMark 是追平、差异化还是明确不支持；任何智能转换都必须可撤销并保留原始文本的可恢复性。

性能上将 overlay 更新限制到受影响 widget/cell，避免每次 selection change 扫描全视口；可采用 requestAnimationFrame 合并、基于 transaction range 的增量更新和取消过期任务，但必须先基准后改动。性能门禁单独运行，不能与 E2E、build 或 lint 并发。

## 10. P0/P1/P2 分阶段计划

### P0：保真与基本编辑安全

- 固定 Return 自动建表、改单格、三种对齐、转义管道、空 cell 的 unit/integration 契约。
- 增加单元格编辑、行列操作的 undo/redo、IME composition、选区稳定和表外零 diff 测试。
- 把复制 Promise 与失败原因传到 app 层，提供中英文错误提示。
- 将依赖内部英文菜单列为发布阻断检查：先确认上游是否提供未暴露的 locale/label 扩展点；当前 `MarkdownTablesConfig` 类型没有此项。若上游无法注入，记录成熟替代方案或上游贡献路径的评估证据；在获得用户批准前不 fork、不自研表格基础组件。
- 建立表格专项 perf 基线；若当前成熟组件无法通过源码保真或 IME 门禁，触发 ADR 复审，不直接自研。

### P1：Typora 高频交互追平

- 在冲突审计后接入 Typora 表格快捷键，并保留可重映射策略。
- 用同一 command contract 暴露选择行/格、增删行列、对齐和删除表格；顶栏、右键、命令面板按上下文启用/禁用。
- 验证焦点工具栏、鼠标句柄、键盘导航、读屏语义和焦点返回。
- 增加真实浏览器粘贴矩阵与保存后最小 diff E2E。

### P2：增强与长期稳定性

- 在 Typora 实机补证后决定 TSV/Excel/HTML Smart Paste 的追平范围。
- 优化大量表格和超宽表格的增量渲染、滚动与内存；建立依赖升级兼容门禁。
- 完善跨平台快捷键、触控板/高 DPI、主题视觉与错误恢复体验。
- 合并单元格和专有列宽仍保持非目标，除非未来有标准化语法与独立产品决策。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 在普通空白行输入两列管道表头并按 Return，生成合法表格；相同文本位于代码块或普通段落时不误触。
2. live preview 非焦点状态隐藏结构管道，正确显示左/中/右对齐及粗体、斜体、删除线、链接、行内代码。
3. 鼠标与键盘均可进入单元格，修改后离开恢复阅读态；IME 候选不中断，光标与选区不跳位。
4. 增删行列、改单格、改对齐均可一次撤销和重做；相邻表格及表外字节保持不变。
5. Windows/Linux 表格快捷键与已批准的 Typora 对齐策略一致，macOS 有对应键；所有入口调用同一命令。
6. source mode 显示完整源码，来回切换不改文档，并保持选区、撤销历史和可接受的滚动位置。
7. 剪贴板拒绝、无当前表格、非法结构均有中英文可见反馈，不崩溃、不静默成功。
8. `table.md` 与扩展 edge fixtures open→save 字节差异为零；操作型 fixture 的差异严格落在声明范围。
9. 大量表格基准满足项目 1MB 打开小于 300ms 的总目标，表格交互 p95 transaction 不超过 16ms；若测试机波动较大，同时要求相对基线不退化超过 10%。

### 11.2 Unit

- 语法树定位：光标在表头、分隔行、cell、边界位置和非表格管道文本。
- 命令：插入、复制、删整表、选行/格、增删行列、对齐、无表格返回值、剪贴板拒绝。
- inline renderer：转义、HTML 禁用、链接安全属性、粗体/斜体/删除线/代码、空 cell、重复调度取消。
- 快捷键：平台映射、冲突、`preventDefault`、composition 中不触发。

### 11.3 Integration

- CodeMirror transaction 覆盖 Return 自动建表、cell editor 提交、行列菜单、对齐与 undo/redo。
- live preview↔source 切换覆盖文档、选区、history、scroll anchor。
- compositionstart/update/end 覆盖中文输入和行内定界符。
- app command port 覆盖成功/失败结果到本地化 notice，菜单上下文禁用状态一致。

### 11.4 E2E

- 从空文档分别用 Return、菜单、命令面板、右键和快捷键建表，编辑并保存后重开。
- 纯键盘完成选格、选行、加删行列和对齐；Escape 正确退出菜单并返回编辑器焦点。
- 复制 Markdown、剪贴板权限拒绝、TSV/HTML/纯文本粘贴矩阵。
- 中文 IME、链接/代码/转义管道、明暗主题、source mode、撤销重做和关键截图。

### 11.5 Fixture

- 保留 `table.md`，新增宽表、空表头、不等列、转义管道、无首尾管道、嵌套行内语法、相邻双表、CRLF 与中英混排样本。
- 每个结构操作使用 before/after 对，断言表外零 diff；未编辑 round-trip 继续做字节比较。

### 11.6 Perf

- 单独运行 1MB 文档加 100/500/1000 张小表，以及单张 100×50 宽表。
- 测量打开时间、首次 widget 稳定时间、单格输入 transaction p50/p95、滚动帧、模式切换、内存峰值与 overlay 更新次数。
- perf 文件串行执行，并保存硬件、版本和基线；不得与 E2E、构建、typecheck、lint 并行。

## 12. 风险与未核实项

- Typora 1.13.7 工具栏按钮全集、中文菜单精确文案、Tab/方向键边界、空格规范化、不等列容错仍未实机逐项核实。
- Typora 对 Excel/TSV/HTML 粘贴的真实行为未知，不能据横切 Smart Paste 推断表格一定转换。
- `codemirror-markdown-tables@1.0.0` 的行列、对齐、键盘、IME、a11y 和粘贴能力目前主要由 ADR 意图与启用配置间接支持，缺少 LumaMark 产品级契约测试。
- inline overlay 使用 DOM 查询和 `setTimeout(0)`；没有表格专项性能基准，性能影响未知。
- 复制命令的异步失败未传递到 UI；当前 E2E 只覆盖已授权剪贴板成功路径。
- 本次 4 文件表格相关 Vitest 为 65/65 通过；扩大到 8 文件组合后为 92/93 通过，失败是 `useAppShellModel.ts` 行数架构门禁，另输出 Node `--localstorage-file` 无有效路径 warning。前者不直接推翻表格行为结论，但意味着当前组合门禁未全绿；warning 仍应由测试基础设施定位并消除。
- 本报告分析的是当前未提交工作树。相关表格实现和测试本身已有用户改动；后续合并时需要在最终提交状态重新运行全部门禁。

## 13. 证据索引

### Typora 基线与官方资料

- `docs/product/typora-baseline/10-tables.md`：表格专题基线、截图观察、对齐项与未核实清单。
- `docs/product/typora-baseline/00-live-preview-model.md`：live preview、源码模式、行内露源、复制粘贴与 IME 横切模型。
- Typora Markdown Reference：<https://support.typora.io/Markdown-Reference/>，Tables 段说明 Return 创建、焦点工具栏、上下文菜单、GFM 源码、行内 Markdown 和对齐冒号。
- Typora Shortcut Keys：<https://support.typora.io/Shortcut-Keys/>，说明插表、选行、选格、删行和源码模式快捷键。
- Typora Quick Start：<https://support.typora.io/Quick-Start/>，说明 live preview 的行内/块级符号显隐与 Smart Paste 横切体验。

### LumaMark 代码与依赖

- `src/editor/capabilities/table/tablePreviewExtension.ts:29-274`：成熟组件配置、主题、inline overlay 与露源调度。
- `src/editor/capabilities/table/tableCommands.ts:10-104`：插入、复制、删除整表与 keymap。
- `src/editor/capabilities/table/createTableCapability.ts:4-8`、`src/editor/capabilities/index.ts:20-49`：capability 聚合和命令边界。
- `src/editor/core/editorDisplayMode.ts:37-52`、`src/editor/core/createEditorState.ts:97-120`：live preview/source 模式与共享编辑器状态。
- `src/features/commands/createCommandModels.ts:117-149,211-253,306-329`、`src/app/controllers/useGlobalCommandShortcuts.ts:75-94`：命令面板、菜单、右键和全局快捷键。
- `src/shared/i18n/locales/en.json:85,118-122`、`zh-CN.json:85,118-122`：LumaMark 应用层双语文案与快捷键标签。
- `package.json:54`、`pnpm-lock.yaml:71-73,1491`：依赖范围声明与当前锁定版本。
- `node_modules/codemirror-markdown-tables/dist/codemirror-markdown-tables.js:5762,7167-7355`：当前已安装依赖的英文菜单/tooltip 文本；这是运行时产物定点证据，不替代仓库内产品契约测试。
- `node_modules/codemirror-markdown-tables/dist/codemirror-markdown-tables.d.ts:199-342`：当前 `MarkdownTablesConfig` 的公开配置面，仅含主题、样式、选区、句柄、换行、cell 扩展、Markdown 配置与全局键位，未见 locale/label 注入口。
- `docs/decisions/0002-codemirror-markdown-tables.md`、`docs/decisions/0003-live-preview-assets-code-and-table-inline.md:27-28,45-54`：成熟组件、薄适配和源码 DOM 保留决策；仅作架构解释。

### 测试与 fixture

- `src/editor/capabilities/table/tableCommands.test.ts:24-116`：插入、复制、删除、非表格和快捷键。
- `src/editor/capabilities/table/tablePreviewExtension.test.ts:43-176`：widget、选区内持续渲染、inline、hover 露源和误识别边界。
- `src/editor/core/editorApi.test.ts:129-162,220-235`：模式切换/撤销与默认成熟表格组件。
- `src/app/shell/AppShell.test.tsx:334-389,481-503`：命令面板、顶栏与右键入口。
- `tests/e2e/editor-markdown.spec.ts:617-793`：复制/删除、cell 编辑、source mode、快捷键和菜单真实路径。
- `tests/e2e/editor-live-preview-visual.spec.ts:60-110`：表格内联阅读、hover、编辑与源码保真截图路径。
- `tests/fixtures/markdown/table.md`、`gfm-edge-cases.md:3-6`、`live-preview-rich.md:12-17`：对齐、空 cell、转义管道和行内内容。
- `tests/fixtures/roundTrip.test.ts:8-72`、`markdownFixtureManifest.ts:33-35,54-65,98-107`：字节级保存与覆盖清单。

### 本次实际验证

- `pnpm exec vitest run src/editor/capabilities/table/tableCommands.test.ts src/editor/capabilities/table/tablePreviewExtension.test.ts src/editor/commands/markdownFormatCommands.test.ts src/editor/core/editorApi.test.ts`：4 个表格相关测试文件、65 项通过。
- `pnpm exec vitest run src/editor/capabilities/table/tableCommands.test.ts src/editor/capabilities/table/tablePreviewExtension.test.ts src/editor/commands/markdownFormatCommands.test.ts src/editor/core/editorApi.test.ts src/app/shell/AppShell.test.tsx src/shared/i18n/i18n.test.ts tests/quality/architectureBoundaries.test.ts tests/fixtures/fixtureCoverage.test.ts`：8 个测试文件共 93 项，92 通过、1 失败；失败为 `useAppShellModel.ts` 222 行超过 220 行限制，与表格行为无直接关系；另有一条 Node `--localstorage-file` warning。该命令不能记为全绿。
- `pnpm exec playwright test tests/e2e/editor-markdown.spec.ts --grep table --workers=1`：Chromium 6 项通过；其中 4 项标题明确为表格场景，另 2 项因 `stable`/`editable` 包含字符串 `table` 被 grep 一并选中，不能把 6 项全部计作表格覆盖。
- `pnpm test:fixtures`：2 个测试文件、24 项通过。
