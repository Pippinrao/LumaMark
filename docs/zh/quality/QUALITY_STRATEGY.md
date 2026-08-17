> 语言：**中文** · [English](../../quality/QUALITY_STRATEGY.md)

# 质量策略

## 背景

LumaMark 计划大量使用 AI 构建。AI 可以显著提升产出速度，但也容易带来：

- 大量未经验证的代码。
- 模糊需求导致返工。
- 功能能跑但不可维护。
- 手动测试压力不断上升。
- 性能退化无人察觉。
- 边缘场景不断漏测。

因此 LumaMark 必须从第一天建立 AI 原生质量体系。

详细执行规则见根目录 [DEVELOPMENT_PROCESS.md](../../DEVELOPMENT_PROCESS.zh.md)。

当前 Parity Reliability 的专题门禁、真实 Windows 路径和里程碑退出条件见 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。本文件维护长期质量分层，不复制当前任务清单。

## 质量目标

LumaMark 的质量体系要做到：

- 让 AI 每次只做小而清晰的任务。
- 让测试证明功能，而不是让 AI 自证。
- 让手动测试变成少量体验确认。
- 让源码保真和性能成为自动化门禁。
- 让 bug 通过根因流程修复，而不是猜测式补丁。

## 测试金字塔

### 单元测试

用于验证纯逻辑：

- Markdown token 识别。
- 缓存 key。
- i18n key。
- 设置解析。
- 文件路径处理。
- 搜索和索引算法。

### 集成测试

用于验证模块协作：

- 打开文件到编辑器。
- 编辑后保存。
- Mermaid 渲染队列。
- 自动保存和恢复。
- Rust command 调用。

### E2E 测试

用于验证真实用户路径：

- 启动应用。
- 打开文件。
- 输入 Markdown。
- 输入中文。
- 保存。
- 切换语言。
- 切换主题。
- 渲染 Mermaid。
- 搜索和替换。

### Fixture 回归测试

用于保护 Markdown 源码保真。

仓库内固定 fixture 用于稳定、可复现地覆盖核心语法和编辑器交互边界。`tests/fixtures/markdownFixtureManifest.ts` 记录每个 fixture 的语法标签，覆盖测试必须确保新增语法不会遗漏样本。

每个 fixture 需要覆盖一种或多种文档特征：

- 标题。
- 列表。
- 任务列表。
- 表格。
- 代码块。
- Mermaid。
- 图片。
- 链接。
- 中英文混排。
- 大文档。

Mermaid 采用分层语料：

- `mermaid-gallery.md` 覆盖 V1 必须渲染成功的核心 Mermaid 图类型。
- `mermaid-edge-cases.md` 覆盖 info string 变体、错误图、连续块、长图和 fixture-only 图类型。
- 冷门或 beta Mermaid 图类型先做源码保真和 fixture 覆盖，升级为正式支持后再进入必过渲染门禁。

关键检查：

> open -> save -> diff，无关 diff 必须为 0。

外部 Markdown corpus 作为真实世界大样本补充，只验证解析、源码保真和 Lezer 节点覆盖；它不能替代仓库内确定性 fixture，也不作为 Mermaid 渲染正确性的唯一依据。

## 性能门禁

每个性能敏感改动都必须关注：

- 启动时间。
- 打开文件时间。
- 输入延迟。
- 滚动流畅度。
- 内存占用。
- Mermaid 渲染耗时。
- 保存耗时。

性能基准必须独立于默认单元测试运行：`pnpm test` 不包含 `tests/perf/**`，性能数据和预算判断通过 `pnpm perf:bench` 单独执行。`pnpm perf:bench` 必须串行运行性能测试文件，避免大文档基准在同一机器上互相抢占资源并产生假回归。输入路径固定采集 5 个样本，既有主预算约束 P80，并对所有单次样本设置明确最大值；冷路径和 pending-render 的每个样本必须使用独立 editor/activation/render 生命周期。不得丢弃首样本、失败重跑或取最小值，详细口径见 [ADR 0007](../decisions/0007-stable-performance-sampling.md)。复杂编辑命令若有实测证据证明成本边界不同，必须单独命名、单独设预算并用新 ADR 说明，不能借此放宽普通输入门禁；代码块围栏补齐的边界见 [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md)。

初始目标：

- 1MB 文件打开小于 300ms。
- 5MB 文件打开小于 1s。
- 10MB 文件可编辑且不冻结。
- 输入延迟尽量小于 16ms。
- 滚动接近 60 FPS。
- Mermaid 渲染不阻塞输入。

## AI 开发护栏

AI agent 必须遵守：

