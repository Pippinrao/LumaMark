# 表格

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Tables |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（GFM 表格默认） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** GFM 管道表格；`| header |` + Return 创建；焦点工具栏；上下文菜单行列；对齐冒号；单元格内行内 Markdown。
- **范围外：** 复杂表格可视化设计器的全部像素行为（部分属 GUI `unknown`）；合并单元格（GFM 通常不支持）。

## 2. 语法表面

- 输入 `| First Header | Second Header |` 后按 Return，创建两列表格。`support`
- 完整源码形态：

```markdown
| First Header | Second Header |
| ------------- | ------------- |
| Content Cell | Content Cell |
```

- 对齐：分隔行用 `:` —— 左 `:---`、右 `---:`、中 `:---:`。`support`
- 单元格可含链接、粗体、斜体、删除线等行内 Markdown。`support`
- Typora 可用图形界面操作，源码由 Typora 自动生成；也可直接写源码。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非焦点显示为排版表格；管道字符通常隐藏。`support`
- 对齐影响单元格文本对齐。`support`
- **本机 1.13.7 截图：** 可见表头与单元格文本，管道符不可见。`observed`（`80-center.png` / `210-typora.png`）
- **焦点工具栏（本机）：** 光标/焦点在表格上时，表上方出现浮动工具栏（对齐与行列相关控件）。`observed`（`231-pagedown.png`）

## 4. 编辑态（光标进入 / 焦点）

- 焦点落在表格上时打开 **表格工具栏**，可调整大小、对齐或删除表格。`support`
- 上下文菜单可复制、增删行列。`support`
- 单元格内编辑文本与行内语法；光标在单元格 span 内遵循 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时)。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | `\| ... \|` + Return 创建 | support |
| 快捷键 | Windows/Linux：`Ctrl+T` 插入表格；`Ctrl+L` 选行；`Ctrl+E` 选单元格；`Ctrl+Shift+Backspace` 删行 | support |
| 菜单 | 插入表格类菜单（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴 TSV/HTML 是否成表未核实 | unknown |
| 其它UI | 焦点工具栏；右键行列；对齐冒号经由 UI 或源码 | support |

## 6. 源码模式与落盘形态

- 落盘为 GFM 管道表；Typora UI 操作会生成/更新源码。`support`
- 源码模式显示全部 `|` 与对齐行。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- UI 生成的空格对齐是否规范化：可能重排空白；对「字符级保真」是风险点，需实测，`unknown`。

## 7. 边界、失败与保真

- 列数不一致行的容错未详述，`unknown`。
- 单元格内管道字符转义需求未逐步说明，`unknown`。
- 复杂表格编辑器（合并、拖拽列宽持久化等）超出 GFM 时，Support 以工具栏/菜单为界。

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| tbl-01 | GFM 管道表语法 | 标准表头/分隔/数据行 | both | align | V1 含基础表格 | V1 |
| tbl-02 | 管道头行 + Return 创建 | 键入表头管道行后 Return 创建表 | support | align | V1 输入路径 | V1 |
| tbl-03 | 对齐冒号 | :--- / :---: / ---:（本机源码保留混用） | both | align | V1 基础表能力 | V1 |
| tbl-04 | 单元格行内 MD | 链/粗/斜/删除线等（本机 cellBold） | both | align | 与 ADR/实现一致的基础 inline | V1 |
| tbl-05 | 阅读态表格 | 非焦点渲染为表 | both | align | V1 live preview | V1 |
| tbl-06 | 焦点可编辑单元格 | 进入单元格改文本 | support | align | V1 基础编辑 | V1 |
| tbl-07 | 焦点工具栏 | 焦点表时出现对齐/行列浮动工具栏 | observed | defer | 复杂表编辑器 V1 延后 | Parity |
| tbl-08 | 右键增删行列 | 上下文菜单行列操作 | support | defer | 复杂表编辑延后 | Parity |
| tbl-09 | UI 生成源码 | 图形操作写回 Markdown | support | defer | 与复杂编辑一并 | Parity |
| tbl-10 | 源码模式完整表 | 显示全部管道 | both | align | V1 源码模式 | V1 |
| tbl-11 | 直接手写源码 | 可不经 UI 写表 | support | align | 源码是唯一真相 | V1 |
| tbl-12 | 粘贴成表 | TSV 等未核实 | unknown | defer | Parity 增强 | Parity |
| tbl-13 | 列宽拖拽持久化 | 是否写入源码未核实 | unknown | differ | 不把专有列宽写进 md，除非有标准语法 | 非目标 |
| tbl-14 | 合并单元格 | GFM 无标准合并 | support | defer | 非 GFM 标准能力 | 非目标 |
| tbl-15 | 空格对齐规范化 | UI 是否重排空格未核实 | unknown | differ | 保真：尽量不重排无关空白 | V1 |
| tbl-16 | 菜单插入表 | 路径未核实 | unknown | align | V1 可提供基础插入 | V1 |
| tbl-17 | 不等列容错 | 行为未核实 | unknown | unknown | 需实测 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 工具栏按钮集合 | 焦点表格截图 | tbl-07 |
| 右键菜单项 | 右键表头/单元格 | tbl-08 |
| UI 改对齐后源码空格 | 改对齐前后 diff | tbl-15 |
| Excel 粘贴 | 复制两列粘贴 | tbl-12 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | common-v1：表格阅读态 + 单元格粗体 + 源码管道/对齐冒号保真 |
