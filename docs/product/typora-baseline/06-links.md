# 链接

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Links / URL’s |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（基础链接） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 行内链接、引用式链接、内部标题锚点链接、自动 URL / `<>` URL；单击展开 vs Ctrl/Cmd+Click 打开。
- **范围外：** 图片（`![]()`，见 [07](07-images.md)）；脚注引用（[12](12-footnotes.md)）。

## 2. 语法表面

### 行内链接

```markdown
This is [an example](http://example.com/ "Title") inline link.
[This link](http://example.net/) has no title attribute.
```

`support`

### 内部链接

- 使用标题名作为 href，例如 `[text](#block-elements)`；按住 Cmd（Windows：Ctrl）并点击可跳转到该标题。`support`

### 引用式链接

```markdown
This is [an example][id] reference-style link.

[id]: http://example.com/ "Optional Title Here"
```

- 隐式名称：`[Google][]` + `[Google]: http://google.com/`。`support`

### URL

- `<email@example.com>` 形式；标准 URL（如 `www.google.com`）也可自动成链。`support`

### 交互

- **单击链接：** 展开以便编辑。`both`（本机：`501-plain-crop.png` 可见 `[OPENME](http…)`）
- **Command/Ctrl + 单击：** 在浏览器中打开超链接。`both`（本机右键「打开链接」旁标注 `Ctrl+点击`，用户已点开目标）
- 右键菜单首项为 **打开链接**（快捷提示 Ctrl+点击），另有 **复制链接地址**。`observed`（`723-menu.png`）

## 3. 阅读态（非当前 / 非焦点）

- 非焦点显示为可辨识的链接文本样式；URL/title 定界符隐藏。`support`
- **本机 1.13.7 截图：** `[linktext](https://example.com)` 显示为带下划线的 “linktext”（主题下可呈蓝色），括号与 URL 不可见。`observed`（`61-c.png` / `80-center.png`）
- 自动链接的视觉与普通链接类似。`support`

## 4. 编辑态（光标进入 / 焦点）

- 单击或光标进入中部 → 展开 Markdown 源码以编辑。`both`（见 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时)）
- Ctrl/Cmd+Click 或右键「打开链接」打开，不进入「仅展开」路径。`both`

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 输入 `[text](url)` 等语法后渲染 | support |
| 快捷键 | 插入链接快捷键（常见 Ctrl+K 类；本节未写死） | unknown |
| 菜单 | 格式 → 链接类项（文案 GUI `unknown`） | unknown |
| 拖拽 | 不适用（图片拖拽见 07） | support |
| 粘贴 | 剪贴板若为 URL，插入图片流程会填 src；链接场景类似期望未全核实 | unknown |
| 其它UI | Ctrl/Cmd+Click 或右键「打开链接」；单击展开 | both |

## 6. 源码模式与落盘形态

- 行内：`[text](url "title")`；引用式保留定义行。`support`
- 源码模式显示完整语法。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。
- 自动链接落盘可能仍是裸 URL 或 `<>` 包裹，取决于用户输入；不臆测自动改写。

## 7. 边界、失败与保真

- 损坏 URL、空 href 的渲染未详述，`unknown`。
- 内部锚点与标题 slug 生成规则（空格、中文、标点）未在本节逐步规范，`unknown`。
- 引用式链接定义行位置任意（「文档中某处」）。`support`

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| link-01 | 行内链接语法 | `[text](url)` 与可选 title | support | align | V1 含链接 | V1 |
| link-02 | 引用式链接 | `[text][id]` + 定义行 | support | align | V1 基础 Markdown | V1 |
| link-03 | 内部锚点链接 | #heading 跳转 | support | defer | 大纲跳转有；文档内 Ctrl+Click 锚点 Parity 打磨 | Parity |
| link-04 | 自动 URL | 裸 URL / <> 可成链 | support | defer | 非 V1 必达自动链接 | Parity |
| link-05 | 单击展开编辑 | 单击展开 `[text](url)` 源码 | both | align | V1 span 编辑模型 | V1 |
| link-06 | Ctrl+Click / 打开链接 | Windows：Ctrl+单击或右键「打开链接」打开目标 | both | align | 基础链接可用性 | V1 |
| link-07 | 阅读态链接样式 | 非焦点显示为链接文本（蓝/下划线） | both | align | V1 live preview | V1 |
| link-08 | 源码完整语法 | 源码显示 []() | both | align | V1 源码模式 | V1 |
| link-09 | 插入链接快捷键 | 键位未核实 | unknown | align | V1 格式菜单含链接 | V1 |
| link-10 | 锚点 slug 规则 | 中文/标点 slug 未核实 | unknown | unknown | 需实测再定 | Parity |
| link-11 | 隐式引用名 | [Google][] 写法 | support | defer | 低频语法放 Parity | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| Ctrl+Click 是否用系统默认浏览器 | 点击 http 链接 | link-06 |
| 中文标题锚点 | `[x](#中文标题)` | link-03, link-10 |
| Ctrl+K 是否存在 | 试快捷键与菜单 | link-09 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-11 | 阅读态链接样式升为 both；单击/Ctrl+Click 仍待稳定复现 |
| 2026-07-11 | 本机核实单击展开为 `[OPENME](…)`；用户确认右键「打开链接」可打开目标 |
