> 语言：**中文** · [English](../../../product/typora-competitive-analysis/17-html-and-embeds.md)

# 1. LumaMark 与 Typora 竞争性分析：HTML 与嵌入

## 2. 用途、范围与非目标

本文用于判断 LumaMark 在 Markdown 内混写 HTML、展示受限嵌入内容以及保持源文件不变方面，与 Typora 1.13.7 的公开体验基线相比处于什么位置，并给出可执行的追平路径。分析对象仅包括：行内 HTML、块级 HTML、`<u>`、带受限 `style` 的 `span`、`iframe`、`video`、相关键盘与鼠标交互、粘贴、保存、安全失败态和测试门禁。

本文不讨论完整 HTML 文档编辑器，不把 HTML/PDF 导出纳入当前实现范围，不评价图片 Markdown 语法本身，也不把 Mermaid、普通远程图片或表格内联渲染误算为 HTML 嵌入能力。Typora 的专有实现不是复刻对象；对齐目标是可观察行为与用户信心。规划文档只用于说明边界和方向，不能单独证明 LumaMark 已有功能。

## 3. 执行摘要

LumaMark 当前已经具备 HTML 专题的两个底座：CodeMirror/Lezer 能识别 `HTMLTag` 与 `HTMLBlock`，编辑器以 CodeMirror 文档保存 Markdown 原文；通用 fixture 也证明一个完整 `<section>` 块经当前模拟 save action 可按字节写回。源码模式切换同样不会改变文本或撤销历史。这里的 round-trip 测试使用固定 `getDocumentText()` mock，既没有调用 open action，也没有挂载真实编辑器，因此这些只是“底层功能存在”的证据，仅证明该样本可被原样交给保存链路，不证明真实 open → edit → save → reopen，更不证明 HTML 已获得 Typora 式阅读态。

真实差距是：live preview 聚合入口只注册代码块、图片、表格和 Mermaid，通用 WYSIWYG 也只隐藏标题、引用、代码信息、链接和强调等 Markdown 标记，没有 HTML capability、HTML widget、焦点展开规则、sanitizer 策略、iframe 授权模型、video 生命周期、错误占位、专题 i18n 文案或 HTML 专题 E2E。结果是 HTML 标签在 live preview 中仍作为源码文字出现；焦点进入与离开不会在“渲染结果”和“标签源码”之间切换。这里不能称为“体验追平”。

优先级结论是：P0 先建立安全与源码保真合同，并扩展攻击/残缺/混写 fixture；P1 只做低风险的受限行内与静态块 HTML 阅读态；P2 才做 `video` 和需要显式信任、沙箱与点击加载的 `iframe`。直接把任意 HTML 写入 `innerHTML`，或仅因锁文件中已有 DOMPurify 就宣称具备净化能力，均不符合现有证据和项目架构。

## 4. Typora 功能与完整体验基线

以下基线来自 `docs/product/typora-baseline/17-html-and-embeds.md`，并结合其直接引用的 live preview 与图片横切模型。基线自身将若干安全黑名单、混写优先级与失败细节标为未核实，因此本文不把这些未知点扩写成 Typora 的确定事实。

### 4.1 创建

- 用户可直接键入 HTML 标签，例如 `<u>Underline</u>` 与 `<span style="color:red">red</span>`。
- iframe、video 或普通 HTML 片段可通过粘贴进入文档；没有公开的通用“插入 HTML”向导或默认快捷键。
- HTML 是补充 Markdown 表达能力的入口，不是独立文档格式。

### 4.2 阅读态

- 支持的行内或块级 HTML 在非焦点状态呈现渲染结果，而不是永久暴露标签。
- `<u>` 显示下划线，受支持的 `span style` 体现样式；iframe 与 video 的加载结果受内容和运行环境影响。
- 不应推导为任意标签、脚本或事件处理器都会执行。Typora 的精确安全清单在现有基线中属于未核实项。

### 4.3 焦点编辑态

