> 语言：**中文** · [English](../../../product/typora-baseline/08-code-blocks.md)

# 代码块

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → (Fenced) Code Blocks |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（基础围栏）；图表类 info string 见 [11](11-mermaid-and-diagrams.md) |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** GFM 围栏代码块；语言标识与语法高亮；` ``` ` + Return 创建；与经典缩进代码块的差异。
- **范围外：** Mermaid/sequence/flow 等图表围栏（[11](11-mermaid-and-diagrams.md)）；行内代码（[05](05-emphasis-and-inline-spans.md)）。

## 2. 语法表面

- Typora **只支持 GFM 围栏**，不支持原始 Markdown 缩进式代码块。`support`
- 输入 ` ``` ` 后按 Return；可在 \`\`\` 后加可选语言标识以启用高亮。`support`

```markdown
```
function test() {
  console.log("notice the blank line before this function?");
}
```

```ruby
require 'redcarpet'
```
```

## 3. 阅读态（非当前 / 非焦点）

- 非当前代码块以等宽、块级代码样式显示，并按语言高亮（若可识别）。`support`
- 围栏定界符在阅读态通常隐藏。`support`（live preview 模型）
- **本机 1.13.7 截图：** ` ```js ` 块显示为带浅色边框的等宽区域，`console.log(1)` 中数字可见高亮色；围栏定界符不可见。`observed`（`61-c.png` / `80-center.png`）

## 4. 编辑态（光标进入 / 焦点）

- 光标进入代码块后编辑源代码文本；语言标识的编辑 UI（首行 info string）细节 GUI `unknown`。
- 代码块内是否隐藏「内部」Markdown：代码内容按字面展示，不二次 WYSIWYG 解析（公开期望与 GFM 一致）。`support`（围栏语义）

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | \`\`\` + Return；可选语言 | support |
| 快捷键 | Windows/Linux：`Ctrl+Shift+K` 插入代码围栏 | support |
| 菜单 | 段落 → 代码块类项（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 向块内粘贴保持字面文本 | unknown |
| 其它UI | 语法高亮由语言标识驱动 | support |

## 6. 源码模式与落盘形态

- 落盘为围栏 + 可选 info string + 内容 + 闭合围栏。`support`
- 缩进式四空格代码 **不是** Typora 支持的创建路径；若文件中已有缩进代码，渲染行为未在本节保证，`unknown`。
- 源码模式显示完整围栏。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 未知语言标识：仍应作为代码块，高亮可降级。`support`（可选语言）
- 围栏内的 Markdown 字符必须保真，不得当正文解析。
- 未闭合围栏的恢复策略未详述，`unknown`。
- 1.13 提及伪代码关键字更新等，属高亮词表维护。`support`（What's New 1.13）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| code-01 | 仅围栏不支持缩进块 | 明确只支持 fenced | support | align | V1 围栏代码；不实现经典缩进块 | V1 |
| code-02 | \`\`\` + Return | 键入创建围栏 | support | align | V1 输入路径 | V1 |
| code-03 | 语言标识 | info string 驱动高亮 | both | align | V1 含语言标识 | V1 |
| code-04 | 语法高亮 | 已知语言高亮（本机 js 关键字着色） | both | align | V1 代码块体验（依赖成熟高亮） | V1 |
| code-05 | 阅读态代码样式 | 非焦点等宽块+边框，语言高亮可见 | both | align | V1 live preview | V1 |
| code-06 | 编辑态改源码 | 焦点内编辑文本 | support | align | V1 当前块可编辑 | V1 |
| code-07 | 块内不二次 WYSIWYG | 内容按字面代码 | support | differ | V1 设计：代码块内不做 WYSIWYG 隐藏，保编辑稳定 | V1 |
| code-08 | 源码完整围栏 | 源码显示 \`\`\` 与语言标识 | both | align | V1 源码模式 | V1 |
| code-09 | 未知语言降级 | 无高亮仍为代码块 | support | align | 失败可见、不毁文档 | V1 |
| code-10 | 菜单插入 | 路径未核实 | unknown | align | V1 段落菜单含代码块 | V1 |
| code-11 | 缩进代码文件兼容 | 打开含四空格代码的旧文 | unknown | defer | 非创建路径；只读兼容可 Parity | Parity |
| code-12 | 未闭合围栏 | 恢复策略未核实 | unknown | unknown | 需实测 | Parity |
| code-13 | 行号/复制按钮 | Support 本节未要求 | unknown | defer | 增强 UI 非 V1 必达 | Parity |
| code-14 | 语言标识编辑 UX | 首行 lang 如何改未核实 | unknown | align | 保留 lang 是 V1 要求 | V1 |
| code-15 | 快捷键创建 | 键位未核实 | unknown | align | 与菜单一并提供 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 焦点时围栏是否可见 | 光标移入代码块 | code-06, code-07 |
| 四空格缩进块打开效果 | 打开仅缩进代码的 md | code-11 |
| 语言切换 UI | 尝试改 ruby→js | code-14 |
| 未闭合 \`\`\` | 删除闭合行 | code-12 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 补充本机阅读态截图：围栏代码块边框与高亮 |
| 2026-07-11 | common-v1：js 高亮 + 源码围栏保真 |
