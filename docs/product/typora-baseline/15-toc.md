# Table of Contents（TOC）

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference；本机源码模式复制 |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** `[toc]` 生成目录、自动更新、阅读态与源码落盘形态。
- **范围外：** 导出 HTML 侧栏大纲锚点细节；侧边栏 Outline 面板（非 `[toc]` 语法）。

## 2. 语法表面

- 输入 `[toc]` 后按 Return，创建 “Table of Contents” 区块。`support`（Markdown Reference → TOC）
- TOC 从文档标题提取，并随标题增删自动更新。`support`
- **非法/不触发：** 未按 Return 确认的行内 `[toc]` 文本可能仍是普通段落内容（确认时机 GUI `unknown`）。

## 3. 阅读态（非当前 / 非焦点）

- 阅读态显示由标题生成的目录列表，而不是字面 `[toc]`。`support`
- **本机 1.13.7 截图（弱证据）：** 在代码块下方出现独立的 “H1 Title” 排版块，位置与源文 `[toc]` 段一致，更像生成目录项而非字面 `[toc]`；尚未用增删标题验证自动更新。`observed`（预览形态，待加强）
- 无标题时的空态表现本机未截图，`unknown`。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入 TOC 块后的可编辑性（能否改生成列表、是否回到 `[toc]` 源码）Support 未逐步说明，标 `unknown`。
- 删除 TOC：用户可删除该块；精确键序 `unknown`。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | `[toc]` + Return | support |
| 快捷键 | 无单独公开默认快捷键 / 不适用 | support |
| 菜单 | 未在 Reference 主文强调 / 不适用或未知 | unknown |
| 拖拽 | 不适用 | support |
| 粘贴 | 可粘贴含 `[toc]` 的源码 | support |
| 其它UI | 不适用 | support |

## 6. 源码模式与落盘形态

- **本机观测（2026-07-11，Typora 1.13.7）：** 打开含 `[toc]` 的 `observe.md`，切换源码模式并全选复制，源文中 **保留字面 `[toc]`**，并未展开为标题列表。`observed`
- 同一文件 Ctrl+S 后磁盘内容仍含 `[toc]`。`observed`
- 因此：live preview 显示生成目录，**落盘/源码模式保持 `[toc]` 标记**（而非展开后的链接列表）。`both`（Support 描述自动更新 + 本机源码核对）
- 模式总览见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 标题变更后 TOC 内容自动更新（预览层）。`support`
- 若用户需要「展开后的静态目录」写入文件，Typora 默认 `[toc]` 标记策略可能不符合——这是行为事实，不是缺陷判定。`both`
- 与侧边栏大纲：Outline 是 UI 导航，`[toc]` 是文档内语法块，二者不同。`support`（概念区分）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| toc-01 | `[toc]`+Return 创建 | 键入 `[toc]`+Return 生成 TOC 块 | support | defer | V1 未列 TOC 语法 | Parity |
| toc-02 | 预览自动更新 | 随标题变化更新目录 | support | defer | 非 V1 | Parity |
| toc-03 | 阅读态显示生成目录 | 预览显示标题项而非字面 `[toc]` | both | defer | 非 V1 | Parity |
| toc-04 | 源码保留 `[toc]` | 源码/落盘保持标记不展开（本机 1.13.7 核对） | both | align | 若支持 TOC，必须源码保真不展开写入 | Parity |
| toc-05 | 无标题空态 | 未核实 | unknown | unknown | 需实测 | Parity |
| toc-06 | 编辑态进入 TOC | 焦点行为未核实 | unknown | unknown | 需实测 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 无标题时 TOC 显示 | 删除全部标题，观察 TOC 块 | toc-05 |
| 光标进入 TOC 是否露出 `[toc]` | 点击 TOC 区域，再切源码对照 | toc-06 |
| 菜单是否可插入 TOC | 查 Paragraph/插入类菜单 | toc-01 |

## 10. 变更记录

| 日期 | 角色 | 摘要 |
|---|---|---|
| 2026-07-11 | agent | 初稿；本机确认源码/落盘保留 `[toc]` |