- 用户进入 HTML 区域后应能编辑原始标签和属性；离开后回到阅读态。这与 Typora 横切模型的“当前块/行内 span 展开、非当前块阅读”一致。
- 基线未确定 HTML 的像素级命中范围、嵌套标签选择规则和残缺标签恢复细节，因此 LumaMark 的验收应以稳定、可预测、源码可见为原则，而不是假定 Typora 的内部算法。

### 4.4 源码模式

- 源码模式显示完整 HTML 标签与属性，不应显示替代 widget。
- live preview 与源码模式编辑同一份 Markdown，切换不应改写源文；横切基线还要求尽可能维持滚动、选区和撤销连续性。

### 4.5 键盘

- 直接键入标签是主路径；没有通用插入 HTML 快捷键。
- 源码模式仍沿用 `Ctrl+/`（Windows/Linux）或 `Command+/`（macOS）。
- 键盘必须能够进入渲染对象对应的源码位置、编辑、退出并继续正文输入，不能制造只能用鼠标操作的孤岛。

### 4.6 鼠标

- 非焦点阅读结果需要提供可理解的点击进入源码路径。
- iframe/video 的内部点击与“选择该 Markdown 块进行编辑”会竞争；完整体验必须区分内容交互、选择源码、打开外部内容和错误重试，而不能让用户失去光标。

### 4.7 粘贴

- 粘贴 HTML/iframe/video 片段后应保留可编辑源文。
- Typora 横切模型还包含 Smart Paste 和 HTML/纯文本/Markdown 多种剪贴板语义，但本专题只要求不把剪贴板 HTML 无提示执行，也不把外部富文本粘贴与“粘贴 HTML 源码”混为一谈。

### 4.8 保存

- 保存应保留用户 HTML 标签、属性、空白、换行和残缺输入，不因预览而规范化整个片段。
- 编辑态保真与导出保真是两条路径；Typora 历史上存在打印/PDF 丢失部分 HTML 的修复记录，不能据此假定 LumaMark 将来的导出器天然正确。

### 4.9 错误与边界

- 非法、受限或无法加载的内容不能静默消失；至少要能回到源码并理解为何未渲染。
- 需要覆盖未闭合标签、Markdown/HTML 嵌套、危险 URL、`script`、`on*` 属性、远程 iframe、远程/本地 video、CSP 拦截、离线与超时。
- Typora 的精确拦截清单、iframe 失败视觉和 Markdown/HTML 优先级仍需独立实机复核。

## 5. LumaMark 当前功能清单与证据

### 5.1 已有能力

| 能力 | 状态 | 精确证据 | 结论 |
|---|---|---|---|
| Markdown 中输入并持有 HTML 原文 | 已实现 | `src/editor/core/createEditorState.ts:97-122` 将传入文本直接建立为 CodeMirror 文档；`src/editor/core/editorApi.ts:78-80` 直接读取 state 文本 | HTML 可作为普通 Markdown 源码编辑，不会先转换成富文本 AST |
| 识别 HTML 语法节点 | 已实现 | `src/editor/markdown/markdownLanguage.ts:14-18` 使用 GFM Markdown language；本次只读探针得到 `<u>`/`span`/`video` 为 `HTMLTag`、iframe 为 `HTMLBlock` | 已有检测入口，但检测不等于预览 |
| 源码模式显示并保持原文 | 已实现 | `src/editor/core/editorDisplayMode.ts:42-57` 在 source mode 只挂源码模式 class，不挂 live preview extensions；`src/editor/core/editorApi.test.ts:129-162` 验证模式切换不改变文本且仍可撤销此前编辑 | 源码模式底座可复用；该测试未单独证明滚动保持 |
| 文件打开与保存以编辑器文本为输入 | 部分实现 | `src/features/file-actions/fileActions.ts:100-123` 把读取文本加载进编辑器；`:139-158` 从 `getDocumentText()` 取文本，但允许可选 `prepareTextForSave` 转换后写盘并回载 | 默认 prepare 是恒等函数，当前没有 HTML 专项转换；仍需测试锁定任何 save prepare 不规范化 HTML |
| 一个块级 HTML fixture 的模拟保存往返 | 部分实现 | `tests/fixtures/markdown/comprehensive.md:39-41` 仅含一个完整 `<section><p>…`；`tests/fixtures/markdownFixtureManifest.ts:76-95` 标记 `commonmark:html`；`tests/fixtures/roundTrip.test.ts:8-72` 对固定 editor mock 文本做字节比较 | 能证明该样本经过模拟 save action 后不变，不能覆盖行内、属性、残缺、真实编辑器重开或嵌入媒体 |
| HTML parser corpus 门禁 | 部分实现 | `scripts/quality/test-markdown-corpus.mjs:90-115` 只要求语料出现 `HTMLBlock`；`:126-150` 只检查 parser 节点与 source text 未变 | 证明解析覆盖，不证明 UI 渲染、焦点、错误态或安全 |

