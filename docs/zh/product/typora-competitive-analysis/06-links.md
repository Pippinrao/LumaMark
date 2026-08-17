> 语言：**中文** · [English](../../../product/typora-competitive-analysis/06-links.md)

# 06 — 链接竞争分析与改进方案

## 用途、范围与非目标

本文用于把 Typora 1.13.7 的链接体验基线与 LumaMark 当前仓库中可直接验证的实现、测试、fixture 和依赖证据逐项对照，并给出可切片实施、可自动验收的改进方案。范围包括行内链接、带 title 的行内链接、引用式链接、隐式引用名、尖括号 autolink、裸 URL、邮箱链接、文档内标题锚点、阅读态与编辑态切换、创建与粘贴、打开与复制地址、键盘和右键路径、源码模式及保存保真。状态只使用“已实现 / 部分实现 / 未实现 / 证据不足”，严重度只使用“阻断 / 高 / 中 / 低”。

非目标：图片语法与资源管理属于 07；脚注引用属于 12；本文不把表格、导出器或 Mermaid 中偶然出现的 `<a>` 当作主编辑器链接体验已经实现；不依据路线图、计划或 fixture 标签宣称功能完成；不复制 Typora 的专有素材、品牌或私有实现。

## 执行摘要

LumaMark 已具备链接的“语法表面”：CodeMirror GFM Markdown language 能产生 `Link`、`Autolink`、`URL` 等节点；live preview 给行内链接和尖括号 autolink 添加统一强调样式，并在非活动行隐藏行内链接的 `[]()` 与 URL；格式菜单可以把选区变成 `[text](url)`；源码模式显示完整源码；`links-images.md` 的未编辑文本能经通用 `saveCurrentFile` 链路保持字节一致。相关聚焦测试本次实际运行通过，但该 fixture 测试没有执行真实文件打开或链接交互。

但它还不是完整的“可用链接功能”。主编辑器没有链接 capability、链接点击命中模型、可信 URL 解析/协议策略、Tauri 系统浏览器打开 service、标题 slug/锚点定位、打开或复制地址的上下文菜单，也没有选择文本后粘贴 URL、Ctrl/⌘+Click、键盘打开、错误反馈与专项 E2E。当前格式命令甚至明确允许对已处于链接中的文字再次套链接，生成 `[[plain](url)](url)`。此外，隐藏规则以“活动行”而非“光标所在链接 span”为粒度，进入同一行任意位置会展开该行所有相关标记，与 Typora 的局部 span 展开仍有差距。综合判断：链接阅读表面为“部分实现”，真正的导航与工作流为“未实现”，是 V1 写作闭环中的高严重度缺口。

## Typora 完整体验

依据 `docs/product/typora-baseline/06-links.md`，Typora 支持 `[text](url "title")`、`[text][id]` 配合任意位置定义行、`[Google][]` 隐式引用名、`[text](#heading)` 内部标题链接、`<https://…>` / `<email@example.com>`，并会将常见裸 URL（例如 `www.google.com`）显示为链接。非焦点阅读态只留下可辨识、常见主题下带颜色和下划线的链接文字，URL、括号及定界符隐藏；单击或将光标移入链接会展开 Markdown 源码以便编辑。

Windows 上 Ctrl+Click 打开目标，右键菜单至少有“打开链接”和“复制链接地址”，其中打开项提示 Ctrl+点击；内部 `#heading` 链接应跳到文档标题。源码模式显示完整语法。Typora 基线没有逐项证明保存时绝不规范化链接源码，因此“引用式不改写为行内式、裸 URL 不强制包成尖括号、title 引号、空白、换行和定义位置不变”应作为 LumaMark 的源码保真验收契约，而不是冒充竞品已核实行为。基线尚未充分核实 Ctrl+K、系统默认浏览器、中文与标点标题 slug、坏 URL/空 href 的精确行为，因此这些只能作为待核实的竞品细节。

## LumaMark 当前功能与精确证据

