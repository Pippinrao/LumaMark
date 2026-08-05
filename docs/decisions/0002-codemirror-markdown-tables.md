# ADR 0002：CodeMirror 表格交互组件选型

日期：2026-07-05

更新：2026-08-04（固定 1.0.0 并补丁修复纵向光标列保持）

## 背景

V1 live preview 表格需要接近成熟 Typora-like 写作体验：默认正常展示、单击后结构化编辑、行列操作稳定、复制粘贴保持 Markdown 源码，并且不能在源码模式隐藏原文。项目规则要求优先成熟组件，当前自研 `TableWidget` 已经暴露出 UI 噪音、焦点状态、内嵌编辑和行列操作维护成本过高的问题。

## 决策

引入 `codemirror-markdown-tables` 作为 CodeMirror 6 表格交互核心。

LumaMark 只保留薄集成层：

- live preview 模式启用 `markdownTables()` 和表格 autocompletion。
- source mode 不启用表格 widget，显示原始 Markdown。
- 菜单命令只补充“复制当前表格 Markdown 源码”和“删除当前表格 block”。
- 视觉差异通过 CSS/theme adapter 调整，不重写表格编辑交互。
- 依赖固定为 `1.0.0`；在上游发布等价修复前，通过 pnpm patch 让 `ArrowUp` / `ArrowDown` 保留当前源码列，并在目标单元格较短时夹紧到末尾。补丁不接管表格状态机、序列化或 DOM 选区。

## 被否决方案

- 继续修补自研 `TableWidget`：会继续扩大自维护基础组件范围，风险集中在 IME、撤销重做、焦点、复制粘贴和源码保真。
- 切换到 Milkdown、Toast UI Editor 或 ProseMirror tables：这些方案更像主编辑器核心替换，不适合作为本轮局部表格修复。
- 自研完整表格编辑器：没有证据表明成熟组件无法满足当前目标，不符合成熟组件优先原则。

## 影响

- 表格行列插入、删除、移动、选择、复制粘贴等核心交互以 `codemirror-markdown-tables` 行为为准。
- LumaMark 不再维护 cell editor、尺寸 picker、行列操作状态机和表格序列化模型。
- 新增依赖进入 `package.json` 和 lockfile；依赖安装遵循 `https://registry.npmmirror.com/`。
- 表格主题由 `src/editor/capabilities/table/table.css` 和扩展配置适配 LumaMark token。
- `patches/codemirror-markdown-tables@1.0.0.patch` 只修改实际使用的 ESM 入口；LumaMark 是 ESM/Vite 应用，不消费该包的 CommonJS `require` 入口。

## 回滚或复审条件

出现以下情况时复审：

- 组件破坏 Markdown 源码保真、撤销重做、IME 或复制粘贴。
- 大文档中表格 widget 对输入或滚动造成可测性能退化。
- 组件长期不维护，或与 CodeMirror 版本升级发生阻塞。
- 上游版本提供并验证了相同的纵向列保持行为；届时删除本地 patch，解除精确版本固定，并用同一组 E2E 防止回归。
- V1 后决定整体切换主编辑器核心，再统一评估 Milkdown、Toast UI Editor 或 ProseMirror。