### 5.2 明确缺失的体验能力

| 能力 | 状态 | 精确证据 | 结论 |
|---|---|---|---|
| HTML live preview capability | 未实现 | `src/editor/capabilities/index.ts:20-39` 只组装 code-block、image、table、mermaid | 没有 HTML 检测、策略、widget 或 renderer 的正式边界 |
| HTML 标签焦点展开/离焦渲染 | 未实现 | `src/editor/wysiwyg/markdownDecorations.ts:453-493` 的隐藏集合不含 `HTMLTag`/`HTMLBlock` | live preview 与焦点编辑态对 HTML 没有状态差异 |
| `<u>` 与受限 `span` 渲染 | 未实现 | capability 聚合和 WYSIWYG 规则均无 HTML；专题检索未发现对应测试 | 标签只作为源文字展示 |
| iframe/video 渲染与控制 | 未实现 | 源码、命令、i18n 和 E2E 中均无 iframe/video capability | 没有加载、沙箱、媒体控制、失败占位或回源入口 |
| 专题安全策略 | 未实现 | `package.json:30-61` 没有直接 sanitizer 依赖；`pnpm why dompurify` 显示 DOMPurify 仅由 Mermaid 间接带入 | 不能把传递依赖或 Mermaid 的安全链路当成通用 HTML 合同 |
| 专题 i18n 与可访问性 | 未实现 | 中英文 locale 与命令/设置定点检索无 HTML/iframe/video key；无语义化 HTML 错误控件 | 当前没有可本地化提示、键盘入口或屏幕阅读器状态 |
| HTML 专题 E2E/视觉回归 | 未实现 | `tests/e2e` 中 HTML 命中均是报告页面、DOM 类型或根主题元素，不是 Markdown HTML 体验 | 无法证明创建、预览、焦点、保存重开和错误处理 |

本次实际运行 `pnpm exec vitest run tests/fixtures/roundTrip.test.ts tests/fixtures/fixtureCoverage.test.ts src/editor/core/editorApi.test.ts`，结果为 3 个测试文件、33 个用例通过。该结果只支持上述底座结论，不支持“HTML 体验已追平”。

## 6. 当前真实体验路径

1. 用户新建或打开 Markdown，可在 CodeMirror 中直接键入 `<u>text</u>`、`<span …>`、iframe 或 video 标签。用户也可尝试粘贴这些文本，但仓库没有 HTML 剪贴板 payload 合同，不能预先断言它必然按“纯文本粘贴”处理。
2. Lezer 会把这些片段识别为 `HTMLTag` 或 `HTMLBlock`，但 live preview 聚合入口没有 HTML capability。
3. 因此非焦点阅读态仍看到标签源码；将光标移入或移出不会出现 Typora 式“渲染结果 ↔ 原标签”切换。键盘和鼠标只是在普通文本上移动，没有 HTML 专属命令或控件。
4. 图片粘贴 handler 只在剪贴板含图片文件时接管；`src/editor/capabilities/image/imageInputExtension.ts:208-217` 在没有图片文件时返回 `false`。仓库没有 HTML 剪贴板策略测试，所以富文本剪贴板到底以哪一种浏览器 payload 进入编辑器属于证据不足；不能把默认浏览器/CodeMirror 行为写成产品合同。
5. 切到源码模式后仍看到完整标签；切回 live preview 仍是源码标签。模式切换不改文本且共享 undo，这是已有测试覆盖的功能。
6. 保存时先读取编辑器当前文本，再经过可选 `prepareTextForSave` 后交给文件服务；默认 prepare 为恒等函数，但并非架构上的不可变保证。一个完整 block fixture 已证明固定 mock 文本可按字节写盘；真实打开、编辑属性、保存、关闭、重开以及残缺标签矩阵没有专题集成或 E2E。
7. iframe/video 不会作为媒体实例化，所以当前不会由文档 HTML 直接触发脚本或远程 frame；这种“未执行”是功能缺失带来的现状，不是已经实现的 allowlist/sandbox 安全能力。

