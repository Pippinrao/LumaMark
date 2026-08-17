> 语言：**中文** · [English](../../../product/typora-competitive-analysis/14-yaml-front-matter.md)

# YAML Front Matter 竞品体验差距分析

> **Parity Reliability 实施更新（2026-07-27）**
>
> 本文正文中的“执行摘要”“LumaMark 当前状态”和差距矩阵记录的是 **2026-07-12 分析快照**，保留作历史取证，不再作为当前实施状态。当前唯一执行路线见 [Typora Parity 核心体验改进计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
>
> - protected-source 分析现保护由文首 `---` 开始、以 `---` 或 `...` 闭合的 YAML 区域，并抑制通用水平线与 Setext 标题装饰；单元/UI 测试覆盖源码可见性，selection-only 更新会复用语法树级分析缓存。
> - 这只是歧义安全降级，不是 YAML Front Matter 功能。YAML 解析、元数据 UI、校验及 `typora-root-url`/`typora-copy-images-to` 工作流仍在 Next。

## 1. 用途、范围与非目标

本文用于判断 LumaMark 在 YAML Front Matter 专题上，哪些只是底层文本能力已经存在，哪些已经形成用户可感知的 Typora-like 体验，并给出可执行的补齐顺序与验证方案。分析对象是 Typora 1.13.7 基线与当前仓库工作树，不把路线图、规划表或“计划对齐”当成实现证据。

范围包括：文首 `---` 包围的 metadata 块创建、阅读态、焦点编辑态、源码模式、键盘、鼠标、粘贴、保存、非法 YAML、与水平线及 Setext 标题的歧义，以及 `typora-root-url`、`typora-copy-images-to` 对图片工作流的影响。非目标包括：设计完整 YAML schema 管理器、导出器的元数据映射、复制 Typora 专有视觉素材，以及把正文中任意 YAML 代码块误当作文档元数据。

## 2. 执行摘要

结论是：LumaMark 具备“把 YAML 当普通 UTF-8 文本打开、编辑并保存”的基础能力，但 YAML Front Matter 专题体验尚未形成，不能据此声称已追平 Typora。

直接证据分为三层。第一层，文件链路确实保真：`src-tauri/src/services/file_service.rs:26-46` 读取 UTF-8 字节并原样写入；`src/features/file-actions/fileActions.ts:100-169` 把读取文本直接装载到编辑器，并把编辑器文本交给保存命令；`tests/fixtures/roundTrip.test.ts:8-72` 对清单内 fixture 做字节比较。第二层，源码模式确实存在：`src/editor/core/editorDisplayMode.ts:35-52` 在 source 模式移除 live preview capability，`tests/e2e/editor-markdown.spec.ts:529-560` 验证普通 Markdown 在模式切换前后不变。第三层也是关键反证：现有 Markdown 解析与装饰没有 Front Matter 分支。`src/editor/markdown/markdownLanguage.ts:14-18` 只启用 GFM Markdown；`src/editor/wysiwyg/markdownDecorations.ts:211-340` 把 `HorizontalRule` 映射为水平线而没有 metadata 类型。本次只读诊断以 `---\ntitle: Demo\n---\n# Body` 为合法最小样本，解析结果是 `Document(HorizontalRule,SetextHeading2(HeaderMark),ATXHeading1(HeaderMark))`；加入数组等多行 YAML 后，闭合分隔符也可能继续被解析为另一个 `HorizontalRule`。因此合法 YAML 在 live preview 中会进入普通 Markdown 的水平线/标题语义，具体误呈现取决于块内文本形状，这是阻断级语义错误。

当前最准确的总体状态是“部分实现”：通用文本打开、源码编辑和保存存在；专用识别、阅读/焦点态、创建入口、校验、图片扩展键、专题测试均未形成。功能存在与体验追平必须分开：能看到并保存几行 YAML 是文本编辑器的通用功能，不等于已实现 Front Matter。

## 3. Typora 功能与完整体验基线

### 3.1 创建

依据 `docs/product/typora-baseline/14-yaml-front-matter.md:20-25`，Typora 在文档顶部输入 `---` 后按 Return 可引入 metadata 块，也可通过顶部菜单插入。触发位置是语义的一部分：正文中的 `---` 更可能是水平线，而不是 Front Matter。创建后应形成成对分隔符和可编辑区域，而不是先出现水平线再让用户手工修正解析结果。

### 3.2 阅读态

依据专题基线 `:27-30` 及横切模型 `docs/product/typora-baseline/00-live-preview-model.md:20-38`，非焦点状态应把 Front Matter 当作独立、弱化或可折叠的 metadata 区，而非正文段落。公开资料能支持 metadata block 模型，但折叠按钮的精确像素、默认展开状态和动画仍证据不足，不能臆造为硬性一致要求。

### 3.3 焦点编辑态

光标进入 metadata 块后可以编辑键值文本，必要源码符号应重新可见；光标离开后恢复安静的阅读态。编辑必须维持稳定选区、撤销栈和 IME 组合态，不能因逐键解析重建大段 DOM 或修改未触及的源文。`typora-root-url` 与 `typora-copy-images-to` 还可由图片菜单或偏好操作写入该块，但这种自动写入必须是用户明确操作的结果。

### 3.4 源码模式

源码模式显示完整的开头 `---`、原始 YAML 内容及闭合 `---`。它与 live preview 编辑同一份 Markdown 源文；切换模式不应吞掉注释、引号、键顺序、空行、缩进、换行风格或未知键。解析 YAML 仅用于体验增强，不得把序列化后的对象反写覆盖用户原文。

### 3.5 键盘

核心键盘路径是文首 `---` + Return 创建、块内正常输入与换行、撤销/重做，以及通过通用源码模式快捷键切换视图。基线没有公开独立的 Front Matter 默认快捷键，因此不应虚构兼容键；若 LumaMark 未来增加命令，应通过现有命令面板与菜单体系提供可发现入口，并保持可本地化。

### 3.6 鼠标

鼠标应能把光标定位到 metadata 块并进入编辑态；若提供折叠控件，必须有明确展开/收起状态、键盘等价操作和可访问名称。Typora 精确的折叠控件样式尚未完成本机复核，当前只能把“独立弱化区域、可进入编辑”作为已知基线，把像素级交互列为未核实项。

### 3.7 粘贴

用户可以在块内粘贴 YAML 文本。现有基线只能证明该入口存在，不能证明 Typora 会阻止用户用跨块选区替换闭合分隔符，也不能把“分隔符保护”写成已知竞品事实。LumaMark 的验收重点应是：普通纯文本和多行 YAML 粘贴可预测、只产生一次可撤销事务，粘贴后重新判定块边界；若粘贴造成未闭合或非法 YAML，则保留原文并进入安全降级。来自富文本剪贴板时是否强制纯文本、是否保留某些格式，以及 Typora 对复杂多格式剪贴板的优先级均证据不足，需实测后再决定兼容策略。

### 3.8 保存

保存结果仍是文档开头的原始 YAML 文本，正文位于闭合分隔符之后。除用户明确触发图片配置写入外，不应自动排序键、规范化引号、展开锚点、移除注释或改写换行。`typora-root-url` 只影响预览路径解析，不应把 `![alt](/path)` 静默改成绝对路径；`typora-copy-images-to` 的写入则属于用户启用复制工作流后的预期源文变更。

### 3.9 错误与边界

文首 `---`、正文水平线和 Setext 标题必须按上下文区分。非法 YAML 是否在 Typora 中显示哪一种具体错误 UI 尚未核实，因此竞品事实只能标为证据不足；但 LumaMark 至少应做到安全降级：保留原文、保持可编辑、不崩溃、不误执行扩展键，并用非阻塞、可本地化的诊断提示指出范围。未闭合块、空块、BOM、CRLF、多文档 YAML、注释、数组、重复键和超大 metadata 都是必须覆盖的边界。

## 4. LumaMark 当前功能清单与证据

1. **普通文本打开：已实现。** `src-tauri/src/services/file_service.rs:26-37` 使用 `fs::read` 后严格按 UTF-8 构造字符串；`src/features/file-actions/fileActions.ts:100-123` 将返回文本直接传给 `editor.loadDocument`。这能打开含 YAML 的 Markdown，但没有提取或理解 metadata。
2. **普通文本保存：已实现。** `src-tauri/src/services/file_service.rs:39-67` 以原文本字节进行原子写入；Rust 测试 `:92-114` 验证一般 UTF-8 文本读写。前端保存路径 `src/features/file-actions/fileActions.ts:126-169` 将编辑器文本交给写入命令，只在 `prepareTextForSave` 返回不同文本且文档未继续变化时回载迁移结果。
3. **通用 fixture 字节 round-trip：部分实现。** `tests/fixtures/roundTrip.test.ts:8-72` 对 `fixturePaths` 中的文件执行保存并比较字节；但 `tests/fixtures/fixturePaths.ts:5-26` 和 `tests/fixtures/markdownFixtureManifest.ts:7-167` 没有 Front Matter fixture 或标签，所以测试框架存在，专题回归证据不存在。
4. **源码模式：已实现。** `src/editor/core/editorDisplayMode.ts:35-52` 支持 `livePreview` 与 `source` 两种模式；`src/features/commands/createCommandModels.ts:267-287` 暴露菜单切换；`tests/e2e/editor-markdown.spec.ts:529-560` 验证标题和强调的源文保留。该 E2E 未包含 YAML，因而只能证明通用模式能力。
5. **Front Matter 语法识别：未实现。** `src/editor/markdown/markdownLanguage.ts:14-18` 仅以 `@codemirror/lang-markdown` 的 GFM language 为 base；本次对合法、未闭合和正文 `---` 三个只读样本执行解析树诊断，合法文首 YAML 未产生 metadata 节点，而产生 `HorizontalRule` 与 `SetextHeading2`。
6. **阅读态与焦点态：未实现。** `src/editor/capabilities/index.ts:20-39` 注册 code block、image、table、Mermaid 和通用 WYSIWYG 扩展，没有 Front Matter capability；`src/editor/wysiwyg/markdownDecorations.ts:211-340` 没有 YAML 分支，反而在 `:242-248` 将解析到的 `HorizontalRule` 映射为 `.lm-md-horizontal-rule`。
7. **菜单、命令面板与快捷键：未实现。** `src/features/commands/createCommandModels.ts:104-150` 的命令面板含水平线、图片、表格等插入项，`:233-264` 的段落/格式菜单也没有 metadata；`src/editor/commands/markdownFormatCommands.ts:5-24` 的命令联合类型没有 Front Matter；`src/editor/commands/markdownFormatKeymap.ts:4-37` 仅定义粗体、斜体和标题快捷键。
8. **块内粘贴：部分实现。** 普通 CodeMirror 粘贴可以输入文本并进入编辑历史，这是通用编辑能力；但当前没有 metadata 区边界、粘贴后的 Front Matter 重判定、非法状态诊断或 YAML 专题测试。Typora 是否强制纯文本、是否保护分隔符仍证据不足，不能把这些未核实细节反向记为 LumaMark 的确定缺失。
9. **YAML 校验与错误提示：未实现。** `package.json:30-80` 没有直接声明 YAML parser 或 `@codemirror/lang-yaml`；`pnpm-lock.yaml:327-328,3088-3096` 虽锁定 `@codemirror/lang-yaml` 和 `@lezer/yaml`，但它们由 `@codemirror/language-data` 间接带入，当前源代码未调用，不能据锁文件声称功能存在。i18n 定点检索也没有 Front Matter/YAML 错误文案。
10. **图片扩展键：未实现。** `src/editor/capabilities/image/imagePreviewExtension.ts:101-123` 只按 URL、绝对路径或当前文档目录解析图片；没有读取 `typora-root-url`。`src/app/controllers/useAppEditorCommands.ts:83-101` 根据全局 `copyImagesToAssets` 决定复制工作流；`src/features/settings/SettingsDialog.tsx:103-114` 仅提供复制到固定文档资源目录的 checkbox，不读写 `typora-copy-images-to`。
11. **相关图片基础能力：部分实现。** `src/editor/capabilities/image/imagePreviewExtension.test.ts:79-131` 覆盖绝对、相对、远程及未保存文档路径；这可作为后续接入 metadata 路径策略的基础，但不等于 Typora 扩展键兼容。

## 5. 当前真实体验路径

用户打开一个含合法 Front Matter 的文件时，Rust 文件服务会把整段 UTF-8 文本交给 CodeMirror。源码模式中用户可以看到并编辑全部字符；在保存前处理器不迁移文本的路径上，保存会把编辑器当前文本交给写入命令。这是当前可用路径。

问题出现在默认 live preview。GFM parser 不识别该文首块，首个 `---` 被解释为水平线，`title: ...` 等行与闭合 `---` 组合后可能成为 Setext 标题。通用装饰层会据此绘制水平线或标题样式。用户没有 metadata 弱化区、折叠、专用焦点编辑态或 YAML 诊断，也没有菜单插入入口。若 YAML 包含 `typora-root-url` 或 `typora-copy-images-to`，图片系统不会读取它们：预览仍按文档目录/绝对路径逻辑处理，复制策略仍取全局 store 设置。用户可以靠切换源码模式手工编辑并保存，但默认所见与文档语义不一致，因此体验未追平。

## 6. 逐项差距矩阵

| 能力 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 含 YAML 文件的通用打开 | 已实现 | 低 | 能加载完整文本 | `file_service.rs:26-37`；`fileActions.ts:100-123` |
| 含 YAML 文件的通用保存 | 已实现 | 中 | 未编辑时具备保真基础，但无专题 fixture | `file_service.rs:39-67`；`roundTrip.test.ts:8-72` |
| 源码模式完整显示 | 已实现 | 低 | 可绕过误渲染直接编辑 | `editorDisplayMode.ts:35-52` |
| 文首 Front Matter 优先识别 | 未实现 | 阻断 | 合法 metadata 被误呈现为水平线/标题 | 解析树诊断；`markdownLanguage.ts:14-18` |
| 正文 `---` 保持水平线 | 已实现 | 中 | 正文常规 HR 可显示，但尚无与 YAML 联合回归 | `markdownDecorations.ts:242-248`；`markdownDecorations.test.ts:85-149` |
| 阅读态 metadata 区 | 未实现 | 高 | 默认视图噪音大且语义错误 | `capabilities/index.ts:20-39` |
| 焦点编辑态与离焦恢复 | 未实现 | 高 | 无 Typora-like 块级交互 | 无 Front Matter capability/测试 |
| 文首 `---` + Return 创建 | 未实现 | 高 | 只能手写完整结构，且创建中会误解析 | 命令与 keymap 无对应分支 |
| 菜单/命令面板插入 | 未实现 | 中 | 功能不可发现 | `createCommandModels.ts:104-150,233-264` |
| 鼠标进入 metadata 编辑态 | 未实现 | 高 | 无独立 metadata 区可点击或定位 | 无 Front Matter capability/测试 |
| Typora 折叠控件与默认状态 | 证据不足 | 低 | 暂不能制定像素级或默认展开/收起追平标准 | 基线 `14-yaml-front-matter.md:27-30` |
| 块内粘贴与非法状态恢复 | 部分实现 | 高 | 通用文本粘贴可用，但无块边界重判定、诊断与专题回归 | 通用 CodeMirror 编辑能力；无 Front Matter 粘贴测试 |
| 非法 YAML 非阻塞诊断 | 未实现 | 高 | 用户看不到错误位置，扩展键也无法安全禁用 | 无 parser 调用、lint 与 i18n 文案 |
| YAML 原文 exact round-trip fixture | 未实现 | 阻断 | 注释、引号、顺序、CRLF 等保真没有自动化证明 | `fixturePaths.ts:5-26` 无 YAML 样本 |
| `typora-root-url` 图片预览 | 未实现 | 中 | 从 Typora 打开的根路径图片可能破图 | `imagePreviewExtension.ts:101-123` |
| `typora-copy-images-to` 工作流 | 未实现 | 中 | 文档级图片复制约定被忽略 | `useAppEditorCommands.ts:83-101`；`SettingsDialog.tsx:103-114` |
| 中文/英文 UI 与错误文案 | 未实现 | 中 | 新入口与诊断无法满足双语要求 | i18n 定点检索无相关 key |
| IME、撤销、选区与大块性能 | 证据不足 | 高 | 专题交互稳定性未知 | 无 unit/integration/E2E/perf 专题覆盖 |

## 7. 根因与架构影响

根因不是文件系统不支持 YAML，而是编辑器语法层缺少“仅限文首、成对分隔符、可选 YAML 子解析”的结构模型。通用 GFM parser 按 CommonMark 合理地把 `---` 解释为 thematic break/Setext 标记；通用 WYSIWYG 层再忠实消费了错误语法树。把 CSS 调成灰色无法修复语义，单纯在 React shell 中扫描全文也会违反 editor 边界并增加高频大对象流动。

合理的架构归属应是：`editor` 负责文首区间识别、CodeMirror language/decoration、选择与事务；`features` 负责“插入 Front Matter”和文档级图片策略等用户动作；`services` 只在需要文件路径或资源复制时执行平台能力；`shared` 放纯类型、诊断码与 i18n 基础设施；Rust 文件服务继续保持薄而保真的字节 I/O，不解析 YAML。metadata 解析结果不应进入全局 React store，也不应持有 Markdown 全文；应以编辑器 state field/facet 暴露小型只读快照或按需命令。

该功能触及源码保真、Markdown 歧义、IME、撤销和图片路径，属于编辑器核心高风险改动。若引入直接 YAML 依赖或改变解析策略，需要同步架构说明；若形成重大依赖/源码保真决策，还应按项目规则建立短决策记录，但这不属于本专题报告的写入范围。

## 8. 详细改进方案

### 8.1 模块与成熟依赖

在 `src/editor/capabilities/front-matter/` 建立聚焦 capability，包含：文首边界识别、解析状态、decorations、commands 与测试。块内高亮优先评估成熟的 `@codemirror/lang-yaml`；只有 mixed parsing 或增量语法树集成确实需要更低层 API 时，才直接依赖 `@lezer/yaml`，不应默认同时直依赖上下层两个包。它们当前都因 `@codemirror/language-data` 出现在锁文件中，但产品代码若直接导入所选包，必须在 `package.json` 显式声明，不能依赖传递关系。若需要安全读取 `typora-root-url` 等键值或做 CST/range-aware 更新，再独立评估成熟的 `yaml` 包；不要手写完整 YAML parser，也不要把 Vite 的可选 `yaml` peer 当成应用依赖。文首分隔符识别是 LumaMark 的 Markdown 集成差异化边界，可以用小型、可测试的区间扫描器或 CodeMirror mixed parsing glue 实现。

### 8.2 数据流

文档文本仍是唯一事实来源。编辑事务改变前若干行时，增量计算 front matter 区间与诊断；得到 `{range, status, diagnostics, selectedKeys}` 这类小快照。live preview decoration 只消费区间与焦点状态；图片 resolver 通过 editor/service facade 查询经过验证的 `typora-root-url`，而不是让 React store 复制 YAML 对象。插入命令以单个 CodeMirror transaction 写入模板，进入同一 undo 栈。

### 8.3 源码保真

禁止“parse 为对象后 stringify 全块”。普通编辑只修改用户选区；自动写入扩展键时使用 CST/range-aware 更新，保留注释、键顺序、引号、缩进、空行、换行风格和末尾换行。重复键、别名、多文档指示符等无法安全更新时，应拒绝自动改写并给出可恢复提示。所有 open → save fixture 必须字节一致；只有用户明确执行命令时才允许出现可解释的局部 diff。

### 8.4 交互、i18n 与可访问性

非焦点状态显示低噪音 metadata 容器，可先不默认折叠，避免在未核实 Typora 细节前过度拟合；焦点进入后露出原始分隔符与 YAML 文本。插入命令进入段落菜单和命令面板，名称、错误、折叠状态、解析诊断全部进入 `en.json` 与 `zh-CN.json`。容器使用语义化区域和本地化 label；折叠按钮若实现，使用原生 button、`aria-expanded`、可见焦点和键盘操作。错误提示不得只依赖颜色，诊断需关联行范围并可由屏幕阅读器获知。

### 8.5 错误处理与扩展键

未闭合或非法 YAML 时保留纯文本可编辑，禁用 metadata 驱动的图片行为，并显示非阻塞诊断；不得崩溃或静默采用部分错误值。`typora-root-url` 只参与预览解析，需规范化路径并经过现有 Tauri asset 授权边界，不改写图片源文。`typora-copy-images-to` 属文档级显式策略：首次采用时应解释它会修改源文；路径越界、绝对路径、无效类型或写入失败要返回稳定错误码与双语信息。LumaMark 自有“复制到 `<文档名>.assets/`”设置与 Typora 键的优先级必须书面确定，建议文档显式键优先于全局默认，但任何迁移都不得自动发生。

## 9. P0 / P1 / P2 分阶段计划

### P0：正确识别与零损保存

- 建立文首成对分隔符识别，保证合法块不再进入 HR/Setext 装饰路径，正文 `---` 仍是水平线。
- 加入 source-preserving fixture：合法、空、非法、未闭合、BOM、LF/CRLF、注释、引号、数组、重复键、中文键值与大 metadata。
- live preview 先提供稳定的弱化容器与焦点编辑，不要求折叠动画；源码模式完整显示。
- 非法 YAML 安全降级，不执行扩展键；加入中英文诊断。

### P1：完整编辑体验

- 增加 `---` + Return 创建事务、菜单与命令面板入口。
- 完成焦点进入/离开、鼠标定位、键盘导航、普通文本与多行 YAML 粘贴、撤销重做、选区和 IME 回归。
- 接入成熟 YAML 高亮与增量诊断；若提供折叠，补齐 `aria-expanded` 和键盘等价操作。
- 明确并实现 `typora-root-url` 的只读预览语义及安全路径边界。

### P2：文档级图片工作流与高级兼容

- 实现 `typora-copy-images-to` 的显式、range-aware 写入以及与全局 assets 设置的优先级。
- 覆盖批量图片导入、移动/复制失败恢复、跨平台路径、工作区外路径授权。
- 在取得 Typora 本机证据后再决定默认折叠状态、控件细节及多文档 YAML 等高级兼容范围。

## 10. 可执行验收标准与测试计划

### 10.1 验收标准

1. 打开以合法 Front Matter 开头的文件时，live preview 中不存在由分隔符产生的 `.lm-md-horizontal-rule`，YAML 内容也不产生 Setext 标题装饰。
2. 同一份文档中的正文 `---` 仍渲染为水平线；文首未闭合 `---` 安全回退且不崩溃。
3. source 模式逐字符显示原始块；未编辑 open → save 后字节差为零，包含 BOM/CRLF/注释/引号/键序。
4. 文首创建命令用一个可撤销事务插入完整模板；一次 Undo 完全恢复创建前状态，Redo 可恢复。
5. 焦点进入块可编辑源码，离开后恢复弱化阅读态；鼠标、Tab/方向键与屏幕阅读器均可到达必要控件。
6. 非法 YAML 显示中英文非阻塞诊断，原文仍可编辑保存，图片扩展键不生效。
7. `typora-root-url` 只改变预览解析结果，不改变 Markdown 图片 source；路径越界被现有安全边界拒绝。
8. `typora-copy-images-to` 只有在用户明确操作后产生局部、可解释 diff；失败时原块和图片引用保持一致。

### 10.2 Unit

- 边界识别：文首、BOM 后文首、空块、未闭合块、正文 HR、Setext、连续分隔符、多文档指示符。
- 区间更新：插入/更新键时保持注释、顺序、引号、缩进和换行；无法安全更新时返回显式错误。
- 路径语义：`typora-root-url` 的 Windows/Unix 相对路径、根路径、`..`、URL 与非法类型。
- decoration：active/inactive 状态、诊断范围、非法 YAML 回退，以及不把块内 `---` 当 HR。

### 10.3 Integration

- CodeMirror transaction 覆盖创建、逐键输入、普通文本与多行 YAML 粘贴、Undo/Redo、source/live preview 切换、选择跨块、中文 IME composition；粘贴后未闭合或非法时必须保留原文并给出可恢复状态。若未来决定强制纯文本或保护分隔符，须先补 Typora 实测或 LumaMark 产品决策证据。
- 文件动作覆盖合法/非法 YAML 的 open → edit → save，验证仅目标区发生预期 diff。
- 图片 capability 与 metadata snapshot 协作，验证 resolver 使用键值但不修改源文。

### 10.4 E2E

- 从菜单和文首键入两条路径创建；点击正文离焦后观察阅读态，再点击 metadata 返回编辑态。
- 切源码模式核对完整字符；保存、重开并比较；非法 YAML 显示双语提示且应用可继续编辑。
- 粘贴多行 YAML、撤销、重做；若提供折叠控件，验证键盘展开/收起；使用 axe 或等价成熟工具检查可访问名称与状态。
- 带 `typora-root-url` 的图片在预期路径显示，同时源码仍保留 `/path`；权限或路径错误显示可恢复提示。

### 10.5 Fixture 与性能

- 新增独立 `front-matter.md`、`front-matter-invalid.md`、`front-matter-crlf.md`、`front-matter-images.md`，登记 manifest/tag，并纳入 `pnpm test:fixtures` 字节 round-trip。
- 增加 1 MB 正文 + 小 Front Matter、10 MB 正文 + 小 Front Matter、超大 Front Matter 三组性能样本。单独运行 `pnpm perf:bench`，测量打开、首屏装饰、逐键事务和模式切换；普通输入事务不应全量 parse/stringify YAML 或扫描 10 MB 全文。性能基准不得与 E2E、构建或 typecheck 并行。

## 11. 风险与未核实项

- Typora 1.13.7 的折叠控件像素、默认展开状态、非法 YAML 具体提示和复杂剪贴板优先级仍证据不足，需要独立本机观察后才能决定是否做细节追平。
- 当前解析树诊断证明了所用 GFM 配置对三个代表样本的行为，但它不是正式自动化测试；最小合法样本与含数组样本会产生不同的普通 Markdown 树形，说明误呈现依赖块内文本形状。实现前必须把这些样本转成仓库内 unit/integration 回归。
- `@codemirror/lang-yaml` 当前只是传递依赖；其版本虽然锁定，但未被产品代码调用。直接接入会影响包体积与解析性能，需要独立基准。
- 文档级图片键会跨越 editor、feature 与 service 边界；若直接塞入全局 store 或让 Rust 自动改写 YAML，将带来状态双源和源码保真风险。
- BOM、非 UTF-8、YAML anchors/aliases、重复键和多文档语法的产品策略尚未书面确定。当前 Rust 明确拒绝非 UTF-8，因此非 UTF-8 不应被报告为已支持。
- 工作树存在大量其他未提交改动，本报告只描述取证时看到的状态；后续代码变化可能使行号漂移，应以符号与提交快照复核。

## 12. 证据索引

- 规则与流程：`AGENTS.md`；`DEVELOPMENT_PROCESS.md`。
- Typora 专题基线：`docs/product/typora-baseline/14-yaml-front-matter.md`。
- 横切体验与歧义：`docs/product/typora-baseline/00-live-preview-model.md`；`docs/product/typora-baseline/13-horizontal-rules.md`；`docs/product/typora-baseline/07-images.md`。
- Markdown 语言：`src/editor/markdown/markdownLanguage.ts:1-75`；`src/editor/markdown/markdownLanguage.test.ts:1-26`。
- live preview 与装饰：`src/editor/core/editorDisplayMode.ts:1-52`；`src/editor/capabilities/index.ts:20-49`；`src/editor/wysiwyg/markdownDecorations.ts:183-340,453-524`；`src/editor/wysiwyg/markdownDecorations.test.ts:85-149`。
- 命令入口：`src/editor/commands/markdownFormatCommands.ts:5-74,150-179`；`src/editor/commands/markdownFormatKeymap.ts:1-37`；`src/features/commands/createCommandModels.ts:35-150,171-304`。
- 文件与保存：`src/features/file-actions/fileActions.ts:91-169`；`src-tauri/src/services/file_service.rs:26-67,92-114`。
- fixture：`tests/fixtures/roundTrip.test.ts:1-72`；`tests/fixtures/fixturePaths.ts:1-42`；`tests/fixtures/markdownFixtureManifest.ts:1-167`；`tests/fixtures/fixtureCoverage.test.ts:1-75`。
- 模式 E2E：`tests/e2e/editor-markdown.spec.ts:62-95,529-560`。
- 图片路径与设置：`src/editor/capabilities/image/imagePreviewExtension.ts:101-123,431-455`；`src/editor/capabilities/image/imagePreviewExtension.test.ts:79-131`；`src/app/controllers/useAppEditorCommands.ts:25-101`；`src/features/settings/SettingsDialog.tsx:9-119`。
- 依赖证据：`package.json:30-80`；`pnpm-lock.yaml:327-328,568-569,3088-3120,3413-3417`。
- 本次只读解析诊断：使用当前安装的 `@codemirror/lang-markdown` 与 `syntaxTree` 对合法文首、未闭合文首和正文 HR 三个内存字符串打印语法树。最小合法样本为 `---\ntitle: Demo\n---\n# Body`，结果是 `Document(HorizontalRule,SetextHeading2(HeaderMark),ATXHeading1(HeaderMark))`；含数组的合法样本还会把闭合分隔符解析为 `HorizontalRule`。该诊断未写文件，也不等同于仓库测试。
