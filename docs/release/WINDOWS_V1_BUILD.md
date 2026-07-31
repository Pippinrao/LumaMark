# Windows V1 构建记录

本文件记录 LumaMark V1 alpha 在 Windows 上的构建方式、产物和发布缺口。

> **历史记录：** 下列分支、版本号、文件大小与 SHA-256 只描述对应 Alpha 构建，不能当作当前工作树的发布产物。Parity Reliability 只有在当前执行计划的自动化门禁、Windows 实测和真实自用退出条件全部满足后，才具备 Beta 候选资格；一次本地 `pnpm build` 成功不等于已发布。

## 0.2.0 NSIS-only Release

- 日期：2026-08-01
- 平台：Windows x64
- 分支：`v1-implementation`
- 发布范围：GitHub Release 只上传 NSIS 安装器；本地同时生成 exe 和 MSI，仅用于现有产物一致性门禁。

最终发布产物：

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---:|---|
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LumaMark_0.2.0_x64-setup.exe` | 4,654,352 bytes | `cf990ae5c7f9b35ccaae8f8dba2d455079a6e54f408df2fee69115ec515ca1ae` |

新鲜自动化验证：

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`：65 个测试文件、605 项测试通过。
- `pnpm test:fixtures`：2 个测试文件、6 项 round-trip 测试通过。
- `pnpm download:markdown-corpus` 和 `pnpm test:markdown-corpus`：解析 6 个语料文件、646,256 bytes。
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`：81 项 Rust 测试通过。
- `pnpm quality:v1-ux-prototype`：2 项通过。
- `pnpm quality:v1-ux-screenshots`：生成 6 张审查截图，且在 `NODE_OPTIONS=--throw-deprecation` 下无 warning。
- `pnpm test:e2e`：131 项 Playwright 测试通过。
- `pnpm test:live-assets`：公网 PNG/SVG 和 Rust 真实下载缓存测试通过。
- `pnpm quality:web-build`
- `pnpm test:e2e:production`：生产 bundle 启动和懒加载 Mermaid 回归通过。
- `pnpm perf:bench`：6 个测试文件、23 项独立性能基准通过。
- `pnpm release:packaged-webview`：Release 构建、真实文件保存、中文输入、任务复选框可访问性、Mermaid active-save 和显示模式往返全部通过。
- `pnpm release:verify-artifacts`：0.2.0 exe、MSI、NSIS 均存在并生成 SHA-256 清单。
- `pnpm release:installer-smoke:plan`：确认 NSIS 路径、临时安装目录、无需管理员权限及 3 秒启动计划。

Windows 桌面真人式抽检使用本轮新编译的 Release exe，并采用隔离的临时 WebView2 数据目录；验证了中英文 Markdown 输入、引用内和普通任务复选框、点击与空格复切、源码/所见即所得往返、Mermaid 渲染、系统另存为对话框和真实文件落盘。保存后的 13 行 Markdown 对标题、引用任务、普通任务、完成任务、Mermaid 与中文文本的断言全部通过；测试文件和临时 WebView2 数据随后已清理，现有正式安装窗口未被修改。

NSIS 包体使用 7-Zip 24.08 识别为 NSIS 3 Unicode/LZMA 并通过完整性测试；解出的 `lumamark.exe` 为 13,838,336 bytes，FileVersion 和 ProductVersion 均为 `0.2.0`，且可启动 WebView2 调试端点、无 stderr。由于本机已经存在并正在运行 `C:\Users\pippin\AppData\Local\LumaMark` 正式安装，安全脚本拒绝覆盖同一 HKCU 安装/卸载注册表；本轮没有执行宿主机上的静默安装→卸载 smoke，也不把包体解压与 payload 启动等同于该路径已通过。

本版本仍未代码签名，Windows SmartScreen 和发布者信任提示属于已知分发风险。

## 构建环境

- 日期：2026-07-05
- 平台：Windows
- 分支：`v1-task9-v1-convergence`
- 构建入口：`pnpm build`
- 实际执行：`tauri build`，并在构建前执行 `pnpm build:web`

## 0.1.2 NSIS-only Release

本次发布只生成并上传 NSIS 安装器，不发布 MSI 或裸 exe 资产。

构建命令：

```powershell
pnpm exec tauri build --bundles nsis
```

发布产物：

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---:|---|
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LumaMark_0.1.2_x64-setup.exe` | 3,275,232 bytes | `3bdabee7e1c66f5af1c47a2f01437e8f5fc7989e0d1a6491f6828e55ccf1d9f3` |

