> 语言：**中文** · [English](../../../product/typora-baseline/11-mermaid-and-diagrams.md)

# Mermaid 与图表

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Draw Diagrams With Markdown；What's New 1.13 |
| Support URL | https://support.typora.io/Draw-Diagrams-With-Markdown/ ；https://support.typora.io/What's-New-1.13/ |
| Preferences 依赖 | **必须**在 Preferences → Markdown 启用 Diagrams |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** Diagrams 总开关；` ```sequence ` / ` ```flow ` / ` ```mermaid `；Mermaid 多图种；`%%{init}%%`；右键保存/复制图；1.13 Mermaid 11.13.0。
- **范围外：** 各图种完整语法教程（指向 Mermaid 官方）；导出格式限制仅作边界摘要。

## 2. 语法表面

### 前置条件

- 先启用 Diagrams。`support`
- 图表 **不是** 标准 Markdown / CommonMark / GFM；导出到部分格式可能不含图；官方仍建议必要时改为插入图片。`support`

### sequence / flow

- ` ```sequence `：js-sequence。`support`
- ` ```flow `：flowchart.js。`support`

### Mermaid

- ` ```mermaid ` 支持 sequence、flowchart、gantt、class、state、pie、requirement、gitGraph、C4、mindmap、timeline、quadrant、sankey、zenuml、xyChart 等（以 Support 列表为准）。`support`
- **1.13**：Mermaid **11.13.0**；新增 Venn、Ishikawa；改进 mermaid 代码高亮等。`support`

### 配置

- 全局：Custom CSS 变量（`--mermaid-theme` 等）。`support`
- 行内：首行 `%%{init: ...}%%`。`support`

### 右键

- 右键图可保存为 SVG/PNG/JPG，或复制到剪贴板。`support`

## 3. 阅读态（非当前 / 非焦点）

- 启用后，非焦点显示渲染图而非源码。`support`
- 未启用 Diagrams 时，围栏应按普通代码块处理（期望）；未逐条核实，`unknown`。
- **本机 1.13.7 截图：** ` ```mermaid ` 的 `graph LR; A --> B` 渲染为带箭头的 A/B 节点图（非普通代码块）。`observed`（`artifacts/typora-observe/231-pagedown.png`；说明本机已启用 Diagrams）

## 4. 编辑态（光标进入 / 焦点）

- 光标进入图表围栏应可编辑源码（与代码块/公式类似的「源码编辑 ↔ 预览」模型）。精确切换手势 GUI `unknown`。
- 预览区右键提供保存/复制。`support`

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 围栏 info string 为 sequence/flow/mermaid + 内容 | support |
| 快捷键 | 不适用（无专用插入键记载） | support |
| 菜单 | 不适用（以键入围栏为主） | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 向围栏粘贴 DSL 文本 | unknown |
| 其它UI | Preferences 启用；右键保存/复制；Custom CSS；%%{init}%% | support |

## 6. 源码模式与落盘形态

- 落盘为普通围栏代码块 + DSL 正文；渲染是编辑器层行为。`support`
- 源码模式显示完整围栏与 DSL。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 非法 DSL：应不影响编辑器整体（公开产品质量期望）；Typora 具体错误面板未核实，`unknown`。
- 导出 HTML/PDF/epub/docx 可含渲染图；其它格式可能不支持。`support`
- ZenUML 非一等公民，可能缺暗色等。`support`
- 1.13 修复多图导出与子元素渲染等。`support`

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| diag-01 | Diagrams 总开关 | Preferences 启用后才渲染图 | support | defer | V1 直接支持 Mermaid fence；总开关式扩展放 Parity | Parity |
| diag-02 | ```mermaid 围栏 | mermaid info string，预览为节点图 | both | align | V1 含 Mermaid fenced block | V1 |
| diag-03 | 异步/离开后预览 | 公开体验为源码与预览切换（手势未全核实） | support | align | V1：停止输入或离开后预览，进入可编辑源码 | V1 |
| diag-04 | 渲染不阻塞输入 | 产品要求级；实现细节未知 | unknown | align | V1 硬性：Mermaid 不阻塞输入 | V1 |
| diag-05 | 错误不影响编辑器 | 坏图不应拖垮编辑 | unknown | align | V1 验收要求 | V1 |
| diag-06 | ```sequence | js-sequence 扩展 | support | defer | Preferences 扩展图种 | Parity |
| diag-07 | ```flow | flowchart.js 扩展 | support | defer | Preferences 扩展图种 | Parity |
| diag-08 | 多 Mermaid 图种 | gantt/class/pie 等 | support | align | V1 以 mermaid 引擎能力为准，不另做可视化编辑器 | V1 |
| diag-09 | Mermaid 11.13 | 1.13 升级至 11.13.0 | support | defer | 版本追平放 Parity；V1 用可用稳定版 | Parity |
| diag-10 | Venn/Ishikawa | 1.13 新图种 | support | defer | 随引擎升级 | Parity |
| diag-11 | %%{init}%% | 行内初始化指令 | support | defer | 高级配置 | Parity |
| diag-12 | CSS 主题变量 | --mermaid-theme 等 | support | defer | 主题深度定制 | Parity |
| diag-13 | 右键保存图 | SVG/PNG/JPG | support | defer | 导出增强 | Parity |
| diag-14 | 右键复制图 | 复制到剪贴板 | support | defer | 剪贴板增强 | Parity |
| diag-15 | 源码保真 DSL | 落盘为围栏文本 | support | align | 源码唯一真相 | V1 |
| diag-16 | 非标准 MD 提示 | 官方建议重要图可改插图片 | support | align | 文档/UX 可提示；不阻止 fence | V1 |
| diag-17 | 可视化拖拽编辑器 | Typora 亦非可视化建模主路径 | support | differ | V1 明确不做 Mermaid 可视化编辑器 | 非目标 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 关闭 Diagrams 时 mermaid 围栏表现 | 关偏好重载后打开含图文档 | diag-01 |
| 光标进入/离开预览切换 | 在 mermaid 块内外点击 | diag-03 |
| 右键菜单项 | 在预览上右键 | diag-13, diag-14 |
| 语法错误 UI | 输入非法 graph | diag-05 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
