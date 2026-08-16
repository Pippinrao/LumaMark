# ADR 0012：GitHub NSIS 自动更新

**状态：** 已接受

**日期：** 2026-08-09

**更新：** 2026-08-13（Windows 当前用户手动系统代理边界）

## 用途与范围

本文记录 Windows x64 应用内自动更新的发布、校验与网络代理边界。范围包括官方 updater 插件、GitHub Release 静态 `latest.json`、NSIS-only 产物、minisign 密钥管理、当前用户的单一手动系统代理与回滚条件。不定义 macOS/Linux 更新渠道，也不定义代码签名证书或 SmartScreen 信任。

## 背景

LumaMark Windows 分发以 NSIS 安装器为主。用户需要在应用内检查并安装更新，而不必手动打开 GitHub Release 页面。更新链路必须可签名校验、可回滚，并符合成熟组件优先原则。

## 决策

采用官方 `tauri-plugin-updater` + `@tauri-apps/plugin-updater`：

1. 更新源为 GitHub Release 静态文件 `latest.json`（`releases/latest/download/latest.json`），不依赖运行时拼装 GitHub API。
2. 发布产物仅考虑 Windows NSIS：`LumaMark_{version}_x64-setup.exe` 与同名 `.sig`。
3. 使用 minisign 签名校验；公钥写入 `src-tauri/tauri.conf.json`，私钥与口令保存在 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。
4. 应用层通过 `src/services/updater/` 封装插件；UI 落在 `src/features/updates/`，不在业务组件直接依赖插件对象。
5. 新增 tag 触发的 `.github/workflows/windows-release-publish.yml`：校验 tag 与版本一致、签名构建 NSIS、生成 `latest.json` 并创建 GitHub Release。Windows CI 产出的 NSIS 必须经同一套 GitHub Secrets 签名；本地未签名安装包只可用于本机验收，不得作为正式分发或 updater 产物。
6. Windows target 通过 Cargo feature union 为官方 updater 实际使用的 `reqwest 0.13.4` 启用 `system-proxy`；不修改 `updaterService.ts`、UI、IPC 或安装流程。

### Windows 代理支持边界

Windows x64 NSIS updater 的代理选择遵循以下边界：

1. `HTTP_PROXY` / `HTTPS_PROXY` 的对应协议设置优先于 Windows Internet Settings；`NO_PROXY` 仍参与绕过，且配置了环境变量绕过规则时，系统 `ProxyOverride` 不会覆盖它。
2. 对应协议未由 `HTTP_PROXY` / `HTTPS_PROXY` 决定时，支持读取当前用户 Windows Internet Settings 中启用的单一手动代理：`ProxyEnable`、简单的 `ProxyServer`（单一 `host:port` 端点）以及普通 `ProxyOverride` 主机绕过列表。
3. `ALL_PROXY` 仅在对应协议代理不存在时作为 fallback；这里的对应协议代理包括 Windows Internet Settings 填入的系统值，因此系统手动代理可以优先于 `ALL_PROXY`。
4. 本次不承诺 PAC / `AutoConfigURL`、WPAD / 自动检测、`netsh winhttp` 的 WinHTTP 代理、`ProxyServer` 的分协议复杂格式、`<local>` 的完整 Windows 语义，或 NTLM / Kerberos 企业集成认证。需要这些能力时必须重新评估官方依赖支持，不在应用层自行解析注册表或实现代理栈。

为确保 feature union 作用在官方 updater 当前实际解析到的同一个 crate 上，Windows target dependency 将 `reqwest` 精确固定为 `=0.13.4`，关闭默认 features，并只显式请求 `system-proxy`。`pnpm quality:updater-proxy` 使用 locked、`x86_64-pc-windows-msvc` 过滤的 `cargo metadata` 验证 updater 只有一个直接 `reqwest`、版本仍为 `0.13.4`、resolved features 包含 `system-proxy`，且对应 `hyper-util` 包含 `client-proxy-system`。升级 updater 后若它切换 `reqwest` 版本或依赖路径，门禁必须 fail-closed，先复审再调整精确版本。

## 被否决方案

- **自研 GitHub Releases API + 启动 NSIS：** 缺少官方签名校验与安装生命周期，违反成熟组件优先原则，也会把平台细节泄漏进 features。
- **仅发布 MSI 或同时主推 MSI：** 产品发布策略已定为 NSIS-only。
- **强制静默升级：** 不符合长时间写作场景下的可预测交互；用户必须确认后再安装。
- **在应用层自行读取注册表或实现 PAC/企业代理：** 会复制成熟 HTTP 栈能力、扩大凭据与平台兼容风险；当前只启用官方依赖已提供的最小系统代理路径。

## 影响

- 依赖新增：`tauri-plugin-updater`、`@tauri-apps/plugin-updater`。
- capability 增加 `updater:default`。
- Windows x64 updater 下载可使用当前用户已启用的简单手动系统代理；`HTTP_PROXY` / `HTTPS_PROXY` 的对应协议配置仍优先；完整优先级见上文。
- Windows target 新增精确 `reqwest 0.13.4` feature-union 依赖；其版本必须与官方 updater 实际依赖保持一致，并由 CI metadata 门禁保护。
- 发布必须提供签名私钥；丢失私钥会使已安装用户无法继续收到签名更新。
- 绿色版 / 未安装路径不保证可更新；失败必须给出明确、可本地化错误文案。
- 国内直连 GitHub 可能不稳定；后续可通过追加 `endpoints` 镜像缓解，无需改业务代码。

## 回滚与复审条件

- 紧急停更：取消有问题的 GitHub Release 的 latest 标记，或从 Release 移除 `latest.json`；客户端检查失败并显示错误，不会强制安装。
- 若官方 updater 在 Windows NSIS 路径出现不可接受的安装失败率，先关闭自动检查并回退到手动下载 Release。
- 需要多渠道（beta/stable）或非 GitHub 主源时，复审 endpoint 与发布契约。
- 需要 PAC/WPAD、WinHTTP、复杂分协议代理、完整 `<local>` 语义或 NTLM/Kerberos 时，复审网络栈与凭据边界。
- 升级 `tauri-plugin-updater` 导致 metadata 门禁发现 `reqwest` 版本或依赖关系变化时，重新核对官方 feature graph 后再修改精确版本，禁止仅放宽门禁。
- 若改为代码签名证书驱动的更新链路，需新 ADR。