1. **部分实现：语法识别与阅读样式。** `markdownLanguage.ts` 使用 `@codemirror/lang-markdown` 的 GFM base；`markdownDecorations.ts:234-240` 把 `Link`、`Autolink` 映射为 `.lm-md-link`，`wysiwyg.css:160-166` 提供强调色和下划线。`markdownDecorations.test.ts:116-146` 验证 `[Luma](…)` 与 `<https://…>` 均产生 link range；`editor-markdown.spec.ts:3-46` 在浏览器真实 DOM 中验证 `.lm-md-link` 含 “Luma”。
2. **部分实现：离焦隐藏和进入编辑。** `markdownDecorations.ts:482-500` 隐藏 `LinkMark` 及 `Link` 父节点下的 `URL`，但判断函数是 `isRangeOnActiveLine`。`markdownDecorations.test.ts:417-447` 证明离开链接行后只显示 `Luma`，不显示 `[Luma]`、URL；这不是链接 span 级行为，而且没有 title、引用式或 autolink 展开测试。
3. **部分实现：创建入口。** `markdownFormatCommands.ts:39-40` 将选区包成 `[selection](url)`；`markdownFormatCommands.test.ts:20-35` 验证该变换；`createCommandModels.ts:256-264` 把 `menu.link` 放入“格式”菜单，英中资源分别提供 Link/链接。命令面板没有链接命令，`markdownFormatKeymap.ts` 也没有 Mod-K；应用的 Ctrl+K 已由 E2E 用作命令面板，因此不能复用为链接快捷键。
4. **已实现：源码模式完整显示。** `editorDisplayMode.ts` 在 source mode 不装载 live-preview capabilities；`editor-markdown.spec.ts:62-107` 验证切换源码模式后仍可见 `[Luma](https://example.com)`。
5. **已实现：已有样本的未编辑保存字节保真。** `links-images.md` 含行内、引用式、尖括号 URL、邮箱 autolink 和链接图片；manifest 标为 `commonmark:link` / `gfm:autolink`。`roundTrip.test.ts` 直接读取 fixture 字节，把同一文本交给 `saveCurrentFile` 写到临时文件后做 Buffer 比较；它枚举 `markdownFixturePaths` 的全部 20 个 fixture，其中包含 `large-1mb.md`、`large-5mb.md`、`large-10mb.md`。本次运行 20 项全部通过。不过该测试没有调用打开文件链路，也不证明链接命令、粘贴、编辑后局部 diff 或大文件交互性能。
6. **未实现：主编辑器打开、复制、锚点导航。** 对 `src/editor`、`src/features`、`src/app`、`src/services`、`src-tauri/src` 的点击、contextmenu、href、slug、open URL 检索，没有主编辑器链接处理器；编辑器右键菜单 `createEditorContextMenuModels` 只有插入/复制/删除表格。`package.json` 和 Rust 入口也没有 Tauri opener/shell 依赖与注册。表格单元格的链接标签仅是 CodeMirror token 视觉，不创建可导航 anchor，因此也不等于主编辑器链接行为。
7. **未实现：粘贴 URL 成链与安全策略。** 主编辑器没有文本 URL 粘贴 handler，也没有链接 URL scheme allowlist、危险协议拒绝、外部打开失败模型或 i18n 错误文案。
8. **部分实现：引用式链接；证据不足：隐式引用名；未实现：裸 URL/裸邮箱阅读样式。** `links-images.md` 包含引用式链接，Lezer 解析门禁要求聚合语料产生 `Link`、`Autolink`、`URL` 节点；generic decoration 对 `Link`/`Autolink` 统一着色，因此引用式语法已有解析与通用装饰链路，但没有专项 DOM、定义跳转或 unresolved reference 测试。仓库 fixture 与测试未覆盖 `[Google][]` 隐式引用名，不能把基线语法存在当作 LumaMark 证据。独立裸 URL/裸邮箱只会落到 `URL` 节点，而 generic decoration 不把独立 `URL` 映射为 `.lm-md-link`；仓库也没有相应 DOM 验收，所以当前不能称为自动成链体验。

## 真实体验路径

当前可复现路径是：启动应用 → 在编辑器输入 `[Luma](https://example.com)` → 光标移动到其他行 → 定界符和 URL 被隐藏，链接文字呈强调色下划线 → 单击链接所在行可看到源码 → 通过“视图 → 源码模式”查看完整 `[Luma](…)` → 保存时原始字节由通用文件链路写回。另一条创建路径是选中文字 → “格式 → 链接” → 得到 `[文字](url)` → 用户必须手工把字面地址 `url` 改为目标。

当前不可完成的真实路径是：阅读态 Ctrl+Click 打开外链、键盘打开链接、右键复制地址、点击 `#标题` 跳转、选中文字后粘贴剪贴板 URL 自动成链。对已有链接文字再次执行“链接”会嵌套语法；这条行为有测试固定，但从产品角度是失败路径而非合格功能。

## 差距矩阵

