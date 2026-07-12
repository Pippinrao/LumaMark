# 1. LumaMark 与 Typora Mermaid 及图表专题竞品分析

## 2. 用途、范围与非目标

本文用于回答一个严格限定的问题：截至当前工作树，LumaMark 的 Mermaid 与图表能力有哪些真实实现，用户实际会经历怎样的创建、阅读、编辑、保存与失败路径，以及这些能力距离 Typora 1.13.7 的公开体验基线还有多远。判断以代码、自动化测试、fixture、锁文件和本次新鲜验证为主；产品规划和架构规划只用于解释目标与边界，不能单独证明功能已经存在。

范围包括 `mermaid` fenced block 的识别与创建、live preview、焦点编辑、源码模式、渲染调度与缓存、主题、错误隔离、源码保真、键盘与鼠标入口、粘贴和保存、多图种、国际化、可访问性、性能及测试覆盖；也比较 Typora 的 Diagrams 总开关、`sequence`/`flow` 兼容围栏、初始化指令、图像复制与导出。

非目标包括 Mermaid 各图种的语法教程、可视化拖拽建模器、数学公式、普通代码块、通用导出系统和 Typora 私有实现推断。本文不把“依赖中的 Mermaid 理论上支持某语法”等同于 LumaMark 已提供稳定体验，也不把“存在测试文件”等同于本次测试已经通过。

## 3. 执行摘要

LumaMark 已经具备可用的 Mermaid 核心闭环：live preview 模式会识别 `mermaid` 围栏，用官方 Mermaid 11.16.0 动态渲染 SVG；预览提供显式“编辑源码”和“删除”按钮；编辑时有补全、基础诊断、实时重渲染；失败块会局部显示错误并保持文档其余部分可编辑；源码模式恢复完整围栏；fixture 原文本经保存写出路径可以保持字节完全一致，但这不等于真实打开链路的完整 round-trip。本次专题单元、调度、语言服务、fixture 覆盖与保存字节保真共 51 项通过，完整 Mermaid E2E 37 项通过，性能样例记录 pending mock render 期间一次普通输入 dispatch 为 3.72 ms。

但“功能存在”不等于“体验追平”。最主要差距有四项。第一，Typora 横切 live preview 基线要求当前块进入可编辑态、离开后回到预览；图表专题的精确进入手势仍未实机核实，不能断言一定是光标自动触发。LumaMark 的测试则明确固定为光标或选区进入块时仍隐藏源码并保持替换预览，用户必须悬停后点击编辑按钮，至少尚未追平“当前块可直接编辑”的交互模型。第二，inline editor 使用独立 CodeMirror 和待提交缓冲，正文只在关闭或 widget 销毁时写回主文档；仓库没有“inline editor 仍打开时直接保存”的自动化证据，因此保存最新编辑和统一撤销历史仍有高风险。第三，120 ms debounce、64 项缓存和 generation 丢弃只能避免部分重复与旧结果回写；真实 `mermaid.render` 仍在浏览器主线程执行，已启动任务不可中止，现有性能测试又使用永不完成的 mock Promise，不能证明复杂图渲染期间输入不卡顿。第四，Typora 的 Diagrams 开关、`sequence`/`flow`、右键复制/导出、深度主题配置等产品表面尚未提供。

综合结论：LumaMark 的 Mermaid 核心功能状态为“部分实现”，已明显超过原型，但尚不能表述为 Typora 体验追平。优先级应先解决焦点编辑与保存一致性，再补真实主线程性能证据，之后扩展设置、导出和兼容围栏。

## 4. Typora 功能与完整体验基线

以下基线来自 `docs/product/typora-baseline/11-mermaid-and-diagrams.md` 及其直接引用的 `00-live-preview-model.md`。公开支持事实、实机观察与未核实项保持分开。

### 4.1 创建

- 用户必须先在 Preferences → Markdown 启用 Diagrams；图表是偏好门控扩展，并非标准 CommonMark/GFM。
- 主创建路径是键入普通 fenced block：`mermaid` 使用 Mermaid，`sequence` 使用 js-sequence，`flow` 使用 flowchart.js。未记录专用插入快捷键、菜单向导或拖拽创建入口。
- 多种 Mermaid 图类型由 Mermaid 引擎解释，包括 flowchart、sequence、gantt、class、state、pie、requirement、gitGraph、C4、mindmap、timeline、quadrant、sankey、ZenUML、xyChart 等；Typora 1.13 升至 Mermaid 11.13.0，并加入 Venn、Ishikawa 等能力。
- 可以在源码首行使用 `%%{init: ...}%%`；还可通过 Custom CSS 变量调整 Mermaid 主题。向围栏直接粘贴 DSL 文本的精确行为在基线中未实机核实。

### 4.2 阅读态

启用 Diagrams 后，非焦点图表块显示渲染图而非 fenced source。本机 Typora 1.13.7 观察证据确认 `graph LR; A --> B` 显示为节点箭头图。关闭 Diagrams 后是否严格退化为普通代码块，基线仍属于未核实项。

### 4.3 焦点编辑态

横切 live preview 模型规定：非当前块接近阅读态，当前块露出必要源码或专用编辑 UI；图表应在源码编辑与预览之间切换。Typora 图表块具体是单击、光标进入还是其它手势触发，现有基线没有逐步 GUI 证据，因此不能臆测像素级细节。但“进入可编辑状态、离开回到预览”是对齐所需的产品模型。

