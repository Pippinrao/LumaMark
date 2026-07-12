# ADR 0005：外部 Markdown 与本地图片变更监听

日期：2026-07-12

## 背景

LumaMark 过去只在打开文件时读取磁盘。其他程序修改 Markdown 或替换本地图片后，编辑器仍显示旧内容，必须重新打开文件或重启。保存又使用原子替换，不同编辑器可能产生 write、truncate、rename 或 delete/create 事件组合，因此不能依赖单一事件类型，也不能静默覆盖用户尚未保存的输入。

## 决策

- 使用成熟的 Rust `notify-debouncer-full` 建立单一 `FileWatchService`，不把前端 `plugin-fs.watch` 作为编辑器核心监听层。
- 仅非递归监听当前 Markdown 和已授权本地图片的父目录，再精确过滤登记目标；父目录 watcher 按引用计数共享和回收，不递归监听工作区。
- 监听事件只作为 invalidation hint。200ms 去抖后重新读取目标并计算 SHA-256 fingerprint，以磁盘真实内容判断修改、删除、重建和自身保存通知。
- 打开/另存文件返回的 fingerprint 与 `watch_document` 安装后 baseline 使用同一算法；前端仅在两者不一致时补读一次，关闭 read→watch 竞态而不制造常态重复读取。监听回调遇到 Windows 临时占用时进行 3 次有界尝试，耗尽后发送 `kind: error`，只提示可恢复错误，绝不改写编辑器内容。
- Rust 通过 `file-watch://changed` 串行发送低频类型化事件；前端再按单调 revision 丢弃迟到事件。service facade 统一负责 command、listen 和 unlisten，UI 组件不直接调用 Tauri API。
- 当前文档 clean 时自动载入磁盘新内容；dirty 时显示“从磁盘重新加载 / 保留当前内容”，在用户选择前绝不覆盖编辑器文本。重新加载时再次读取磁盘，保留当前路径并尽量保持选区；文件删除时保留编辑内容并提示。
- 本地图片变化只更新对应 source 的运行时预览 revision、重新授权该路径，并给 asset URL 增加 cache-busting 参数；Rust 授权结果和前端 revision key 都必须折叠 `.` / `..`、统一路径分隔符，并在 Windows 下按大小写不敏感比较，避免同一文件因路径拼写不同而漏刷新。其他本地/远程 widget 保持不变，Markdown 源码和图片引用保持逐字不变。远程 HTTP 图片使用既有缓存生命周期，不加入磁盘 watcher。
- 文档切换、引用集合变化和窗口卸载会替换或清理监听目标；generation 防止旧文档事件覆盖新文档。

## 被否决方案

- 仅在重新聚焦窗口时重新读取：不能及时刷新图片，也无法可靠覆盖后台长时间编辑和原子保存。
- 直接使用 `@tauri-apps/plugin-fs.watch`：可以快速监听，但需要向 WebView 扩大目录 capability，并会把冲突策略和原子保存兼容逻辑分散到前端。
- 递归监听整个工作区：实现简单，但事件量和权限范围超过当前文档刷新需求。
- 外部变更时始终自动覆盖：会丢失 dirty 文档中的用户输入。

## 影响

- 新增 Rust 依赖 `notify-debouncer-full`；监听、hash 和事件发送位于 Rust service，Tauri command 保持薄入口。
- 每次变更会在线程 worker 中重新读取对应目标；范围限制为一个当前文档和其本地图片，且经过 200ms 合并，不进入输入热路径。多图片 target 更新串行收敛到最新集合，文档 target 与图片 target 分别拥有生命周期。
- Playwright 在 Web command/event 边界验证交互；真实 watcher、原子替换和公网图片缓存分别由 Rust 集成测试验证，不能把 browser mock 标记为完整桌面 E2E。

## 回滚或复审条件

- 大量图片文档导致 watcher 数量、hash I/O 或内存出现可测量退化。
- 多窗口需要各自独立文档会话和冲突状态。
- Linux/macOS 文件系统后端无法稳定覆盖原子替换，或网络/可移动磁盘需要 polling fallback。
- 需要版本合并、三方 diff 或历史恢复，而二选一冲突对话框不足。
