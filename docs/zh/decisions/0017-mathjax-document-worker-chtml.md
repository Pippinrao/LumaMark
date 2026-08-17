> 语言：**中文** · [English](../../decisions/0017-mathjax-document-worker-chtml.md)

# ADR 0017：MathJax 文档级 Worker 与 CHTML 数学渲染

**状态：** 已接受

**日期：** 2026-08-13

## 背景

Issue #11 的数学公式范围不只包含简单的 `$...$` 与 `$$...$$` 排版，还要求 AMS 编号、文档内 `\label` / `\ref`、按源码顺序生效的宏、Physics、mhchem、离线 Tauri WebView、安全边界和可选择文本。这些能力具有文档状态：单个公式的输出可能受它之前的宏、编号和标签影响，前向引用又要求同一批次解析完整公式序列。

KaTeX 和 MathJax 都是成熟渲染器。KaTeX 的体积与同步渲染速度更有吸引力，但其支持表不能满足本次已锁定的完整 `\label` / `\ref` 文档语义。MathJax v4 的 TeX 输入、AMS 标签、扩展包和文档级处理模型符合迁移目标，因此不能把公式作为彼此无状态的字符串独立缓存或渲染。

数学渲染也是编辑器冷路径。把 MathJax 放到主线程会让宏展开、排版和字体模块加载与输入、选区、滚动及 IME 竞争；从 CDN 或运行时加载任意 TeX 包又不符合离线桌面、安全和 CSP 约束。

## 决策

- 直接并精确锁定 `@mathjax/src@4.1.3` 与 `@mathjax/mathjax-newcm-font@4.1.3`，不依赖 Mermaid 的传递 KaTeX。
- 输出固定使用 CHTML 与 NewCM 字体。CHTML 保留浏览器文本选择和响应式布局；字体作为 Vite 同源静态资源随应用离线打包。
- MathJax 只在文档首次出现可渲染公式时创建 module Web Worker。每个文档使用独立 TeX/MathDocument 状态，并按源码顺序整批接收公式、配置和布局指标。
- 请求和结果携带 `documentId` 与单调 `generation`。公式序列或配置改变后 debounce；新请求取消旧 Worker，陈旧 generation 永不写回。缓存键覆盖完整有序公式序列、布局、偏好和引擎版本，不按单公式源码缓存有状态结果。
- Markdown 正文、选区与撤销历史继续只由主 CodeMirror `EditorState` 持有。React store 不保存全文、CHTML 或高频公式状态；Worker 结果只形成可丢弃的 decorations/widgets。
- TeX 包白名单固定为 `base`、`ams`、`newcommand`、`textmacros`、`configmacros`、`begingroup`、`mhchem`、`physics`；Physics 由偏好门控。禁止 `require`、`autoload`、`setoptions`、`html` 与 `texhtml`。
- 启用 MathJax Safe handler，拒绝外部协议、样式、任意 class 和不受控 ID；用户标签不直接成为 DOM ID，编号 fragment 加文档作用域前缀。Widget 装载 Worker CHTML 前再次剥离脚本、嵌入元素、事件属性和外部 URL。
- 单公式输入上限为 10 KiB，单文档最多 1000 个公式且 TeX 总长最多 1 MiB；TeX 宏、buffer 和模板展开设定显式上限，Worker 由 watchdog 终止并可在后续请求恢复。
- 不放宽 Tauri CSP，不使用 CDN、blob worker 或运行时任意包加载。MathJax 与 Mermaid 保持独立 chunk；生产构建递归检查所有 JavaScript，入口上限 `<120 KiB`、任一 JS chunk 上限 `<700 KiB`。
- `quality:web-build` 将 Rolldown 的 `[PLUGIN_TIMINGS]` 视为阻塞 warning，而不是允许后续构建静默漂移；出现该标记必须定位具体插件或构建阶段，修复并重新生成无 warning 的生产包。
- 同源 module Worker 与主线程代码属于同一应用发布包和信任边界；主线程信任由固定版本 MathJax 生成的 stylesheet，不声称在 Worker 代码本身被篡改后仍能沙箱化任意 CSS。用户 TeX 的不可信边界由包白名单、Safe handler、资源限制及 CHTML 装载前的二次 active-markup/URL 净化共同约束。
- 首版语法只接受独立物理行上的块定界符 `$$`，包括列表和引用中的嵌套块；行内只接受 `$...$`，默认 Pandoc 规则，可切换 Legacy 或 disabled。TeX 内容在 Markdown 语法树中保持 opaque。
- 默认偏好为行内 Pandoc、编号 none、Physics 关闭；mhchem 始终包含在固定白名单内。偏好变化只重配 Markdown language 与 renderer state，不修改正文、选区、dirty 或撤销历史。
- Source 始终显示原始 Markdown；Reading 始终显示渲染结果；Live Preview 中 inactive 公式替换源码，active 块保留主编辑器源码并在下方显示预览，active 行内公式显露源码。

