> 语言：**中文** · [English](../../decisions/0008-shared-media-viewer.md)

# ADR 0008：图片与 Mermaid 共享媒体查看器

**状态：** 已接受

**日期：** 2026-08-04

## 背景

图片 block 和 Mermaid block 需要在编辑器外层展开查看，并支持放大、缩小、平移和重置。该交互不能改写 Markdown、创建编辑 transaction、复制 Mermaid 渲染任务，或把图片/SVG payload 放入全局 store。Dialog、缩放和平移属于基础 UI 能力，应优先使用成熟组件。

## 决策

- 使用既有 `@radix-ui/react-dialog` 提供模态层、焦点陷阱、Esc 关闭和可访问名称；使用 `react-zoom-pan-pinch` 提供缩放、平移、触控和 transform 状态。
- `features/media-viewer` 拥有查看器 React UI 与会话状态，并由 app container 懒加载。每次请求创建新 session，使缩放状态归一；关闭后优先把焦点还给仍连接的展开按钮，否则聚焦主编辑器。
- editor 只暴露 `EditorMediaPreviewRequestHandler`：普通图片传递浏览器实际加载的 resolved asset URL；Mermaid 传递当前 Widget 已成功渲染的 SVG。Mermaid 查看器不得重新调用 renderer。
- image 与 Mermaid Widget 只在成功状态暴露展开按钮。按钮事件阻止冒泡到编辑/删除行为，但不派发 CodeMirror transaction；loading/error 状态没有可用的展开操作。
- Mermaid SVG 只保留在 Widget 实例和当前 feature 会话内，不写入 Zustand、service 或持久化层。查看器关闭后不参与 Markdown 保存、恢复或 undo/redo。
- 图片 capability 拆为 `imageBlockDetection`、`imagePathResolver`、`ImageBlockWidget` 和 `imagePreviewExtension`，避免 toolbar 和异步图片生命周期继续扩大 StateField 文件。

## 被否决方案

- **使用 gallery/lightbox 套件（如 yet-another-react-lightbox）：** 其 gallery、slide 和 modal 抽象与现有 Radix Dialog 重叠，本需求只有单媒体查看，不需要相册状态。
- **自研 pointer/wheel transform 引擎：** 需要自行维护边界、触控、滚轮、动画和跨浏览器行为，不符合成熟组件优先原则。
- **在 CodeMirror Widget 内直接挂全屏层：** 会把应用级模态、焦点和 i18n 生命周期耦合到 decoration DOM，Widget 重建时也更易丢失会话。
- **使用浏览器 Fullscreen API：** 会进入操作系统全屏权限与窗口级 Esc 语义；本需求采用应用视口内 Dialog，行为更可预测且跨 Tauri 平台一致。
- **复刻 Typora 私有 viewer：** 只参考公开体验目标，不复制专有素材或私有实现。

## 影响

- 新增一个仅在首次展开时加载的前端 chunk 和 `react-zoom-pan-pinch` 依赖；启动和编辑输入热路径不导入该组件。
- editor capability 多一个注入式轻量事件边界，但不依赖 React、app、feature、service 或 Tauri。
- Mermaid 展开复用已有 SVG，因此不增加 Mermaid 解析/渲染成本；图片按钮只在成功 load 后创建。
- 中英文按钮名称、tooltip、Dialog 标题和说明由 i18n 资源统一提供。

## 回滚与复审条件

若依赖导致可测量的启动包体、首次打开延迟、内存或跨平台触控退化，应先验证升级或配置收敛；仍无法满足门禁时再评估替换库。若未来加入多图导航、下载、旋转或导出，应重新评估 gallery 组件，不在当前 feature 内累积自研基础设施。
