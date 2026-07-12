# 数学公式

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Math Blocks / Inline Math；Math and Academic Functions；What's New 1.13 |
| Support URL | https://support.typora.io/Math/ ；https://support.typora.io/Markdown-Reference/ ；https://support.typora.io/What's-New-1.13/ |
| Preferences 依赖 | Inline Math 需开启；Physics 包、自动编号、legacy inline 解析、Apply Line Break 等为 Math 偏好项 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 块级 `$$`；行内 `$...$`（门控）；MathJax 渲染；结束编辑手势；1.13 MathJax v4 与 `\\` 换行默认；Pandoc 风格 vs legacy 行内规则。
- **范围外：** 完整 TeX 宏列表（指向 MathJax 文档）；导出格式对数学的限制细节（Support 有 Limitations）。

## 2. 语法表面

### 块级

- 输入 `$$` 后按 Return，进入接受 TeX/LaTeX 的输入区。`both`（用户本机空文档确认）
- 源码中为成对 `$$` 包裹的多行 LaTeX。`both`
- **本机编辑态 UI（1.13.7）：** 焦点在公式块时出现灰色输入区，内含 `$$`…`$$` 源码；同块下方即时预览渲染结果；右上角有「公式」标签与 ✓。`observed`（`artifacts/typora-observe/840-math-ready.png` / `843-math.png`）

### 行内

- 先在 Preferences → Markdown 开启 Inline Math（Reference 称需重启；1.13 改为提示重载窗口）。`support`
- 语法 `$...$`，例如 `$\lim_{x \to \infty} \exp(-x) = 0$`。`support`
- 触发行内预览：输入 `$`，按 Esc，再输入 TeX。`support`
- 默认接近 Pandoc 规则：开 `$` 后不能直接空白；闭 `$` 前不能空白；闭 `$` 后不能紧跟数字（避免 `$2`）。`support`
- Legacy 兼容模式可放宽规则。`support`

### 1.13 / MathJax v4

- 升级 MathJax v4；**默认支持用 `\\` 换行**。`support`（What's New 1.13）
- 新增若干 TeX 包/命令（begingroup、bboldx、更多 text-mode 宏等）。`support`

### 其它能力（门控或扩展）

- Physics 包、mhchem 化学、`\label`/`\ref`、自动编号。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非焦点块公式显示渲染结果；行内公式在开启后显示为公式字形。`support`
- 渲染失败时的错误 UI 未逐条核实，`unknown`。
- **本机 1.13.7 截图：** `$$ E = mc^2 $$` 在 live preview 中居中渲染为公式字形。`observed`（`artifacts/typora-observe/210-typora.png`）

## 4. 编辑态（光标进入 / 焦点）

- 块公式输入模式结束方式：Up/Down、Command/Ctrl+Return、点击 ✓、或点击其它位置。`both`（本机可见 ✓；用户确认点 ✓/外部后 `$$` 消失、回阅读态预览）
- 行内：光标进入应可编辑 TeX 源（与 span 展开一致的期望）；`$`+Esc 为额外触发。`support`

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | `$$`+Return；行内 `$`…`$`（需开启）；`$`+Esc 触发 | both（块创建）/ support（行内） |
| 快捷键 | Windows/Linux：`Ctrl+Shift+M` 插入数学块；块内结束编辑可用 `Ctrl+Return`（及方向键/✓/失焦，见 Support Math） | support |
| 菜单 | Edit → Math Tools（强制刷新等） | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 向公式输入区粘贴 TeX | unknown |
| 其它UI | ✓ 按钮；点击外部结束；自动编号等偏好 | support |

## 6. 源码模式与落盘形态

- 块：独立行的 `$$` … `$$`。`support`
- 行内：段落中的 `$...$`。`support`
- 源码模式显示原始 TeX。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- MathJax 仅支持 LaTeX 子集。`support`
- 并非所有导出格式支持数学。`support`
- 历史：MathJax v3 起 `\\` 行为变化；曾提供 “Apply Line Break at \\” 选项；v4 默认支持 `\\`。`support`
- 强制刷新：Edit → Math Tools。`support`

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| math-01 | 块公式 $$ | $$ 包裹块级 TeX，预览居中渲染；编辑态灰框+「公式」✓ | both | defer | V1 明确延后数学公式 | Parity |
| math-02 | $$ + Return 创建 | 键入 `$$`+Return 进入公式输入区 | both | defer | 随公式能力一并做 | Parity |
| math-03 | 多种结束编辑手势 | 点 ✓/外部后退出编辑，`$$` 隐藏回预览 | both | defer | 交互打磨属 Parity | Parity |
| math-04 | 行内 $ 门控 | 需 Preferences 开启 | support | defer | 门控 + 非 V1 | Parity |
| math-05 | Pandoc 行内规则 | 默认避免 $2 等误识别 | support | defer | 随行内公式 | Parity |
| math-06 | Legacy 行内模式 | 可选旧解析 | support | defer | 兼容选项 | Parity |
| math-07 | $ + Esc 触发 | Reference 记载的触发 | support | defer | 随行内公式 | Parity |
| math-08 | MathJax 渲染 | 使用 MathJax | support | defer | 引擎选型在 Parity 决策 | Parity |
| math-09 | MathJax v4 / \\ 默认 | 1.13 默认 \\ 换行 | support | defer | 追平时对齐现代行为 | Parity |
| math-10 | 自动编号 | 偏好可自动编号 | support | defer | 学术增强 | Parity |
| math-11 | Physics / mhchem | 可选包与化学 | support | defer | 扩展 | Parity |
| math-12 | \label/\ref | TeX 交叉引用 | support | defer | 学术增强 | Parity |
| math-13 | Math Tools 刷新 | 菜单强制刷新 | support | defer | 运维型能力 | Parity |
| math-14 | 源码保真 TeX | 落盘为原始 TeX（本机 `$$`…`$$` 保留） | both | defer | 实现时必须保真 | Parity |
| math-15 | 阅读态公式预览 | 非焦点显示渲染；退出编辑后 `$$` 隐藏 | both | defer | 随公式 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| ✓ 按钮位置与样式 | 创建 $$ 块观察 | math-03 |
| 1.13 改 inline math 是否仍要重载 | 开关偏好看提示 | math-04 |
| 错误 TeX 的红字/源码回退 | 输入非法命令 | math-08 |
| 行内光标展开是否露出 $ | 点击已渲染行内公式 | math-07 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 本机核实编辑态灰框+「公式」✓；用户确认退出后 `$$` 消失回预览 |
| 2026-07-11 | 用户确认空文档 `$$`+Return 可创建公式输入区 |
