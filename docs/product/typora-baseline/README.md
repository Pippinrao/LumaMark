# Typora 行为基线文档集

本目录是 LumaMark 对 **Typora 公开写作体验** 的行为基线事实库。目标是把「Typora 实际怎么表现」写成可引用、可对齐、可复核的专题文档，供产品、UX、编辑器实现与验收使用。

## 1. 用途与非用途

### 用途

- 记录 Typora（当前观测版本 **1.13.7**）在 live preview / 源码模式下的公开行为。
- 为 LumaMark 的「追平 / 延后 / 刻意差异」决策提供可核对的事实与出处。
- 把横切交互模型（焦点、span 展开、换行、复制粘贴、IME、符号隐藏）集中在 [00-live-preview-model.md](00-live-preview-model.md)，专题文档只写本主题增量。

### 非用途

- 不是 LumaMark 产品规格书；LumaMark 范围以 [V1 版本设计](../V1_VERSION_DESIGN.md) 与 [V1 UX 设计](../V1_UX_DESIGN.md) 为准。
- 不是竞品战略文档；战略判断留在 [竞品策略](../COMPETITOR_STRATEGY.md)。
- 不复制 Typora 专有素材、品牌元素或私有实现细节。
- 不猜测未公开的内部实现；未核实项进入各文档 §9。

## 2. 阅读约定

### 出处标记（provenance）

| 标记 | 含义 |
|---|---|
| `support` | 来自 Typora 官方 Support 文档，本机未逐条点击复核 |
| `observed` | 本机在观测环境中实际核实 |
| `both` | Support 有记载，且本机已核实 |
| `unknown` | 尚未核实；不得当作已确认事实写入 §1–§7 的断言句 |

### 文档结构

- 专题文档 `01`–`17` 使用统一十节结构（见 [_TEMPLATE.md](_TEMPLATE.md)）。
- **§1–§7 只写 Typora 事实**，禁止夹带 LumaMark 建议。
- **§8 是唯一允许写 LumaMark 对齐的位置**，表格列固定。
- 横切行为只在 `00` 展开；专题用链接引用 `00` 锚点。

### 对齐取值

| LumaMark | 含义 |
|---|---|
| `align` | V1 或明确阶段内应对齐该行为 |
| `defer` | 承认 Typora 有此行为，但当前阶段不做 |
| `differ` | 因源码保真或架构约束刻意不同 |
| `unknown` | 事实或产品取舍尚未定 |

| 阶段 | 含义 |
|---|---|
| `V1` | 落在 V1 范围 |
| `Parity` | 追平 Typora 阶段 |
| `非目标` | 明确不做或长期非目标 |

## 3. 观测环境

| 项 | 值 | 出处 |
|---|---|---|
| Typora 路径 | `C:\Program Files\Typora\Typora.exe` | `observed` |
| Typora 版本 | **1.13.7** | `observed` |
| OS | Windows 10/11（界面语言：简体中文菜单已观测） | `observed` |
| 观测日期 | 2026-07-11 | `observed` |
| 中文菜单 | 文件 / 编辑 / 段落 / 格式 / 视图 / 主题 / 帮助；侧栏「文件」「大纲」 | `observed` |

### 主引用 Support 页面

