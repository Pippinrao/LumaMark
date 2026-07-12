# 标题

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Headings |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** ATX 标题 `#`–`######`；键入与快捷键创建；阅读态/编辑态；落盘形态。
- **范围外：** Setext 标题（Support 本节以 ATX 为例，未强调 Setext）；大纲侧栏跳转（产品壳层，非本语法专题）；TOC 见 [15-toc.md](15-toc.md)。

## 2. 语法表面

- 行首 1–6 个 `#` 对应 H1–H6。`support`

```markdown
# This is an H1
## This is an H2
###### This is an H6
```

- Typora：输入若干 `#`，再输入标题内容，按 Return 创建标题。`support`
- 快捷键：⌘1–⌘6（Windows：Ctrl+1–6）切换/应用对应级别。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非当前标题以对应级别的排版样式显示；行首 `#` 通常隐藏。`support`（live preview 模型，见 [00 §7](00-live-preview-model.md#7-源码符号隐藏的一般原则与例外入口)）
- **本机 1.13.7 截图：** `# H1 Title` 显示为大号 “H1 Title”，`#` 不可见。`observed`（`artifacts/typora-observe/80-center.png`）
- 标题内若含行内 span，非焦点时按 span 阅读态渲染。见 [05](05-emphasis-and-inline-spans.md)。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入标题块后应能编辑标题文本；结构符号（`#` 与空格）在编辑态是否始终可见属 GUI 细节，`unknown`（见 §9）。
- 焦点模型总则见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 行首输入 `#`…`######` + 内容 + Return → 标题 | support |
| 快捷键 | Ctrl/Cmd+1…6 | support |
| 菜单 | 常见于「段落」类菜单（具体菜单文案以安装语言为准；路径 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴以 `#` 开头的行可成为标题（解析时机 `unknown`） | unknown |
| 其它UI | 大纲点击跳转（壳层，非创建路径） | support（产品常见能力，本机未测） |

## 6. 源码模式与落盘形态

- 落盘为 ATX：`#{1,6}` + 空格 + 文本。`support`
- 源码模式完整显示 `#` 标记。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- 闭合 `#`（`# title #`）是否自动规范化：Support 未要求，保真上应保留用户写法；未核实，`unknown`。

## 7. 边界、失败与保真

- 超过 6 个 `#` 的行为未在 Reference 本节详述，`unknown`。
- 空标题（仅 `#`）是否允许：未核实，`unknown`。
- 标题中的行内 Markdown（粗体、链接等）可解析，规则同 span 专题。`support`（GFM/Reference 整体）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| h-01 | ATX H1–H6 | 行首 1–6 个 # 为标题 | both | align | V1 含标题 | V1 |
| h-02 | # + 内容 + Return | 键入路径创建标题 | support | align | V1 输入路径 | V1 |
| h-03 | Ctrl+1…6 | 快捷键设置级别 | support | align | V1 快捷键体验 | V1 |
| h-04 | 阅读态隐藏 # | 非焦点以标题样式显示、隐藏 # | both | align | V1 live preview | V1 |
| h-05 | 编辑态可改文本 | 焦点标题可编辑 | support | align | V1 当前块可编辑 | V1 |
| h-06 | 源码完整 # | 源码模式显示标记 | both | align | V1 源码模式 | V1 |
| h-07 | 标题内行内语法 | 标题可含强调等 | support | align | V1 基础 span | V1 |
| h-08 | 菜单改级别 | 段落菜单路径未本机核实 | unknown | align | V1 菜单有标题层级入口 | V1 |
| h-09 | 闭合 # 保真 | 用户手写闭合井号是否保留未核实 | unknown | differ | 源码保真：不擅自改写标题标记风格 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 焦点时 # 是否可见 | 光标移入 H2，截图 | h-05 |
| 段落菜单文案与项 | 打开「段落」菜单 | h-08 |
| 七个 # 的渲染 | 键入 `####### x` | h-01 |
| Setext 下划线标题 | 写入 `Title` + `===` | （范围外，可补专题） |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 补充本机阅读态截图：H1 隐藏 `#` |
| 2026-07-11 | common-v1：H1/H2 阅读态 + 源码模式完整 `#`/`##` |
