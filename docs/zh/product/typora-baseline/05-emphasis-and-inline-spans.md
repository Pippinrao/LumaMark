> 语言：**中文** · [English](../../../product/typora-baseline/05-emphasis-and-inline-spans.md)

# 强调与行内 Span

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Span Elements（Emphasis / Strong / Code / Strikethrough / Emoji / Inline Math / Sub / Sup / Highlight） |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | Inline Math、Subscript、Superscript、Highlight 需在 Preferences → Markdown 开启 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 斜体、粗体、行内代码、删除线、emoji 短码；Preferences 门控的 highlight / sub / sup / inline math 的语法表面；光标进入 span 展开。
- **范围外：** 链接与图片（[06](06-links.md)、[07](07-images.md)）；块级公式（[09](09-math.md)）；HTML `<u>` 等（[17](17-html-and-embeds.md)）。

## 2. 语法表面

行内元素在键入后即解析渲染；光标移到 span 中部展开为源码。`support`（见 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时)）

| 能力 | 语法 | Preferences | 出处 |
|---|---|---|---|
| 斜体 | `*text*` 或 `_text_`（推荐 `*`） | 否 | support |
| 粗体 | `**text**` 或 `__text__`（推荐 `**`） | 否 | support |
| 行内代码 | `` `code` `` | 否 | support |
| 删除线 | `~~text~~` | 否 | support |
| Emoji | `:smile:`；或菜单 Edit → Emoji & Symbols 插入 UTF-8 | 否 | support |
| 行内公式 | `$...$` | 是 | support |
| 下标 | `~text~`（例 `H~2~O`） | 是 | support |
| 上标 | `^text^`（例 `X^2^`） | 是 | support |
| 高亮 | `==text==` | 是 | support |

- GFM：词内下划线不触发强调（如 `wow_great_stuff`）。`support`
- 反斜杠可转义字面量 `*` / `_`。`support`
- 行内公式触发预览：输入 `$` 后按 Esc 再输入 TeX（Reference 记载）。`support`
- 行内公式 Pandoc 风格规则与 legacy 兼容模式见 [09-math.md](09-math.md)。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非焦点 span 显示渲染样式（斜体/粗体/等宽/删除线等），定界符隐藏。`support`
- **本机 1.13.7 截图：** `**boldspan**` 显示为加粗 “boldspan”，定界符不可见。`observed`（`80-center.png`）
- Emoji 短码渲染为图形/字符。`support`
- 未开启 Preferences 的扩展应保持为字面文本（期望）；关闭时的确切回退未逐条核实，`unknown`。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入 span 中部 → 展开 Markdown 源码。`support`
- 展开后可编辑定界符与内容；离开后重新渲染。`support`（模型）
- 行内公式在开启后另有 `$` + Esc 触发路径。`support`

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 输入定界符包裹；`:emoji` 自动完成助手 | support |
| 快捷键 | 粗斜体等常见快捷键（本节未全部列出） | unknown |
| 菜单 | 格式菜单；Edit → Emoji & Symbols | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴已带定界符的文本可解析 | unknown |
| 其它UI | Emoji 自动完成弹层（输入 `:` 后） | support |

## 6. 源码模式与落盘形态

- 落盘保留用户定界符风格（`*` vs `_`）；Typora 推荐 `*` / `**` 但不等于自动改写。`support`
- 源码模式显示全部定界符。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- Preferences 关闭时，`==` / `~` / `^` / `$` 是否仍写入文件：作为普通字符应可存在；渲染关闭。`support`（功能门控）

## 7. 边界、失败与保真

- 未配对定界符应尽量保持用户输入，避免「智能修复」破坏源码。
- 词内 `_` 忽略是 GFM 规则，对齐时需一致。`support`
- 转义 `\\*` 应显示字面量。`support`
- Inline math 与货币 `$2`：Pandoc 风格规则避免误识别。`support`（Math 页）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| span-01 | 斜体 * / _ | 单星或单下划线强调；阅读态隐藏定界符 | both | align | V1 含 italic | V1 |
| span-02 | 粗体 ** / __ | 双定界符 strong；阅读态隐藏 | both | align | V1 含 bold | V1 |
| span-03 | 推荐 * / ** | Typora 推荐星号风格 | support | align | 输入可用任一；不强制改写 | V1 |
| span-04 | 行内代码 backtick | 反引号行内代码；阅读态隐藏 | both | align | V1 含 inline code | V1 |
| span-05 | 删除线 ~~ | GFM strikethrough；焦点展开浅灰 `~~` | both | align | V1 含 strikethrough | V1 |
| span-06 | 光标中部展开 | 进入 span 展开源码（粗体见浅灰 `**`） | both | align | V1 live preview 编辑模型 | V1 |
| span-07 | 阅读态隐藏定界符 | 非焦点只看样式 | both | align | V1 符号隐藏 | V1 |
| span-08 | 词内 _ 忽略 | GFM 不解析词内下划线；本机 `word_with_underscore` 保持纯文本 | both | align | 与 GFM 一致减少误伤 | V1 |
| span-09 | 反斜杠转义 | \\* 得字面量 | support | align | 源码保真 | V1 |
| span-10 | Emoji :name: | 短码与自动完成 | support | defer | 非 V1 必达 | Parity |
| span-11 | Highlight == | 需 Preferences | support | defer | 门控扩展 | Parity |
| span-12 | Sub/Sup ~ ^ | 需 Preferences | support | defer | 门控扩展 | Parity |
| span-13 | Inline math $ | 需 Preferences；规则见 Math | support | defer | 公式整体非 V1 | Parity |
| span-14 | 定界符风格保真 | 不把 _ 静默改成 * | support | differ | 源码保真优先于风格统一 | V1 |
| span-15 | 格式快捷键 | 具体键位未全核实 | unknown | align | V1 格式菜单/快捷键 | V1 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 粗斜体快捷键 | 查格式菜单旁标注 | span-15 |
| 关闭 highlight 后 == 显示 | 关偏好，重启/重载，看字面量 | span-11 |
| Emoji 自动完成列表 | 输入 `:sm` | span-10 |
| 嵌套 ***粗斜体*** | 键入并移入移出光标 | span-06 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 本机核实粗体光标进入展开浅灰 `**` |
| 2026-07-11 | common-v1：斜体/粗体/删除线/行内代码阅读态；`~~` 焦点展开；词内 `_` 不解析 |
