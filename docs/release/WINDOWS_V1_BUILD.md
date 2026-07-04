# Windows V1 构建记录

本文件记录 LumaMark V1 alpha 在 Windows 上的构建方式、产物和发布缺口。

## 构建环境

- 日期：2026-07-05
- 平台：Windows
- 分支：`v1-task9-v1-convergence`
- 构建入口：`pnpm build`
- 实际执行：`tauri build`，并在构建前执行 `pnpm build:web`

## 产物

`pnpm build` 已成功生成 Windows release 可执行文件和安装器：

| 产物 | 路径 | 大小 |
|---|---|---:|
| Windows 可执行文件 | `src-tauri/target/release/lumamark.exe` | 10,396,672 bytes |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/LumaMark_0.1.0_x64_en-US.msi` | 4,161,536 bytes |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe` | 3,152,794 bytes |

## 启动 Smoke

已执行 release 可执行文件启动 smoke：

```powershell
$exe = Resolve-Path 'src-tauri\target\release\lumamark.exe'
$process = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$process.Refresh()
$started = -not $process.HasExited
if ($started) { Stop-Process -Id $process.Id -Force }
```

结果：`release exe started and stayed alive for 3 seconds`。

这个 smoke 证明 release exe 可以启动并保持运行；它不等同于 MSI/NSIS 安装后启动验证。

## 本轮修复

- `src-tauri/tauri.conf.json` 显式配置了 `bundle.icon`，使用现有 `src-tauri/icons/icon.ico` 等图标资源，修复 Windows bundling 阶段的 `Couldn't find a .ico icon` 错误。
- `identifier` 从 `com.lumamark.app` 调整为 `com.lumamark.desktop`，避免 Tauri 对 `.app` 后缀的跨平台警告。

## 已知发布缺口

- 产物尚未签名。V1 alpha 可以本地安装测试，但公开分发前需要补代码签名、证书管理和发布校验。
- MSI/NSIS 安装、卸载、安装后启动 smoke 尚未在自动化中执行。本轮证据覆盖安装器生成和 release exe 启动。
- `identifier` 一旦进入公开分发应保持稳定；后续变更会影响安装身份、升级身份和应用数据路径。
- 构建仍有 Vite 大 chunk 警告；不影响安装器生成，但后续需要继续拆分 Mermaid/KaTeX/Cytoscape 等重依赖。
- 本轮只验证 Windows 构建。macOS 和 Linux 保持架构兼容，不作为 V1 alpha 发布门禁。

## V1 完成定义检查

| 检查项 | 当前证据 | 状态 |
|---|---|---|
| P0 能力 | 打开、编辑、保存、基础 WYSIWYG、Mermaid、i18n、性能和 fixture 均有自动化覆盖 | 通过 |
| P1 核心体验 | 工作区文件树、大纲、命令面板、设置页、状态栏、Windows 构建均已落地 | 通过 |
| 应用可启动 | `pnpm test:e2e` 覆盖 Web shell；release exe smoke 证明 `lumamark.exe` 可启动并保持 3 秒 | 通过 |
| Windows 安装产物生成 | `pnpm build` 生成 MSI 和 NSIS 安装器 | 通过 |
| Windows 安装后启动 | 本轮未执行 MSI/NSIS 安装 smoke | 尚未覆盖 |
| 中文和英文可切换 | `tests/e2e/v1-workflow.spec.ts` 覆盖设置页切换到 English | 通过 |
| 亮色和暗色可切换 | `tests/e2e/v1-workflow.spec.ts` 断言 `html[data-theme="dark"]` | 通过 |
| CodeMirror 6 是唯一主编辑核心 | `src/editor/core/*` 为唯一编辑器初始化入口；未引入其他编辑核心 | 通过 |
| React store 不持有 Markdown 全文 | `src/features/file-actions/fileActions.test.ts` 断言打开后 state 不包含源码 | 通过 |
| 打开 `.md` 文件 | Rust file service、file action 单测、V1 workflow E2E 覆盖打开路径 | 通过 |
| 保存当前文件 | file action 单测、fixture round-trip、V1 workflow E2E 覆盖保存路径 | 通过 |
| 另存为 | `src/features/file-actions/fileActions.test.ts` 覆盖 dialog path 和保存状态；可继续追加 UI 级 E2E | 通过 |
| 保存无无关 diff | `pnpm test:fixtures` | 通过 |
| dirty 状态准确 | `src/features/file-actions/fileActions.test.ts` 覆盖成功、失败、保存中修改 | 通过 |
| 基础 WYSIWYG | `tests/e2e/editor-markdown.spec.ts` 和 decoration 单测覆盖标题、强调、列表、任务、代码等 | 通过 |
| 任务列表 checkbox 可修改源码 | `tests/e2e/editor-markdown.spec.ts` 覆盖点击和撤销 | 通过 |
| Mermaid fenced block 可异步渲染 | `tests/e2e/mermaid.spec.ts` 和 scheduler 单测 | 通过 |
| Mermaid 错误不影响编辑 | Mermaid scheduler/widget 单测覆盖错误恢复路径；E2E 覆盖正常渲染 | 通过 |
| 文件树可用 | `src/features/file-tree/FileTree.test.tsx` 覆盖懒加载去重；Task 8 E2E 覆盖外壳入口 | 通过 |
| 大纲可用 | `src/features/outline/outlineParser.test.ts` 和 `useDebouncedOutline.test.tsx` | 通过 |
| 命令面板可用 | `tests/e2e/app-shell.spec.ts` 覆盖打开命令面板并触发保存命令 | 通过 |
| 基础设置页可用 | `tests/e2e/v1-workflow.spec.ts` 覆盖语言和主题切换 | 通过 |
| 1MB 和 5MB 文件编辑顺畅 | `pnpm perf:bench` 自动化门禁覆盖读取、文件动作打开、编辑器载入和尾部输入 | 通过 |
| 10MB 文件不冻结 | `tests/perf/editorLargeDocument.bench.test.ts`、`openFileActionLargeDocument.bench.test.ts` 和 `outlinePanelLargeDocument.bench.test.tsx` 覆盖打开、debounce 后大纲刷新、虚拟化大纲渲染和尾部输入 | 通过 |
| E2E 覆盖 V1 关键路径 | `tests/e2e/v1-workflow.spec.ts` 覆盖打开、编辑、保存、reload 后重开、Mermaid、语言、主题 | 通过 |
| fixture round-trip 无无关 diff | `pnpm test:fixtures` | 通过 |
| 中文和英文核心文案覆盖 | `src/shared/i18n/i18n.test.ts` 覆盖核心 key；E2E 覆盖语言切换 | 通过 |
| 已知数据损坏风险 | Rust atomic write 测试、fixture round-trip、file action dirty 测试覆盖基础保存风险 | 未发现阻塞风险 |