- [Markdown Reference](https://support.typora.io/Markdown-Reference/)
- [Images](https://support.typora.io/Images/)
- [Math](https://support.typora.io/Math/)
- [Draw Diagrams With Markdown](https://support.typora.io/Draw-Diagrams-With-Markdown/)
- [What's New 1.13](https://support.typora.io/What's-New-1.13/)（MathJax v4、Mermaid 11.13.0、源码/hybrid 滚动位置保留、Copy as Plain Text）
- [Quick Start](https://support.typora.io/Quick-Start/)（Live Preview 定义、默认 Copy as HTML、Smart Paste）
- [Shortcut Keys](https://support.typora.io/Shortcut-Keys/)（Windows/macOS 常用快捷键）

多数语法与交互事实以 `support` 编码；**版本号与安装路径为 `observed`**。GUI 点击路径中未在本机逐条复核者，在下方 CRITICAL 清单与各文档 §9 标为 `unknown`，并给出建议复核步骤。

复核状态约定：`partial` = Support 骨架为主；`partial+` = 常用阅读态/源码保真/关键交互已本机核实（夹具 `common-v1.md` 等），键入创建路径与菜单项可能仍有 `support`/`unknown`。

## 4. 文档索引

| 文件 | 主题 | 复核状态 |
|---|---|---|
| [00-live-preview-model.md](00-live-preview-model.md) | Live Preview 横切交互模型 | partial+ |
| [01-paragraphs-and-breaks.md](01-paragraphs-and-breaks.md) | 段落与换行 | partial+ |
| [02-headings.md](02-headings.md) | 标题 | partial+ |
| [03-blockquotes.md](03-blockquotes.md) | 引用块 | partial+ |
| [04-lists-and-task-lists.md](04-lists-and-task-lists.md) | 列表与任务列表 | partial+ |
| [05-emphasis-and-inline-spans.md](05-emphasis-and-inline-spans.md) | 强调与行内 span | partial+ |
| [06-links.md](06-links.md) | 链接 | partial+ |
| [07-images.md](07-images.md) | 图片 | partial+ |
| [08-code-blocks.md](08-code-blocks.md) | 代码块 | partial+ |
| [09-math.md](09-math.md) | 数学公式 | partial+ |
| [10-tables.md](10-tables.md) | 表格 | partial+ |
| [11-mermaid-and-diagrams.md](11-mermaid-and-diagrams.md) | Mermaid 与图表 | partial |
| [12-footnotes.md](12-footnotes.md) | 脚注 | partial |
| [13-horizontal-rules.md](13-horizontal-rules.md) | 水平线 | partial+ |
| [14-yaml-front-matter.md](14-yaml-front-matter.md) | YAML Front Matter | partial |
| [15-toc.md](15-toc.md) | TOC | partial |
| [16-callouts.md](16-callouts.md) | Callouts / Alerts | partial |
| [17-html-and-embeds.md](17-html-and-embeds.md) | HTML 与嵌入 | partial |
| [_TEMPLATE.md](_TEMPLATE.md) | 专题文档模板 | — |

## 5. 对齐决策树

新增或复核一条行为点时，按顺序判断：

1. **事实是否成立？** 有 Support 或本机观测 → 写入 §1–§7；否则进 §9，对齐用 `unknown`。
2. **是否属于横切？** 是 → 只在 `00` 写事实，专题引用锚点。
3. **是否在 LumaMark V1 范围？**（标题、段落/换行、粗斜体/删除线、引用、ul/ol、任务列表、hr、行内代码、围栏代码+语言、链接、基础图片预览、基础表格、Mermaid fence）→ 优先 `align` + `V1`。
4. **是否为公式？** → `defer` + `Parity`（V1 明确延后）。
5. **是否 Preferences 门控扩展？**（highlight、sub/sup、callouts、diagrams 开关下的 sequence/flow 等）→ `defer` + `Parity`。
6. **是否与源码保真或架构冲突？**（例如代码块内强行 WYSIWYG 隐藏）→ 才允许 `differ`，并写清理由。
7. **其余追平项** → `defer` + `Parity`，或事实不清时 `unknown`。

## 6. 质量门禁

写完或更新本目录文档后必须自检：

- [ ] 无 TBD / TODO / 空节。
- [ ] §1–§7 无 LumaMark 建议句。
- [ ] §8 表格列完整：`ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段`。
- [ ] LumaMark 列仅 `align|defer|differ|unknown`；阶段仅 `V1|Parity|非目标`。
- [ ] 对齐 ID 数量不低于各文件下限（见各文件 §8）。
- [ ] 未核实 GUI 细节进入 §9，不编造 `observed`。
- [ ] 不引用 Typora 专有素材文件。
- [ ] `docs/README.md` 已索引本目录。

## 7. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| [竞品策略](../COMPETITOR_STRATEGY.md) | 战略与节奏；行为细节以本目录为准 |
| [V1 版本设计](../V1_VERSION_DESIGN.md) | LumaMark V1 范围与非目标；决定 §8 的 align/defer |
| [V1 UX 设计](../V1_UX_DESIGN.md) | LumaMark live preview UX 目标；不替代 Typora 事实 |
| [详细架构](../../architecture/DETAILED_ARCHITECTURE.md) | 实现约束；可解释 `differ`，不改写 Typora 事实 |

## 8. CRITICAL 实测清单（15 项）

观测环境：Typora **1.13.7** / Windows；夹具 `artifacts/typora-observe/gui-test.md` 与 `observe.md`；截图证据见同目录 `60-simple.png`、`80-center.png`、`61-c.png` 等。

| # | 项 | 当前状态 | 证据 / 剩余缺口 |
|---|---|---|---|
| 1 | Typora 版本 1.13.7 | `observed` | 可执行文件 ProductVersion |
| 2 | 一次 Return = 新段落 | `both` | 夹具 `break-test.md`：`ONLYLINE` + Return + `SECONDPARA` → 落盘 `ONLYLINE\n\nSECONDPARA\n` |
| 3 | Shift+Return = 硬换行 | `both` | 同夹具：`SHIFTBASE` + Shift+Return + `HARDBREAK` → 落盘 `SHIFTBASE\nHARDBREAK\n`（无空行） |
| 4 | 非当前块隐藏 Markdown 符号 | `observed`（阅读态） | 截图：`#` / `**` / 链接语法 / `[ ]` 均不可见 |
| 5 | 行内 span 光标进入展开 | `observed` | 点击粗体 `boldtarget` 后露出浅灰 `**`（`312-bold-click.png` / `410-plain.png`） |
| 6 | 链接阅读态与打开手势 | `both` | 单击展开为 `[OPENME](…)`（`501-plain-crop.png`）；右键「打开链接 / Ctrl+点击」可打开目标（用户本机已点开） |
| 7 | 图片预览与破图 | `observed` | `231-pagedown.png`：本地图预览；破图露缺失图标与 `![missing](...)` |
| 8 | 任务列表阅读态与点击 | `both` | 空心圆/实心圆+勾；点击未选中圆后落盘 `- [ ]` → `- [x]`（`span-test.md`） |
| 9 | 表格阅读态与焦点工具栏 | `observed` | 焦点表时出现对齐/行列浮动工具栏（`231-pagedown.png`） |
| 10 | 代码围栏阅读态 + 源码保真 | `both` | 边框等宽块 + 高亮；源码保留 fence |
| 11 | 数学块渲染 | `both` | 空文档 `$$`+Return 可创建（用户确认）；编辑态灰框+「公式」✓；退出后居中预览且 `$$` 隐藏；源码保留 `$$` |
| 12 | Mermaid 预览 | `observed` | `A → B` 流程图已渲染（本机 Diagrams 已启用） |
| 13 | `[toc]` 源码保留；预览生成目录 | `both` | 源码保留 `[toc]`；预览生成 “H1 Title” 项 |
| 14 | 源码/hybrid 切换保留滚动 | `both`（近似） | What's New 1.13 声明；本机滚到底并点击可见区后 `Ctrl+/`：源码停在文末 `[toc]`/图片行（`630`/`631`）；切回 hybrid 仍在文后半（`632`），非精确像素对齐 |
| 15 | Copy as Plain Text | `both` | 右键 →「复制 / 粘贴为…」→「复制为纯文本」（`432-copy-as-submenu.png`） |

**本轮已 observed 的结论：**

- Return / Shift+Return 落盘形态与 Support 一致（段间空行 vs 段内单换行）。
- 粗体 / 链接 span：光标或单击进入后展开源码定界符。
- 任务列表：圆形 checkbox；点击可改落盘 `[ ]`/`[x]`。
- 上下文菜单含「复制为纯文本 / Markdown / HTML」等项。
- 模式切换：光标在可见区时，hybrid↔源码大致保留文末附近位置（非像素级断言）。
- 阅读态符号隐藏、公式/代码/表/Mermaid/TOC/图片：同前。

**仍待人工点验：** 无（CRITICAL 与常用功能主路径已覆盖；低频 Preferences/学术扩展仍见各篇 §9）。

**自动化说明：** DPI-aware `PrintWindow` + `SendInput`（硬超时）可截图与键鼠；点击目标需按正文像素定位。PowerShell `SendKeys` 易挂起，已弃用。