## 7. 逐项差距矩阵

状态列只使用“已实现 / 部分实现 / 未实现 / 证据不足”：它描述当前仓库证据，不表达路线承诺。严重度列只使用“阻断 / 高 / 中 / 低”：“阻断”表示在安全交付该行能力前必须解决，并不等价于阻断当前 V1 发布；“低”也不表示已经体验追平。

| ID | 行为点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|---|
| html-gap-01 | 直接键入 HTML 并保留原文 | 已实现 | 低 | 可编写标签并由编辑器持有原文，但现有专项证据仍只相当于源码编辑 | `createEditorState.ts:97-122`；`editorApi.ts:78-80` |
| html-gap-02 | 非焦点行内 HTML 阅读态 | 未实现 | 高 | `<u>`、`span` 永久显示标签，打断 WYSIWYG 阅读 | `capabilities/index.ts:20-39` 无 HTML |
| html-gap-03 | 块级 HTML 阅读态 | 未实现 | 高 | HTML block 无预览，文档阅读噪声显著 | `markdownDecorations.ts:453-493` 无 HTML 规则 |
| html-gap-04 | 焦点进入源码、离焦回预览 | 未实现 | 高 | 无 Typora 式同视图编辑闭环 | 同上，无状态转换实现或测试 |
| html-gap-05 | 源码模式完整显示 HTML | 已实现 | 低 | 用户始终能回到真实源文 | `editorDisplayMode.ts:42-57`；`editorApi.test.ts:129-162` |
| html-gap-06 | HTML 保存字符级保真 | 部分实现 | 高 | 完整 block 有底座，复杂属性、空白和残缺输入仍可能无回归保护 | `comprehensive.md:39-41`；`roundTrip.test.ts:8-72` |
| html-gap-07 | HTML 粘贴合同 | 证据不足 | 中 | 富文本粘贴可能因平台 payload 不同而不可预测 | 只有图片 paste 专项，HTML 无测试 |
| html-gap-08 | iframe 阅读与交互 | 未实现 | 阻断 | 无法阅读嵌入内容，也没有信任与沙箱机制 | 无 capability/命令/i18n/E2E |
| html-gap-09 | video 阅读与交互 | 未实现 | 高 | 无播放控件、源解析、错误和生命周期处理 | 无 capability/命令/i18n/E2E |
| html-gap-10 | script、事件属性和危险 URL 拦截 | 未实现 | 阻断 | 一旦直接增加渲染，将形成文档级代码执行与钓鱼风险 | `package.json` 无直接 sanitizer；无攻击测试 |
| html-gap-11 | CSP 与远程媒体策略 | 部分实现 | 高 | 已有应用级 CSP 基线，但没有显式 frame/media 指令或按文档块授权路径；实际回退与跨 WebView 行为仍待核实 | `src-tauri/tauri.conf.json:25-30` |
| html-gap-12 | 失败占位与回源入口 | 未实现 | 高 | 受限或加载失败内容可能只能显示源码，未来若静默隐藏则更难诊断 | 无错误模型和 i18n key |
| html-gap-13 | 键盘与屏幕阅读器可达 | 未实现 | 高 | 未来 widget 可能成为不可聚焦或抢焦点的内容孤岛 | 无 HTML 控件与 a11y 测试 |
| html-gap-14 | HTML 专题性能预算 | 证据不足 | 中 | 大量标签/嵌入可能增加输入延迟、DOM 数量、网络和内存占用 | 现有 perf 无 HTML 场景 |
| html-gap-15 | HTML/PDF 导出一致性 | 未实现 | 低 | 编辑态即使追平，导出仍可能丢标签或行为不同；但导出明确不属于本专题当前验收 | V1 设计把 HTML/PDF 导出列为非目标 |