## 被否决方案

- **KaTeX 作为 Issue #11 最终引擎：** 无法满足本次锁定的完整文档级标签与引用目标；不能用局部兼容层伪造 TeX 文档状态。
- **MathJax 在主线程渲染：** 会让批量排版、宏展开和字体加载进入输入与滚动竞争路径，也削弱超时后的隔离与恢复能力。
- **SVG path 输出：** 不符合可选择文本和响应式版面目标，且会增大复杂公式输出。
- **按单公式源码缓存：** 编号、宏和引用受完整有序公式序列影响，单公式缓存可能返回语义已过期的结果。
- **CDN、blob worker、autoload 或 `\require`：** 破坏离线保证并扩大 CSP、供应链和运行时包加载攻击面。
- **复用 Mermaid scheduler 类型或迁移到 Rust：** 两者的状态与错误合同不同；当前基准没有证明需要新增 Rust 渲染链路。

## 影响

- 数学能力进入独立 `editor/capabilities/math`，由 syntax、inventory、session、Worker renderer、widget、字体和偏好模块组成；通用 WYSIWYG 与 Mermaid 不承担数学主体逻辑。
- 文档级整批渲染会在公式序列或偏好变化时重算，但普通非公式编辑只映射 decorations，不触发 Worker。专用性能基准必须持续覆盖无公式 1 MiB 文档、100/1000 个公式、持续输入、resize、Worker 时间和内存释放。
- 105 个 NewCM WOFF2 会增加安装体积，但不会进入应用入口或 Mermaid chunk；离线安装包必须验证普通与稀有字形、Physics 和 mhchem 不发起网络请求。
- CHTML 使用 `role="math"` 与 TeX accessible name 提供基础可访问性；完整辅助技术、引用键盘导航和跨平台字体仍属于产品验收门禁。
- `\label` 索引只对当前 generation 有效。引用点击必须从当前结果重新解析目标并调用共享位置揭示能力，不能长期缓存绝对源码位置。

## 回滚与复审条件

若固定版本在支持的 Tauri WebView 中无法离线运行、持续突破 JS chunk 门禁、造成输入或内存预算不可接受的退化，或出现 Safe handler 与 DOM 二次净化仍无法隔离的安全问题，应停用数学 capability 并回退为源码可见状态，再通过新 ADR 复审引擎或输出格式。

复审时不得静默回退到主线程、SVG、CDN、blob worker 或放宽 CSP。只有新的兼容语料证明 KaTeX 已完整满足文档级编号、宏和双向引用目标，或 MathJax 官方架构发生实质变化，才重新比较引擎。

## 参考

- [KaTeX 支持表](https://katex.org/docs/support_table.html)
- [MathJax 本地托管](https://docs.mathjax.org/en/latest/web/hosting.html)
- [MathJax CHTML 输出](https://docs.mathjax.org/en/latest/output/html.html)
- [MathJax SVG 输出差异](https://docs.mathjax.org/en/latest/output/svg.html)
- [MathJax 编号与引用](https://docs.mathjax.org/en/v4.0/input/tex/eqnumbers.html)
- [Tauri CSP](https://v2.tauri.app/security/csp/)