本次发布前验证：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:fixtures`
- `pnpm perf:bench`
- `pnpm test:e2e`
- `pnpm quality:web-build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm release:packaged-webview`
- `pnpm release:installer-smoke:plan`
- `pnpm release:installer-smoke:nsis`

NSIS 安装器 smoke 结果：静默安装到临时目录、启动安装后的 `lumamark.exe` 并保持 3 秒、静默卸载，全部通过。

## 产物

`pnpm build` 已成功生成 Windows release 可执行文件和安装器：

| 产物 | 路径 | 大小 |
|---|---|---:|
| Windows 可执行文件 | `src-tauri/target/release/lumamark.exe` | 10,396,672 bytes |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/LumaMark_0.1.0_x64_en-US.msi` | 4,161,536 bytes |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe` | 3,152,794 bytes |

## GitHub 手动构建

已新增手动触发的 GitHub Actions workflow：

```powershell
gh workflow run "Windows Release Build" --repo Pippinrao/LumaMark --ref v1-implementation
```

workflow 文件：`.github/workflows/windows-release-build.yml`。

该 workflow 在 `windows-latest` runner 上执行 `pnpm build`，并上传以下构建产物：

- `src-tauri/target/release/lumamark.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*setup.exe`
- `src-tauri/target/release/lumamark-windows-artifacts.json`

其中 `lumamark-windows-artifacts.json` 由以下命令生成：

```powershell
pnpm release:verify-artifacts
```

该命令会检查 Windows release 可执行文件、MSI 安装包和 NSIS 安装包是否存在、是否非空，并记录每个产物的大小和 SHA-256。

已执行 GitHub 手动构建验证：

| 项目 | 结果 |
|---|---|
| Workflow run | <https://github.com/Pippinrao/LumaMark/actions/runs/28725030218> |
| 触发分支 | `v1-implementation` |
| 提交 | `8dff55e8059327a8dcf72bbe56b53b644eb4df27` |
| 状态 | `success` |

GitHub artifact 记录如下，大小为 GitHub artifact 压缩包大小。该 run 执行于 artifact manifest 接入前，因此只包含三个二进制产物：

| Artifact | 大小 |
|---|---:|
| `lumamark-windows-release-exe` | 3,929,225 bytes |
| `lumamark-windows-msi` | 3,882,214 bytes |
| `lumamark-windows-nsis` | 3,065,781 bytes |

这条 workflow 只证明 Windows release 可执行文件和安装器可以在 GitHub runner 上构建并作为 artifact 保留，不执行安装、卸载或安装后启动 smoke。

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

## 安装器 Smoke

已新增可重复执行的 Windows 安装器 smoke 脚本：

```powershell
pnpm release:installer-smoke:plan
pnpm release:installer-smoke:nsis
```

脚本位置：`scripts/release/windows-installer-smoke.ps1`。

默认策略：

- `release:installer-smoke:plan` 只输出 JSON 计划，不安装、不卸载、不启动应用。
- `release:installer-smoke:nsis` 运行 NSIS 用户级静默安装 smoke。
- NSIS smoke 会安装到系统临时目录下的 `lumamark-installer-smoke\nsis`，启动安装后的 `lumamark.exe` 并保持 3 秒，然后静默卸载。
- 脚本会拒绝临时 smoke 目录之外的安装路径，避免清理或覆盖非测试安装。
- 脚本会检测现有 LumaMark 安装；若发现安装路径不在 smoke 临时目录下，会拒绝执行真实安装器 smoke。
- MSI smoke 只能通过 `-InstallerKind Msi` 显式选择；由于当前 MSI 是 `perMachine`，真实执行需要管理员 PowerShell。

本轮已自动化安装器 smoke 入口，并用测试覆盖 plan 和路径安全校验；真实 NSIS 安装/卸载 smoke 需项目所有者明确授权后执行。

## 本轮修复

- `src-tauri/tauri.conf.json` 显式配置了 `bundle.icon`，使用现有 `src-tauri/icons/icon.ico` 等图标资源，修复 Windows bundling 阶段的 `Couldn't find a .ico icon` 错误。
- `identifier` 从 `com.lumamark.app` 调整为 `com.lumamark.desktop`，避免 Tauri 对 `.app` 后缀的跨平台警告。