| 行为 | LumaMark 状态 | 严重度 | 直接判断 |
|---|---|---|---|
| 行内链接/尖括号 autolink 阅读样式 | 部分实现 | 中 | 有 parser range、CSS、unit/E2E；无完整交互 |
| 链接 span 进入时局部展开 | 部分实现 | 高 | 当前按活动行隐藏/展开 |
| 带 title 行内链接 | 证据不足 | 中 | parser 可能支持，但无专项展示与编辑测试 |
| 引用式链接阅读态 | 部分实现 | 中 | fixture、`Link` 解析与通用装饰链路存在；无专项 DOM、定义解析与 unresolved 验收 |
| 隐式引用名阅读态 | 证据不足 | 中 | Typora 基线有语法；LumaMark fixture、unit、E2E 均未覆盖 `[Google][]` |
| 尖括号 URL / 邮箱 autolink | 部分实现 | 中 | 尖括号 URL 有 unit 范围证据；邮箱仅有 fixture 保存证据，无 DOM 验收 |
| 裸 URL / 裸邮箱自动成链 | 未实现 | 中 | parser 可产生独立 `URL`，但当前 decoration 不为独立 `URL` 提供链接样式或交互 |
| Ctrl/⌘+Click 外链 | 未实现 | 阻断 | 无 handler、service、opener 依赖 |
| 右键打开/复制地址 | 未实现 | 高 | 现有右键模型仅表格动作 |
| 内部标题锚点跳转 | 未实现 | 高 | 无 slug 和 link navigation capability |
| 选区粘贴 URL 成链 | 未实现 | 中 | 无 paste handler 与测试 |
| 格式菜单插入链接 | 部分实现 | 中 | 生成写死的字面地址 `url`，不采集真实 URL，已有链接会嵌套 |
| Mod-K 插入链接 | 未实现 | 低 | Ctrl+K 已是命令面板 |
| 源码模式完整语法 | 已实现 | 低 | E2E 有直接证据 |
| 未编辑 fixture 字节保真 | 已实现 | 低 | Buffer 级 round-trip 通过 |
| 错误、安全、a11y 反馈 | 未实现 | 高 | 无协议策略、错误模型和链接语义焦点路径 |

## 架构根因

链接目前被放在通用 `wysiwyg/markdownDecorations.ts` 的节点到 CSS 映射中，而不是独立 editor capability。该通用层只知道范围与活动行，无法承载 href/title/引用定义解析、点击意图、内部/外部分流和可访问语义。格式命令同样只做字符串包裹，不知道选区是否位于既有 Link 节点，也没有 URL 输入状态。App 右键菜单由通用 command model 驱动，但没有“当前命中链接”的轻量上下文；service 层没有外部打开 facade；Rust/Tauri 没有 opener 能力。结果是视觉存在、端到端行为断裂。

另一个根因是测试把 parser 覆盖、fixture 标签和 UI 行为混在一起：corpus 能证明语法树有 Link/URL 节点，round-trip 能证明未编辑文本不变，却都不能证明用户可以打开或编辑链接。缺少单一 `LinkTarget`/`LinkContext` 领域模型，也使 URL 校验、错误与安全策略无统一入口。

## 详细改进方案

### 模块与成熟依赖

在 `src/editor/capabilities/link/` 建立独立 capability：`linkSyntax.ts` 负责从 Lezer tree 得到行内/引用式/autolink 的源码范围、可见文本、原始 destination/title 和定义范围；`linkDecorations.ts` 负责 span 级显隐与可访问 DOM；`linkInteractions.ts` 负责 pointer/keyboard/paste transaction；`linkCommands.ts` 负责插入、编辑、取消及锚点选择。继续复用成熟的 `@codemirror/lang-markdown` / `@lezer/markdown`，不得另写正则 Markdown parser。右键 UI 继续复用已安装的 Radix Context Menu，并扩展统一 command model，不新造菜单。

外部打开应在 `services/links/linkNavigation.ts` 提供窄 facade，Tauri 运行时优先采用官方、成熟且跨平台的 `@tauri-apps/plugin-opener` 与 Rust plugin；Web/E2E 注入 fake adapter。引入前需按项目规则做依赖体积、权限与阿里云镜像可用性记录。URL 结构使用平台 `URL` 解析器；只允许经书面确认的 `http:`、`https:`、`mailto:`，其他 scheme 默认拒绝。不要直接把任意 destination 写入 `innerHTML` 或 `window.open`。

### 数据流

Pointer/keyboard 事件 → capability 通过 `view.posAtCoords` 与 syntax tree 获取不可变 `LinkContext` → 若为 `#fragment`，交给 editor 内部 `selectPosition`/scroll transaction；若为外部 URL，交给 service facade 规范化、协议检查并调用 opener → 成功不改文档，失败发出轻量错误事件 → app controller 将错误映射为本地化 notice。右键时 capability 只上报当前链接元数据，不把 Markdown 全文放入 React store；菜单动作通过稳定 command port 回到 editor/service。粘贴 URL 时只在非空选区且剪贴板为允许 URL、当前不在代码/链接节点时生成一次 CodeMirror transaction。

