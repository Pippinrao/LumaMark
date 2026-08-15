# ADR 0014：设置持久化下沉到 Rust 配置文件

**状态：** 已接受

**日期：** 2026-08-09

## 用途与范围

本文记录 LumaMark 应用设置从 WebView `localStorage` 迁移到 Rust 管理的 `settings.json` 的决策。范围包括存储位置、原子写入、损坏处理、与会话状态的边界、一次性迁移和回滚条件。产品分区与字段清单以 [设置系统设计](../product/SETTINGS_SYSTEM_DESIGN.md) 为准。

## 背景

本决策落地前，偏好分散在多个 localStorage key（`lumamark.app-preferences.v1`、`lumamark.reading-appearance.v1`、`lumamark.startup.v1`、`lumamark.sidebar-open.v1` 等），`copyImagesToAssets` 与 `fontZoomPercent` 仅存在于内存，重启丢失。WebView 存储会随用户清除站点数据或重装而消失，且无法被 Rust 侧工具或未来的导出/备份路径统一读取。产品因此需要单一、可迁移、可测试的设置事实源。

## 决策

- 使用单一版本化 `LumaMarkSettings`（当前 `version: 2`），由 Rust `settings_service` 读写 `app_config_dir()/settings.json`；v2 把 `updates.autoCheckOnStartup` 收入唯一设置事实源。
- `settings_get` / `settings_set` 只做 `AppHandle` 与 service 适配；schema、字段校验、默认值、原子写与损坏备份在 service 内完成。验收专用配置目录的 env/temp-root/canonical 护栏属于 command adapter 的 fail-closed 启动边界，不进入生产设置 schema。
- 写入使用现有依赖 `atomic-write-file` 做临时文件 + rename；不引入新的持久化 crate。
- 文件不存在时返回默认值且不创建文件；首次用户写入才落盘。
- JSON 解析失败时：将原文件移动为唯一的 `settings.corrupt-<timestamp>[-n].json`，原子写入默认文件并返回结构化恢复结果；同一损坏内容不在每次启动重复备份。未来 schema 版本返回 unsupported，原文件不备份、不改写。
- 前端经 `services/settings/settingsClient` 访问；`features/settings/settingsStore` 为唯一 settings 写入口。写盘 debounce，避免高频 UI 变更打满磁盘。
- store 对外暴露结构化 load/recovery/write 状态；损坏恢复保留备份路径，普通读写失败保留稳定 code，未来版本显式阻断写入。写失败保留 canonical 快照以便重试，不退化为多个含义混杂的错误布尔值。
- 应用级 close coordinator 拦截 Tauri close request，等待待写设置 flush 成功后才销毁窗口；标题栏 X、Alt+F4 与系统关闭共用该路径。flush 失败保持窗口，用户可从设置提示重试。
- `appearance.theme` 支持 `light`、`dark`、`system`；默认仍为 `light` 以保持确定性，`system` 只在消费层动态解析，不写入第二份“当前解析主题”。
- TS/Rust defaults 与 validator 的共同契约由仓库夹具自动核对，避免双语言实现漂移。
- 设置与会话状态分离：最近文件列表、`lastSession`、`recentWorkspaces`、运行时临时侧栏开合留在 localStorage；仅用户显式偏好进入 `settings.json`。
- 首启一次性迁移：仅在 Rust 明确返回配置文件不存在时读取旧 localStorage，先成功写入新配置，再写 localStorage marker。配置文件存在本身是防覆盖护栏；保存失败不写 marker，可在下次启动重试。旧 key 不删除，至少保留一个版本周期。
- 非法枚举或超范围数值回退字段默认值并上报一次可见错误，不整文件丢弃（若整文件可读但单字段非法）。
- 无版本、v0 与 v1 文档在读取时原子写回 canonical v2；未来版本在任何写回之前拒绝，前端在该次 hydration 失败后阻断 settings 待写队列，防止默认值覆盖未知版本。
- issue #13 的自动保存与应用内回收站不属于本决策；恢复草稿和 OS 回收站文件动作继续使用各自独立合同。

## 被否决方案

- 继续只用 localStorage：无法解决重启丢失与跨重装迁移，且多 store 各自序列化已造成字段遗漏。
- 把设置写入文档旁或工作区目录：设置是应用级偏好，不是文档元数据；会污染用户仓库。
- 引入完整嵌入式数据库或复杂配置中心：当前字段量小，JSON 文件足够；过度基础设施违反朴素依赖原则。
- 迁移时立即删除旧 key：剥夺回滚与对照证据。
- 损坏时静默覆盖为默认值且不备份：违反「失败模式必须显式处理」。

## 影响

- 新增 `src-tauri/src/services/settings_service.rs`、`src-tauri/src/commands/settings.rs`、前端 `settingsClient` 与 `settingsStore`。
- 既有 preference store 需收敛或改为 settings 投影；启动 hydration 改为先读 Rust 设置再应用到 DOM / i18n / 外观。
- 浏览器纯 Web 开发模式下需要可测试的 settings facade 替身（内存或 mock），不得让 unit/E2E 硬依赖真实 app config 目录。
- 自动化必须覆盖默认值、跨语言契约、往返、损坏备份、结构化错误、迁移幂等、debounce/重试与关窗 flush；Windows 打包验收必须用真实 OS 指针完成顶部主题菜单修改、立即关窗和 fresh WebView profile 重启恢复。

## 回滚与复审条件

- 若 Rust 配置读写在目标平台不稳定，可临时回退为 localStorage 适配器实现同一 `settingsClient` 接口，但必须保留错误可见性；回退需修订本文状态。
- 若产品需要多 profile / 便携模式（U 盘配置），复审路径解析与文件布局。
- 若 Markdown 门控等大量字段进入 schema，复审是否拆分文件或引入更严格的 schema 迁移框架；在那之前保持单一 JSON。
- 若原子写依赖变更，必须同步更新损坏与临时文件测试。
