# Windows V1 构建记录

本文件记录 LumaMark V1 alpha 在 Windows 上的构建方式、产物和发布缺口。

> **历史记录：** 下列分支、版本号、文件大小与 SHA-256 只描述对应 Alpha 构建，不能当作当前工作树的发布产物。Parity Reliability 只有在当前执行计划的自动化门禁、Windows 实测和真实自用退出条件全部满足后，才具备 Beta 候选资格；一次本地 `pnpm build` 成功不等于已发布。

## 自动更新发布（NSIS + GitHub Release）

当前正式发布路径：

1. 确认 `package.json` / `Cargo.toml` / `tauri.conf.json` 版本一致。
2. 确认 GitHub Secrets 已配置：
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（无口令时可为空）
3. 打 tag 并推送，例如 `git tag v0.2.17 && git push origin v0.2.17`。
4. `.github/workflows/windows-release-publish.yml` 会：
   - 校验 tag 与 `package.json` 版本一致
   - 注入签名密钥后执行 `pnpm build:nsis`
   - 生成 `latest.json`
   - 创建 GitHub Release，并上传：
     - `LumaMark_{version}_x64-setup.exe`
     - `LumaMark_{version}_x64-setup.exe.sig`
     - `latest.json`

应用内 updater endpoint：

```text
https://github.com/Pippinrao/LumaMark/releases/latest/download/latest.json
```

`latest.json` 契约（静态清单）：

```json
{
  "version": "0.2.17",
  "notes": "",
  "pub_date": "2026-08-09T00:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/Pippinrao/LumaMark/releases/download/v0.2.17/LumaMark_0.2.17_x64-setup.exe"
    }
  }
}
```

本地生成清单：

```powershell
pnpm release:generate-updater-manifest
```

密钥管理：

- 公钥写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 私钥只存 GitHub Secrets / 离线保险位置；丢失后已安装用户无法继续接收签名更新。
- 粘贴私钥到 GitHub Secrets 时避免带 UTF-8 BOM；发布 workflow 会清洗 BOM，但密钥本身仍须是 `tauri signer generate` 产出的合法内容。
- 私钥文件不得提交仓库；`.gitignore` 已忽略 `*.key` / `*.key.pub`。

回滚：

- 删除或取消标记有问题的 GitHub Release，使 `latest` 回退到上一版。
- 如需紧急停用自动更新，可临时从 Release 移除 `latest.json`；已安装客户端会检查失败并显示错误，而不会强制安装。

手动全量构建校验仍使用 `.github/workflows/windows-release-build.yml`（上传 exe/MSI/NSIS artifacts，不创建 Release）。

## 0.2.3 NSIS-only 发布候选

- 日期：2026-08-05
- 平台：Windows x64
- 分支：`main`
- 目标发布标签：`v0.2.3`
- 发布策略：候选通过全部门禁后，GitHub Release 仅上传 NSIS 安装器；裸 exe、MSI 和本地产物清单用于一致性门禁。

候选产物：

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---:|---|
| Windows 可执行文件 | `src-tauri/target/release/lumamark.exe` | 13,857,792 bytes | `2e7bc99ccddf3eabfd6b443dcc362b5fe99c51fe452a036eb84514ba29cebc42` |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/LumaMark_0.2.3_x64_en-US.msi` | 6,041,600 bytes | `26f8d2cbe9208dbf8bce402148ec237023bb97292e9749f63ed2374979b353da` |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LumaMark_0.2.3_x64-setup.exe` | 4,650,095 bytes | `5ac67fa71530271520480158af94b3bf45ba15cb24f9b3b7686db6da4f3a6c87` |

本版本完成并验收 GitHub Issues #1–#6：媒体全屏查看与缩放、完整菜单与精确快捷键、阅读宽度和平台主修饰键缩放、启动页与单文件恢复体验、活动 Markdown 源码标记视觉，以及格式化、折行和不等宽表格中的稳定光标映射。验收补丁还覆盖语言切换时现有媒体、搜索面板和任务复选框的原地重标、启动偏好持久化错误的可见反馈，以及启动页后的真实 E2E 交互。

