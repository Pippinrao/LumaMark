# 水平线

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Horizontal Rules |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 空行上输入 `***` 或 `---` 后按 Return 生成水平线。
- **范围外：** `___` 等其它 CommonMark 变体是否同等（未在本节写明则 `unknown`）。

## 2. 语法表面

- 在空行输入 `***` 或 `---` 并按 Return → 绘制水平线。`support`

## 3. 阅读态（非当前 / 非焦点）

- 显示为分隔线样式；源码星号/连字符隐藏。`support`（live preview 模型，见 [00 §7](00-live-preview-model.md#7-源码符号隐藏的一般原则与例外入口)）

## 4. 编辑态（光标进入 / 焦点）

- 焦点落在 hr 上时是否展开为 `---` 源码：GUI `unknown`。
- 删除 hr 的键位行为未核实，`unknown`。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 空行 `***` 或 `---` + Return | support |
| 快捷键 | 不适用（未记载） | support |
| 菜单 | 段落 → 分割线类项（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴含 --- 的行 | unknown |
| 其它UI | 不适用 | support |

## 6. 源码模式与落盘形态

- 落盘为 `***` 或 `---`（或用户手写的等价形式）。`support`
- 源码模式可见标记。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 与 Setext 标题下划线、YAML `---` 的歧义：文首 `---` 见 [14](14-yaml-front-matter.md)；hr 要求在空行上下文。`support`（各自章节）
- 不把用户的 `***` 静默改成 `---`（保真原则）。

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| hr-01 | *** 创建 hr | 空行 *** + Return | support | align | V1 含 hr | V1 |
| hr-02 | --- 创建 hr | 空行 --- + Return | support | align | V1 含 hr | V1 |
| hr-03 | 阅读态分隔线 | 非焦点显示为线 | both | align | V1 live preview | V1 |
| hr-04 | 源码保真标记 | 保留 *** 或 ---（本机源码见 `***`） | both | differ | 不统一改写用户 hr 风格 | V1 |
| hr-05 | 菜单插入 | 路径未核实 | unknown | align | V1 段落菜单含分割线 | V1 |
| hr-06 | 焦点展开源码 | 是否展开未核实 | unknown | unknown | 需实测 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 焦点 hr 是否显示 --- | 点击分隔线 | hr-06 |
| ___ 是否可用 | 空行输入 ___ + Return | hr-01 |
| 与 YAML 冲突 | 文首 --- 对比文中 --- | hr-02 / yaml |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | common-v1：阅读态水平线；源码保留 `***` |
