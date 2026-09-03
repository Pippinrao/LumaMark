> 语言：**中文** · [English](../../decisions/0019-live-preview-pointer-selection-style.md)

# ADR 0019：实时预览指针选区 style

- 状态：已采纳
- 日期：2026-08-18（对应 issue #14、#19 的同一根因）
- 更新：2026-09-03（`posAtCoords` 为 null 或与指针方向相反时，拖拽 head 保持上一有效位置）

## 背景

issue #14 与 #19 反复反馈：实时预览／阅读模式下单击会选中附近文字，而不是放置光标。此前的修复保留了 CodeMirror 内置鼠标选区，只在 `mouseup` 的结算阶段纠正结果。症状因此以更弱的形式反复出现——错误选区仍然产生，只是存在时间更短。

Windows 安装包证据（WebView2、DPR 1.5、Win32 `SendInput`）与浏览器 E2E 显示两个来源，都位于 CodeMirror 的 `basicMouseSelection`：

- 它在手势开始时对按下坐标做一次命中测试，之后每个指针事件再做一次，并取两次结果的并集。被隐藏的 WYSIWYG 分隔符使两次命中不一致：按在链接文字上时按下解析到链接的 `[` 位置，抬起解析到实际点击的字符，光标在抬起瞬间明显跳动。
- 它没有单击容差。按住时移动一两个 CSS 像素（真实鼠标下极常见）就会映射到下一个字符，并画出一个字符的选区，直到结算把它折叠。

结算只能纠正最终状态，因此它纠正的任何内容都已经在整个按住过程中被绘制出来。

## 决策

- 实时预览注册自己的 `EditorView.mouseSelectionStyle`（`editor/wysiwyg/pointerSelectionStyle.ts`），接管装饰插件已解析为光标或 word-or-drag 候选的普通左键按下。
- style 只解析一次锚点：使用插件基于浏览器原生 caret 命中计算出的按下候选，并在文档变更时映射该锚点。
- 指针停留在 DPR 感知的单击容差内（`isPrimaryPointerClick`）时：光标候选返回折叠光标；`word-or-drag` 候选（系统 `detail === 2`）返回按下锚点处的词。
- 指针越过容差后，head 使用 CodeMirror `posAtCoords` 从按下坐标映射，包括 `detail === 2`。命中为 `null`（widget 内部）时保持上一有效 head，而不是塌回按下锚点。命中方向与指针移动相反时也保持上一 head，避免隐藏定界符让选区闪烁。原生 `caretPositionFromPoint` 只用于按下和 `mouseup` 结算，不得在每次拖拽 `mousemove` 上运行。
- 以下情况返回 `null`，保留 CodeMirror 内置行为：三击、已经 `preventDefault` 的行内代码 chip 按下、没有候选的按下。
- 单击的 `mouseup` 结算保持对同一位置的确认。已经画出字符拖选区间的 `detail === 2` 拖拽，不得再被结算成选词。

## 被否决的方案

- **继续只在结算阶段纠正**：按住期间被合成器绘制的内容仍然是错的，这正是两次失败的做法。
- **在 `mousemove` 监听里再次折叠选区**：需要依赖 DOM 监听器与 CodeMirror 自身 document 监听器的注册顺序，且每次指针移动派发两个事务。
- **对所有按下 `preventDefault` 并自行驱动选区**：会失去 CodeMirror 的拖拽能力——边缘自动滚动、原子区间跳过、选区拖放、焦点处理。
- **修补 CodeMirror 的坐标缓存**：公共 API 无法触及，且该分歧源自对隐藏分隔符的命中测试本身。

## 影响

- 实时预览单击的光标落点不再依赖 CodeMirror 的坐标映射，而依赖装饰插件本就信任的浏览器原生 caret 命中。
- 选行仍由 CodeMirror 负责。系统标成 `detail === 2` 且能解析候选的按下由 style 持有：容差内选词，越过容差后从按下锚点做字符拖选。
- 修改单击容差、锚点解析或插件候选规则，现在会影响按住期间绘制的内容，而不只是结算结果。
- 越过容差后每个指针事件做一次 `posAtCoords` 查找。原生 caret 命中离开拖拽移动路径。

## 验证要求

- 单元测试覆盖多种设备像素比下的容差行为、越过容差后的拖拽扩展、`posAtCoords` 为 null 或与指针反向跳动时保持上一 head、反向拖拽仍可收缩选区、以及锚点随文档变更的映射。
- 浏览器 E2E 针对标题、加粗、链接、普通段落与列表项，断言按下、移动一到三像素、抬起三个时刻都是折叠选区，并断言真实拖拽仍然产生区间选区。拖过矩阵（加粗、斜体、删除线、行内代码、行内公式、链接、混合行内、图片、Mermaid、围栏代码、块级公式）在按住期间采样；选区塌缩或原生光标在越过容差后重现即失败。
- `pnpm release:installed-preview-click-selection-os` 对安装包用 Win32 `SendInput` 执行按下—移动—抬起；只要按住期间任一采样出现区间，或光标在按下与抬起之间移动，即判失败。
- `pnpm release:installed-selection-caret-os` 用同一套拖过矩阵做 Win32 `SendInput` 验收；按住期间选区塌缩、`caret-color` 不透明、或折叠后光标未恢复，即判失败。

## 重新评估与回滚条件

出现以下情况时重新评估：

- CodeMirror 改变 `mouseSelectionStyle` 语义或其内置命中测试，使两次位置解析一致。
- 选词／选行若不再适用「容差内选词、越过容差后字符拖选」，再重新评估接管范围。
- 多光标、矩形选区或新的指针能力需要 style 当前拒绝接管的行为。
- 安装包验收发现浏览器原生 caret 命中解析出的按下位置本身不正确。
