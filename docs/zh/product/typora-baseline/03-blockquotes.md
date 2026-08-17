> 语言：**中文** · [English](../../../product/typora-baseline/03-blockquotes.md)

# 引用块

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Blockquotes |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** `>` 引用；多段引用；嵌套引用；Typora 自动插入 `>` / 换行。
- **范围外：** Callouts / GitHub Alerts（需 Preferences，见 [16-callouts.md](16-callouts.md)）；引用内列表细节见 [04](04-lists-and-task-lists.md)。

## 2. 语法表面

- Markdown 使用邮件风格的 `>` 标记引用。`support`

```markdown
> This is a blockquote with two paragraphs. This is the first paragraph.
>
> This is second paragraph.

> This is another blockquote with one paragraph.
```

- Typora：输入 `>` 再输入内容即可生成引用块；会为你插入合适的 `>` 或换行。`support`
- 嵌套：增加更多层 `>`。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非当前引用以引用样式（缩进/竖线等主题样式）显示，`>` 标记通常隐藏。`support`（见 [00 §7](00-live-preview-model.md#7-源码符号隐藏的一般原则与例外入口)）
- 引用内多段落在阅读态保持段落间距。`support`

## 4. 编辑态（光标进入 / 焦点）

- 光标在引用内时继续编辑；Return 时 Typora 可自动继续插入 `>`。`support`
- 如何退出引用（空行、Backspace 删 `>` 等）的精确手势未在 Reference 逐步列出，`unknown`。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 输入 `>` + 内容；续行自动 `>` | support |
| 快捷键 | 可能有引用快捷键（未在 Reference 本节写死），`unknown` | unknown |
| 菜单 | 段落类「引用」菜单项（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴带 `>` 的文本可形成引用 | unknown |
| 其它UI | 不适用 | support |

## 6. 源码模式与落盘形态

- 落盘每行（或续行规则下）带 `>` 前缀；空引用行常为单独的 `>`。`support`
- 源码模式显示全部 `>`。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- 用空行分隔的两个引用块在源码中表现为两组 `>` 区域。`support`（示例含「三空行分隔两个引用」的叙述）

## 7. 边界、失败与保真

- 嵌套深度上限未记载，`unknown`。
- 引用内可含列表、代码等其它块（CommonMark/GFM 常见）；Typora 自动续 `>` 与内嵌块的交叉行为需实测，`unknown`。
- 用户手写的 `>` 后空格数量应尽量保真。

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| bq-01 | `>` 引用语法 | 邮件风格 > 引用 | both | align | V1 含 blockquote | V1 |
| bq-02 | 键入 > 创建 | 输入 > 与内容生成引用 | support | align | V1 输入路径 | V1 |
| bq-03 | 自动插入 > | 续行时自动插入合适 > 或换行 | support | align | Typora-like 手感 | V1 |
| bq-04 | 嵌套引用 | 多层 > 嵌套 | support | align | V1 基础引用 | V1 |
| bq-05 | 多段引用 | 引用内可多段落 | support | align | V1 段落模型 | V1 |
| bq-06 | 阅读态样式 | 非焦点呈引用排版、隐藏 >（左侧竖线） | both | align | V1 live preview | V1 |
| bq-07 | 源码显示 > | 源码模式完整前缀 | both | align | V1 源码模式 | V1 |
| bq-08 | 退出引用手势 | 如何退出未逐步核实 | unknown | unknown | 需实测后定 | Parity |
| bq-09 | 菜单切换引用 | 菜单路径未核实 | unknown | align | V1 段落菜单含引用 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 空引用行按 Return 是否退出 | 在 `>` 行按 Return / Backspace | bq-08 |
| 引用内嵌代码围栏 | 在引用中输入 ``` | bq-03 |
| 快捷键 | 查快捷键面板或菜单旁标注 | bq-08 / 菜单项 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | common-v1：阅读态左侧竖线隐藏 `>`；源码保留 `>` |