### 4.4 源码模式

源码模式显示完整围栏、info string 和 DSL 正文。Windows/Linux 使用 `Ctrl+/` 在 hybrid live preview 与源码模式间切换。两种模式编辑同一份 Markdown，Typora 1.13 声明切换时保留滚动位置；跨模式撤销栈的精确行为仍未逐条核实。

### 4.5 键盘、鼠标与粘贴

- 键盘创建依靠键入 fenced source；没有已知图表专用插入快捷键。源码模式快捷键为 `Ctrl+/`。
- 鼠标右键图表预览可保存为 SVG、PNG、JPG，或复制到剪贴板。具体菜单项顺序和焦点切换手势仍需实机复核。
- 普通 Typora 粘贴受 Smart Paste 规则影响；在图表围栏内粘贴 Mermaid DSL 的细节以及复制图像后的剪贴板格式，基线未完整核实。

### 4.6 保存、错误与边界

- Markdown 落盘仍是普通 fenced block 与 DSL 文本，渲染仅是编辑器派生视图；保存不应改写无关文本。
- 非法 DSL 不应拖垮编辑器，但 Typora 的错误文案、错误面板和重试交互尚未核实。
- HTML、PDF、epub、docx 等导出可包含渲染图，部分其它格式不支持；官方建议关键图在互操作要求高时改为普通图片。
- ZenUML 等图种存在主题或支持层级限制。Typora 1.13 修复过多图导出与子元素渲染问题，说明多图与导出生命周期本身是重要边界。

## 5. LumaMark 当前功能清单与精确证据

### 5.1 依赖和实际接线

1. **官方渲染引擎已接入。** `package.json:58` 声明 `mermaid ^11.16.0`，`pnpm-lock.yaml:83-85,2165-2166,4954-4975` 锁定 11.16.0 及解析、布局、净化依赖。版本高于 Typora 基线的 11.13.0，但版本号更高不能自动证明每种 Typora 体验都兼容。
2. **只在 live preview 接线。** `src/editor/core/editorDisplayMode.ts:37-52` 显示 source 模式只加 class，live preview 才装载 capability；`src/editor/capabilities/index.ts:20-28` 把 Mermaid capability 与 code block、image、table 一起聚合；`createMermaidCapability.ts:4-8` 的公开能力只提供 preview extension。
3. **架构边界已落地。** 当前主体位于 `src/editor/capabilities/mermaid/`，旧 `widgets/mermaid` 是兼容导出路径；这与 `docs/architecture/DETAILED_ARCHITECTURE.md:246-258` 的模块职责吻合。该文档只能证明约束，实际文件与 import 链才证明当前接线。

### 5.2 识别、预览与图种

1. **围栏检测已实现。** `mermaidBlockDetection.ts:30-65` 从 CodeMirror syntax tree 收集 fenced block；`68-103` 要求同时存在 `CodeInfo` 与 `CodeText`，接受大小写不敏感的 `mermaid` 和以 `mermaid ` 开头的 metadata-like info string，不接受 `sequence` 或 `flow`。
2. **预览替换已实现。** `mermaidPreviewExtension.ts:95-123` 对所有检测到的块建立 `Decoration.replace`，整个 fenced range 被 widget 替换；`MermaidWidget.test.ts:103-129` 验证 SVG 出现且主文档字符串不变。
3. **多图种真实 E2E 已实现。** `tests/fixtures/mermaidSamples.ts:10-263` 定义 27 个 required 样例和 2 个 fixture-only 样例；`tests/e2e/mermaid.spec.ts:226-262` 逐个要求预览状态成功和 SVG 可见。本次新鲜完整执行 37/37 通过，覆盖 flowchart、sequence、class、state、ER、gantt、pie、gitGraph、mindmap、timeline、requirement、C4、sankey、xyChart、block、packet、radar、architecture、kanban、treemap、Venn 等。
4. **metadata 只被识别，没有配置语义证据。** `MermaidWidget.test.ts:68-101` 只断言 `mermaid {theme: "neutral"}` 被收集；render adapter 接收的是 extension options 中的 config，并没有解析 info string。因此不能把 metadata-like 文本识别表述为按块配置已实现。

### 5.3 渲染调度、缓存、主题与安全

1. **debounce、缓存和过期结果丢弃已实现。** `mermaidRenderScheduler.ts:38-86` 以 blockId 管理 120 ms 定时任务并优先命中缓存；`88-145` 用单调 generation 防止旧结果回写。`mermaidRenderScheduler.test.ts:80-284` 覆盖旧任务、缓存命中和 generation 边界。
2. **缓存键完整且有上限。** `mermaidCache.ts:12-51` 将 source、theme、排序后的 config 和 Mermaid version 写入 key，默认最多 64 项；相关测试见 `mermaidRenderScheduler.test.ts:17-73`。
3. **官方包动态加载且强制 strict。** `mermaidRenderAdapter.ts:7-33` 动态 import Mermaid，覆盖 `securityLevel: 'strict'`，关闭 `startOnLoad`，按应用明暗主题初始化并调用官方 `render`。SVG 随后在 `MermaidBlockWidget.ts:194-201` 通过 `innerHTML` 注入；安全边界依赖 strict 配置与 Mermaid/DOMPurify 上游。
4. **主题重渲染已实现。** `mermaidPreviewExtension.ts:46-69,135-139` 观察根节点 `data-theme`，主题变化触发 decoration 重建；`MermaidWidget.test.ts:555` 起的测试验证会请求新渲染。
5. **真实主线程隔离未实现。** scheduler 的异步边界是 `setTimeout` 加 Promise；`renderWithMermaid` 仍在窗口线程调用 `mermaid.render`，没有 worker 或可中止的渲染执行体。取消只能清 timer 或忽略旧结果，无法停止已经开始的布局计算。

