# ADR 0009：桌面 Markdown 文件打开桥

**状态：** 已接受

**日期：** 2026-08-05

## 用途与范围

本文记录单窗口 LumaMark 从操作系统启动参数和二次启动请求打开 Markdown 文件的边界。范围包括文件关联、路径保真、单实例转发、前端竞态、dirty 文档决策和失败降级；不定义多窗口文档模型。

## 背景

Windows 资源管理器双击 Markdown 文件时，首实例必须直接打开文件；应用已经运行时，新进程必须把请求交给现有窗口并恢复焦点。Tauri 事件是无确认的通知，如果前端尚未监听就发送 payload，事件可能丢失。另一方面，Rust 的 OS 启动参数允许非 UTF-8 路径，而 WebView IPC 只能传递 JSON 字符串，不能用 lossy 转换悄悄改写路径。

## 决策

- 使用官方 `tauri-plugin-single-instance`，并在其他插件之前注册。Windows bundle 声明 `md`、`markdown`、`mdown` 文件关联；macOS/Linux 保留同一 bundle 声明和直接命令行启动能力，但安装器/桌面环境是否注册关联必须分别验收。
- 首实例使用 `std::env::args_os()`，解析层只接收 `OsString`/`OsStr` 与 `Path`。路径先做词法规范化，只有在进入 JSON IPC 边界时才调用 `Path::to_str()`；不可表示为 UTF-8 时返回 `desktop.open_request_path_not_utf8`，禁止 `to_string_lossy`。
- single-instance 插件回调由上游固定提供 `Vec<String>` 和 UTF-8 cwd，因此二次启动无法恢复已经被插件边界拒绝或转换的非 UTF-8 参数。该限制只存在于二次实例；若它成为真实用户问题，复审原生 Windows IPC 或 Tauri 上游能力。
- 每次进程启动只接受参数中的第一个有效 Markdown 路径。Rust 待处理队列按词法规范化后的路径去重，排空后同一路径可再次作为新的用户操作进入队列。
- `desktop-open-requests-available` 事件只表示“队列可能有数据”，不携带文件事实。前端必须先订阅事件，再调用 `open_requests_drain`；通知与初始排空竞态通过串行 drain 链收敛，因此重复通知不会重复消费已经排空的请求。
- 监听注册失败时仍尝试初始 drain，并显示本地化可恢复错误。初始 drain reject 或返回 `ok: false` 时不得把 desktop bootstrap 标记完成，也不得启动最后会话恢复；错误必须保持可见直至用户关闭或后续重试策略明确实现。
- 桌面请求复用 `fileWorkflow.openPath`。dirty 文档只为当前展示的请求确认；确认只打开该项，取消会清空当前前端批次及其尚未处理项。打开失败不调用成功回调，现有文件错误保持可见。
- 成功处理二次实例后恢复、显示并聚焦 `main` 窗口。事件通知失败不丢弃 Rust 队列，前端下一次 drain 仍可取回。

## 被否决方案

- 直接把事件 payload 当作打开请求：监听建立前可能丢失，也没有确认或 exactly-once 语义。
- 在 Rust 使用 `std::env::args()` 或 `to_string_lossy`：会 panic 或静默改写不可序列化路径，违反路径保真原则。
- 一次启动打开全部 Markdown 参数：单窗口编辑器没有 tabs，连续替换文档会让 dirty 决策和最终可见文件含糊。
- 前端收到失败后继续恢复最后会话：用户双击的目标会被旧会话覆盖，且 UI 会错误暗示桌面请求已经处理。
- 自研单实例 socket/命名管道：官方插件已经覆盖当前单窗口需求；在没有非 UTF-8 二次实例证据前不扩大平台代码。

## 影响

- 新增官方 `tauri-plugin-single-instance`、薄 `open_requests_drain` command、Rust 队列 service 和前端 typed client/controller。
- Markdown 正文仍只由 CodeMirror 持有；队列只保存路径，不进入 React 全局 store。
- 自动化测试覆盖 Unicode/emoji、Unix 非 UTF-8 拒绝、首个有效参数、规范化去重、监听/排空竞态与失败、dirty confirm/cancel，以及 AppShell 自适应与手动宽度优先。
- 浏览器测试和 Rust 测试不能证明 Windows 安装器关联、资源管理器双击或现有窗口聚焦；这些仍是发布串行验收项。

## 回滚与复审条件

- 若插件导致启动、打包或平台稳定性退化，先移除文件关联与 single-instance 插件，保留应用内“打开文件”对话框作为可恢复回滚路径。
- 若产品引入多窗口或 tabs，重新定义多请求分派、dirty 决策和窗口所有权，不能继续沿用“首个有效路径”合同。
- 若真实用户需要非 UTF-8 的二次实例路径，评估 Tauri 上游修复或平台原生 IPC；不得以 lossy 转换降级。
- 若事件/command 桥在真实 Windows WebView 中无法稳定恢复焦点或排空队列，必须在发布前阻断文件关联交付并复审桥接方案。
