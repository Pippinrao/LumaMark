> 语言：**中文** · [English](../../decisions/0009-desktop-file-open-bridge.md)

# ADR 0009：桌面文件打开与多窗口路由

**状态：** 已接受

**日期：** 2026-08-05（2026-08-15 更新）

## 用途与范围

本文定义 LumaMark 从操作系统启动参数、文件关联和二次实例请求打开 Markdown 文件时的持久交接、文档身份、窗口所有权与路由边界。范围包括 `multiWindow` / `aggregateWindow`、动态 Tauri 窗口、崩溃恢复、exactly-once 生命周期和隔离的 Windows 路由验收；不引入页内 tabs，也不改变 Markdown 正文由 CodeMirror 独占的原则。

## 背景

桌面打开不是一次可丢失的 UI 事件。新窗口可能尚未 mount，目标窗口可能在请求完成确认前崩溃，别名路径也可能指向同一文件。只发事件或只看 live window 都会造成请求丢失、重复打开或同一文档被两个窗口同时编辑。

Tauri 的 single-instance callback 是同步入口。官方 [`WebviewWindowBuilder` known issues](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#known-issues) 明确指出，在 Windows 的同步 command/event handler 中直接创建 WebView 可能死锁，因此 callback 不能解析文件、读取设置、访问持久状态或创建窗口。

## 决策

- 使用官方 `tauri-plugin-single-instance`，并严格把它注册为第一个 Tauri plugin；这是该插件保证 secondary 在其他 plugin setup 前退出的上游合同。builder 预先 manage 一个不读写配置的 readiness gate，single-instance 之后才注册专用 open-request state plugin；该 plugin 只初始化并 manage durable authority，不发布 ready。primary 的唯一启动 worker 必须先按固定顺序完成 retained target 恢复和初始 argv 路由，成功后才永久发布 routing ready。这样 secondary 不会恢复或改写持久状态，primary 在 setup 窗口收到的 callback 也不会越过启动恢复。dialog、updater、opener 等普通 UI/平台插件继续排在两者之后。Windows bundle 声明 `md`、`markdown`、`mdown` 文件关联；ProgId / NSIS `FILECLASS` 使用稳定标识符，描述文案不进入注册键。
- 首实例保留 `std::env::args_os()`；二次实例受上游约束接收 `Vec<String>`。解析禁止 `std::env::args()` 和 `to_string_lossy`。一次 launch 中每个有效 Markdown 参数按原顺序进入同一个串行路由 worker；非 Markdown 参数和 flag 被忽略，不可表示为 UTF-8 的首实例路径显式失败。
- single-instance 同步 callback 只复制 `AppHandle`、args 和 cwd，再以 `tauri::async_runtime::spawn_blocking` 投递工作。worker 先有界等待 routing readiness；ready 后才解析 config、identity、settings 或持久化，超时以稳定错误 `desktop.open_request_state_startup_timeout` fail closed 并留日志，禁止无限等待或绕过 authority。首实例 setup 由唯一 worker 先恢复 retained target、再路由初始 argv；任一步失败都不发布 ready，禁止绕过路由直接写入 `main`。
- `DesktopWindowRoutingService` 持有全局 mutex。锁覆盖参数解析、一次 `DocumentPathIdentity::resolve`、claim owner 查询、active request 查询、窗口选择/创建和 durable enqueue，保证同路径并发不会双建窗口，不同路径并发不会复用同一 `document-N` label。
- `DocumentClaimService` 是内存中的 Pending/Owned 权威；`OpenRequestService` 是 durable handoff 权威。两者共享同一 validated identity，不另造 path owner 表。持久记录保存词法别名与已解析 identity 快照，查询只扫描内存索引；无关的离线/UNC retained path 不得触盘或阻断当前路径。
- durable request 使用 queued → processing → applied-pending → acknowledged 生命周期。只有 acknowledged 才删除 retained identity。`desktop-open-requests-available` 只是定向提示；窗口 mount 后必须主动 recover/claim，因此早到或重复通知不丢请求。已有 owner 或 active target 的再次启动仍执行幂等 durable enqueue，再通知并聚焦，避免 query/ack/claim 竞态吞掉 launch。
- 每个有文件的路由先检查 claim owner，再检查 retained target；这两类权威命中不依赖 settings 可用性。owner/target label 缺失时用原 label 重建窗口。只有新 identity 才读取 canonical settings 中的 `openWindowMode`：
  - `multiWindow`：首实例冷启动时，若 Tauri 已创建的空 `main` 没有 claim/retained authority，第一条新 identity 复用 `main`；同批后续路径和二次实例的新 identity 创建最低可用的 `document-N`，同时排除 live label 和 durable active target。若 `main` 已有 retained target，禁止覆盖，第一条新 identity 也创建 `document-N`；
  - `aggregateWindow`：优先复用 `main`，否则复用确定性的首个 managed live window，再无窗口才创建 `main`；
  - 无文件 activation：聚焦 `main` 或确定性的首个 managed live window，不读取 settings、不产生请求。
- 动态窗口只能从 main `WindowConfig` 克隆，label 只允许 `main` 或规范的 `document-N`。default capability 精确覆盖 `['main', 'document-*']`，禁止使用全局 `*` 或扩大权限集。
- 新窗口必须先安全创建，再持久 enqueue。enqueue 返回失败或拒绝时销毁刚创建的空窗口；rollback 失败返回组合错误。create、notify、show、restore、focus 任一步失败都显式记录并 fail closed；durable enqueue 已成功后即使通知/聚焦失败也不得删请求。
- 启动时读取 durable `active_target_windows`，按确定性顺序重建缺失 label 并定向通知，避免旧 queued/processing/applied-pending 请求永久饥饿。恢复与首实例 argv 必须由同一个 `spawn_blocking` worker 在同一 routing mutex 内依次执行（先恢复、后路由），禁止两个并发 task 争抢执行顺序；只有整个批次成功后才能发布 readiness 并释放等待中的 secondary worker。
- 路由验收使用 `LUMAMARK_ROUTING_ACCEPTANCE_MODE=1`，且必须同时提供已通过现有 settings acceptance 校验的 config dir：系统临时目录中的专属随机父目录、预创建固定 `settings-config` 叶、无 `.`/`..`、canonical 后仍被包含。marker 缺失时 menu acceptance 继续跳过 single-instance；marker 非 `1` 或缺少严格 config 时启动 fail closed。路由脚本还必须从全部子进程环境中移除 menu-only 的 `LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR`，防止两个验收协议交叉污染。验收脚本必须使用每次运行独有的 ownership nonce/marker，清理前重新证明 canonical 路径、固定叶、所有权 marker 与无占用进程，禁止清理真实用户配置。

## 被否决方案

- 把事件 payload 当作文件事实：监听建立前会丢失，且没有重放或完成确认。
- primary argv 直接 enqueue 到 `main`：会绕过窗口模式、owner/retained authority，并把多路径错误聚合到一个窗口。
- 把 open-request state plugin 放在 single-instance 之前：secondary 会先恢复或改写 primary 的 durable state；把 readiness 等待放在同步 callback 内同样会阻塞入口。同步 callback 中读取 settings、解析 identity、持久化或创建 WebView 还会在 Windows 引入死锁风险。
- 每次 retained 查询重新 resolve 全表路径：一个无关离线/UNC 路径即可阻断全部路由，且把 O(N) 文件系统/网络 IO 放进启动链。
- 仅按字符串或 live window 去重：路径别名、crash recovery 和 query/ack 竞态都会破坏单一 owner。
- 动态窗口使用任意 label 或 capability `*`：权限边界不可审计。
- 自研单实例 socket/命名管道：官方插件覆盖当前平台需求；二次实例非 UTF-8 的上游限制若形成真实需求再复审。

## 影响

- Rust 增加聚焦的 desktop window router、document claim authority、durable open-request lifecycle 与 identity snapshot；Tauri commands 保持薄入口。
- 前端按 window label 主动 recover/claim，完成打开后先 record-applied，再 acknowledge；窗口销毁释放 processing lease，但保留 applied-pending。
- 自动化必须覆盖 default multi、aggregate、owner/pending coalesce、missing target/owner rebuild、无文件聚焦、create/enqueue rollback、同/不同路径并发、label 唯一性、批量 argv 精确分派、settings 不可用的权威命中和 startup recovery。
- 浏览器 E2E、Rust fake 和 CDP 合成输入不能证明 Windows WebView、文件关联、二次实例和真实焦点。发布前仍需在隔离配置与隔离安装路径上运行真实 executable，并保存命令、退出码、日志、窗口 label/路径 JSON、截图和 `ClientToScreen` 后的 OS 指针证据。

## 回滚与复审条件

- 若动态窗口或 single-instance 使启动/打包稳定性退化，可临时关闭文件关联入口，但不得降级为可丢失事件或把所有请求静默塞回 `main`。
- 若引入页内 tabs，必须重新定义 aggregate 的 tab 选择、dirty 决策和 document claim 粒度。
- 若真实用户需要非 UTF-8 二次实例路径，评估 Tauri 上游或平台原生 IPC；不得使用 lossy 转换。
- 若安装包不能稳定证明多窗口、aggregate 复用、crash recovery 和 exactly-once，发布门禁失败，不得 push/tag/Release。