### 5.4 编辑、删除、错误与可访问性

1. **显式源码编辑已实现。** `mermaidWidgetDom.ts:41-71` 创建可聚焦 preview、状态区、action 区、inline editor host 和 SVG 容器；`74-102` 创建带本地化 aria-label/title 的编辑、删除按钮。`MermaidBlockWidget.ts:48-87,106-162` 处理点击、焦点离开、Escape 和实时预览。
2. **inline editor 有成熟 CodeMirror 基础能力。** `mermaidInlineEditor.ts:18-59` 使用 CodeMirror history、line wrapping、默认键位、自动补全和 lint，而不是手搓文本框。
3. **补全和基础诊断已实现但不完整。** `mermaidLanguageService.ts:11-123` 提供图种、关键字、snippet、250 ms lint；`138-184` 只检查空内容、首行图种和部分未闭合块，不是官方 Mermaid parser 的完整语法诊断。诊断消息在 `145,163,177` 直接硬编码英文，未进入 i18n。
4. **错误隔离已实现。** `MermaidBlockWidget.ts:169-205` 将 loading、success、error 限定在单个 widget，失败后自动展开 inline editor；`MermaidWidget.test.ts:210-268` 证明错误文案本地化且坏块不影响好块；`tests/e2e/mermaid.spec.ts:264-301` 覆盖失败块存在时正文仍可编辑。
5. **基础键盘和焦点可访问性部分存在。** preview 有 `tabIndex=0`，按钮有 aria-label，CSS 有 `:focus-visible`；但没有图表语义名称、生成 SVG 的稳定 `role=img`/可访问标题契约、键盘 action menu、错误详情关联或屏幕阅读器 live region 测试。

### 5.5 源码模式、保存与 fixture

1. **源码模式可恢复完整 source。** `tests/e2e/mermaid.spec.ts:303-339` 插入 gallery 后切换源码模式，断言 preview 为零且围栏和 DSL 可见；`tests/e2e/v1-workflow.spec.ts:164-175` 也覆盖保存重载后切源码模式。
2. **未编辑 fixture 的保存字节保真已实现，但完整 open → save round-trip 证据不足。** `tests/fixtures/fixturePaths.ts:5-31` 将 `mermaid.md`、gallery 和 edge cases 纳入通用 fixture；`tests/fixtures/roundTrip.test.ts:8-72` 把 fixture 原文本直接作为 `editor.getDocumentText()` 的返回值，调用保存路径并逐字节比较。它证明保存写出不会改写这些字节，但没有调用打开路径、没有把文本装载进真实 EditorState，也不能单独证明解析、编辑器装载和保存组成的完整 round-trip。
3. **存在一条真实打开/保存/重开 E2E，但不构成 fixture 字节 round-trip。** `tests/e2e/v1-workflow.spec.ts:105-175` 通过 `Ctrl+O` 打开文档，保存后检查 Mermaid 源码片段，重载并重新打开后检查预览与源码模式；断言是 `toContain`，且没有在 inline editor 中编辑 DSL，所以它证明基础工作流存在，不能补足逐字节保真或 active-edit save 证据。
4. **inline 编辑写回存在时序风险。** `MermaidBlockWidget.ts:154-162` 输入时只更新 `pendingContent` 并请求预览，`235-250` 在关闭或 destroy 时才 dispatch 到主文档。测试覆盖点击正文后关闭再继续操作，但没有覆盖 inline editor 保持打开时直接按 `Ctrl+S`。因此“编辑中的最新 DSL 一定被保存”只能判定为部分实现。
5. **统一撤销历史证据不足。** inline editor 自己安装 `history()`，主文档在 flush 时收到一次 `input.mermaid` 事务。仓库没有证明 inline editor 的逐步撤销、主编辑器撤销与源码模式撤销构成单一连续历史。

### 5.6 i18n、样式和产品入口

- `src/shared/i18n/locales/zh-CN.json:128-132` 与 `en.json:128-132` 提供删除、编辑、编辑源码、加载、渲染失败文案，`i18n.test.ts:89-93` 将其纳入双语 key 门禁。
- 图标按钮自身没有可见硬编码文案；但语言服务诊断仍硬编码英文，因此国际化只能判定为部分实现。
- `mermaid.css:1-139` 提供预览、错误、hover/focus action、可滚动 SVG、inline editor 的明暗 token 样式；没有 Typora 风格的 Custom CSS Mermaid 变量产品契约。
- 对 `src/features`、`src/app`、`src/editor/commands` 的定点检索未发现 Diagrams 设置、Mermaid 插入命令、复制图像或 SVG/PNG/JPG 导出命令。功能入口目前依赖键入/粘贴 fenced source 和预览上的编辑、删除按钮。

## 6. 当前真实体验路径

