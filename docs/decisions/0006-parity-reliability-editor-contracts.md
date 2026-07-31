# ADR 0006：Parity Reliability 编辑器合同

**状态：** 已接受

**日期：** 2026-07-27

## 背景

Foundation 与 MarkText+ 已建立 CodeMirror 主编辑器、文件闭环和多种 Markdown capability，但可靠性行为曾分散在装饰器、保存调用方和复杂块内部。继续逐语法增加活动行特例、字符串 round-trip 或嵌套编辑器，会放大 IME、选区、撤销、active-save 与源码保真的风险。

当前实施范围见 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。

## 决策

### 共享 editing context

- 在 `editor/interaction` 派生 `EditorInteractionContext`，统一表示 composition、每个 selection 的最小 block、inline span、delimiter 与受保护源码范围。
- 上下文从 CodeMirror state/语法树获得，并随 transaction 映射或增量重算；不进入 React store。
- 标题、列表、引用、代码围栏和行内标记消费同一合同，不再各自维护活动行规则。

### 精确源码序列化

- CodeMirror 内部使用规范化 `Text`；`DocumentSourceFormat` 保存 UTF-8 BOM、末尾换行、主换行格式和逐行 LF/CRLF/CR 覆盖，并随文档变化映射。
- `EditorDocumentPort` 的快照和保存点捕获当前 `Text` 与格式状态；序列化只发生在文件边界。
- 未修改行保持原格式；新增换行沿用邻近格式并回退到主格式。禁止静默全文件归一化。

### Mermaid 单一主 EditorView

- 主 `EditorView` 是 Markdown 正文、选区和撤销历史的唯一所有者。
- Mermaid 编辑态在主文档中显示围栏源码，预览位于块下方；不得创建持有待提交正文的嵌套 `EditorView`。
- 保存、另存为、恢复和关闭直接读取主文档，不依赖 blur 或额外 flush。
- Mermaid 的动态生产分包允许按体积拆分上游依赖，但 Rolldown 输出必须启用 `strictExecutionOrder`；否则手工分组与 `maxSize` 产生的循环 chunk 可能在 helper 初始化前执行，导致开发环境正常而生产 Mermaid 首次渲染失败。

### 保存转换使用成熟 diff 能力

- 受控的 `prepareTextForSave` 转换使用官方 CodeMirror 包 `@codemirror/merge` 计算最小 changes，再由同一 CodeMirror transaction 映射 selection 和 scroll snapshot。
- 该依赖只用于稀疏、受测试约束的保存转换，不进入普通输入热路径；LumaMark 不自研通用 diff 算法。
- 当前 raw `diff` 调用未配置 timeout。它保证应用 changes 后得到目标文本，但极端输入可能采用粗粒度扫描，因此不能把所有文档上的语义位置映射宣传为无条件精确。

## 被否决方案

- **每个装饰器维护独立活动行或 composition 特例：** 规则会漂移并产生冲突。
- **在 React store 保存正文或交互上下文：** 会把高频大对象带入渲染路径，并形成第二事实来源。
- **保存时从调用方字符串重新解析格式：** 无法可靠区分原格式与转换结果。
- **Mermaid 使用嵌套 EditorView，关闭时再提交：** 会形成第二正文、独立 undo 栈和 active-save 窗口。
- **自研 diff 或全量替换文档：** 前者缺少成熟验证，后者会破坏 selection、scroll 和最小变更语义。

## 影响

- editor capability 需要通过共享 interaction API 获取编辑范围，不能直接依赖 shell 或 feature 状态。
- 文件工作流通过 `EditorDocumentPort` 获取快照与精确序列化结果；Rust command 仍保持薄入口。
- Mermaid 预览仍可异步缓存和取消，但编辑事件只进入主 CodeMirror transaction。
- `@codemirror/merge` 成为生产依赖；其版本变化必须运行保存映射、长文档和保真回归。
- Mermaid 分包配置变化必须同时经过真实 `dist/` 懒加载渲染和 Windows packaged WebView active-save 门禁；构建成功与 chunk 体积合格都不能单独证明执行顺序正确。

## 验证要求

- 单元测试覆盖 context 派生、composition、格式映射和 save-preparation changes。
- 使用真实 `EditorView → prepareTextForSave → write → reopen → byte diff` 证明无关字节 diff 为 0。
- 集成/E2E 覆盖模式切换、selection/scroll、统一 undo 和 Mermaid active-save。
- 生产 E2E 必须触发 Mermaid 动态 import 并得到 SVG；Windows packaged WebView 必须从真实临时文件进入编辑态，验证 active-save 立即落盘、Unicode 输入、模式往返和任务 checkbox 可访问名称。
- diff/save benchmark 与 1/5/10 MB 文档性能门禁独立串行运行。

## 复审与回滚条件

出现以下任一情况时复审本决策：

- 保存转换从稀疏规范化扩展为大范围重写。
- 大文档测试触发粗粒度 diff，或 selection/scroll 映射不能被证明准确。
- 引入 `scanLimit`、timeout 或其他可能产生非精确匹配的配置。
- `DocumentSourceFormat` 映射导致不可接受的内存或输入延迟。
- 新能力提出第二个可编辑正文或独立撤销栈。

当 diff 精确性不可观察时，优先切换到可报告精确状态的 API（例如 `Chunk.build`），并在 `precise=false` 时显式采用安全 fallback、测试与遥测；不得静默声称位置保持精确。只有新的 ADR 证明必要性和回滚方案后，才允许恢复嵌套编辑器或改变源码保真合同。
