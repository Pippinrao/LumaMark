# V1 性能基线

本文件记录 LumaMark V1 alpha 的性能门禁和当前实测结果。后续优化可以提高指标，但不得移除性能门禁。

## 环境

- 日期：2026-07-05
- 平台：Windows，本地开发工作树
- 命令：`pnpm perf:bench`
- 覆盖范围：Markdown fixture 读取、应用文件动作打开、打开后 debounce 大纲刷新、虚拟化大纲面板初始渲染、CodeMirror 大文档初始化、尾部输入 dispatch、Mermaid pending render 输入 dispatch
- 运行口径：`pnpm test` 排除 `tests/perf/**`，性能基准必须通过 `pnpm perf:bench` 单独执行。

## 自动化门禁

| 路径 | 预算 | 当前结果 | 结论 |
|---|---:|---:|---|
| 读取 `large-1mb.md` | < 300 ms | 2.30 ms | 通过 |
| 读取 `large-5mb.md` | < 1000 ms | 6.01 ms | 通过 |
| 读取 `large-10mb.md` | < 2000 ms | 11.96 ms | 通过 |
| 文件动作打开 `large-1mb.md` | < 300 ms | 34.59 ms | 通过 |
| 文件动作打开 `large-5mb.md` | < 1000 ms | 33.34 ms | 通过 |
| 文件动作打开 `large-10mb.md` | < 2000 ms | 47.39 ms | 通过 |
| 打开后大纲刷新 `large-1mb.md` | < 50 ms | 7.31 ms | 通过 |
| 打开后大纲刷新 `large-5mb.md` | < 150 ms | 24.34 ms | 通过 |
| 打开后大纲刷新 `large-10mb.md` | < 300 ms | 56.96 ms | 通过 |
| 大纲面板初始渲染 `large-1mb.md` | < 60 ms | 27 / 799 项，40.22 ms | 通过 |
| 大纲面板初始渲染 `large-5mb.md` | < 60 ms | 27 / 3953 项，9.17 ms | 通过 |
| 大纲面板初始渲染 `large-10mb.md` | < 60 ms | 27 / 7892 项，9.94 ms | 通过 |
| 编辑器载入 `large-1mb.md` | < 300 ms | 87.19 ms | 通过 |
| 编辑器载入 `large-5mb.md` | < 1000 ms | 17.22 ms | 通过 |
| 编辑器载入 `large-10mb.md` | < 2000 ms | 30.40 ms | 通过 |
| 1MB 尾部输入 dispatch | < 16 ms | 4.07 ms | 通过 |
| 5MB 尾部输入 dispatch | < 50 ms | 1.15 ms | 通过 |
| 10MB 尾部输入 dispatch | < 100 ms | 1.11 ms | 通过 |
| Mermaid 渲染 pending 时普通输入 dispatch | < 50 ms | 3.15 ms | 通过 |
| Web 首屏入口 JS chunk | < 120 KiB | 59.11 KiB | 通过 |
| Web 任意 JS chunk | < 700 KiB | 最大 662.69 KiB，gzip 143.24 KiB，Mermaid 动态依赖 | 通过 |

## 解释

- 1MB、5MB 和 10MB 的自动化性能门禁通过，覆盖读取、应用文件动作打开、打开后大纲刷新、虚拟化大纲面板初始渲染、编辑器载入和尾部输入 dispatch。
- 10MB 文件满足当前自动化 “不冻结” 门禁：可通过文件动作打开、完成 debounce 后大纲刷新、只初始渲染 27 / 7892 个大纲项、创建编辑器并完成一次尾部输入。
- Mermaid 渲染通过 scheduler 异步执行；pending render 下普通输入 dispatch 仍低于 50 ms。
- Web 构建已通过 `pnpm quality:web-build` 门禁：首屏入口从大 vendor 包中拆出，React、CodeMirror、UI 依赖和 Mermaid 重依赖分组加载。最大 chunk 是 Mermaid 动态渲染链路中的 `vscode-languageserver-types` / Langium 等上游解析依赖，不进入首屏入口。

## 已知限制

- 当前基线运行在 Vitest + jsdom 环境，不能替代真实窗口中的滚动 FPS、IME 手感和长时间编辑测试。
- Web 构建 chunk 预算已自动化。后续若 Mermaid、KaTeX、Cytoscape 等依赖继续增长，应优先评估按图表类型懒加载或替换更细粒度入口，而不是提高预算。
- 性能数值会受本机 CPU、磁盘缓存和依赖版本影响。若 CI 或其他机器出现回归，应以自动化门禁和新基线记录为准。