新鲜自动化验证：

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`：81 个测试文件、745 项测试通过。
- `pnpm test:fixtures`：2 个测试文件、6 项 round-trip 测试通过。
- `pnpm download:markdown-corpus` 和 `pnpm test:markdown-corpus`：解析 6 个语料文件、646,256 bytes。
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`：81 项 Rust 测试通过；公网 Rust 测试由专用门禁单独执行。
- `pnpm quality:v1-ux-prototype`：2 项通过。
- `NODE_OPTIONS=--throw-deprecation pnpm quality:v1-ux-screenshots`：生成 6 张截图，无弃用 warning。
- `pnpm test:e2e -- --workers=1`：156 项 Playwright 测试通过。
- `pnpm test:live-assets:public`：公网 PNG 和 SVG 内容、MIME 与签名校验通过；首次组合命令遇到一次外部 Wikimedia TLS `ECONNRESET`，原子命令重跑即通过。
- `pnpm test:live-assets:rust`：1 项真实下载和缓存测试通过。
- `pnpm quality:web-build`
- `pnpm test:e2e:production`：2 项生产 bundle 测试通过。
- `pnpm perf:bench`：6 个测试文件、23 项独立性能基准通过；10MB 文档加载 77.49 ms、输入 p80 1.07 ms。
- `pnpm release:packaged-webview`：0.2.3 Release 构建和真实打包 WebView 验证通过。
- `pnpm release:verify-artifacts`：本地 0.2.3 exe、MSI、NSIS 均存在，大小和 SHA-256 与上表一致。
- `pnpm release:installer-smoke:plan`：确认 NSIS 安装器存在、目标为隔离临时目录且无需管理员权限。

打包 WebView 验证覆盖应用启动、Mermaid 活跃编辑保存、编辑器输入、显示模式往返、页面宽度持久化、会话缩放重置、任务复选框可访问性和 Unicode 输入；外观布局恢复耗时 19.1 ms。

本机已有 `C:\Users\pippin\AppData\Local\LumaMark` 安装，安全脚本按设计拒绝运行可能影响现有安装注册信息的 NSIS 静默安装/卸载 smoke；本轮未绕过保护。MSI 管理员安装 smoke 同样未执行。

本版本仍未代码签名，Windows SmartScreen 和发布者信任提示属于已知分发风险。

## 0.2.1 NSIS-only Release

- 日期：2026-08-03
- 平台：Windows x64
- 分支：`v1-implementation`
- 发布提交：`20accc2d9e0a97ab410126efc817c07dbb9ec816`
- Windows runner：[Windows Release Build 30757679582](https://github.com/Pippinrao/LumaMark/actions/runs/30757679582)（`success`）
- 发布范围：GitHub Release 只上传由上述 runner 生成的 NSIS 安装器；exe、MSI 和 manifest 作为 workflow artifacts 保留。

最终发布产物：

| 产物 | 路径 | 大小 | SHA-256 |
|---|---|---:|---|
| NSIS 安装包 | `LumaMark_0.2.1_x64-setup.exe` | 4,656,736 bytes | `6a003c9e3c798e991a820a345c0a5d5cecab6992a75e5498aebdeae6c4337efb` |

本版本将应用菜单重构为 Typora-like 的 File、Edit、Paragraph、Format、View、Help 六组菜单，补齐可执行命令、禁用态、嵌套菜单、键盘导航、菜单快捷键、About 对话框和中英文文案，并同步更新竞品分析与视觉验证截图。

新鲜自动化验证：

- `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`：68 个测试文件、637 项测试通过。
- `pnpm test:fixtures`：2 个测试文件、6 项 round-trip 测试通过。
- `pnpm download:markdown-corpus` 和 `pnpm test:markdown-corpus`：解析 6 个语料文件、646,256 bytes。
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`：81 项 Rust 测试通过，1 项显式忽略的公网测试由 `pnpm test:live-assets` 单独执行并通过。
- `pnpm quality:v1-ux-prototype`：2 项通过。
- `pnpm quality:v1-ux-screenshots`：生成 6 张审查截图，且在 `NODE_OPTIONS=--throw-deprecation` 下无 warning。
- `pnpm test:e2e -- --workers=1`：137 项 Playwright 测试通过。
- `pnpm test:live-assets`：公网 PNG/SVG 和 Rust 真实下载缓存测试通过。
- `pnpm quality:web-build`
- `pnpm test:e2e:production`：2 项生产 bundle 测试通过，覆盖菜单键盘操作与懒加载 Mermaid。
- `pnpm perf:bench`：6 个测试文件、23 项独立性能基准通过。
- `pnpm release:packaged-webview`：Release 构建和真实打包 WebView 验证通过，生成 exe、MSI 和 NSIS。
- `pnpm release:verify-artifacts`：本地 0.2.1 exe、MSI、NSIS 均存在并生成 SHA-256；GitHub runner manifest 与下载后的最终 NSIS 哈希一致。
- `pnpm release:installer-smoke:plan`：确认 NSIS 安装器存在、目标为隔离临时目录且无需管理员权限。

本地 Release 候选也通过真实打包 WebView 启动与文件保存验证。本机已有 `C:\Users\pippin\AppData\Local\LumaMark` 安装，安全脚本按设计拒绝运行可能影响现有安装注册信息的静默安装/卸载 smoke，因此该项未执行；MSI 的管理员安装 smoke 同样未执行。

本版本仍未代码签名，Windows SmartScreen 和发布者信任提示属于已知分发风险。

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