### 源码保真

打开、复制、悬停和跳转均是只读行为，绝不重写源码。插入/编辑只替换目标 Link 节点或选区，必须保留未触及文本、行尾、空白与定义位置；引用式链接不得静默转行内链接，尖括号和裸 URL 不互转，title 引号风格不规范化。既有链接再次执行命令应进入“编辑当前链接”或保持无操作，禁止嵌套。每个变换都必须支持单步 undo/redo，并覆盖 IME composition、选区方向、复制粘贴和多光标的明确契约。

### i18n、a11y 与错误

新增的“打开链接”“复制链接地址”“编辑链接”“地址无效”“不支持的链接协议”“无法打开链接”等完整文案同步进入 en/zh-CN；不要拼接句子。阅读态链接必须提供语义可聚焦元素或等价 CodeMirror accessible decoration，保留清晰 focus-visible 样式，支持 Enter 打开、Escape 返回编辑，不把 Ctrl/⌘+Click 作为唯一入口。屏幕阅读器应读出链接文字与目标类型，隐藏的 Markdown 标记继续 `aria-hidden`，但不能让可见文字失去链接语义。

失败必须显式区分：unresolved reference、空 destination、非法 URL、不支持 scheme、内部锚点不存在、系统 opener 拒绝/失败、剪贴板权限失败。错误不得清空选区或改写文档；锚点不存在时保留当前位置并给出可本地化反馈。外部 URL 打开前对控制字符、混淆 scheme 做拒绝，展示/复制仍以用户原始源码为准，避免规范化破坏保真。

## P0 / P1 / P2

### P0

- 建立 link capability 和 `LinkContext`，把行内/尖括号链接从通用 decoration 移入 span 级显隐；保持现有样式。
- 实现 Ctrl/⌘+Click、Enter、右键“打开链接/复制链接地址”，接入安全 URL policy 与可注入 navigation service。
- 实现 `#fragment` 到标题的确定性跳转，至少覆盖英文、中文、重复标题和不存在目标；slug 规则先形成项目契约，再编码。
- 修复已有链接重复包裹；补齐源码保真、undo/redo、IME 与协议拒绝测试。

### P1

- 增加链接编辑 popover/dialog 或等价成熟可访问交互，支持 text、destination、可选 title；增加选区粘贴 URL 成链。
- 完整支持引用式、隐式引用名、邮箱与裸 URL 阅读/编辑/打开矩阵，并给 unresolved reference 明确但克制的状态。
- 补齐命令面板入口；评估快捷键冲突后决定链接快捷键，不覆盖现有 Ctrl+K 命令面板。

### P2

- 支持跨文件相对 Markdown 链接与可配置的同应用打开策略、最近访问历史等现代工作流。
- 在不改写源文档的前提下提供链接检查、失效诊断或批量审计；网络检查必须异步、可取消、默认不进入输入热路径。

## 可执行验收与测试计划

**验收：** 非活动链接只显示文字并具链接语义；把光标放入该链接 span 才展开其原始源码，同一行其他链接不展开。Ctrl/⌘+Click 或聚焦后 Enter 对 `https:` 调用 navigation adapter 恰好一次且文档字节不变；`javascript:` 等危险 scheme 被拒绝并显示本地化错误。右键可打开/复制精确原始 destination。`#中文-标题` 跳到确定标题并保持可撤销编辑历史不受污染。已有链接执行插入命令不产生嵌套。source mode 始终显示原始 inline/reference/autolink 形态。完成任何编辑并保存后，除目标 range 外 diff 为 0。

**Unit：** syntax extractor 覆盖转义括号、空格/title、引用定义、隐式引用、邮箱、裸 URL、相对 URL、fragment、未解析引用；URL policy 覆盖大小写 scheme、控制字符、编码、mailto；slug 覆盖中英、标点、重复标题；command 覆盖空选区、正反选区、链接内选区、多光标、单步 undo。

**Integration：** 使用真实 EditorView 验证两条同一行链接只有活动 span 展开，pointer modifier 与 Enter 路由正确；service fake 验证外部打开、拒绝与失败事件；右键 command model 随命中位置变化；source/live preview 切换不丢选择；IME composition 中不触发粘贴/包裹副作用。

**E2E：** Playwright 输入行内、title、引用式、autolink、邮箱、裸 URL 与内部链接；验证阅读态、单击编辑、Ctrl+Click fake opener、右键复制、键盘打开、锚点滚动、中英切换、亮暗主题 focus 样式、错误 notice 和源码模式。不得访问真实公网或真的拉起浏览器，以注入 adapter 记录调用。

