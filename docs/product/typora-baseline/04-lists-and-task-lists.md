# 列表与任务列表

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Lists / Task List |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（任务列表为 GFM 默认能力） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 无序 `*` / `+` / `-`；有序 `1.`；任务列表 `[ ]` / `[x]`；点击 checkbox 切换。
- **范围外：** 引用内列表的全部交叉用例（见 §9）；缩进代码块（Typora 不走经典缩进代码，见 [08](08-code-blocks.md)）。

## 2. 语法表面

### 无序 / 有序

- 输入 `* list item 1` 创建无序列表；`*` 可换为 `+` 或 `-`。`support`
- 输入 `1. list item 1` 创建有序列表。`support`

```markdown
*   Red
*   Green
*   Blue

1.  Red
2.  Green
3.  Blue
```

### 任务列表

```markdown
- [ ] a task list item
- [ ] list syntax required
- [ ] normal **formatting**, @mentions, #1234 refs
- [ ] incomplete
- [x] completed
```

- 可通过点击条目前的 checkbox 切换完成/未完成。`both`（本机点击空心圆后落盘 `- [ ]` → `- [x]`）

## 3. 阅读态（非当前 / 非焦点）

- 非当前列表项显示项目符号或数字，以及任务控件；Markdown 列表标记字符通常隐藏。`support`（见 [00 §7](00-live-preview-model.md#7-源码符号隐藏的一般原则与例外入口)）
- 任务项在阅读态仍可点击 checkbox（交互例外入口）。`support`
- **本机 1.13.7 截图：** `- [ ]` / `- [x]` 源码标记不可见；未完成显示为空心圆，完成显示为实心圆 + 白色勾选（非方框）。`observed`（`80-center.png` / `61-c.png`）
- 部分主题下已完成项文本可呈删除线样式（本机 `span-test` / `gui-test` 截图可见）。`observed`

## 4. 编辑态（光标进入 / 焦点）

- 光标进入列表项可编辑文本；Return 通常产生下一项（自动续标记）——精确续项/退出规则 GUI `unknown`。
- 嵌套缩进（Tab / 快捷键）细节未在 Reference 本节逐步说明，`unknown`。
- 行内格式在任务项中可用（示例含 `**formatting**`）。`support`

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | `*`/`+`/`-` + 空格；`1.` + 空格；`- [ ] ` 任务项 | support |
| 快捷键 | 列表相关快捷键可能存在（本节未写死） | unknown |
| 菜单 | 段落菜单列表/任务列表（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴多行可成列表（规则 `unknown`） | unknown |
| 其它UI | 点击 checkbox 切换 `[ ]`/`[x]` | both |

## 6. 源码模式与落盘形态

- 无序落盘保留用户选用的 `*`/`+`/`-`（是否在编辑中统一成一种标记：未核实，保真上宜保留）。`support` + 保真原则
- 有序落盘为 `n.` 形式；自动重编号行为 `unknown`。
- 任务列表落盘为 `- [ ]` / `- [x]`（或同级无序标记 + 方括号）。`support`
- 源码模式显示全部标记。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 紧凑 vs 松散列表（项间空行）影响部分解析器；Typora 对空行列表的视觉未逐条核实，`unknown`。
- 点击 checkbox 只应翻转完成态标记，不应重排无关文本。`support`（行为意图）
- 1.13 修复说明提及列表与引用的缩进渲染问题已修，说明历史上存在缩进渲染敏感点。`support`（What's New 1.13 bugfix）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| list-01 | 无序 * + - | 三种无序标记均可；本机 `-` 阅读态隐藏 | both | align | V1 含 ul | V1 |
| list-02 | 有序 1. | 数字点号有序列表；阅读态隐藏标记 | both | align | V1 含 ol | V1 |
| list-03 | 键入创建列表 | 标记+空格触发列表 | support | align | V1 输入路径 | V1 |
| list-04 | 任务 [ ]/[x] | GFM 任务列表语法 | both | align | V1 含 task list | V1 |
| list-05 | 点击 checkbox | 点击圆形控件切换完成态并改落盘 | both | align | V1 任务列表交互 | V1 |
| list-06 | 任务项内行内格式 | 示例允许粗体等 | support | align | V1 基础 span | V1 |
| list-07 | 阅读态符号 | 非焦点隐藏 `[ ]`/`[x]`，显示空心/实心圆控件 | both | align | V1 live preview | V1 |
| list-08 | 源码完整标记 | 源码显示列表与任务标记（本机见 `-` / `1.`） | both | align | V1 源码模式 | V1 |
| list-09 | Return 续项 | 自动下一项未逐步核实 | unknown | align | Typora-like 续项是预期手感 | V1 |
| list-10 | 嵌套缩进 | Tab 嵌套细节未核实 | unknown | defer | 基础嵌套 V1 宜有；复杂交互 Parity 打磨 | Parity |
| list-11 | 标记风格保真 | 不把用户的 - 静默改成 * | support | differ | 源码保真：保留用户列表标记字符 | V1 |
| list-12 | 有序自动重编号 | 中间插入是否重编号未核实 | unknown | unknown | 需实测；重编号可能影响保真 | Parity |
| list-13 | 菜单插入列表 | 菜单路径未核实 | unknown | align | V1 段落菜单含列表 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| Return / Shift+Return 在列表项内 | 各项内试按键并看源码 | list-09 |
| Tab / Shift+Tab 嵌套 | 多级列表 | list-10 |
| 有序列表插入中间项后的编号 | 在 1,2,3 间插入 | list-12 |
| checkbox 点击是否可撤销为一步 | 点击后 Ctrl+Z | list-05 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 补充本机阅读态：任务列表圆形 checkbox 视觉 |
| 2026-07-11 | 本机核实点击 checkbox 落盘翻转；完成项可呈删除线 |
| 2026-07-11 | common-v1：ul/ol 阅读态隐藏标记；源码保留 `-`/`1.` |
