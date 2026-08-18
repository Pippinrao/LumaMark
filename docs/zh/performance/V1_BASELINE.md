> 语言：**中文** · [English](../../performance/V1_BASELINE.md)

# V1 性能基线

本文件记录 LumaMark V1 alpha 的性能门禁和当前实测结果。后续优化可以提高指标，但不得移除性能门禁。

## 环境

- 日期：2026-07-22
- Parity Reliability 增补日期：2026-07-27
- 0.2.0 发布校准日期：2026-08-01
- 阅读外观增补日期：2026-08-04
- 阅读外观真实布局校准日期：2026-08-05
- 代码块围栏可靠性增补日期：2026-08-12
- 代码块围栏补齐预算校准日期：2026-08-13
- 卡顿恢复混合文档校准日期：2026-08-18
- 装机交互卡顿门禁日期：2026-08-19
- 平台：Windows，本地开发工作树
- 命令：`pnpm perf:bench`（jsdom，串行）和 `pnpm release:installed-ux-stutter`（真实装机/WebView2 窗口）
- 覆盖范围：Markdown fixture 读取、应用文件动作打开、打开后 debounce 大纲刷新、虚拟化大纲面板初始渲染、CodeMirror 大文档初始化、尾部输入 dispatch、selection-only dispatch、显示模式往返、阅读外观 compartment dispatch 往返、代码块密集文档输入/激活/真实 Enter 围栏补齐，简单/复杂 Mermaid pending render 与 active-edit 输入 dispatch，1/5/10MB 文档统计调度，约 2–4KB 混合文档（数学 + PlantUML + Mermaid + 表格）尾部输入/选区/滚动/处理时间探测，以及装机同窗口小文件点击、标题栏拖动咬合、混合文档滚动和加载 long task 测量
- 运行口径：`pnpm test` 排除 `tests/perf/**`，性能基准必须通过 `pnpm perf:bench` 单独串行执行。大纲面板 benchmark 会先预热一次极小渲染。输入与默认编辑器创建固定采集 5 个样本、保留首样本并输出全部数值；默认 editor 首次输入、Mermaid 冷路径和 pending-render 的每个样本都使用独立 editor/activation/render 生命周期。既有主预算约束 P80（第 4 个有序样本，最多允许 1 次超过主预算），最大值按 `max(50 ms, 2 × 主预算)` 约束；默认编辑器创建还要求首样本和 P80 `< 300 ms`、最大值 `< 600 ms`，详细决策见 [ADR 0007](../decisions/0007-stable-performance-sampling.md)。代码块围栏补齐作为复杂编辑命令使用 P80 `< 50 ms`、最大值 `< 100 ms`，普通尾部输入仍保持 P80 `< 16 ms`、最大值 `< 50 ms`，边界见 [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md)。Mermaid 1/5/10MB active-edit P80 预算仍保持 `< 16/50/100 ms`；pending-render 的 P80 与最大值都必须 `< 50 ms`。

## 自动化门禁

