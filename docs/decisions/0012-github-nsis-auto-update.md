# ADR 0012：GitHub NSIS 自动更新

**状态：** 已接受

**日期：** 2026-08-09

## 用途与范围

本文记录 Windows 应用内自动更新的发布与校验边界。范围包括官方 updater 插件、GitHub Release 静态 `latest.json`、NSIS-only 产物、minisign 密钥管理与回滚条件。不定义 macOS/Linux 更新渠道，也不定义代码签名证书或 SmartScreen 信任。

## 背景

LumaMark Windows 分发以 NSIS 安装器为主。用户需要在应用内检查并安装更新，而不必手动打开 GitHub Release 页面。更新链路必须可签名校验、可回滚，并符合成熟组件优先原则。

## 决策

采用官方 `tauri-plugin-updater` + `@tauri-apps/plugin-updater`：

1. 更新源为 GitHub Release 静态文件 `latest.json`（`releases/latest/download/latest.json`），不依赖运行时拼装 GitHub API。
2. 发布产物仅考虑 Windows NSIS：`LumaMark_{version}_x64-setup.exe` 与同名 `.sig`。
3. 使用 minisign 签名校验；公钥写入 `src-tauri/tauri.conf.json`，私钥与口令保存在 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。
4. 应用层通过 `src/services/updater/` 封装插件；UI 落在 `src/features/updates/`，不在业务组件直接依赖插件对象。
5. 新增 tag 触发的 `.github/workflows/windows-release-publish.yml`：校验 tag 与版本一致、签名构建 NSIS、生成 `latest.json` 并创建 GitHub Release。

## 被否决方案

- **自研 GitHub Releases API + 启动 NSIS：** 缺少官方签名校验与安装生命周期，违反成熟组件优先原则，也会把平台细节泄漏进 features。
- **仅发布 MSI 或同时主推 MSI：** 产品发布策略已定为 NSIS-only。
- **强制静默升级：** 不符合长时间写作场景下的可预测交互；用户必须确认后再安装。

## 影响

- 依赖新增：`tauri-plugin-updater`、`@tauri-apps/plugin-updater`。
- capability 增加 `updater:default`。
- 发布必须提供签名私钥；丢失私钥会使已安装用户无法继续收到签名更新。
- 绿色版 / 未安装路径不保证可更新；失败必须给出明确、可本地化错误文案。
- 国内直连 GitHub 可能不稳定；后续可通过追加 `endpoints` 镜像缓解，无需改业务代码。

## 回滚与复审条件

- 紧急停更：取消有问题的 GitHub Release 的 latest 标记，或从 Release 移除 `latest.json`；客户端检查失败并显示错误，不会强制安装。
- 若官方 updater 在 Windows NSIS 路径出现不可接受的安装失败率，先关闭自动检查并回退到手动下载 Release。
- 需要多渠道（beta/stable）或非 GitHub 主源时，复审 endpoint 与发布契约。
- 若改为代码签名证书驱动的更新链路，需新 ADR。
