> 语言：**中文** · [English](../../../product/typora-baseline/17-html-and-embeds.md)

# HTML 与嵌入

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → HTML |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（部分 HTML 能力可能受安全/导出限制，见 §7） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 在 Markdown 中混写 HTML 的阅读/编辑/落盘；下划线 `<u>`；iframe embed；`<video>`；行内 style 示例。
- **范围外：** 完整 HTML 文档编辑器；浏览器安全策略白皮书；导出器对每类标签的矩阵（仅记公开限制）。

## 2. 语法表面

- 可用 HTML 补 Markdown 不足，例如：`<span style="color:red">this text is red</span>`。`support`（Markdown Reference → HTML）
- **下划线：** Markdown/GFM 无原生 underline，可用 `<u>Underline</u>`。`support`
- **Embed：** 可粘贴部分网站提供的 iframe 嵌入代码。`support`（Embed Contents）
- **Video：** 可用 `<video>` 标签嵌入视频。`support`
- **非法/不触发：** 并非所有 HTML 都会在预览中执行或显示；不安全或受限标签的精确黑名单本机未枚举，`unknown`。

## 3. 阅读态（非当前 / 非焦点）

- 被支持的 HTML 在阅读态按渲染结果呈现（如红色 span、下划线）。`support`
- iframe / video 是否立即加载取决于内容与环境；失败可见性 `unknown`。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入 HTML 区域时通常需要编辑源码标签本身（展开为源码编辑）。`support`（与 span/块「进入即源码」模型一致；精确命中规则 GUI `unknown`）
- 横切见 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时)。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 直接键入 HTML 标签 | support |
| 快捷键 | 无通用「插入 HTML」公开默认 / 不适用 | support |
| 菜单 | 不适用（无独立 HTML 插入向导记载） | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 可粘贴 iframe/video/HTML 片段 | support |
| 其它UI | 不适用 | support |

## 6. 源码模式与落盘形态

- 源码模式显示原始 HTML 标签。`support`
- 落盘应保留用户 HTML（保真）；打印/PDF 时部分 HTML 曾出现未保留问题并在版本说明中修复，说明导出路径与编辑态保真可能不同。`support`（What's New 1.13 bugfix 提及打印 PDF 时部分 HTML 保留问题）

## 7. 边界、失败与保真

- **与 Markdown 混写：** HTML 与 Markdown 混用时的优先级边界未在 Reference 穷尽，`unknown`。
- **安全：** 哪些脚本/事件处理器被拦截未公开逐步列表，`unknown`（只记「不要假设任意 HTML 都执行」）。
- **图片对齐等：** 官方建议用 HTML 做对齐（如图片 align），见 [07-images.md](07-images.md)。`support`
- **相对路径：** 1.13 修复了某类元素内相对路径设置尊重问题（发布说明级）。`support`（What's New 1.13）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| html-01 | 允许混写 HTML | 可用 HTML 补样式与结构 | support | defer | V1 以 MD 为主，HTML 非基线 | Parity |
| html-02 | `<u>` 下划线 | 用 `<u>` 实现下划线 | support | defer | 非 V1 语法列表 | Parity |
| html-03 | span style | 支持行内 style 示例用法 | support | defer | 非 V1 | Parity |
| html-04 | iframe embed | 可粘贴 iframe 嵌入 | support | defer | 安全与复杂度高，默认不做 | 非目标 |
| html-05 | video 标签 | 支持 `<video>` | support | defer | 非 V1 | Parity |
| html-06 | 源码显示 HTML | 源码模式见原始标签 | support | align | 源码模式必须真源文 | V1 |
| html-07 | 落盘保真 | 编辑保存应保留 HTML | support | align | 源码保真 | V1 |
| html-08 | 不安全标签拦截 | 黑名单未核实 | unknown | unknown | 需安全专项后再定 | Parity |
| html-09 | MD/HTML 混写边界 | 优先级未穷尽 | unknown | unknown | 需用例矩阵 | Parity |
| html-10 | 导出与编辑态差异 | 导出可能丢部分 HTML | support | differ | LumaMark 导出策略独立，不盲跟 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| script/on* 是否执行 | 粘贴 `<script>` 与 onclick，观察预览 | html-08 |
| 未闭合标签恢复 | 输入残缺 HTML，看是否自动修复落盘 | html-07 |
| iframe 失败态 | 粘贴无效 iframe，看占位/错误 | html-04 |

## 10. 变更记录

| 日期 | 角色 | 摘要 |
|---|---|---|
| 2026-07-11 | agent | 初稿：HTML / embed / video |
