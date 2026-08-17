> 语言：**中文** · [English](../../../product/typora-baseline/14-yaml-front-matter.md)

# YAML Front Matter

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference；Images（`typora-root-url` / copy-images） |
| Support URL | https://support.typora.io/Markdown-Reference/ ；https://support.typora.io/Images/ |
| Preferences 依赖 | 无（部分键影响图片行为） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** 文首 YAML Front Matter 的创建、编辑、阅读表现；与图片相关的 Typora 扩展键（如 `typora-root-url`、`typora-copy-images-to`）。`support`
- **范围外：** 正文水平线 `---`（见 [13-horizontal-rules.md](13-horizontal-rules.md)）；完整 YAML 模式校验器；导出元数据映射细节。

## 2. 语法表面

- 在文章**顶部**输入 `---` 后按 Return，引入 metadata 块。`support`（Markdown Reference → YAML Front Matter）
- 也可从 Typora 顶部菜单插入 metadata 块。`support`
- 常见扩展键（非标准 Markdown，属 Typora 行为扩展）：
  - `typora-root-url:` — 为以 `/` 开头的图片路径提供本地预览前缀。`support`（Images）
  - `typora-copy-images-to:` — 插入本地图时复制到指定相对目录。`support`（Images）
- **非法/不触发：** 非文首的 `---` 更可能被当作水平线或普通分隔，而不是 Front Matter。`support`（与 HR 节对照；文首歧义见 §7）

## 3. 阅读态（非当前 / 非焦点）

- Front Matter 在 live preview 中通常以可折叠/弱化的元数据区呈现，而不是正文段落流。`support`（公开「metadata block」模型；折叠 UI 像素细节 GUI `unknown`）
- 横切阅读态原则见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)。

## 4. 编辑态（光标进入 / 焦点）

- 光标进入 metadata 块后可编辑键值文本。`support`
- 菜单 `Format` → `Image` → `Use Image Root Path` 可自动生成 `typora-root-url`。`support`（Images）
- 开启「复制图片到文件夹」并选择目标后，会向当前文档 YAML 写入 `typora-copy-images-to: {relative path}`。`support`（Images）

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 文首 `---` + Return | support |
| 快捷键 | 无单独公开默认快捷键 / 不适用 | support |
| 菜单 | 顶部菜单可插入 metadata；Image 菜单可写入 root-url / copy-images 键 | support |
| 拖拽 | 不适用（拖拽图片可能间接触发 copy-images 键写入） | support |
| 粘贴 | 可粘贴 YAML 文本进块内 | support |
| 其它UI | Image 相关菜单项改写 YAML 键 | support |

## 6. 源码模式与落盘形态

- 源码模式显示完整 `---` … `---` 包裹的 Front Matter。`support`
- 落盘为文档开头的 YAML 文本；正文在闭合 `---` 之后。`support`
- 模式总览见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- **文首歧义：** 文首 `---` + Return 走 Front Matter；正文中的 `***`/`---` 走水平线。`support`
- **非法 YAML：** Support 未规定严格 schema；解析失败时的 UI 提示本机未录，`unknown`。
- **键影响预览：** `typora-root-url` 只影响 Typora 内预览解析，不把用户 `![alt](/path)` 改写成绝对路径（除非用户另做 Move/Copy 图片操作）。`support`（Images）
- 与源码保真相关：自动插入 `typora-copy-images-to` 会改写文档头部，属于用户开启功能后的预期写入。`support`

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| yaml-01 | 文首 `---`+Return 创建 | 顶部 `---`+Return 引入 metadata 块 | support | defer | V1 未承诺 Front Matter 专用 UX | Parity |
| yaml-02 | 菜单插入 metadata | 可用菜单插入 | support | defer | 非 V1 必需 | Parity |
| yaml-03 | 源码完整显示 | 源码模式可见完整 YAML | support | align | 源码模式应显示真实源文 | V1 |
| yaml-04 | 落盘保真 | 以文首 YAML 文本落盘 | support | align | 源码保真要求不吞元数据 | V1 |
| yaml-05 | typora-root-url 预览前缀 | YAML 键影响本地图片预览根路径 | support | defer | Typora 专有键；V1 可用其它资源解析策略 | Parity |
| yaml-06 | typora-copy-images-to | 插入图时复制并写 YAML 键 | support | defer | 属工作流扩展，非 V1 基线 | Parity |
| yaml-07 | 与 HR 文首歧义处理 | 文首 `---` 优先 Front Matter | support | align | 打开既有文档时需可预期解析 | Parity |
| yaml-08 | 非法 YAML 提示 | 失败 UI 未核实 | unknown | unknown | 需实测后再定 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| Front Matter 折叠/展开控件 | 打开含 YAML 的文档，观察阅读态控件 | yaml-01 |
| 非法 YAML 可见失败 | 写入破损 YAML，看是否提示 | yaml-08 |
| 非文首 `---` 是否误开 Front Matter | 在正文中部输入 `---`+Return | yaml-07 |

## 10. 变更记录

| 日期 | 角色 | 摘要 |
|---|---|---|
| 2026-07-11 | agent | 初稿：YAML Front Matter 与图片相关扩展键 |