| 路径 | 预算 | 当前结果 | 结论 |
|---|---:|---:|---|
| 读取 `large-1mb.md` | < 300 ms | 1.99 ms | 通过 |
| 读取 `large-5mb.md` | < 1000 ms | 5.71 ms | 通过 |
| 读取 `large-10mb.md` | < 2000 ms | 14.59 ms | 通过 |
| 文件动作打开 `large-1mb.md` | < 300 ms | 75.29 ms | 通过 |
| 文件动作打开 `large-5mb.md` | < 1000 ms | 104.94 ms | 通过 |
| 文件动作打开 `large-10mb.md` | < 2000 ms | 177.25 ms | 通过 |
| 打开后大纲刷新 `large-1mb.md` | < 50 ms | 7.04 ms | 通过 |
| 打开后大纲刷新 `large-5mb.md` | < 150 ms | 23.55 ms | 通过 |
| 打开后大纲刷新 `large-10mb.md` | < 300 ms | 49.41 ms | 通过 |
| 大纲面板初始渲染 `large-1mb.md` | < 60 ms | 23 / 799 项，23.62 ms | 通过 |
| 大纲面板初始渲染 `large-5mb.md` | < 60 ms | 23 / 3953 项，19.66 ms | 通过 |
| 大纲面板初始渲染 `large-10mb.md` | < 60 ms | 23 / 7892 项，11.33 ms | 通过 |
| 默认小文档首次编辑器创建 | 首样本 < 300 ms；P80 < 300 ms；最大值 < 600 ms | 首样本 98.51 ms；P80 16.79 ms；中位数 14.46 ms；最大值 98.51 ms；样本 [98.51, 10.39, 13.22, 14.46, 16.79] | 通过 |
| 默认小文档首次尾部输入 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 1.49 ms；中位数 1.46 ms；最大值 6.84 ms；样本 [6.84, 1.26, 1.46, 1.18, 1.49] | 通过 |
| 编辑器载入 `large-1mb.md` | < 300 ms | 58.07 ms | 通过 |
| 编辑器载入 `large-5mb.md` | < 1000 ms | 54.90 ms | 通过 |
| 编辑器载入 `large-10mb.md` | < 2000 ms | 79.19 ms | 通过 |
| 1MB 尾部输入 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 2.05 ms；中位数 1.63 ms；最大值 3.14 ms；样本 [3.14, 2.05, 1.63, 1.49, 1.55] | 通过 |
| 5MB 尾部输入 dispatch | P80 < 50 ms；最大值 < 100 ms | P80 1.27 ms；中位数 1.18 ms；最大值 2.22 ms；样本 [2.22, 1.27, 1.16, 1.09, 1.18] | 通过 |
| 10MB 尾部输入 dispatch | P80 < 100 ms；最大值 < 200 ms | P80 1.21 ms；中位数 1.19 ms；最大值 1.54 ms；样本 [1.54, 1.19, 1.21, 1.19, 1.16] | 通过 |
| Mermaid 渲染 pending 时普通输入 dispatch | P80 < 50 ms；最大值 < 50 ms | P80 0.74 ms；中位数 0.55 ms；最大值 3.31 ms；样本 [3.31, 0.74, 0.55, 0.46, 0.53] | 通过 |
| 1MB 文档 12 次 selection-only dispatch | < 100 ms | 22.50 ms（平均 1.88 ms） | 通过 |
| 5MB 文档 12 次 selection-only dispatch | < 120 ms | 10.94 ms（平均 0.91 ms） | 通过 |
| 10MB 文档 12 次 selection-only dispatch | < 160 ms | 9.05 ms（平均 0.75 ms） | 通过 |
| 1MB 文档 source/live-preview 模式往返 | < 150 ms | 23.44 ms | 通过 |
| 5MB 文档 source/live-preview 模式往返 | < 300 ms | 20.83 ms | 通过 |
| 10MB 文档 source/live-preview 模式往返 | < 600 ms | 31.52 ms | 通过 |
| 1MB 文档阅读外观 compartment dispatch 往返 | < 50 ms | 0.88 ms | 通过 |
| 5MB 文档阅读外观 compartment dispatch 往返 | < 75 ms | 0.69 ms | 通过 |
| 10MB 文档阅读外观 compartment dispatch 往返 | < 100 ms | 0.84 ms | 通过 |
| 2048 个 fenced blocks（0.46 MiB）载入 | < 300 ms | 27.42 ms | 通过 |
| 2048 个 fenced blocks 尾部输入 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 2.52 ms；中位数 1.71 ms；最大值 4.21 ms；样本 [4.21, 2.52, 1.71, 1.59, 1.37] | 通过 |
| 2048 个 fenced blocks 聚焦激活 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 0.96 ms；最大值 1.72 ms；样本 [1.72, 0.96, 0.96, 0.85, 0.84] | 通过 |
| 2048 个 fenced blocks 尾部真实 Enter 围栏补齐 | P80 < 50 ms；最大值 < 100 ms | P80 24.55 ms；最大值 35.75 ms；样本 [24.55, 19.98, 13.08, 15.50, 35.75] | 通过 |
| 复杂 Mermaid pending 时主文档输入 dispatch | P80 < 50 ms；最大值 < 50 ms | 180 节点 / 17,348 bytes；P80 0.74 ms；中位数 0.62 ms；最大值 2.64 ms；样本 [2.64, 0.62, 0.60, 0.56, 0.74] | 通过 |
| 小文档首次 Mermaid active-edit 输入 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 2.08 ms；中位数 1.85 ms；最大值 2.84 ms；样本 [2.84, 2.08, 1.85, 1.74, 1.51] | 通过 |
| 1MB 文档 Mermaid active-edit 输入 dispatch | P80 < 16 ms；最大值 < 50 ms | P80 2.23 ms；中位数 2.12 ms；最大值 2.44 ms；样本 [2.44, 2.23, 2.12, 2.06, 1.86] | 通过 |
| 5MB 文档 Mermaid active-edit 输入 dispatch | P80 < 50 ms；最大值 < 100 ms | P80 2.02 ms；中位数 1.94 ms；最大值 7.35 ms；样本 [2.02, 1.84, 1.94, 1.75, 7.35] | 通过 |
| 10MB 文档 Mermaid active-edit 输入 dispatch | P80 < 100 ms；最大值 < 200 ms | P80 1.63 ms；中位数 1.62 ms；最大值 1.74 ms；样本 [1.74, 1.61, 1.63, 1.62, 1.62] | 通过 |
| 1MB 文档统计（同步计数） | P80 < 16 ms | P80 8.25 ms；样本 [8.25, 5.62, 4.73] | 通过 |
| 5MB 文档统计调度（输入路径） | P80 < 2 ms | P80 0.19 ms；样本 [0.19, 0.01, 0.01] | 通过 |
| 10MB 文档统计调度（输入路径） | P80 < 2 ms | P80 0.04 ms；样本 [0.04, 0.00, 0.00] | 通过 |
| 约 2–4KB 混合文档（数学 + PlantUML + Mermaid + 表格）尾部输入 dispatch | P80 < 8 ms；处理 P95 < 32 ms；最大值 < 32 ms | P80 2.01 ms；最大值 7.23 ms；样本 [7.23, 2.01, 1.68, 1.36, 1.72]；处理 P95 7.23 ms | 通过 |
| 约 2–4KB 混合文档 selection-only dispatch | P80 < 8 ms；最大值 < 32 ms | P80 0.33 ms；最大值 0.62 ms；样本 [0.62, 0.33, 0.23, 0.25, 0.31] | 通过 |
| 约 2–4KB 混合文档滚动两帧提交（jsdom 代理） | P80 < 16 ms | P80 0.03 ms；最大值 0.42 ms | 通过 |
| Web 首屏入口 JS chunk | < 120 KiB | 15.05 KiB | 通过 |
| Web 任意 JS chunk | < 700 KiB | 最大 664.41 KiB，gzip 146.38 KiB，Mermaid 动态依赖 | 通过 |

