# 图片

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Images；Images in Typora |
| Support URL | https://support.typora.io/Images/ ；https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | Image Insert（相对路径、复制到文件夹、转义、全局图片设置等）；粘贴剪贴板图片需配置存放位置 |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** `![alt](src)` 语法；拖拽/菜单/粘贴插入；相对路径与 `typora-root-url`；单击编辑源码；单图段落默认居中 CSS；对齐用 HTML；删除/移动/复制图片上下文菜单与菜单命令。
- **范围外：** 云上传服务商细节的逐步配置（Support 有专节，本基线只记能力存在）；数学/图表导出中的图片。

## 2. 语法表面

```markdown
![Alt text](/path/to/img.jpg)
![Alt text](/path/to/img.jpg "Optional title")
```

- `src` 可为 URL 或绝对/相对文件路径。`support`
- 拖拽本地或浏览器图片可插入；同目录或子目录拖拽时使用相对路径。`support`
- YAML `typora-root-url` 可为本地预览指定 URL 前缀。`support`
- 对齐：Typora 本身不提供对齐控件；可用 HTML（如在图片后加对齐相关 HTML）。`support`
- 默认：段落内仅含一张图片时居中（主题 CSS）。`support`

## 3. 阅读态（非当前 / 非焦点）

- 非焦点显示图片预览（能解析路径/URL 时）。`support`
- 单图段落默认居中。`support`
- 损坏路径显示错误态（Support 提及 `.md-img-error` 相关 CSS）。`support`
- **本机 1.13.7 截图：** 相对路径 `sample.png` 显示为蓝色方块预览；`no-such-file.png` 显示破图/缺失图标，并露出部分 Markdown 源码文本。`observed`（`231-pagedown.png`）

## 4. 编辑态（光标进入 / 焦点）

- **单击图片**可修改 Markdown 源码。`support`
- 右键：Delete Image（可删磁盘文件）、Move/Copy/Rename 等。`support`
- 焦点模型见 [00 §2](00-live-preview-model.md#2-块级焦点模型当前块--非当前块)。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 手写 `![]()` 语法 | support |
| 快捷键 | Windows/Linux：`Ctrl+Shift+I` 插入图片 | support |
| 菜单 | Format → Image → Insert Local Images…；When Insert…；Use Image Root Path；Move/Copy All Images | support |
| 拖拽 | 拖入一个或多个图片文件；浏览器拖拽 | support |
| 粘贴 | 剪贴板图片数据：需先设定存放文件夹/服务器；macOS 还可粘贴 Finder 文件 | support |
| 其它UI | 单击编辑源码；右键删除/移动/复制；偏好相对路径与转义 | support |

## 6. 源码模式与落盘形态

- 落盘为 `![alt](src "title")`。`support`
- 相对路径偏好、`./` 前缀、URL 转义由 Preferences / 插入时选项决定。`support`
- `typora-copy-images-to` 等可写入 YAML Front Matter。`support`
- 源码模式显示完整图片语法。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 默认拖拽：使用原文件路径作为 `src`，除非开启复制到文件夹等选项。`support`
- Delete Image 可能删除磁盘文件；仅删引用则选中 Markdown 删除。`support`
- 远程图 Move/Copy All 时可下载到本地并改引用。`support`
- 调整大小见 Support 另文；本基线不展开像素级 UI，`unknown` 细节进 §9。
- 1.13：`<img>` 在 `<p>` 内尊重相对路径设置。`support`（What's New 1.13）

## 8. LumaMark 对齐

LumaMark V1 的本地图片策略是：拖入本地文件默认保留原绝对路径；用户可显式开启复制到固定的 `<文档名>.assets/` 目录。剪贴板位图在未保存文档中先进入草稿图片目录，并在首次保存时迁移到 `.assets`。这不等同于 Typora 的任意目标文件夹和 YAML `typora-copy-images-to` 工作流。

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| img-01 | ![]() 语法 | 标准图片 Markdown | both | align | V1 含基础图片预览 | V1 |
| img-02 | 本地/URL src | 支持路径与 URL | both | align | V1 基础预览 | V1 |
| img-03 | 拖拽插入 | 拖放插入图片 | support | align | V1 常用插入路径 | V1 |
| img-04 | 相对路径默认 | 相对当前 md 解析 | support | align | 工作区相对资源 | V1 |
| img-05 | 单击编辑源码 | 点击图片改 Markdown | support | align | 与 span 编辑模型一致 | V1 |
| img-06 | 阅读态预览 | 非焦点显示图像；破图露缺失图标与部分源码 | both | align | V1 基础预览 | V1 |
| img-07 | 单图段落居中 | 默认 CSS 居中 | support | defer | 主题细节可 Parity | Parity |
| img-08 | HTML 对齐 | 无内建对齐，用 HTML | support | defer | HTML 能力见 17；非 V1 重点 | Parity |
| img-09 | 粘贴剪贴板图 | 需配置存放位置 | support | align | V1 以草稿图片目录和首次保存迁移覆盖无源路径位图 | V1 |
| img-10 | 复制到给定文件夹 | Preferences + YAML typora-copy-images-to | support | defer | Typora 专有工作流属性 | Parity |
| img-11 | typora-root-url | YAML 前缀本地预览 | support | defer | Typora 专有元数据 | Parity |
| img-12 | 右键删/移/拷图 | 上下文菜单管理文件与引用 | support | defer | 资源管理增强 | Parity |
| img-13 | Move/Copy All Images | 菜单批量处理含远程下载 | support | defer | 批量资源工具 | Parity |
| img-14 | 相对路径 ./ 前缀选项 | 偏好可强制 ./ | support | defer | 兼容性选项 | Parity |
| img-15 | 插入时 URL 转义 | 可自动 escape | support | defer | 偏好项 | Parity |
| img-16 | 多图一次拖入 | 支持一次多个文件 | support | align | 与拖拽插入一并做 | V1 |
| img-17 | 源码完整语法 | 源码显示 ![]() | both | align | V1 源码模式 | V1 |
| img-18 | 云上传插入 | 可上传到图床 | support | defer | 非 LumaMark 核心；避免绑定专有上传生态 | 非目标 |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 单击展开的源码内联 UI | 单击已插入图 | img-05 |
| 未配置文件夹时粘贴位图 | 清空图片插入设置后 Ctrl+V | img-09 |
| 单图居中在当前主题 | 段落仅一张 PNG | img-07 |
| 缩放手柄/对话框 | 按 Support「Resize images」链接操作 | （未单列 ID） |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
| 2026-07-12 | 更新 LumaMark 本地拖放、`.assets` opt-in 与剪贴板草稿迁移对齐状态 |
