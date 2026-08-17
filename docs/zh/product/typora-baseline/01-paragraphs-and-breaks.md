> 语言：**中文** · [English](../../../product/typora-baseline/01-paragraphs-and-breaks.md)

# 段落与换行

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Paragraph and line breaks |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（段落/换行为默认行为） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 普通段落的创建与分隔；硬换行（line break）；与经典 Markdown「双空行分段」的差异；兼容其它解析器的行末双空格 / `<br>` 说明。
- **范围外：** 标题、列表、引用内的 Return 特例（见各专题）；源码符号隐藏总则见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)、[00 §4](00-live-preview-model.md#4-换行与段落规则return--shiftreturn--空行)。

## 2. 语法表面

- 段落：一个或多个连续文本行。`support`
- **源码约定（经典 MD）：** 段落之间用两个及以上空行分隔。`support`
- **Typora 编辑约定：** 只需按一次 Return（形成一个空行）即可创建新段落。`both`
- **硬换行：** Shift + Return 创建 single line break。`both`
- 兼容提示：多数其它解析器忽略单一换行；若需被其它解析器识别，可在行末留两个空格，或插入 `<br>`。`support`

示例（落盘常见形态，`support`）：

```markdown
第一段文字。

第二段文字。

同一段内的第一行
第二行（若为硬换行，源码中为单换行；兼容写法可为行末双空格）
```

## 3. 阅读态（非当前 / 非焦点）

- 非当前段落以正文排版显示，无可见的「空行标记」。`support`（阅读态模型，见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)）
- 硬换行在阅读态表现为段内断行，不新开段落间距。`support`
- 精确 CSS 间距本机未测，`unknown`。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入段落后可直接编辑纯文本；段落本身通常无额外结构定界符需要展开。`support`（相对 span/标题更「无符号」）
- 在段内插入强调等 span 后，遵循 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时) 的展开规则。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 在空文档或段落后按 Return → 新段落；Shift+Return → 硬换行 | both |
| 快捷键 | Return / Shift+Return（无单独「插入段落」专用键记载） | support |
| 菜单 | 不适用（Support 未将普通段落列为独立菜单插入项） | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴多行纯文本时按换行拆成段落/换行（精确拆分规则 GUI `unknown`） | unknown |
| 其它UI | 不适用 | support |

## 6. 源码模式与落盘形态

- 源码模式可见段落间空行与段内换行的真实字符。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- Typora 一次 Return 分段意味着落盘常为「单空行分隔段落」，与「必须双空行」的经典叙述不同，但文件仍是合法 Markdown 文本。`both`（本机：`ONLYLINE\n\nSECONDPARA\n`）
- 硬换行落盘为段内 `\n`；若用户手动加行末两空格或 `<br>`，则按用户所写保留。`both`（本机：`SHIFTBASE\nHARDBREAK\n`）

## 7. 边界、失败与保真

- 连续多次 Return 会产生多个空行；是否合并为空段落的 UI 表现未逐条核实，`unknown`。
- 为跨解析器兼容而添加的行末双空格应被保真保留，不应在保存时静默删除（公开原则：源文件为文本；静默删除属实现猜测，不写入事实断言）。
- HTML `<br>` 与纯 Markdown 换行可并存，见 [17-html-and-embeds.md](17-html-and-embeds.md)。

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| para-01 | 一次 Return 新段落 | 编辑时一次 Return 即可新段落；落盘段间一空行 | both | align | V1 含段落与换行 | V1 |
| para-02 | 异于经典双空行叙述 | Support 明确对比经典「两空行」与 Typora「一空行」 | support | align | 输入手感是 Typora-like 核心 | V1 |
| para-03 | Shift+Return 硬换行 | Shift+Return 产生 line break；落盘段内单 `\n` | both | align | V1 含换行 | V1 |
| para-04 | 兼容双空格 / br 说明 | 为其它解析器可保留行末两空格或 br | support | align | 源码保真允许用户手写兼容写法 | V1 |
| para-05 | 阅读态段落排版 | 非焦点段落呈正文样式 | both | align | V1 live preview 基础 | V1 |
| para-06 | 源码可见真实换行 | 源码模式显示空行与硬换行字符 | both | align | V1 源码模式 | V1 |
| para-07 | 粘贴多行拆分 | 粘贴多行如何分段未逐条核实 | unknown | unknown | 需实测后再定对齐 | Parity |
| para-08 | 连续空行保真 | 多 Return 产生的空行是否合并未核实 | unknown | differ | 保真优先：不静默合并用户空行，除非有明确产品决策 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 连续三次 Return 的视觉与源码 | 键入后切源码数空行 | para-08 |
| 从浏览器粘贴富文本/纯文本 | 分别粘贴，对比落盘 | para-07 |
| 硬换行在导出 HTML 的标签 | 导出或复制 HTML 查看 | para-03 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 本机核实 Return / Shift+Return 落盘形态 |
| 2026-07-11 | common-v1：段落阅读态与源码换行可见 |