- 先读 `AGENTS.md` 和 `DEVELOPMENT_PROCESS.md`。
- 先拆小任务。
- 先写验收标准。
- 功能和 bugfix 默认测试先行。
- 没有新鲜验证不得声称完成。
- 审查以 `DEVELOPMENT_PROCESS.md` 为准：默认实现者自审，不默认独立审查或审查子代理。
- 无法自动验证的地方必须明确说明。

## Definition of Done

任务完成必须满足：

- 需求逐项对应。
- 新行为有测试。
- 相关验证命令已运行。
- 验证输出已阅读。
- 涉及 UI 文案时 i18n 已同步。
- 涉及编辑器时源码保真风险已检查。
- 涉及性能时没有明显退化。
- 涉及基础组件时符合成熟组件优先原则。

## GitHub 质量门禁

仓库必须维护 `.github/workflows/v1-quality.yml`，在默认分支 `main`（以及遗留的 `v1-implementation`）的 push 和 pull request 上自动运行 V1 质量门禁，并支持 `workflow_dispatch` 手动触发。

该门禁拆成并行 Windows job：前端单元/lint/typecheck、Rust check/test 并跑远程图片 live gate、Web 构建/生产启动并采集 UX 截图、按 shard 切分的 Playwright E2E。live-asset 与截图步骤放进已经需要 Node 或 Rust 的 job，避免 t=0 同时拉取 GitHub Actions marketplace。同一 runner 上的 Playwright 仍保持 1 个 worker，避免 MathJax/Mermaid 抢 CPU；并行来自不同虚拟机上的 shard。性能基准必须在上述 job 全部成功后单独执行，不得与 E2E、构建、typecheck 或 lint 并行。

该门禁至少覆盖：

- TypeScript typecheck。
- lint。
- 普通单元和集成测试。
- fixture round-trip。
- Rust check/test。
- Playwright E2E。
- 生产构建启动与 Mermaid 动态 import 渲染回归。
- 远程图片确定性 mock 与独立真实公网缓存集成测试。
- Web 构建 chunk 预算。
- 单独执行的性能基准。

已知外部限制：Vite 8 / Rolldown 复制 MathJax NewCM WOFF2（105 个）和懒加载 PlantUML TeaVM 引擎时，会在 `vite:asset` 上发出 `PLUGIN_TIMINGS`。这是打包已知大资源的拷贝成本，不是自定义插件变慢。`quality:web-build` 只豁免仅点名 `vite:asset` 的该诊断；其它插件计时警告仍失败。Vite `build.rolldownOptions.checks.pluginTimings` 关闭同一诊断，避免 `pnpm build:web` 日志被噪声淹没。后续治理：若 Rolldown 提高 asset 插件阈值或字体/引擎拷贝不再触发，收回该豁免并重新打开检查。

仓库还必须维护 `.github/workflows/windows-release-build.yml`，作为手动发布构建门禁，用于在 GitHub Windows runner 上签名生成并上传 release exe、MSI、NSIS 和 `*.sig`。该 workflow 不创建 GitHub Release；正式分发只接受 `.github/workflows/windows-release-publish.yml` 的签名发布。

任何用于 V1 发布判断的手动发布构建，都必须先运行 `pnpm release:verify-artifacts`，生成包含大小和 SHA-256 的 `lumamark-windows-artifacts.json`，并将该 manifest 作为 GitHub artifact 保留。`docs/release/WINDOWS_V1_BUILD.md` 必须记录 workflow run 链接、提交哈希、结论和 artifact 清单。没有可追溯 run 证据和 artifact manifest 时，不得把 GitHub runner 发布构建视为已验证。

Windows 本地候选包还必须运行 `pnpm release:packaged-webview`：从真实临时 Markdown 文件进入 release WebView，要求 Mermaid SVG 成功、主 CodeMirror 编辑态立即保存、Unicode 输入、`Mod-/` 往返及任务 checkbox 可访问名称通过。该自动化使用 WebView2 CDP，只证明应用内 DOM、键盘事件和真实 Rust 文件写入；它不能替代中文 IME 候选窗、系统剪贴板或 Narrator/NVDA 的前台人工检查。

## 手动测试策略

手动测试只保留在以下场景：

- 视觉审美判断。
- 新交互初次体验。
- 跨平台真实环境抽检。
- 自动化暂时无法稳定覆盖的系统行为。

凡是重复执行两次以上的手动测试，都应该转为自动化。

## Bug 策略

Bug 修复必须遵守：

1. 复现。
2. 定位根因。
3. 写失败测试。
4. 最小修复。
5. 验证。
6. 保留回归测试。

三次修复失败后必须暂停，重新审视架构或假设。