## 8. 根因与架构影响

第一根因不是 parser 缺失，而是产品仍未定义“哪些 HTML 可以阅读态渲染”。Lezer 已能提供 `HTMLTag`/`HTMLBlock` 范围，但 parser 只回答语法边界，不回答安全、资源授权、焦点、错误或可访问性。

第二根因是 capability 边界尚未建立。`docs/architecture/DETAILED_ARCHITECTURE.md:231-238` 要求复杂编辑器能力进入 `editor/capabilities/<name>/`，`:583-595` 要求 widget 只是 capability 内部细节。该文档是架构约束而非实现证明。HTML 若塞进 `markdownDecorations.ts`，会把净化、异步资源、DOM 生命周期和错误处理压入通用热路径，违反现有分层。

第三根因是安全模型缺位。锁文件中的 `dompurify` 来自 Mermaid 传递依赖，不能稳定承诺版本、配置或公共 API。Tauri CSP 当前配置了 `default-src 'self'`，但没有显式 `frame-src` 或 `media-src`；具体 frame/media 回退与跨 WebView 行为仍需按 Tauri/WebView 官方文档和实机验证，不能把“当前没有远程资源入口”误写成已经完成的嵌入安全策略。简单全局放宽 CSP 还会扩大整个 WebView 的授权面，而不是只授权某个文档块。

第四根因是测试把“解析/保存”与“体验”混在同一个 `commonmark:html` 标签下。一个完整 block 能通过 round-trip，无法证明行内样式、焦点展开、粘贴 payload、失败态或跨平台媒体。后续必须拆出语义明确的 fixture tag 与专项门禁。

架构上应新增独立 `editor/capabilities/html/`，保持编辑器拥有源文和选择状态；安全策略与纯分类逻辑可放 capability 内的无 DOM 模块；本地/远程资源授权通过 service facade 注入，不允许 capability 直接调用 Tauri；用户信任偏好与命令编排属于 `features`；通用错误文案进入 `shared/i18n`。若决定改变 CSP、引入主要依赖或改变保存策略，还需要单独 ADR，但不在本文落盘范围内。

## 9. 详细改进方案

### 9.1 模块归属

- `editor/capabilities/html/createHtmlCapability.ts`：薄组装入口，只暴露 extension 与必要 command。
- `htmlBlockDetection.ts`：从 Lezer `HTMLTag`/`HTMLBlock` 读取可视区范围，分类为低风险行内、静态块、video、iframe、拒绝或残缺。
- `htmlPolicy.ts`：纯函数 allowlist、属性规则、URL scheme、尺寸上限与拒绝原因；可直接单元测试。
- `htmlSanitizer.ts`：把 policy 应用到预览副本，绝不回写 Markdown 文档。
- `HtmlPreviewWidget.ts`、`VideoPreviewWidget.ts`、`IframePlaceholderWidget.ts`：各自负责 DOM 生命周期；iframe 默认只显示可操作占位，用户显式信任后才加载。
- `htmlPreviewExtension.ts`：只为非活动范围、可视区内内容创建 decoration/widget，管理缓存、取消和焦点恢复。
- `services/assets` 或专门的 embed policy facade：解析受授权的本地媒体与远程 URL；editor 不直接接触 Tauri。
- `features/settings` 与 `features/commands`：承载“允许受信站点”“重新加载嵌入”“编辑源码”等用户动作，不持有 Markdown 全文。

### 9.2 成熟依赖优先

优先评估 DOMPurify 作为明确的直接依赖，并锁定配置与安全测试；不能依赖 Mermaid 间接安装的版本。HTML 结构解析优先使用浏览器 `DOMParser` 或成熟 parser，不手写正则净化器。CodeMirror/Lezer 继续负责 Markdown 范围识别。iframe sandbox、Permissions Policy、CSP 与 Tauri WebView 行为应依据官方平台能力设计。若成熟方案无法满足源码保真、跨 WebView 一致性或性能，必须记录原型/benchmark/限制并取得用户批准后才扩大自研范围。

