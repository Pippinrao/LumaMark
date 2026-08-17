> 语言：**中文** · [English](../../../product/typora-baseline/16-callouts.md)

# Callouts / GitHub Style Alerts

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | What's New 1.8 / 1.10（Github Style Alert） |
| Support URL | https://support.typora.io/What's-New-1.8/ ；https://support.typora.io/What's-New-1.10/ |
| Preferences 依赖 | 需启用 **Github Style Alert**（Preferences → Markdown） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** GitHub 风格 Alert / Callout 的语法、Preferences 门控、阅读/编辑与落盘。
- **范围外：** 普通 blockquote（见 [03-blockquotes.md](03-blockquotes.md)）；自定义 CSS 改标签文案的完整主题工程。

## 2. 语法表面

- 需先在 Preferences 启用 “Github Style Alert”。`support`（What's New 1.8）
- 基于引用块，首行使用 `[!TYPE]` 标签。五种类型：`NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。`support`

```markdown
> [!NOTE]
> Highlights information that users should take into account, even when skimming.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]
> Crucial information necessary for users to succeed.

> [!WARNING]
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]
> Negative potential consequences of an action.
```

- **未启用 Preferences 时：** 按普通引用/文本处理（具体是否原样显示 `[!NOTE]` 本机未开关对比，`unknown`）。
- **非法/不触发：** 未知类型标签的降级行为 `unknown`。

## 3. 阅读态（非当前 / 非焦点）

- 启用后，阅读态以强调样式的提示块呈现（图标/色条等主题相关视觉）。`support`（What's New 1.8 展示说明）
- 横切见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)。

## 4. 编辑态（光标进入 / 焦点）

- 可像引用块一样编辑内容；可将已有段落范围转换为 Alert：`Paragraph` → `Alert`。`support`（What's New 1.10：Toggle alert 与 blockquote 同类逻辑）
- View 菜单切换 alert 的逻辑与 blockquote 一致。`support`（1.10）

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 输入 `> [!NOTE]` 等引用语法 | support |
| 快捷键 | 无单独公开默认 / 不适用 | support |
| 菜单 | Paragraph → Alert；View 切换 | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 可粘贴 GFM alert 源码 | support |
| 其它UI | Preferences 启用开关 | support |

## 6. 源码模式与落盘形态

- 落盘为带 `[!TYPE]` 的引用块 Markdown，而非专有二进制。`support`
- 源码模式显示完整 `>` 与标签。`support`
- 自定义 CSS 改写的显示文案在导出 PDF/HTML 时可能不保留。`support`（What's New 1.9 相关说明）

## 7. 边界、失败与保真

- **非标准：** 非 CommonMark/GFM 全量保证；跨解析器兼容性有限。`support`（1.8 明确 note）
- **嵌套/内含列表：** 行为细节 GUI `unknown`。
- **i18n：** GitHub 未提供标签 i18n；可用 Custom CSS 改显示词。`support`（1.8）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| callout-01 | Preferences 门控 | 需启用 Github Style Alert | support | defer | Preferences 扩展，非 V1 | Parity |
| callout-02 | 五种 TYPE | NOTE/TIP/IMPORTANT/WARNING/CAUTION | support | defer | 非 V1 | Parity |
| callout-03 | 引用块语法 | `> [!TYPE]` 形式 | support | defer | 非 V1 | Parity |
| callout-04 | 阅读态强调样式 | 启用后以 alert 样式渲染 | support | defer | 非 V1 | Parity |
| callout-05 | 菜单转换为 Alert | Paragraph → Alert | support | defer | 非 V1 | Parity |
| callout-06 | 源码落盘保真 | 以 Markdown 引用+标签落盘 | support | align | 若日后支持，必须保真 | Parity |
| callout-07 | 未启用时表现 | 未开关对比 | unknown | unknown | 需实测 | Parity |
| callout-08 | 未知 TYPE 降级 | 未核实 | unknown | unknown | 需实测 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 开关开/关对比 | Preferences 切换后 reload，同一源码观感 | callout-07 |
| 未知 `[!FOO]` | 输入非法类型，看是否当普通引用 | callout-08 |
| 内含列表/代码 | 在 alert 内嵌列表与围栏 | callout-04 |

## 10. 变更记录

| 日期 | 角色 | 摘要 |
|---|---|---|
| 2026-07-11 | agent | 初稿：GFM Alert / Callout |
