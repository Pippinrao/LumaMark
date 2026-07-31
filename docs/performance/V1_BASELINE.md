# V1 性能基线

本文件记录 LumaMark V1 alpha 的性能门禁和当前实测结果。后续优化可以提高指标，但不得移除性能门禁。

## 环境

- 日期：2026-07-22
- Parity Reliability 增补日期：2026-07-27
- 0.2.0 发布校准日期：2026-08-01
- 平台：Windows，本地开发工作树
- 命令：`pnpm perf:bench`
- 覆盖范围：Markdown fixture 读取、应用文件动作打开、打开后 debounce 大纲刷新、虚拟化大纲面板初始渲染、CodeMirror 大文档初始化、尾部输入 dispatch、selection-only dispatch、显示模式往返、代码块密集文档，以及简单/复杂 Mermaid pending render 与 active-edit 输入 dispatch
- 运行口径：`pnpm test` 排除 `tests/perf/**`，性能基准必须通过 `pnpm perf:bench` 单独串行执行。大纲面板 benchmark 会先预热一次极小渲染；大文档编辑器 benchmark 会先测量极小默认文档的创建与同形尾部输入，并分别执行 `< 300 ms`、`< 16 ms` 冷路径预算，再销毁编辑器，模拟应用先创建默认编辑器的生命周期，避免把测试环境的 React/CodeMirror/jsdom 首次初始化成本计入目标样本且不让初始化退化逃逸。Mermaid active-edit 另有一个预算 `< 16 ms` 的小文档冷路径用例，随后 1/5/10MB 稳态预算仍保持 `< 16/50/100 ms`。

## 自动化门禁

| 路径 | 预算 | 当前结果 | 结论 |
|---|---:|---:|---|
| 读取 `large-1mb.md` | < 300 ms | 2.13 ms | 通过 |
| 读取 `large-5mb.md` | < 1000 ms | 5.91 ms | 通过 |
| 读取 `large-10mb.md` | < 2000 ms | 11.32 ms | 通过 |
| 文件动作打开 `large-1mb.md` | < 300 ms | 76.97 ms | 通过 |
| 文件动作打开 `large-5mb.md` | < 1000 ms | 113.22 ms | 通过 |
| 文件动作打开 `large-10mb.md` | < 2000 ms | 179.67 ms | 通过 |
| 打开后大纲刷新 `large-1mb.md` | < 50 ms | 7.13 ms | 通过 |
| 打开后大纲刷新 `large-5mb.md` | < 150 ms | 25.00 ms | 通过 |
| 打开后大纲刷新 `large-10mb.md` | < 300 ms | 50.82 ms | 通过 |
| 大纲面板初始渲染 `large-1mb.md` | < 60 ms | 23 / 799 项，20.48 ms | 通过 |
| 大纲面板初始渲染 `large-5mb.md` | < 60 ms | 23 / 3953 项，8.17 ms | 通过 |
| 大纲面板初始渲染 `large-10mb.md` | < 60 ms | 23 / 7892 项，9.44 ms | 通过 |
| 默认小文档首次编辑器创建 | < 300 ms | 104.20 ms | 通过 |
| 默认小文档首次尾部输入 dispatch | < 16 ms | 7.42 ms | 通过 |
| 编辑器载入 `large-1mb.md` | < 300 ms | 30.05 ms | 通过 |
| 编辑器载入 `large-5mb.md` | < 1000 ms | 50.85 ms | 通过 |
| 编辑器载入 `large-10mb.md` | < 2000 ms | 73.32 ms | 通过 |
| 1MB 尾部输入 dispatch | < 16 ms | 3.67 ms | 通过 |
| 5MB 尾部输入 dispatch | < 50 ms | 2.40 ms | 通过 |
| 10MB 尾部输入 dispatch | < 100 ms | 2.17 ms | 通过 |
| Mermaid 渲染 pending 时普通输入 dispatch | < 50 ms | 3.51 ms | 通过 |
| 1MB 文档 12 次 selection-only dispatch | < 100 ms | 21.11 ms（平均 1.76 ms） | 通过 |
| 5MB 文档 12 次 selection-only dispatch | < 120 ms | 11.04 ms（平均 0.92 ms） | 通过 |
| 10MB 文档 12 次 selection-only dispatch | < 160 ms | 9.08 ms（平均 0.76 ms） | 通过 |
| 1MB 文档 source/live-preview 模式往返 | < 150 ms | 24.73 ms | 通过 |
| 5MB 文档 source/live-preview 模式往返 | < 300 ms | 21.64 ms | 通过 |
| 10MB 文档 source/live-preview 模式往返 | < 600 ms | 28.30 ms | 通过 |
| 2048 个 fenced blocks（0.46 MiB）载入 | < 300 ms | 27.13 ms | 通过 |
| 2048 个 fenced blocks 尾部输入 dispatch | < 16 ms | 4.38 ms | 通过 |
| 复杂 Mermaid pending 时主文档输入 dispatch | < 50 ms | 180 节点 / 17,348 bytes，3.50 ms | 通过 |
| 小文档首次 Mermaid active-edit 输入 dispatch | < 16 ms | 5.42 ms | 通过 |
| 1MB 文档 Mermaid active-edit 输入 dispatch | < 16 ms | 3.62 ms | 通过 |
| 5MB 文档 Mermaid active-edit 输入 dispatch | < 50 ms | 4.63 ms | 通过 |
| 10MB 文档 Mermaid active-edit 输入 dispatch | < 100 ms | 2.67 ms | 通过 |
| Web 首屏入口 JS chunk | < 120 KiB | 15.05 KiB | 通过 |
| Web 任意 JS chunk | < 700 KiB | 最大 664.41 KiB，gzip 146.38 KiB，Mermaid 动态依赖 | 通过 |