### 9.3 数据流与源码保真

数据流应为：CodeMirror source slice → Lezer 范围 → 分类与 policy → 生成不可反向写入的 sanitized preview model → widget。用户点击“编辑源码”只移动选择到原范围；编辑行为由 CodeMirror transaction 完成。离焦后重新从最新 source slice 计算预览。预览 DOM、浏览器自动补全的闭合标签、属性排序或 URL 归一化绝不能写回文档。

所有保存测试都比较原始 UTF-8 字节。fixture 至少覆盖行内/块级、单双引号、属性顺序、实体、空白、CRLF/LF、中文属性、未闭合标签、嵌套 Markdown、危险属性、iframe/video 与相对路径。仅当用户明确编辑某个字符时才允许该范围发生 diff。

### 9.4 安全、错误与资源策略

- P1 allowlist 只包含无脚本的表达性标签和最小属性，例如 `u`、`span` 的受限样式集合，以及经过评审的静态结构标签；禁止 `script`、`object`、`embed`、`form`、`base`、所有 `on*` 属性、`javascript:`/危险 `data:` scheme 和 CSS URL。
- 行内 style 不接受任意 CSS 字符串，应解析为属性集合，只放行颜色等经过评审的声明，并限制长度和值域。
- video 默认 `controls`、禁止 autoplay、建议 `preload="metadata"` 或 `none`；本地源必须走已授权 asset resolver，远程源受协议、大小、超时和取消策略控制。
- iframe 默认不实例化。占位显示域名、风险说明和“加载一次/信任站点/编辑源码”；sandbox 默认不授予脚本、同源、弹窗、下载、表单等能力，任何增加都需逐站点理由。外链仍需 `noopener`/`noreferrer` 等隔离。
- CSP 不应全局加入宽泛 `https:` 就算完成；应先验证 Tauri/WebView 是否能用精确 `frame-src`/`media-src` 与应用层 allowlist 双重限制。
- 每个拒绝原因形成稳定错误码，由中英文 i18n 显示；错误占位提供回源入口，不静默删除或伪装成成功预览。

### 9.5 可访问性与交互

静态 `<u>`/`span` 预览不额外制造 tab stop；块级预览提供可见 focus ring 和“编辑源码”按钮。video 使用原生 controls 并有标题/说明来源；iframe 占位必须是键盘可达的 group，朗读域名、是否已加载和风险状态。Escape 返回源码，Enter/Space 激活明确按钮，方向键不被嵌入内容无条件吞掉。widget 销毁或模式切换后，焦点与选区必须回到对应源范围。

## 10. P0/P1/P2 分阶段计划

### P0：安全与保真合同

1. 建立 `htmlPolicy` 纯模型、拒绝原因和中英文文案合同，不实例化任何 HTML。
2. 新增 `html-inline.md`、`html-block.md`、`html-malformed.md`、`html-security.md`、`html-embeds.md` fixture，并加入独立 manifest tags。
3. 增加真实 editor open → edit → save → reopen 的字符级集成测试；补 parser 节点矩阵与源码/undo/选区测试。
4. 完成 DOMPurify 直接依赖、CSP、iframe sandbox、video 资源和跨平台 WebView 的 ADR/原型评估。

### P1：低风险 HTML 阅读态

1. 创建 HTML capability，实现 `<u>`、受限 `span` 与经批准静态块的非焦点预览。
2. 实现点击/键盘进入源码、离焦恢复预览、残缺/拒绝内容错误占位和模式切换焦点恢复。
3. 增加粘贴策略：明确“粘贴为纯文本/HTML 源码/富文本转换”的边界，默认不执行剪贴板 HTML。
4. 完成 unit、integration、E2E、fixture、a11y 与视觉回归；单独运行 HTML 性能基准。

### P2：受控媒体与嵌入