## 解释

- 1MB、5MB 和 10MB 的自动化性能门禁通过，覆盖读取、应用文件动作打开、打开后大纲刷新、虚拟化大纲面板初始渲染、编辑器载入和尾部输入 dispatch。
- 10MB 文件满足当前自动化 “不冻结” 门禁：可通过文件动作打开、完成 debounce 后大纲刷新、只初始渲染 23 / 7892 个大纲项、创建编辑器并完成一次尾部输入。
- Mermaid 渲染通过 scheduler 异步执行；pending render 下普通与复杂输入均在 5 个独立 render 生命周期上执行 P80/最大值 `< 50 ms` 门禁。active-edit 冷路径在 5 个独立 activation 上执行 P80 `< 16 ms`、最大值 `< 50 ms` 门禁；同一文档内的 1/5/10MB 连续输入保持近似常数时间且 P80 分别通过 `< 16/50/100 ms` 预算。
- 2026-08-18 卡顿恢复校准将打开后大纲刷新恢复为原始 `< 50/150/300 ms` 预算（本轮实测 10.13/25.56/52.40 ms），把 5/10MB 文档统计移出输入路径（调度 `< 2 ms`），并新增约 2–4KB 混合写作样本。该混合文档保持尾部输入 P80 `< 8 ms`、选区 P80 `< 8 ms`；Vitest + jsdom 的处理 P95 只是 INP 处理时间的代理（`< 32 ms`），不是真实 Chrome INP 测量。2026-08-19 的混合文档滚动代理为 P80 `< 16 ms`（实测 0.03 ms），同样不能替代装机 WebView2 滚动或 long task 证据。
- Parity Reliability 增补门禁证明：selection-only 更新不会修改文档，显示模式往返保持 selection；代码块密集文档的普通尾部输入和聚焦语言激活沿用 1MB 输入的 P80 `< 16 ms`、最大值 `< 50 ms` 严格预算。真实 Enter 围栏补齐同时执行语法确认、多段插入、selection、视口和高度映射更新，按 [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md) 作为复杂编辑命令独立约束为 P80 `< 50 ms`、最大值 `< 100 ms`；复杂 Mermaid 长任务 pending 时主 `EditorApi` 文档立即接收输入，且不会为块外输入启动第二个渲染任务。
- 阅读外观通过 CodeMirror compartment 与 CSS variable 往返重配置；Vitest + jsdom 中 1/5/10MB 文档的同步 dispatch 本机实测分别为 0.88/0.69/0.84 ms，并由 `< 50/75/100 ms` 自动化预算约束，过程不修改正文或 selection。该数值不包含浏览器样式计算、真实排版或绘制成本，不能用作“完成页面重排”的延迟声明。打包 WebView2 烟测会在切换宽度后等待两帧并读取 `.cm-content` 边界以强制观察真实布局，预算为 `< 500 ms`。
- Web 构建已通过 `pnpm quality:web-build` 门禁：首屏入口从大 vendor 包中拆出，React、CodeMirror、UI 依赖和 Mermaid 重依赖分组加载。CodeMirror 启动核心与 Lezer 基础包保持为一个 600.41 KiB 的拓扑完整 chunk，代码语言包继续按需加载；禁止用任意 `maxSize` 再拆这个核心组，因为会破坏循环模块的初始化顺序并造成生产白屏。最大 chunk 是 Mermaid 动态渲染链路中的 `vscode-languageserver-types` / Langium 等上游解析依赖，不进入首屏入口。
- Mermaid 重依赖的体积分组会形成循环输出 chunk，因此 Rolldown 输出启用 `strictExecutionOrder`。`pnpm test:e2e:production` 在实际 `dist/` 上触发 Mermaid 动态 import 并要求 SVG 成功、无 `pageerror` 或非预期 console error；`pnpm release:packaged-webview` 再对真实 release WebView 与 Rust 文件写入验证 active-save。两项功能门禁都不能由“构建成功”或 chunk 体积预算替代。

