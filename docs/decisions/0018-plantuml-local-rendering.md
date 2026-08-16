# ADR 0018：PlantUML 采用官方 TeaVM 本地渲染

- 状态：已采纳
- 日期：2026-08（对应 issue #12「plantuml 语法支持」）
- 编号说明：issue-12 原稿曾使用 0014，但仓库已占用 [ADR 0014](0014-settings-persistence.md)；MathJax 为 [ADR 0017](0017-mathjax-document-worker-chtml.md)。本决策因此落为 0018。

## 背景

需要为 LumaMark 增加 PlantUML 图表预览。PlantUML 官方渲染器由 Java 实现，传统上依赖 JVM 或远程 PlantUML 服务器。项目原则要求本地、离线、隐私友好、无 JVM、高性能，且优先采用成熟组件。设置必须进入 canonical `settings.json`，不能再使用独立 localStorage store。

## 决策

采用官方 `@plantuml/core`（TeaVM 编译引擎，MIT，固定 1.2026.6）在 **WebView 内本地渲染**：

- `plantuml.js` 与 `viz-global.js` 懒加载：首个 ` ```plantuml ` 块出现时才注入 Graphviz 脚本并动态 `import('@plantuml/core')`。
- `renderToString(lines, onSuccess, onError, { dark: true })` 跟随 `document.documentElement` 的 `data-theme`。
- 引擎失败 promise 保持 sticky，避免重复注入损坏的 Graphviz 脚本。
- TeaVM 运行时有进程级可变状态，因此渲染调用串行排队。
- SVG 注入前用显式依赖的 `dompurify`（SVG profile）消毒。
- 调度、缓存、`jobOwner` 隔离和 `BlockWidgetGeometryTracker` 镜像 Mermaid 合同，不阻塞输入。
- 阅读模式走现有 render-lock：不创建 Edit/Delete，Expand 仍可用。
- 开关为 canonical v3 字段 `markdown.plantuml.enabled`，默认开启。现有 v3 文档缺少该字段不算 invalid，但需要 writeback。不升 SETTINGS_VERSION。

## 被否决方案

- **打包 `plantuml.jar` + JVM**：安装体积大、冷启动慢、跨平台 JVM 管理复杂。
- **远程服务器（PlantUML 官方 / Kroki）**：需网络、有隐私泄露、离线不可用，且与 CSP `connect-src` 冲突。
- **独立 `plantumlSettingsStore` / localStorage**：与 canonical settings 和损坏恢复合同冲突。
- **第三方 Rust 实现**：语法覆盖不完整，不是 drop-in。

## 影响

- 新增直接依赖 `@plantuml/core@1.2026.6`、`dompurify@3.4.11`。
- 安装包体积增加约 8 MB；运行时懒加载。`quality:web-build` 把 `plantuml-` / `viz-global-` chunk 排除在 700KiB JS budget 之外，并把 Vite `chunkSizeWarningLimit` 提到 7000。复制该引擎与 MathJax NewCM 字体会触发 Rolldown `vite:asset` `PLUGIN_TIMINGS`；门禁只豁免这一插件名，见 [质量策略](../quality/QUALITY_STRATEGY.md)。
- PlantUML 是独立 editor capability，默认开启，设置即时生效。
- 实机完成证据必须包含 NSIS 安装包 + Win32 OS 指针路径：`scripts/release/verify-installed-plantuml-os.mjs`。

## 回滚 / 复审条件

- 若 `@plantuml/core` 破坏 API 或体积失控，回退评估 Rust sidecar / 本地 jar，并重新评估远程方案。
- 若官方 npm 产物停更，改为 vendoring `plantuml.js` + `viz-global.js`。