## 解释

- 1MB、5MB 和 10MB 的自动化性能门禁通过，覆盖读取、应用文件动作打开、打开后大纲刷新、虚拟化大纲面板初始渲染、编辑器载入和尾部输入 dispatch。
- 10MB 文件满足当前自动化 “不冻结” 门禁：可通过文件动作打开、完成 debounce 后大纲刷新、只初始渲染 23 / 7892 个大纲项、创建编辑器并完成一次尾部输入。
- Mermaid 渲染通过 scheduler 异步执行；pending render 下普通输入 dispatch 仍低于 50 ms。active-edit 首次输入由独立 `< 16 ms` 冷路径约束，预热后的 1/5/10MB 输入保持近似常数时间且分别通过 `< 16/50/100 ms` 预算。
- Parity Reliability 增补门禁证明：selection-only 更新不会修改文档，显示模式往返保持 selection；代码块密集文档沿用 1MB 输入的 `< 16 ms` 严格预算；复杂 Mermaid 长任务 pending 时主 `EditorApi` 文档立即接收输入，且不会为块外输入启动第二个渲染任务。
- Web 构建已通过 `pnpm quality:web-build` 门禁：首屏入口从大 vendor 包中拆出，React、CodeMirror、UI 依赖和 Mermaid 重依赖分组加载。CodeMirror 启动核心与 Lezer 基础包保持为一个 600.41 KiB 的拓扑完整 chunk，代码语言包继续按需加载；禁止用任意 `maxSize` 再拆这个核心组，因为会破坏循环模块的初始化顺序并造成生产白屏。最大 chunk 是 Mermaid 动态渲染链路中的 `vscode-languageserver-types` / Langium 等上游解析依赖，不进入首屏入口。
- Mermaid 重依赖的体积分组会形成循环输出 chunk，因此 Rolldown 输出启用 `strictExecutionOrder`。`pnpm test:e2e:production` 在实际 `dist/` 上触发 Mermaid 动态 import 并要求 SVG 成功、无 `pageerror` 或非预期 console error；`pnpm release:packaged-webview` 再对真实 release WebView 与 Rust 文件写入验证 active-save。两项功能门禁都不能由“构建成功”或 chunk 体积预算替代。

## 真实 Tauri WebView2 人机工学测量

2026-07-22 在 `src-tauri/target/release/lumamark.exe` 上通过 WebView2 CDP 执行真实 Rust 文件读取与键盘事件。窗口为 1000 × 700 CSS 像素、DPR 1.5；样本 `ergonomic-large-10mb.md` 为 10,486,549 字节、10,044,653 个 CodeMirror UTF-16 位置、299,863 行。键盘数据从事件前的页面 `performance.now()` 计时到两次 `requestAnimationFrame`，每项 7 次；它包含事件处理与两帧可见提交成本。

| 路径 | 结果 | 结论 |
|---|---:|---|
| 最近文件点击到完整 EditorState 且状态“已打开” | 249.97 ms | 通过当前 10MB 打开预算 |
| 10MB 尾部直接 dispatch | 26.60 ms | 通过当前 100 ms 输入预算 |
| 10MB 实际键盘输入 | P50 48.20 ms；P95 90.40 ms | P95 通过当前 100 ms 门禁，但高于单帧 16 ms |
| 10MB 实际 `Ctrl+Z` | P50 148.50 ms；P95 155.90 ms | 未达到 100 ms，保留为明确优化项 |
| 初始可见 DOM | 31 行；滚动高度 7,000,168 px；无页面横向溢出 | 虚拟化/viewport 渲染生效 |
| 7 次输入/撤销后的主数据 | 文档长度与行数精确恢复；标题 clean；恢复草稿为空 | 保存点与 undo 往返通过该样本 |

同一开发版真实 WebView2 在修复前的 10MB 尾部键盘输入为 P50 226 ms / P95 242 ms；修复 changed-range/viewport 热路径后开发版复测为 P50 86.9 ms，发布版最终为 P50 48.2 ms / P95 90.4 ms。该对比使用同一磁盘样本与页面内两帧口径，但开发版和发布版构建模式不同，因此只用于定位改进方向，不当作严格同构 benchmark。

## 已知限制

- 自动化基线仍主要运行在 Vitest + jsdom；本轮补了真实 Windows Tauri WebView2 打开、尾部输入和撤销，但不能替代滚动 FPS、原生 IME 手感、屏幕阅读器和长时间编辑测试。
- 真实 WebView2 的 10MB 撤销 P95 为 155.90 ms，仍有可感知延迟；不得因自动化 dispatch 为 1.79 ms 就宣称大文档人机体验已经完全达标。
- Web 构建 chunk 预算已自动化。后续若 Mermaid、KaTeX、Cytoscape 等依赖继续增长，应优先评估按图表类型懒加载或替换更细粒度入口，而不是提高预算。
- 性能数值会受本机 CPU、磁盘缓存和依赖版本影响。若 CI 或其他机器出现回归，应以自动化门禁和新基线记录为准。