## 已知发布缺口

- 产物尚未签名。V1 alpha 可以本地安装测试，但公开分发前需要补代码签名、证书管理和发布校验。
- NSIS 安装、卸载、安装后启动 smoke 已有自动化脚本入口，但本轮尚未执行真实安装器 smoke。
- MSI 安装、卸载、安装后启动 smoke 需要管理员权限；本轮只提供显式可选入口，未执行真实 MSI smoke。
- GitHub 手动构建 workflow 已在 run `28725030218` 证明可生成并上传 release exe、MSI 和 NSIS 产物；真实安装器 smoke 仍需授权后执行。
- `identifier` 一旦进入公开分发应保持稳定；后续变更会影响安装身份、升级身份和应用数据路径。
- Web 构建已新增 `pnpm quality:web-build` chunk 门禁，首屏入口和动态 chunk 预算均通过；Mermaid/KaTeX/Cytoscape 等重依赖已从首屏入口拆出。
- 本轮只验证 Windows 构建。macOS 和 Linux 保持架构兼容，不作为 V1 alpha 发布门禁。

## V1 完成定义检查

| 检查项 | 当前证据 | 状态 |
|---|---|---|
| P0 能力 | 打开、编辑、保存、基础 WYSIWYG、Mermaid、i18n、性能和 fixture 均有自动化覆盖 | 通过 |
| P1 核心体验 | 工作区文件树、大纲、命令面板、设置页、状态栏、Windows 构建均已落地 | 通过 |
| 应用可启动 | `pnpm test:e2e` 覆盖 Web shell；release exe smoke 证明 `lumamark.exe` 可启动并保持 3 秒 | 通过 |
| Windows 安装产物生成 | `pnpm build` 生成 MSI 和 NSIS 安装器；GitHub run `28725030218` 在 `windows-latest` 上传 exe、MSI 和 NSIS artifacts | 通过 |
| Windows 安装后启动 | `scripts/release/windows-installer-smoke.ps1` 已提供 NSIS 自动 smoke 和 MSI 可选 smoke；真实安装器 smoke 待授权执行 | 尚未覆盖 |
| 中文和英文可切换 | `tests/e2e/v1-workflow.spec.ts` 覆盖设置页切换到 English | 通过 |
| 亮色和暗色可切换 | `tests/e2e/v1-workflow.spec.ts` 断言 `html[data-theme="dark"]` | 通过 |
| CodeMirror 6 是唯一主编辑核心 | `src/editor/core/*` 为唯一编辑器初始化入口；未引入其他编辑核心 | 通过 |
| React store 不持有 Markdown 全文 | `src/features/file-actions/fileActions.test.ts` 断言打开后 state 不包含源码 | 通过 |
| 打开 `.md` 文件 | Rust file service、file action 单测、V1 workflow E2E 覆盖打开路径 | 通过 |
| 保存当前文件 | file action 单测、fixture round-trip、V1 workflow E2E 覆盖保存路径 | 通过 |
| 另存为 | `src/features/file-actions/fileActions.test.ts` 覆盖 dialog path 和保存状态；`tests/e2e/v1-workflow.spec.ts` 覆盖 UI 另存为后当前文件切换到新路径，后续普通保存继续写入新文件 | 通过 |
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
| Web 构建 chunk 预算 | `pnpm quality:web-build` 覆盖 Vite warning-free 构建、首屏入口 JS 小于 120 KiB、任意 JS chunk 小于 700 KiB | 通过 |
| E2E 覆盖 V1 关键路径 | `tests/e2e/v1-workflow.spec.ts` 覆盖打开、编辑、保存、另存为、reload 后重开、Mermaid、语言、主题 | 通过 |
| fixture round-trip 无无关 diff | `pnpm test:fixtures` | 通过 |
| 中文和英文核心文案覆盖 | `src/shared/i18n/i18n.test.ts` 覆盖核心 key；E2E 覆盖语言切换 | 通过 |
| 已知数据损坏风险 | Rust atomic write 测试、fixture round-trip、file action dirty 测试覆盖基础保存风险 | 未发现阻塞风险 |
