> 语言：**中文** · [English](../../decisions/0004-local-recovery-drafts.md)

# ADR 0004：本地恢复草稿的安全边界

日期：2026-07-11

更新：2026-07-27（恢复草稿改用精确源码序列化）

## 背景

写作应用需要在意外退出后尽可能保留未保存的内容，但恢复机制不能绕过用户的保存意图，更不能静默覆盖 Markdown 源文件。恢复功能还不能把高频 Markdown 正文放入 React 或 Zustand 状态。

## 决策

- 用户编辑后以 500ms debounce，通过 `EditorDocumentPort.serializeText()` 将当前 CodeMirror 精确序列化文本和可选原文件路径写入浏览器本地存储；不得使用规范化的 `getText()` 代替。
- 草稿持久化放在 `services/drafts`；React feature 只调度快照、呈现恢复决策并通过 `EditorDocumentPort` 读取或载入文本。
- 序列化快照包含 `DocumentSourceFormat` 恢复出的 UTF-8 BOM、混合 LF/CRLF/CR 分布和末尾换行意图。恢复时 `loadText(..., { saved: false })` 重新建立规范化 `Text` 与格式状态，并作为未保存文档进入 editor；详细合同见 [ADR 0006](0006-parity-reliability-editor-contracts.md)。
- 启动且编辑器端口就绪后，如发现草稿，使用 Radix dialog 显式提供“恢复草稿”和“丢弃草稿”。对话框不允许通过 Escape 或点击遮罩绕过选择。
- 恢复总是创建新的未保存文档：清空文档上下文路径、标记 dirty、聚焦编辑器；绝不写回或覆盖记录中的原文件路径。
- 成功打开、新建或成功保存且文档保持 clean 时取消待写任务并清除已有恢复草稿。
- 浏览器存储不可访问或损坏时，恢复能力安全降级且不影响正在进行的编辑。

## 被否决方案

- 静默把恢复内容写回原文件：会绕过用户确认，可能覆盖磁盘上较新的版本。
- 把全文放进 app store：会使 React 订阅高频变化数据，破坏编辑器热路径边界。
- 仅在 `beforeunload` 时存储：异常退出、进程终止或 WebView 崩溃时不可靠。

## 影响

- 恢复草稿是本机浏览器 profile 内的短期恢复能力，不是跨设备同步或历史版本功能。
- 对原文件的存储路径仅用于说明来源，不用于自动写入。
- 单元/集成测试覆盖调度、显式恢复、保存后的清理、存储不可用，以及 BOM、混合换行和末尾换行的保存/恢复 round-trip；Playwright 覆盖恢复和丢弃两个真实用户路径。
- 草稿存储的是一次精确序列化字符串，不持有活动 `EditorState`、selection 或 undo history；恢复后的撤销边界仍由主 EditorView 建立。

## 回滚或复审条件

- 本地存储容量、隐私策略或多窗口需求使单一草稿槽不足。
- 需要跨重启的多个草稿、版本历史、加密或跨设备同步时，应采用有容量管理和冲突策略的独立服务。
- 恢复路径影响 CodeMirror 的 IME、撤销重做、选区稳定性或启动性能。
- 浏览器存储或后续草稿 schema 无法逐字保存 `DocumentSourceFormat` 所表达的格式意图。

当前恢复草稿的门禁与 active-save 共同纳入 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。