**Fixture：** 扩充 `links-images.md` 或拆出职责明确的 links fixture，加入转义 destination、单双引号 title、隐式引用、未解析引用、中文 fragment、重复标题、相对路径、空 destination、危险 scheme；执行 open → edit one range → save → byte diff，只允许预期 range 改变。继续运行 `pnpm test:fixtures`，且不要把大文件 fixture 与其他重 CPU 门禁并行。

**Perf：** 单独基准 1MB/5MB/10MB 链接密集文档的打开、viewport decoration、光标跨链接、滚动、粘贴与内存；事件处理只查询命中位置附近语法树，不扫描 Markdown 全文；内部标题索引增量更新并可取消。目标保持普通输入 transaction 尽量低于 16ms、滚动接近 60 FPS，性能基准独立运行。

## 风险与未核实项

- Typora 的 Ctrl+K、系统默认浏览器选择、中文/标点/重复标题 slug、坏 URL 和空 href 精确呈现仍为证据不足；实施前应在受控 Windows/macOS 环境复核，但 LumaMark 必须先定义自洽、安全、跨平台契约。
- CodeMirror/Lezer 已能在聚合语料中产生 `Link`、`Autolink`、`URL`，本次定点解析也确认独立裸 URL/裸邮箱落为 `URL` 而不是 `Link`；但转义 destination、title、未解析引用和复杂引用定义的精确节点边界仍需用已提交的 parser snapshot 逐例锁定。
- Tauri opener 的最终权限、包体积、Windows URL scheme 行为和阿里云镜像可用性尚未验证；引入主要依赖时需要决策记录与 capabilities 最小权限。
- 把 decoration 改为可聚焦链接可能影响 selection、IME、复制和 CodeMirror DOM 映射；必须先用 capability 原型和自动测试验证，不以普通 `<a>` 覆盖源码编辑 DOM。
- 当前表格 preview 的 `_blank` 链接策略与未来统一 navigation service 不一致，后续需收口，但本专题不据此修改表格模块。

## 证据索引

- 竞品事实：`docs/product/typora-baseline/06-links.md`；横切模型：`docs/product/typora-baseline/00-live-preview-model.md`。
- 解析与模式：`src/editor/markdown/markdownLanguage.ts`、`src/editor/core/editorDisplayMode.ts`、`src/editor/core/createEditorState.ts`。
- 装饰与样式：`src/editor/wysiwyg/markdownDecorations.ts:234-240,482-500`、`src/editor/wysiwyg/wysiwyg.css:160-166`。
- 装饰测试：`src/editor/wysiwyg/markdownDecorations.test.ts:116-146,417-447`。
- 插入命令与已知嵌套：`src/editor/commands/markdownFormatCommands.ts:39-40`、`src/editor/commands/markdownFormatCommands.test.ts:20-35,91-103`、`src/editor/commands/markdownFormatKeymap.ts`。
- 菜单与 i18n：`src/features/commands/createCommandModels.ts:256-264,306-329`、`src/shared/i18n/locales/en.json`、`src/shared/i18n/locales/zh-CN.json`。
- E2E：`tests/e2e/editor-markdown.spec.ts:3-46,62-107`；当前只证明样式与源码模式。
- Fixture：`tests/fixtures/markdown/links-images.md`、`tests/fixtures/markdownFixtureManifest.ts:40-43`、`tests/fixtures/fixturePaths.ts:5-30`、`tests/fixtures/roundTrip.test.ts`、`tests/fixtures/fixtureCoverage.test.ts`。
- 定点解析：以 `node --input-type=module` 导入 `@lezer/markdown`，对 `parser.configure(GFM)` 输入引用式、隐式引用名、裸 URL、裸邮箱与尖括号邮箱并遍历语法树；结果分别出现 `Link`、`Link`、`URL`、`URL`、`Autolink`，该只读探针不替代应提交的 parser snapshot。
- 依赖与外部打开缺口：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`；现有成熟右键组件为 `@radix-ui/react-context-menu`。
- 本次验证：`pnpm test src/editor/wysiwyg/markdownDecorations.test.ts src/editor/commands/markdownFormatCommands.test.ts src/features/commands/createCommandModels.test.ts tests/fixtures/fixtureCoverage.test.ts`，4 files / 76 tests 通过；`pnpm test tests/fixtures/roundTrip.test.ts`，1 file / 20 tests 通过。后者读取并保存比较了三个 `large-*` fixture，但这是源码字节回归，不是独立性能基准，也不证明尚未实现的导航功能。