## 装机交互门禁

`pnpm release:installed-ux-stutter` 测量真实 Windows 窗口（进程能抢到前景时用 OS 鼠标，否则用 WebView CDP 点击；Event Timing / 两帧滚动；`PerformanceObserver` long task）。必须打开 routing acceptance（`LUMAMARK_ROUTING_ACCEPTANCE_MODE=1`），以免第二次 argv 再拉起一个进程。

这些数字不能与 `pnpm perf:bench` 的 jsdom dispatch 互换。Vitest 里混合文档输入 P80 通过，不能证明装机同窗口点文件、标题栏拖动咬合、滚动帧或加载 long task。

| 路径 | 预算 | 当前结果 | 结论 |
|---|---:|---:|---|
| 同窗口点小文件（`pointerdown` → 目标正文可见） | P80 < 50 ms | P80 25.0 ms；样本 [28.1, 24.5, 22.5, 25.0, 23.9]；2026-08-19 本分支 release exe | 通过 |
| 标题栏拖动首次 `GetWindowRect` 变化 | 鼠标开始移动后 < 50 ms | 跳过：开始菜单/搜索占前景（`foregroundTitle='开始'`）。空白条仍只用 native `.lm-titlebar-drag`；窗口能抢到前景时探针会记录首次位移 | 跳过 |
| 约 2–4KB 混合文档滚动两帧 | P80 < 16 ms；P95 < 32 ms | P80 16.7 ms；P95 16.8 ms；两次预热滚动后样本约 16.6–16.8 ms。16.7 ms 是一帧 60 Hz vsync；门禁允许 1 ms 余量，避免量化帧误伤 | 通过 |
| 混合文档加载/出图 long task（3 秒窗口） | < 50 ms | 0 ms（`PerformanceObserver` longtask） | 通过 |
| 冷启动 argv → 正文可见 | 记录，不压到 50 ms | 本轮 933 ms（含 WebView 启动） | 已知限制 |

要声称「装机包在这三条路径上不再卡」，必须对本分支对应 exe 跑绿 `pnpm release:installed-ux-stutter`。不得用 jsdom 混合文档 dispatch 通过当作该证据。系统开始菜单占前景时，标题栏拖动咬合会跳过（不是失败）；这不是生产缺陷。

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
| 小文档页面宽度切换到两帧布局提交 | 19.60 ms | 通过打包 WebView2 `< 500 ms` 烟测预算 |

同一开发版真实 WebView2 在修复前的 10MB 尾部键盘输入为 P50 226 ms / P95 242 ms；修复 changed-range/viewport 热路径后开发版复测为 P50 86.9 ms，发布版最终为 P50 48.2 ms / P95 90.4 ms。该对比使用同一磁盘样本与页面内两帧口径，但开发版和发布版构建模式不同，因此只用于定位改进方向，不当作严格同构 benchmark。

## 已知限制

- 自动化基线仍主要运行在 Vitest + jsdom；本轮补了真实 Windows Tauri WebView2 打开、尾部输入、撤销和小文档阅读外观两帧布局观测，但不能替代大文档宽度/字体重排、滚动 FPS、原生 IME 手感、屏幕阅读器和长时间编辑测试。
- jsdom 的 `view.dispatch` / 合成滚动不是装机 INP、标题栏拖动咬合、WebView2 滚动帧或 `longtask` 时长。这三条交互路径用 `pnpm release:installed-ux-stutter` 测量。
- 冷启动 argv 打开两行 Markdown 包含 WebView 启动（此前装机探测约 900–1100 ms），是明确的已知限制，不是同窗口点文件的 50 ms 预算。
- 真实 WebView2 的 10MB 撤销 P95 为 155.90 ms，仍有可感知延迟；不得因自动化 dispatch 为 1.79 ms 就宣称大文档人机体验已经完全达标。
- Web 构建 chunk 预算已自动化。后续若 Mermaid、KaTeX、Cytoscape 等依赖继续增长，应优先评估按图表类型懒加载或替换更细粒度入口，而不是提高预算。
- 性能数值会受本机 CPU、磁盘缓存和依赖版本影响。若 CI 或其他机器出现回归，应以自动化门禁和新基线记录为准。