1. 用户在 live preview 主编辑器键入或粘贴完整 ` ```mermaid ` fenced block。没有设置开关、插入菜单或专用快捷键。
2. 一旦语法树识别出完整围栏，extension 会扫描文档中的 Mermaid 块，用一个 preview widget 替换整个 source range。即使主编辑器光标或选区位于该块，预览仍保持，源码不会自动展开；这是 `MermaidWidget.test.ts:131-184` 明确锁定的当前行为。
3. 首次渲染显示本地化 loading 状态。120 ms 后动态加载/调用 Mermaid；相同 source、theme、config、version 可命中内存缓存。成功时显示 SVG，失败时显示通用错误并自动打开源码编辑区。
4. 用户用鼠标 hover 或键盘聚焦 preview 后看到编辑、删除图标。点击编辑会打开嵌套 CodeMirror，预览位于源码编辑器下方；输入触发补全、基础 lint 和重新渲染。Escape 或焦点移出成功 preview 会关闭编辑器，错误状态则保持打开。
5. inline editor 输入期间，SVG 使用待提交文本渲染，但主 Markdown 文档尚未立即更新。焦点离开、Escape、widget 重建或销毁后，待提交内容才替换原 fenced block 的正文范围。删除按钮会删除整个块并顺带处理一侧换行。
6. 用户切换源码模式后，live preview capability 被卸载，完整围栏与 DSL 在主 CodeMirror 中出现。切回 live preview 后重新建立 preview。
7. Mermaid fixture 原文本直接经过保存写出路径时能保持字节一致；关闭 inline editor 后的修改会进入主文档。fixture 门禁尚未覆盖真实打开并装载进 EditorState 后再保存，inline editor 仍打开时立即保存是否包含最后输入也没有自动化保证。
8. 没有图像复制、另存 SVG/PNG/JPG、旧 `sequence`/`flow` 引擎、Diagrams 开关或按块配置 UI。粘贴不经过 Mermaid 专用转换，只按主编辑器或 inline CodeMirror 的普通文本输入路径处理。

## 7. 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| `mermaid` 围栏识别与 SVG 预览 | 已实现 | 低 | 常用 Mermaid 文档可直接阅读 | `mermaidBlockDetection.ts:30-103`；本次 E2E 多图种通过 |
| 键入/粘贴 fenced source 创建 | 部分实现 | 中 | 熟悉 Markdown 的用户可创建，新用户缺少发现性入口 | 未发现插入 command；E2E 通过文本插入创建 |
| 非焦点阅读态 | 已实现 | 低 | 可获得接近最终阅读的图表预览 | `mermaidPreviewExtension.ts:95-123` |
| 焦点进入块自动编辑源码 | 部分实现 | 高 | 用户必须悬停并点按钮，偏离 Typora 直接编辑心智 | `MermaidWidget.test.ts:131-184` 明确保持预览并隐藏 source |
| 完整源码模式 | 已实现 | 低 | 可查看和编辑原始 fence/DSL | `editorDisplayMode.ts:37-52`；E2E `303-339` |
| inline editor 实时预览 | 已实现 | 低 | 编辑 DSL 时可同时观察结果 | `MermaidBlockWidget.ts:106-205`；E2E `190-224` |
| 编辑中立即写回唯一 Markdown 真相 | 部分实现 | 高 | 打开 inline editor 时保存可能遗漏末次输入，撤销历史也可能分裂 | `MermaidBlockWidget.ts:154-162,235-250`；缺少 active-save 测试 |
| debounce 与缓存 | 已实现 | 低 | 降低重复渲染和快速输入抖动 | scheduler/cache 代码及单元测试 |
| 可中止真实渲染 | 未实现 | 高 | 复杂旧图仍可能占用主线程，快速修改会浪费计算 | `renderWithMermaid` 直接调用官方 render；cancel 只丢结果 |
| 全文/全树扫描控制 | 未实现 | 高 | 任意选区变化都可能重新遍历全文，长文档多图时影响输入与滚动 | `mermaidPreviewExtension.ts:80-86,103-106` |
| 真实 Mermaid 主线程性能门禁 | 部分实现 | 高 | 3.72 ms 样例不能覆盖复杂图布局长任务 | perf 测试 `26-80` 使用永不完成 mock render |
| 多 Mermaid 图种 | 已实现 | 低 | 当前 27 个 required 与 2 个扩展样例可渲染 | `mermaidSamples.ts`；本次完整 E2E 37/37 通过 |
| Mermaid 11.13+ 新图种 | 部分实现 | 中 | Venn 已有真实 E2E；Ishikawa 只有补全词条，不能证明当前渲染链路可用 | 锁定 11.16.0；`venn` sample/E2E；`mermaidLanguageService.ts:52-53` |
| Diagrams 总开关 | 未实现 | 中 | 用户无法把 Mermaid 围栏按普通代码块阅读，也无法统一关闭高成本渲染 | settings/app 定点检索无入口 |
| `sequence` 与 `flow` 围栏 | 未实现 | 中 | 打开 Typora 旧文档时两类图不会按图表预览 | detector 只接受 `mermaid` |
| `%%{init}%%` | 证据不足 | 中 | 高级按图配置可能有效，但缺本地兼容与安全回归保证 | 官方引擎可能解析；仓库无专测 |
| metadata-like info string 配置 | 部分实现 | 中 | 围栏会被识别，但 `{theme: ...}` 不会转成配置 | 检测测试只断言 info 文本 |
| 应用明暗主题 | 已实现 | 低 | 切主题会重新渲染并使用对应 Mermaid theme | theme observer 与测试 |
| Custom CSS Mermaid 变量 | 未实现 | 低 | 高级用户不能复用 Typora 的深度主题定制方式 | CSS 与设置中无公开变量契约 |
| 错误块隔离 | 已实现 | 低 | 单个坏图不会拖垮其它图或正文编辑 | widget 单元测试及 E2E `264-301` |
| 错误详情、定位和重试 | 部分实现 | 中 | 用户只看到通用失败文案，排错成本高 | `onError` 丢弃 error 对象，只显示 `renderFailed` |
| SVG/PNG/JPG 保存 | 未实现 | 中 | 无法像 Typora 一样从预览直接导出图像 | action DOM 仅 edit/delete |
| 复制图像到剪贴板 | 未实现 | 中 | 跨应用复用流程需要另行截图或外部工具 | 未发现 clipboard/export 命令 |
| UI 文案双语 | 部分实现 | 中 | action/status 双语，但 lint 对中文界面仍显示英文 | locale keys 与 `mermaidLanguageService.ts:145,163,177` |
| 基础键盘/焦点可访问性 | 部分实现 | 中 | 可 Tab 到 preview/button，但图表语义、错误关联和快捷操作不足 | `mermaidWidgetDom.ts:41-64,74-113` |
| 未编辑 source 保存字节保真 | 已实现 | 低 | 原 fixture 文本经保存写出后无字节差异；不等于完整 open → EditorState → save | `roundTrip.test.ts:8-72`；本次通过 |
| fixture 字节级 open → save round-trip | 证据不足 | 高 | 基础 E2E 只做片段断言；打开/装载阶段若规范化源码，现有字节门禁无法发现 | `roundTrip.test.ts:17-45` 使用同一 `sourceText` mock；`v1-workflow.spec.ts:105-175` 仅 `toContain` |
| IME、跨模式 undo、复制选择 | 证据不足 | 高 | 中文输入、撤销连续性和选择复制仍可能出现难恢复问题 | 专题测试未覆盖这些交互 |

## 8. 根因与架构影响

1. **当前块模型选择错误。** preview extension 对每个 Mermaid block 无条件使用整块 `Decoration.replace`，selection 变化只触发同样的重建，没有“当前块显示 source、非当前块显示 preview”的分支。这不是按钮样式问题，而是 live preview 状态模型与 Typora 基线不同。
2. **嵌套编辑器制造双状态。** inline CodeMirror 拥有独立 doc、selection、composition 和 history；`pendingContent` 又在 widget 内暂存，主文档直到 flush 才更新。它直接影响保存、撤销、IME、焦点、widget 重建和源码唯一真相。`mermaidEditingState.ts:1-13` 还是按绝对 offset 的模块级全局 Set，多编辑器、多窗口、块前方插入或文档切换时可能残留或错配。
3. **渲染异步与计算隔离被混为一谈。** `setTimeout` 能把调用移出当前输入事务，Promise 能异步回传结果，但 Mermaid 的解析、布局与 SVG 生成仍可能在同一 UI 线程执行。generation 解决的是结果竞态，不解决 CPU 抢占。
4. **更新粒度过粗。** 任何 docChanged 或 selection 事务都对 `[0, doc.length]` 遍历 syntax tree，并重建所有 Mermaid decorations。长文档、多图、频繁光标移动会把 Mermaid capability 带入热路径，违背 capability 自身应限制影响面的目标。
5. **产品表面尚未接入 feature/service 层。** 当前 capability 只拥有 editor 内部 extension，没有 settings facade、command port、context-menu action 或 export/clipboard service，因此 Diagrams 开关、插入入口和导出能力自然缺失。把这些继续塞入 widget 会违反架构边界，应由 `features/settings`、`features/commands` 与 `services` 协作。
6. **诊断没有统一 i18n/error contract。** language service 使用自建浅规则和硬编码英文；render adapter 抛出的真实错误在 widget 层被丢弃。结果是错误可隔离，但不可解释、不可定位，也难以稳定测试不同语言。

## 9. 详细改进方案

### 9.1 模块归属与数据流

- `editor/capabilities/mermaid/mermaidPreviewExtension.ts` 负责基于主 EditorState 推导三态：非当前块为 preview，当前块为 source-editing，渲染失败块为 source + error。当前块应直接编辑主 CodeMirror 文档，避免复制出第二份 Markdown 状态。
- `mermaidBlockDetection.ts` 继续负责语法树识别，但输入应改为 transaction changed ranges、selection 相关块和 visibleRanges；维护按 block identity 的轻量索引，不能在每次光标移动时扫描全文。
- `MermaidBlockWidget.ts` 收缩为纯预览生命周期和状态展示；移除 `pendingContent`、模块级 offset Set 及嵌套 history。若保留“源码+预览同时显示”的增强入口，nested editor 也必须通过同步 transaction bridge 每次写回主 doc，并共享明确的 undo group，不能在保存前留未提交副本。
- `services/render-jobs` 提供通用但轻量的任务生命周期接口：queued/running/succeeded/failed/stale、取消 token、测量字段；Mermaid capability 只传 source/config/theme/version 和接收结果，不让 React store 持有 SVG 或 Markdown 全文。
- `features/settings` 管理 Diagrams 开关与持久化；`editorDisplayModeCompartment` 或独立 Mermaid compartment 接收配置 effect，做到热更新，关闭时退化为普通 fenced code block。
- `features/commands` 提供“插入 Mermaid 图表”“编辑当前图表”“复制图像”“保存图像”命令，UI 菜单与快捷键只调用 command port。右键菜单优先复用仓库已有 Radix Context Menu，不能在 widget 中手搓菜单。
- `services/diagram-export` 负责 SVG 序列化、PNG/JPEG 转换与文件保存；剪贴板优先评估 Tauri 官方 clipboard plugin 或现有平台 facade。若新增主要依赖，需先记录包体积、维护状态、许可和跨平台影响。

建议数据流为：Markdown 主文档 → syntax tree/受影响 block → immutable render request → scheduler → 官方 Mermaid renderer → sanitized SVG cache → preview widget。编辑始终直接产生主 EditorState transaction；保存只读取主文档；预览、SVG、诊断均为可丢弃派生数据。

### 9.2 成熟依赖优先与渲染策略

- 继续使用官方 `mermaid`，不自研 DSL parser、布局或 SVG renderer。完整语法校验优先调用 Mermaid 官方 parse/render 能力，而不是继续扩大正则诊断器。
- 先用真实图基准确认主线程长任务，再决定隔离方式。若官方 Mermaid 当前版本无法在 Worker 环境完整运行，应记录限制，评估官方可分离 parser、受控 iframe/独立 WebView 或空闲调度；不能用“返回 Promise”替代线程隔离证明。
- 对已开始且不可 abort 的 render，至少做请求合并、只渲染最新版本、视口外延迟、并发上限和长任务遥测。主题切换时只重渲染可见图，后台逐步填充缓存。
- 缓存需要按 SVG 字节数和条目数双重限制，文档关闭/主题大变更时可释放；记录命中率、平均/分位渲染耗时和最大 SVG 大小。

### 9.3 源码保真、保存与撤销

- 唯一可编辑数据必须始终是主 EditorState 中原始 fenced source。预览不能 stringify AST，不能规范化空白、换行、fence 长度、info string 大小写或 `%%{init}%%`。
- 只替换用户实际编辑的 DSL content range，保留 opening/closing fence、metadata 和文档行尾风格。保存前不需要 widget flush；`Ctrl+S` 任意焦点状态都读取最新主文档。
- unit/integration 测试必须覆盖 CRLF、四反引号 fence、大小写 info、metadata、空图、连续图、块前插入导致 offset 变化、撤销/重做、source/live preview 切换、真实 open → EditorState → save，以及 active edit 直接保存。

### 9.4 i18n、可访问性与错误处理

- 将全部 lint 诊断、渲染失败摘要、重试、复制源码、保存/复制图像文案放入中英文资源；不要拼接句段。错误对象需映射为稳定 error code 与本地化消息，同时提供可展开的技术详情，不能把原始异常直接暴露为不受控 UI。
- preview 使用 `figure`/语义等价容器；生成 SVG 具备稳定 `role="img"`、可访问名称和必要描述。名称优先取 Mermaid 可用 title，否则使用本地化“Mermaid 图表”。loading/error 使用合适 live region，但避免每次键入都重复朗读。
- 所有 hover action 也必须在 focus-within 显示，支持 Tab/Shift+Tab、Enter/Space、Escape；删除要有可撤销路径或明确焦点落点。上下文菜单项目应可由键盘触发。
- 渲染失败保留 source 可编辑，提供重试与复制 source；一个块失败不得取消其它块。主题、配置或 Mermaid 版本变化引发的失败应带上对应 render context，便于诊断缓存污染。

## 10. P0/P1/P2 分阶段计划

### P0：保护主数据和输入性能

1. 改成“当前块直接编辑主文档、非当前块显示 preview”，消除光标进入仍隐藏 source 的行为差距。
2. 移除或严格桥接 inline editor 的待提交副本，保证 active edit 下 `Ctrl+S`、Save As、窗口关闭恢复与 undo/redo 都读取最新 DSL。
3. 把 block 收集改为 changed-range/selection/viewport 增量路径，停止每次 selection 全文扫描。
4. 建立真实 Mermaid render 性能基准：复杂 flowchart、sequence、C4、多图并发、连续快速修改；记录 UI 线程 long task、输入延迟、滚动和内存，不再只测 mock pending Promise。
5. 为 IME、caret、selection、undo、active-save、错误恢复补集成与 E2E 门禁。

### P1：补齐可控性与专业编辑体验

1. 在设置中加入可持久化、可热更新的 Diagrams 开关；关闭时显示普通代码块。
2. 使用官方解析能力完善诊断、错误定位和重试；全部文案双语。
3. 验证并锁定 `%%{init}%%`、安全级别、主题指令和 metadata 的实际策略；若允许按块配置，明确白名单与优先级。
4. 增加插入/编辑命令、键盘可达 action、图表语义名称与屏幕阅读器测试。
5. 增加 SVG 复制/保存，随后在可靠转换链路下提供 PNG/JPEG；复用成熟 context menu 与平台 clipboard/file facade。

### P2：兼容性与深度定制

1. 评估 Typora 文档中的 `sequence`/`flow` 迁移路径。优先提供导入提示或一键转换到 Mermaid；只有成熟引擎确有维护价值时才接入旧渲染器，不能为兼容而自研布局。
2. 增加公开主题变量和受控 Mermaid config，记录与应用明暗主题、文档 init 指令的优先级。
3. 完成多格式导出、剪贴板兼容、批量多图导出和大型 gallery 的资源回收。
4. 在 Windows packaged WebView 完成长期编辑、主题切换、多窗口和跨平台抽检。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 在 live preview 中输入合法 `mermaid` fence 后，非当前块显示 SVG；光标进入该块时完整 fence/DSL 可在主编辑器直接编辑，离开后恢复 preview。
2. inline/当前块编辑期间立即按 `Ctrl+S` 或 Save As，落盘必须包含最后一次输入；测试必须调用真实打开路径并装载 EditorState，随后执行 open → edit → save → reopen，结果与内存主文档一致且无关 diff 为 0，禁止用同一个 fixture 字符串同时 mock 打开结果和编辑器内容来替代该链路。
3. `Ctrl+Z/Ctrl+Y` 在 preview、当前块 source、全局 source 模式之间保持可预测连续性；IME 组合态不触发提前 flush、不移动候选、不丢字符。
4. 同一块快速输入 20 次只允许最新 source 更新 preview；旧结果不得回写。关闭或移出视口的任务不得继续无上限占用资源。
5. 100 个 Mermaid 块的文档中，普通段落光标移动不得触发 100 块完整重建；性能测试必须能从计数器证明访问范围受限。
6. 合法核心图种、Venn/Ishikawa、`%%{init}%%`、主题切换均有确定性结果；非法图只影响自身，错误 UI 双语且可重试。
7. Diagrams 关闭后 `mermaid` fence 按普通 code block 显示，源码不变；重新开启后恢复 preview。
8. preview 可由键盘聚焦并执行编辑、复制、保存、删除；屏幕阅读器能得到图表名称、loading 和 error 状态。
9. SVG/PNG/JPEG 导出与剪贴板复制不改变 Markdown，导出失败给出可恢复错误。

### 11.2 Unit

- block detection：大小写、metadata、CRLF、四反引号、空内容、连续块、changed ranges、offset 变化。
- cache/scheduler：source/theme/config/version key、字节上限、请求合并、并发上限、stale、错误、释放。
- edit transaction：主文档即时更新、selection mapping、undo group、删除换行边界、source fidelity。
- config/i18n：Diagrams 开关、init 白名单、全部中英文 key、错误 code 映射。

### 11.3 Integration

- CodeMirror 主 view 中 current/non-current/source 三态转换，验证 doc、selection、scroll、history 不丢失。
- 真实 Mermaid parse/render adapter 的成功、失败、主题与 init，验证安全配置不可被文档覆盖。
- editor command port、settings compartment、export service、clipboard/file facade 的边界测试。
- 打开 → 当前块编辑 → 不失焦直接保存 → 重开；fixture bytes 与预期精确一致。

### 11.4 E2E

- 鼠标点击、键盘 Tab/Enter/Escape、`Ctrl+/`、`Ctrl+S`、`Ctrl+Z`、中文 IME、普通粘贴与大段 DSL 粘贴。
- 明暗主题、Diagrams 开关、坏图恢复、多图局部失败、复制/导出、source mode 往返和滚动位置。
- 真实 Windows/Tauri packaged WebView 至少保留一条 smoke，Web Vite harness 不能替代平台剪贴板、文件对话框与 WebView 行为。

### 11.5 Fixture

- 保留 `mermaid.md`、gallery、edge cases；增加 init、CRLF、四反引号、超长 label、Unicode/中英文、主题、多图连续错误、active-save expected fixture。
- 每个 fixture 执行真实 open → EditorState load → save → byte diff；另保留当前的纯保存写出单测。可渲染集合与仅保真集合分层，beta 图种升级前不得含糊混用。

### 11.6 Perf

- 单独串行运行，不与 build/E2E/typecheck 并发。
- 指标至少包括：首次动态加载时间、真实 render P50/P95/P99、输入 dispatch、Event Loop long task、滚动帧、100 图 decoration 更新、cache 命中率、SVG 总字节与内存回收。
- 场景至少包括：复杂 flowchart、长 sequence、C4、Venn、单块连续 20 次编辑、10 个并发可见块、100 个多数不可见块、主题切换。
- 当前 3.72 ms mock pending dispatch 可保留作调度回归，但不能作为“真实 Mermaid 不阻塞输入”的唯一门禁。

### 11.7 本次实际验证

- `pnpm exec vitest run src/editor/capabilities/mermaid/MermaidWidget.test.ts src/editor/capabilities/mermaid/mermaidRenderScheduler.test.ts src/editor/capabilities/mermaid/mermaidLanguageService.test.ts tests/fixtures/fixtureCoverage.test.ts tests/fixtures/roundTrip.test.ts`：2026-07-12 本轮新鲜执行退出码 0，5 个文件、51 项通过。
- `pnpm exec playwright test tests/e2e/mermaid.spec.ts`：2026-07-12 本轮新鲜完整执行退出码 0，单 worker 串行 37/37 通过，用时 43.0 秒。本轮没有出现失败；该结果只证明本次运行，不外推长期无偶发失败。
- `pnpm exec vitest run tests/perf/mermaidInputLatency.bench.test.ts --no-file-parallelism`：2026-07-12 本轮新鲜执行退出码 0，1/1 通过，记录 3.72 ms；测试使用 mock pending render，结论范围仅限 dispatch 样例。

## 12. 风险与未核实项

1. Typora 关闭 Diagrams 后的精确显示、图表焦点切换手势、非法 DSL 错误 UI、右键菜单顺序与 DSL 粘贴行为仍未实机复核；这些不能写成确定事实。
2. LumaMark 在 inline editor 保持打开时保存、Save As、窗口关闭、恢复草稿的最新内容一致性未测试，且代码存在延迟 flush 证据；通用 fixture 门禁也只验证保存写出，没有覆盖真实 open → EditorState → save。
3. 中文 IME、跨主/嵌套 editor undo、跨模式 undo、选择复制、屏幕阅读器、触控与多窗口未覆盖。
4. `%%{init}%%` 可能由 Mermaid 11.16.0 直接支持，但本地没有兼容、安全和主题优先级测试，因此保持证据不足。
5. 现有性能测试没有运行真实 Mermaid 计算，也没有测长任务、滚动、100 图扫描和内存；动态 import 只优化首屏包加载，不等于渲染不阻塞。
6. E2E 运行在 Web harness，不覆盖 Tauri packaged WebView 的文件、剪贴板、GPU、字体和平台差异；本轮一次 37/37 通过也不能证明长期无偶发失败。
7. 当前仓库存在大量未提交的他人改动，本报告描述的是 2026-07-12 当前工作树快照，不代表某个已发布 tag；本文未修改或回滚这些改动。

## 13. 证据索引

### 基线与横切文档

- `docs/product/typora-baseline/11-mermaid-and-diagrams.md`：Typora 1.13.7 功能、来源、观察与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：阅读态/当前块/source mode、键鼠、粘贴、IME 与源码符号的横切模型。
- `AGENTS.md`：架构、性能、i18n、成熟组件与文档治理契约。
- `DEVELOPMENT_PROCESS.md`：测试分层、fixture round-trip、性能门禁和完成声明规则。

### 实现与依赖

- `package.json:30-61`；`pnpm-lock.yaml:83-85,2165-2166,4954-4975`：Mermaid 11.16.0 依赖事实。
- `src/editor/core/editorDisplayMode.ts:37-52`；`src/editor/capabilities/index.ts:20-39`；`createMermaidCapability.ts:4-8`：live preview 实际接线。
- `src/editor/capabilities/mermaid/mermaidBlockDetection.ts:30-103`：围栏检测。
- `src/editor/capabilities/mermaid/mermaidPreviewExtension.ts:35-139`：state field、全文 decoration 重建、主题观察、120 ms scheduler。
- `src/editor/capabilities/mermaid/mermaidRenderScheduler.ts:38-145`；`mermaidCache.ts:12-67`：调度、generation、缓存。
- `src/editor/capabilities/mermaid/mermaidRenderAdapter.ts:7-33`：strict config、dynamic import、真实 render 调用。
- `src/editor/capabilities/mermaid/MermaidBlockWidget.ts:48-302`：preview lifecycle、错误、inline edit、flush、删除。
- `src/editor/capabilities/mermaid/mermaidWidgetDom.ts:34-126`；`mermaidInlineEditor.ts:18-59`；`mermaidEditingState.ts:1-13`：DOM、嵌套编辑器与编辑状态。
- `src/editor/capabilities/mermaid/mermaidLanguageService.ts:11-199`：补全、浅诊断与硬编码英文。
- `src/editor/capabilities/mermaid/mermaid.css:1-139`：主题 token、hover/focus actions、error/editor/SVG 样式。
- `src/shared/i18n/locales/en.json:128-132`；`zh-CN.json:128-132`；`i18n.test.ts:89-93`：已进入 i18n 的 Mermaid UI 文案。

### 测试与 fixture

- `src/editor/capabilities/mermaid/MermaidWidget.test.ts:37-583`：检测、source 不变、焦点仍预览、错误隔离、按钮、编辑、删除、主题。
- `mermaidRenderScheduler.test.ts:17-284`；`mermaidLanguageService.test.ts:9-84`：缓存/竞态与补全/诊断。
- `tests/e2e/mermaid.spec.ts:34-339`：异步输入、编辑删除、caret、错误、多图种、gallery 与 source mode。
- `tests/e2e/v1-workflow.spec.ts:6-19,105-135,164-175`：打开、保存、重载、主题、Mermaid 与源码模式工作流。
- `tests/fixtures/mermaidSamples.ts:10-263`；`markdown/mermaid.md`；`mermaid-gallery.md`；`mermaid-edge-cases.md`：确定性样例。
- `tests/fixtures/markdownFixtureManifest.ts:68-70,110-154`；`fixturePaths.ts:5-31`；`fixtureCoverage.test.ts:44-75`：fixture 清单与覆盖；`roundTrip.test.ts:8-72`：相同 fixture 文本经保存写出后的字节保真，不是完整打开链路。
- `tests/perf/mermaidInputLatency.bench.test.ts:21-80`；`docs/performance/V1_BASELINE.md:35-49`：当前 mock pending dispatch 门禁与其已知范围。

### 架构与质量边界

- `docs/architecture/DETAILED_ARCHITECTURE.md:140,220-258,540-556,682-704`：官方 Mermaid、capability 分层、异步调度目标与反模式。
- `docs/quality/QUALITY_STRATEGY.md:41-117`：集成/E2E/fixture/perf 分层与 Mermaid 门禁。
- `docs/product/V1_PRODUCT_REQUIREMENTS.md`、`V1_VERSION_DESIGN.md`、`docs/roadmap/V1_IMPLEMENTATION_PLAN.md`：只作为目标、范围和历史计划检索，不作为已实现证据。