1. 先实现 video 的本地/远程源解析、原生 controls、取消、离线和错误状态。
2. 再实现 iframe 点击加载、站点 allowlist、sandbox、Permissions Policy、精确 CSP 与信任撤销。
3. 增加网络超时、重定向、跨窗口打开、模式切换、文档关闭和大量嵌入资源释放测试。
4. HTML/PDF 导出另立专题，不复用编辑器 widget DOM 作为导出合同。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 在 live preview 中输入 `<u>中文 English</u>`，离开该范围后只显示带下划线文本；点击或键盘进入后显示原始标签，源文本逐字符不变。
2. 受限 `span style` 只应用 allowlist 声明；被拒绝声明显示可本地化原因，保存仍保留用户原始属性。
3. source mode 不创建任何 HTML/video/iframe widget；来回切换保持文本、undo、selection 和可接受的滚动位置。
4. `script`、`onerror`、`onclick`、`javascript:`、危险 CSS 与超长属性在所有路径均不执行；拒绝不能改写或删除源文。
5. video 失败、离线或取消时显示错误并可回源；关闭文档后停止加载并释放资源。
6. iframe 未经用户动作不发出网络请求；加载后 sandbox 权限与站点 allowlist 可被自动化断言，撤销信任后不再自动加载。
7. 保存并重开全部 HTML fixtures 后，无关字节 diff 为 0；只编辑属性值时，diff 仅限目标字符范围。
8. 中英文下所有错误、按钮、tooltip 与状态文本均来自 i18n；键盘可完成加载、编辑源码、重试和返回编辑器。
9. 中文 IME 在标签文本与属性值内组合输入时，候选过程不触发预览替换；确认上屏后一次 undo 只撤销该次输入，selection 仍落在原逻辑位置。跨越渲染 HTML 的选择、复制和粘贴必须分别断言默认 Copy、Copy as Markdown 与纯文本语义；粘贴含 `text/html` 的剪贴板不得无提示执行，失败后源码、选区与剪贴板文本均可恢复。

### 11.2 Unit

- `htmlBlockDetection`：HTMLTag/HTMLBlock、嵌套、残缺、行内与块级范围。
- `htmlPolicy`：标签、属性、URL scheme、style declaration、长度和站点 allowlist 表驱动测试。
- sanitizer：已知 XSS payload 与编码/实体绕过语料，断言预览副本安全且输入字符串未变。
- cache key、错误码、iframe sandbox token 与 video source 分类。

### 11.3 Integration

- CodeMirror selection 进入/离开、IME 组合、undo/redo、复制粘贴、模式切换和 widget lifecycle。
- file action 使用真实编辑器文档而不是固定 mock 文本完成 open → edit → save → reopen。
- asset/embed facade 的授权、取消、超时、文档路径变化与错误传播。

### 11.4 E2E 与可访问性

- Chromium Web 模式覆盖键入、粘贴、点击、键盘回源、保存重开、语言与主题。
- Tauri Windows 实机覆盖 CSP、远程 frame/media、本地 video、离线与 WebView 差异；macOS/Linux 在能力进入跨平台承诺前抽检。
- 使用 Playwright 可访问性断言检查 role/name/tab 顺序/focus return，并对静态、拒绝、加载中、失败、已加载状态做关键截图。

### 11.5 Fixture 与性能

- fixture 运行 open → save → diff；增加“编辑一个字符后仅目标范围变化”的 delta fixture。
- 性能基准必须与 E2E、build、typecheck、lint 分开串行运行。测量 1MB/5MB/10MB 文档中 0、100、1000 个 HTML 片段的打开时间、输入 transaction、滚动、widget 数、内存和缓存命中。
- sanitizer 与分类不得在每次按键同步扫描整篇文档；只处理变更范围和可视区，非活动块 debounce，昂贵媒体点击后加载，可取消并在离屏/文档关闭时释放。
- 守住项目既有目标：普通输入延迟尽量小于 16ms，1MB 打开小于 300ms，5MB 小于 1s，10MB 可编辑不冻结；任何预算调整必须以独立基准证据为依据。

## 12. 风险与未核实项

