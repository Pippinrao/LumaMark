# ADR 0015：外部打开与工作区文件变更

**状态：** 已接受

**日期：** 2026-08-09

## 用途与范围

本文记录为链接右键「打开链接」、图片/文件树「在文件管理器中显示」以及文件树新建/重命名/删除所引入的依赖、权限与安全边界。范围包括 opener 选型、协议白名单、工作区路径逃逸防护、删除语义与 capability 变更。菜单信息结构以 [菜单系统设计](../product/MENU_SYSTEM_DESIGN.md) 为准。

## 背景

本决策落地前，`src-tauri` 仅注册 `tauri-plugin-dialog` 与 `tauri-plugin-single-instance`；`capabilities/default.json` 只授予 `core:*` 窗口权限与 `dialog:default`。当时已注册的 19 个 command 没有打开外部 URL、reveal in explorer、新建/重命名/删除文件的能力。因此 Typora 基线中已核实的链接右键「打开链接」与文件树资源管理动作无法实现。编辑器侧已有 `deriveEditorInteractionContext` 可识别 Link/Image，缺口在平台能力而非语法树。

## 决策

### 外部打开

- 引入官方 `tauri-plugin-opener`（Tauri 2），但不向 WebView capability 直接开放插件 command；前端只能调用经过业务校验的 LumaMark Tauri commands，Rust 内部通过 `OpenerExt` 执行系统操作。不引入 `tauri-plugin-shell` 作为默认方案，避免宽泛命令执行面。
- 对外 URL 只允许 `http:`、`https:`、`mailto:`。`javascript:`、`data:`、`file:` 及其他协议一律拒绝，返回明确错误码；前端与 Rust **双重校验**，Rust 校验是安全边界。
- 相对路径 Markdown 链接解析为工作区内（或相对当前文档）的文件打开，走现有文件打开工作流，不交给系统 opener。
- 「在文件管理器中显示」通过 opener/reveal 能力打开父目录并选中目标（平台 API 以插件文档为准）；有工作区 claim 时必须先匹配进程内 `WorkspaceSession`，目标再通过该根的 canonical 边界。无工作区的单文件场景允许以真实存在的 Markdown 文档为 fallback：文档必须是现存文件，目标必须位于其 canonical 实际父目录内。该 fallback 依赖受信任的内置前端传递当前文档路径，并不宣称可抵御已完全控制 WebView 的攻击者；若威胁模型提升，需新增受管 `CurrentDocumentSession` 后再收紧 command。
- 单元测试使用可注入的 opener 抽象：拒绝协议时断言不调用真实系统 opener。真实系统打开仅作 Windows 人工/发布抽检。

### 工作区文件变更

- 新增薄 Tauri commands：`workspace_create_file`、`workspace_create_directory`、`workspace_rename_entry`、`workspace_delete_entry`；reveal 统一走 `opener_reveal_path`，业务逻辑分别落在 workspace/opener service。
- 所有写操作校验目标路径位于**当前已打开工作区根**之内；含 `..` 或解析后逃逸根外的路径返回 `invalid_path`，不创建、不删除、不重命名。
- Rust 进程维护单一 `WorkspaceSession`：只有成功打开工作区后才激活 canonical 根；每个 mutation command 虽保留前端 `workspaceRoot` 参数以维持 typed command 合同，但必须先证明该 claim 与当前 session 的 canonical 根等价。切换工作区会使旧 claim 立即失效，已删除、断开或改指向的根也不能继续授权。
- `WorkspaceSession` 防止 stale/mismatched claim、路径别名与工作区切换并发穿透，但不是针对已完全控制 WebView 的沙箱：为支持最近工作区和会话恢复，受信任内置前端仍可调用 `workspace_open_path(path)` 激活任意现存目录。当前威胁模型信任随应用发布的前端代码；若要抵御 compromised WebView，必须把可激活根收紧为 Rust 持久化的用户批准 token/allowlist 或仅允许原生对话框建立授权，不能把 session 等同于该更强安全边界。
- 路径边界对已存在的根、父目录和目标使用 canonical 校验，阻断 symlink/junction 逃逸，并兼容 Windows 路径大小写与 `\\?\` 前缀差异；返回给前端的条目路径仍保持调用链中的正常化非 canonical 格式，避免泄漏 verbatim 前缀或改变文件树 key。
- 重名冲突返回明确错误，不覆盖已有文件。
- **删除语义：优先移到操作系统回收站**（Windows Recycle Bin）。若平台 API 不可用，返回明确错误并保持文件不变，不做静默永久删除。永久删除若未来需要，必须另开确认合同与 ADR 修订。
- 删除当前已打开文档对应文件时，前端必须走既有外部变更 / dirty 合同，不得静默丢弃编辑区内容。
- 文件树 UI 继续用 `react-arborist`；右键菜单复用 Radix Context Menu 与统一命令节点模型，不自研树或菜单。

### 并发文件系统边界

- 新建文件使用独占创建，目录创建使用操作系统的原子“不覆盖”语义；悬空 symlink 也按已占用目标处理。Windows 的重命名系统调用同样不覆盖已存在目标。
- canonical 校验与最终系统调用之间仍存在不可完全消除的命名空间竞态，例如同一登录用户的另一个进程在两者之间替换父目录 junction。当前威胁模型把“已能写入用户工作区的本地进程”视为与用户同等权限的外部变更源；校验会尽量贴近系统调用，目标冲突会失败而非覆盖。若未来工作区来自不可信多用户目录或需要抵御恶意本地竞态，必须复审为基于目录句柄的相对操作及平台级 no-replace rename，而不能继续增加词法路径检查。

### 权限

- capability 不授予 `opener:*` 或通用任意路径 `fs:allow-write` 给前端直达，避免绕过 URL 白名单与 canonical 路径边界；系统 opener 只由已校验的 Rust command 内部调用。
- 业务逻辑在 Rust service；前端只调用 typed client。

## 被否决方案

- 使用 `tauri-plugin-shell` 的 `open` 作为唯一方案且无协议白名单：攻击面过大，文档型应用不可接受。
- 前端直接拼 `window.open` 打开任意 href：WebView 行为不一致，且无法统一协议策略与错误提示。
- 无工作区根校验的递归删除/写入：路径逃逸风险。
- 默认永久删除：不符合「长时间写作」产品对误操作的保守态度。
- 为右键菜单引入第二套命令注册表：与菜单系统设计冲突。

## 影响

- `Cargo.toml`、前端 typed command facade 与 `lib.rs` 注册列表变更；`capabilities/default.json` 已复核并保持不授予任何 `opener:*` 权限，WebView 不能绕过自有 Rust command 校验。
- 链接工作流、图片右键 reveal、文件树右键依赖本文落地。
- 安全测试必须覆盖协议拒绝与路径逃逸；E2E 可覆盖复制路径与菜单结构，真实 opener/回收站依赖平台抽检。
- 与 [ADR 0005](0005-external-file-and-image-watch.md) 的外部文件变更合同衔接：工作区删除/重命名后 watcher 与 dirty 提示仍有效。

## 回滚与复审条件

- 若 opener 插件在 Windows WebView2 上不稳定或权限模型过宽，回滚为「仅复制链接/路径」并禁用打开/reveal 菜单项，同时修订菜单覆盖矩阵。
- 若回收站 API 在某平台不可用且产品要求删除，必须先修订本文删除语义再实现。
- 若产品支持多工作区根或打开工作区外单文件的复杂资源管理，复审路径校验边界。
- 若安全审计要求更严协议集或用户可配置白名单，通过设置项扩展且默认保持本文白名单。