- Typora 对 `script`、事件属性、CSS、iframe sandbox 的精确规则尚未核实；本方案以 LumaMark 安全边界为准，不盲目复制未知行为。
- Typora 对未闭合标签、嵌套 HTML/Markdown、iframe 失败态和点击命中规则尚未做本机矩阵复核。
- 当前通用 round-trip 测试没有调用 open action，并用固定 `getDocumentText()` mock 返回 fixture 原文；它能验证 save action 对该输入的字节写入，但不能替代真实编辑器 open → edit → save → reopen 测试，也未覆盖非恒等 `prepareTextForSave`。
- DOMPurify 当前仅为 Mermaid 的传递依赖；升级、去重或打包变化都可能改变可用性，必须在采用时显式声明直接依赖和版本策略。
- Tauri CSP 与 Windows WebView2、macOS WKWebView、Linux WebKitGTK 对 frame/media/sandbox 的细节可能不同；全局放宽会扩大攻击面。
- 任意 inline style 会影响主题一致性、对比度和可读性；即便安全，也可能不符合无障碍要求。
- iframe/video 会引入网络、隐私、cookie、自动播放、资源占用和焦点捕获风险；需要用户可见的信任与撤销机制。
- 本次未启动 LumaMark GUI，也未运行 Playwright、Tauri 或性能基准；当前体验结论来自代码、测试、fixture 和只读 parser 探针，视觉与跨平台表现仍需后续专项验证。

## 13. 证据索引

### Typora 基线与横切事实

- `docs/product/typora-baseline/17-html-and-embeds.md`：HTML、`<u>`、span style、iframe、video、源码与保存基线。
- `docs/product/typora-baseline/00-live-preview-model.md`：阅读态/焦点态、源码模式、键盘、粘贴、IME 与符号显隐模型。
- `docs/product/typora-baseline/07-images.md`：HTML 图片对齐、相对路径与图片横切边界。

### LumaMark 实现证据

- `src/editor/markdown/markdownLanguage.ts:14-18`：GFM Markdown/Lezer parser。
- `src/editor/core/createEditorState.ts:97-122`：文档 state、language、history、keymap 与 display mode 组装。
- `src/editor/core/editorDisplayMode.ts:40-57`：source/live preview extension 分支。
- `src/editor/core/editorApi.ts:78-112,151-160`：源文读取、加载与模式切换。
- `src/editor/capabilities/index.ts:20-39`：现有 live preview capability 清单，无 HTML。
- `src/editor/wysiwyg/markdownDecorations.ts:453-493`：现有隐藏节点集合，无 HTMLTag/HTMLBlock。
- `src/features/file-actions/fileActions.ts:100-169`：打开、取编辑器原文和写盘路径。
- `src/editor/capabilities/image/imageInputExtension.ts:208-217`：只在剪贴板含图片文件时接管 paste。
- `src-tauri/tauri.conf.json:25-30`：当前 CSP 与 asset protocol 范围。
- `package.json:30-61`、`pnpm-lock.yaml:1746,4577`：直接依赖无 sanitizer，锁文件存在传递 DOMPurify；`pnpm why dompurify` 进一步确认来源为 Mermaid。

### 测试与 fixture 证据

- `src/editor/core/editorApi.test.ts:129-162`：源码/live preview 切换保持文本和 undo。
- `tests/fixtures/markdown/comprehensive.md:39-41`：唯一明确 HTML block fixture。
- `tests/fixtures/markdownFixtureManifest.ts:76-95`：`commonmark:html` 标签。
- `tests/fixtures/roundTrip.test.ts:8-72`：通用 fixture 字节往返。
- `tests/fixtures/fixtureCoverage.test.ts:9-63`：要求 `commonmark:html` 被 manifest 覆盖。
- `scripts/quality/test-markdown-corpus.mjs:90-115,126-150`：HTMLBlock parser 节点和 source fidelity 门禁。
- `tests/e2e/` 定点检索：没有 Markdown HTML/iframe/video 专题 E2E；现有 HTML 命中来自测试报告页面、DOM 类型或应用根元素。
