> 语言：**中文** · [English](../../../product/typora-competitive-analysis/07-images.md)

# 图片：Typora 竞品差距分析

> **菜单系统实施更新（2026-08-02）：** Format → Image、命令面板“图片”和 `Ctrl+Shift+I` 现在共用真实本地图片选择流程。Tauri 新增多选图片对话框并限制常见图片扩展名，取消选择保持文档不变；选中图片后继续复用既有 `createLocalImageReferences` 导入策略、草稿资源与文档切换保护。浏览器 E2E 通过注入文件命令证明菜单/快捷键编排，Windows Tauri 实机已验证本地化系统对话框可以打开、过滤器正确且取消后文档不变。因此下方旧摘要中“只插入 `![image](url)`、没有选择器和 `Ctrl+Shift+I`”已经过期，但右键资源管理、路径偏好持久化、批量移动/复制及真实文件选择后的自动化桌面闭环等差距仍然成立。

> **Parity Reliability 实施更新（2026-07-27）：** 下方主体保留为旧专题审计快照，其中“本地图片 watcher 未接到编辑器刷新入口”和 live preview DOM 必须包含完整隐藏源码的断言已经过期。当前文件 watcher revision 会进入图片 capability 的局部刷新入口；图片 owner 采用精确范围，selection 位于 owner 内才显示源码与下方预览，离开后恢复替换预览。拖放、粘贴、草稿迁移、远程缓存、本地图片磁盘刷新和源码模式精确 Markdown 均有浏览器/Rust 回归；保存转换继续通过精确序列化边界。完整图片选择器、策略持久化和事务回滚仍属于 Next，真实 Windows 系统剪贴板也未完成前台验证。当前范围以 [当前执行计划](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 与 [ADR 0003](../../decisions/0003-live-preview-assets-code-and-table-inline.md)、[ADR 0005](../../decisions/0005-external-file-and-image-watch.md) 为准。

## 2. 用途、范围与非目标

本文用于回答一个严格限定的问题：截至当前工作树，LumaMark 的图片功能究竟有哪些可由代码、测试和 fixture 共同证明，用户从创建图片引用到预览、编辑、保存和处理错误时会经历什么，与 Typora 1.13.7 的完整图片体验还差什么。本文以 `docs/product/typora-baseline/07-images.md` 和其直接引用的 `00-live-preview-model.md` 为 Typora 体验基线，以当前 `src/`、`src-tauri/`、`tests/`、依赖清单和实际聚焦验证为 LumaMark 事实来源。

范围包括标准 Markdown 图片语法、本地与远程来源、阅读态预览、焦点编辑态、源码模式、菜单与键盘、鼠标拖放、剪贴板位图、资源落盘、草稿迁移、错误边界、源码保真、安全和性能。非目标包括云图床供应商配置、数学或图表导出、替 LumaMark 决定最终产品范围，以及复述旧总报告。Typora 的公开行为只作为体验基准，不推断其私有实现。

文中的“功能存在”只表示仓库有可定位的执行路径；“体验追平”还要求入口、状态转换、真实桌面链路、错误恢复、可访问性、持久化与性能均有证据。规划文档只用于解释架构意图，不能单独证明功能已实现。

## 3. 执行摘要

LumaMark 已经越过“只能显示 Markdown 源码”的阶段：CodeMirror 图片 capability 能识别**独占一行的图片段落**，在非焦点时替换为居中的懒加载预览，点击预览把光标放回源码行；相对路径、Windows 绝对路径、`data:`、`blob:` 和 HTTP(S) 来源有分流处理。保存文档中的粘贴位图会写入固定的 `<文档名>.assets/image-NNN.ext`，未保存文档先使用 `lumamark-draft://` 引用并在首次保存时迁移；Tauri 侧限制文件类型和 12 MiB 大小，远程下载禁重定向、拒绝本地/私网地址，并按 URL 哈希缓存。图片插入相关的中英文文案、逐文件 asset scope 和多图异步插入顺序也有实现与测试。

但这仍不等于 Typora 图片体验已经追平。当前预览只覆盖“图片语法占满整行”的子集，普通段落内图片、链接包裹图片不渲染；焦点态是“源码行加下方预览”，而不是已经证实的 Typora 精细内联展开；菜单、命令面板和 `Ctrl+Shift+I` 已能选择本地图片，但浏览器拖出的 URL/HTML 图片仍没有导入路径；没有图片右键删除、移动、复制、重命名或批量 Move/Copy All；没有 `typora-root-url`、`typora-copy-images-to`、任意目标目录、`./` 前缀与 URL 转义偏好。复制到 assets 的设置只在 Zustand 内存 store 中，重启持久化没有证据。图片错误最终复用通用文件错误提示，不能向用户给出针对性的恢复动作。

新鲜验证进一步限制了结论：图片输入 Playwright、Rust `asset_service`、图片 capability 与 fixture 门禁均有通过记录。本地图片 revision 刷新入口及其控制器测试已经存在，但 `useAppDocumentModel` 创建文件工作流时没有把 `onLocalImageChanged` 接到该入口，默认回调仍为空操作，所以“本地图片在磁盘变化后自动刷新”当前只能判为部分实现。2026-07-22 已把图片 preview 的 selection-only 与普通尾部编辑从全树发现/同步路径中移出，并用围栏增删双向测试保护缓存失效；这只收窄编辑热路径风险，不等于建立了图片数量、解码、滚动和内存专项性能门禁。Playwright 仍使用注入的文件/asset 命令替身，证明浏览器层编排，不证明真实 Tauri 拖放、IPC、磁盘写入与 WebView asset protocol 的完整桌面链路。

## 4. Typora 功能与完整体验基线

### 4.1 创建

Typora 接受手写 `![alt](src "title")`，也提供 Windows/Linux `Ctrl+Shift+I`、Format → Image → Insert Local Images…、单个或多个本地文件拖入、浏览器图片拖入和剪贴板位图粘贴。插入时可按偏好保留路径、复制到指定目录、产生相对路径、决定是否保留 `./` 和是否转义 URL；`typora-copy-images-to` 可以写入 YAML。完整体验不是“能插一段字符串”，而是文件选择、路径策略、落盘失败与文档编辑作为一个可理解的事务。

### 4.2 阅读态

非焦点图片显示预览；图片独占段落时由主题 CSS 默认居中。来源可以是 URL、绝对路径或相对路径，YAML `typora-root-url` 可为本地预览提供前缀。损坏来源显示明确破图/错误态，而不是静默空白。图片段落仍对应原始 Markdown，渲染不能重排无关文本。

### 4.3 焦点编辑态

单击图片可修改 Markdown 源码。该行为属于 Typora live preview 的共同模型：阅读态隐藏结构，用户进入元素后露出必要源文，离开后恢复预览。完整追平还包括光标、选区、IME、撤销重做和滚动连续性，而不只是 DOM 中同时出现图片与源码。

### 4.4 源码模式

源码模式显示完整 `![alt](src "title")`，与 live preview 编辑同一份 Markdown；切换模式不应改写路径、alt、title、空白或换行。Typora 1.13 还声明模式切换保留滚动位置。

### 4.5 键盘与鼠标

键盘可用 `Ctrl+Shift+I` 打开图片插入入口。鼠标除单击进入源码外，还支持右键 Delete Image、Move/Copy/Rename 等资源动作；菜单含 Use Image Root Path 和 Move/Copy All Images。删除磁盘文件是高风险动作，必须与仅删除 Markdown 引用明确区分。

### 4.6 粘贴与保存

剪贴板位图需要已配置的存放位置或服务器；保存后的 Markdown 记录稳定图片引用。默认拖放可使用原文件路径，配置复制策略后才复制。保存与资源迁移必须处理重名、并发、部分失败、重试和孤儿文件，不应让用户在失败后得到一份引用已改但文件未落盘的文档。

### 4.7 错误与边界

基线包含不存在路径、远程下载失败、未配置粘贴目录、非法路径、批量文件、同名文件、HTML 对齐和仅图片段落居中。Typora 不提供内建对齐控件，用户可通过 HTML 控制；云上传细节不在本文展开。缩放手柄的精确 1.13.7 行为在基线中仍属未核实，不能据此给 LumaMark 判定追平或落后。

## 5. LumaMark 当前功能清单

以下每一项均区分执行代码、自动化测试与 fixture。测试文件存在只证明覆盖意图；本轮实际运行结果另见本节末尾。

1. **标准占位插入：已实现。** `src/editor/commands/markdownFormatCommands.ts:39-43` 将选区包装成 `![...](url)`；`src/features/commands/createCommandModels.ts:104-119,256-264` 把图片动作接入命令面板和 Format 菜单。`src/editor/commands/markdownFormatCommands.test.ts:39` 覆盖无选区时插入占位并选中 alt。
2. **独占行图片检测与阅读态预览：已实现。** `imagePreviewExtension.ts:71-99,126-154` 从 Lezer 语法树读取 `Image`，但 `lineText.trim() !== raw` 时明确拒绝，因此只预览图片独占行；`191-228` 用 block replacement/widget 切换阅读态。`imagePreviewExtension.test.ts:27,51,134,210` 分别覆盖检测、仅图片段落、非焦点预览和内联图片不替换。`tests/fixtures/markdown/remote-images.md:13` 明确把内联图片标成 source-only。
3. **焦点与点击编辑：部分实现。** `imagePreviewExtension.ts:205-225` 在选区进入图片行时保留源码并把预览放到行后；`260-270` 点击 figure 后把光标移到图片行起点。`imagePreviewExtension.test.ts:159,187` 覆盖点击露源码及焦点时预览仍可见。功能入口存在，但其“源码+预览持续并存”与 Typora 精确焦点体验没有像素和光标级对比证据。
4. **路径与来源解析：部分实现。** `imagePreviewExtension.ts:101-124,415-468` 支持 HTTP(S)/data/blob、绝对路径和基于文档目录的相对路径；`assetCommands.ts:302-380` 将本地授权和远程缓存分流。`imagePreviewExtension.test.ts:79,113,232,274,349` 覆盖绝对/相对/data/远程/未保存路径。没有 `typora-root-url`、YAML 路径根或 `file:` URL 兼容矩阵。
5. **本地多图原生拖放：已实现。** `src/services/assets/localImageDrop.ts:31-97` 监听 Tauri drag-drop，筛选 png/jpeg/gif/webp/svg，按 DPI 缩放换算落点并保留路径顺序；`useAppEditorCommands.ts:79-117` 将结果插入编辑器。`localImageDrop.test.ts:5,41,72` 覆盖顺序、坐标和跨显示器 scale factor；`useAppEditorCommands.test.tsx:41,73` 覆盖默认保留原路径与选择复制后的行为。
6. **DOM 拖放与剪贴板位图：已实现。** `imageInputExtension.ts:180-218` 只接管 `image/*` File；`137-177` 串行读取、保持原选区映射后插入。`imageInputExtension.test.ts:20,42,84,120` 覆盖多图顺序、异步期间文档变化和能力重配。`editor-image-input.spec.ts:58-105` 覆盖保存文档中的 drop/paste、预览和源码保持。
7. **特殊字符转义：已实现。** `imageInputExtension.ts:68-96` 转义 alt 中的反斜线/方括号，并在来源含空格、括号或尖括号时使用 angle destination；`imageInputExtension.test.ts:31` 有对应测试。
8. **保存文档位图入 assets：已实现。** `useAppEditorCommands.ts:66-76` 调用二进制 IPC；`assetCommands.ts:147-196` 拼装元数据长度加原始字节的 payload；Rust `asset_service.rs:73-145` 生成 `<stem>.assets/image-NNN.ext`、校验字节并原子写入。`assetCommands.test.ts:212`、`assets.rs:249-272` 与 `asset_service.rs:808-818` 覆盖 payload 和类型校验。
9. **未保存文档草稿图片与首次保存迁移：已实现。** `useAppEditorCommands.ts:46-64` 创建 `lumamark-draft://` 引用；`useAppDocumentModel.ts:59-64` 在保存前迁移；`asset_service.rs:158-175,232-339` 写草稿、拒绝路径穿越并只替换匹配占位。`fileActions.test.ts:36,235`、`asset_service.rs:865-977` 与 `editor-image-input.spec.ts:222-252` 覆盖渲染、迁移、重试和并发编辑保护。
10. **可选复制本地拖入图片：部分实现。** `SettingsDialog.tsx:47-52,103-114` 有 Images 页签和 checkbox；`appStore.ts:46-58` 默认关闭并在内存中更新；`assetCommands.ts:409-450` 仅在已有文档路径且用户选择时逐个复制。`AppShell.test.tsx:310` 与 E2E `editor-image-input.spec.ts:209` 覆盖切换。未发现设置持久化或任意目标目录。
11. **远程缓存与安全边界：已实现。** Rust `asset_service.rs:16-19,360-428` 使用 12 MiB 上限和 SHA-256 文件名；`430-533,628-676` 禁重定向、检查 content-type、拒绝 localhost/私网/非 HTTP(S)。`assets.rs:29-47` 在 blocking task 中下载。Rust 单元测试覆盖 loopback、超限、非文件 cache entry 和重定向；`src-tauri/tests/remote_image_live.rs:42-81` 提供需公网、默认忽略的真实下载测试。
12. **最小权限 asset protocol：已实现。** `tauri.conf.json:25-31` 启用协议但静态 scope 为空；`assets.rs:74-127` 逐文件解析和授权。`tests/quality/tauriAssetProtocol.test.ts:6-59` 覆盖 scope、CSP、禁止目录级授权和 blocking task。
13. **本地图片磁盘变更刷新：部分实现。** `imagePreviewExtension.ts:337-361` 同步本地来源，`assetCommands.ts:383-399,468-475` 维护 watch target 与 revision URL，`useAppEditorCommands.ts:185-207` 暴露 `refreshLocalImage`，对应 `useAppEditorCommands.test.tsx:237-280` 本轮通过。但 `useAppDocumentModel.ts:78-86` 创建 `useFileWorkflow` 时未传 `onLocalImageChanged`，而 `useFileWorkflow.ts:60-64` 的默认回调为空操作；文件监视事件尚未在真实 app 编排中触发 editor refresh，因此不能声称端到端体验可靠。
14. **错误与 i18n：部分实现。** `imagePreviewExtension.ts:284-337,382-412` 有下载中、相对路径不可用、缓存失败和加载失败的中英文 caption；`i18n.test.ts:73-78` 要求图片 key 双语齐全。插入失败在 `useAppEditorCommands.ts:195-200` 被写成 `asset.image_insert_failed`，但 `FileErrorNotice.tsx:10-23` 将未知 code 统一映射到通用操作失败，缺少图片类型、大小、权限、缓存等恢复指导。
15. **fixture 与源码 round-trip：部分实现。** `links-images.md`、`remote-images.md`、`live-preview-rich.md` 被 `markdownFixtureManifest.ts` 登记；`roundTrip.test.ts:8-72` 对清单文件执行打开—保存—字节比较。本轮该测试包含在 9 个全部通过的聚焦 Vitest 文件中，但 fixture 仍缺 title/空格路径/括号/破图/草稿冲突/HTML 对齐等系统矩阵。
16. **普通编辑热路径控制：部分实现。** `imagePreviewExtension.ts` 缓存已发现的图片块；selection-only 只在光标进入/离开缓存块时更新，普通尾部文本变更映射旧 block/decorations 并保留 widget。old/new 变更行命中真实 `Image` 或 fenced-code `CodeMark` 时保守重新发现，测试覆盖图片创建/修改/删除、相邻 closing fence 双向变化及 inline triple-backtick 不误触。尚无 100/500/1000 图片节点、真实解码、滚动 FPS 与内存基准。

验证边界：历史聚焦记录中 `editor-image-input.spec.ts` 为 9/9、Rust `asset_service` 为 20/20；2026-07-22 全量前端单测与 Rust 单测另行新鲜重跑，图片增量缓存回归包含在全量门禁中。默认忽略的公网测试仍未运行，也没有执行图片专属视觉报告、真实 Tauri 图片拖放/粘贴/asset protocol E2E 或图片专项性能基准。

## 6. 当前真实体验路径

### 6.1 手写或菜单插入

用户可手写图片 Markdown，或从 Format → Image/命令面板执行图片命令。后者只生成 `![image](url)` 并选中 alt，用户仍需手动把 `url` 改为路径；它不会打开文件选择器。图片独占一行且光标离开后，编辑器把整行替换为 figure 预览；图片混在正文或被链接包裹时保持源码。

### 6.2 本地文件拖入

真实 Tauri 原生 drop 提供文件绝对路径和物理坐标。默认设置下，LumaMark 直接把原始绝对路径写进 Markdown；用户在设置中临时开启复制后，已有路径的文档会把文件复制到 `<stem>.assets/` 再插入相对引用。多文件按来源顺序插入为多行。若用户切换文档或控制器卸载，异步复制结果会被丢弃。浏览器网页里拖出的图片如果没有形成 `image/*` File 或 Tauri 本地路径，目前没有 URL/HTML fallback。

### 6.3 粘贴位图

保存过的文档中，剪贴板 `image/*` 字节被发送给 Rust，校验后立即写入 assets，再插入引用。未保存文档写入应用数据目录并使用草稿 URI；首次 Save As 前，服务把匹配草稿复制到新文档 assets 并把迁移后的 Markdown 重新载入/保存。代码未显示迁移成功后清理草稿目录，也未显示用户撤销已入库图片时回收孤儿资源。

### 6.4 阅读、焦点与源码模式

阅读态图片居中、最大宽度 100%、最大高度 72vh，并带圆角和阴影。点击图片把光标定位到源码行开头；源码行出现，但预览仍留在其下。切到 Source Mode 后完整 Markdown 仍在原文中，E2E 对本地、远程和 Windows 路径均断言未被改写。title 是否完整参与预览、模式切换滚动是否稳定、IME 在图片语法中的组合态均没有专项体验证据。

### 6.5 错误路径

无文档路径的相对图片、未保存文档的远程图片、下载失败与 `<img>` load error 都会显示本地化 caption。导入失败则进入页面顶部通用错误 notice；用户只能关闭提示，不能从提示中重试、选择其他目录或查看具体原因。远程来源会被下载到文档旁 `.lumamark/assets/remote-cache`，原 Markdown URL 不改；这提升离线预览和安全控制，但也产生缓存生命周期与磁盘清理责任。

## 7. 逐项差距矩阵

| 能力点 | 状态 | 严重度 | 用户影响 | 证据 |
|---|---|---|---|---|
| 标准 `![]()` 与 title 源文 | 部分实现 | 中 | 可编辑标准语法，但 title/复杂 destination 的预览矩阵不完整 | `markdownFormatCommands.ts:39-43`；`imagePreviewExtension.ts:126-153` |
| 独占行阅读态预览 | 已实现 | 低 | 常见单图段落可阅读并居中 | `imagePreviewExtension.ts:191-228`；对应单测/E2E |
| 正文内联图片与链接图片预览 | 未实现 | 高 | 合法 Markdown 仍显示源码，破坏所见即所得连续性 | `imagePreviewExtension.ts:136-142`；单测明确不替换内联图片 |
| 单击进入源码 | 部分实现 | 中 | 能编辑，但源码与预览并存的焦点体验未证明追平 | `imagePreviewExtension.ts:260-270`；点击单测 |
| Source Mode 原文保持 | 已实现 | 低 | 本地/远程路径切换后仍可见原文 | 图片输入 E2E 8 项 |
| `Ctrl+Shift+I` | 未实现 | 中 | Typora 迁移用户的肌肉记忆失效 | `markdownFormatKeymap.ts:4-37` 无图片 binding |
| Insert Local Images 文件选择器 | 未实现 | 高 | 菜单只能插入语法模板，无法完成本地文件插入 | `createCommandModels.ts:116`；`markdownFormatCommands.ts:41-42` |
| 多本地文件原生拖放 | 已实现 | 低 | 常用批量插入路径可用 | `localImageDrop.ts:74-91`；三项 service 单测 |
| 浏览器图片/URL 拖放 | 未实现 | 中 | 从网页拖图无稳定插入结果 | 输入扩展只读取 `FileList`/`image/*` item |
| 保存文档粘贴位图 | 已实现 | 低 | 位图自动入固定 assets 并产生相对引用 | Rust 服务与 E2E |
| 未保存草稿位图首次保存迁移 | 已实现 | 中 | 新文档可先贴图后命名保存 | 草稿迁移 Rust/feature/E2E 证据 |
| assets 设置持久化 | 未实现 | 中 | 重启后用户偏好丢失 | `appStore.ts:46-58` 仅内存状态 |
| 任意复制目录与 `typora-copy-images-to` | 未实现 | 中 | 无法适配既有项目资源布局 | 无执行代码；基线 img-10 |
| `typora-root-url` | 未实现 | 高 | 带该 YAML 的 Typora 文档可能无法正确预览 | 当前仅按文档父目录解析 |
| `./` 与 URL 转义偏好 | 未实现 | 中 | 团队格式约定和跨解析器兼容性不足 | 只有固定 destination 转义函数 |
| 图片右键删除/移动/复制/重命名 | 未实现 | 高 | 资源管理必须离开编辑器手工完成 | context menu 模型只有通用/表格动作，无图片动作 |
| Move/Copy All 与远程本地化 | 未实现 | 中 | 文档迁移和离线整理成本高 | 无命令或 service facade |
| 破图/缓存错误可见 | 已实现 | 低 | 用户不会面对静默空白 | 图片 caption i18n 与 widget error |
| 可操作的错误恢复 | 未实现 | 高 | 失败后不知道是类型、大小、权限或网络问题，也不能重试 | `FileErrorNotice.tsx:10-23` 通用映射 |
| 本地图片外部变更刷新 | 部分实现 | 高 | 文件替换后预览可能陈旧；局部 revision 测试通过，但 app 未把 watch 事件接到刷新入口 | `useAppEditorCommands.ts:185-207`；`useAppDocumentModel.ts:78-86`；80/80 聚焦 Vitest |
| 逐文件 asset 最小权限 | 已实现 | 低 | 避免为预览开放整个文件系统 | Tauri config、command 与 quality test |
| 图片专属性能门禁 | 未实现 | 高 | 大量/大尺寸图片可能拖慢输入与滚动，当前无法量化 | `tests/perf/` 无图片 benchmark |
| 真 Tauri 图片端到端 | 证据不足 | 高 | 浏览器替身通过不能证明原生拖放、IPC、磁盘与 scope 联动 | E2E `beforeEach` 注入命令替身 |
| 图片删除后的孤儿资源清理 | 未实现 | 中 | assets、draft 与 remote-cache 可能持续增长 | 非测试代码无清理路径 |
| 缩放/尺寸编辑 UI | 证据不足 | 低 | Typora 精确基线本身未核实，暂不能作追平结论 | 基线 §9 |

## 8. 根因与架构影响

第一，当前实现选择了“图片独占行 block widget”作为可控薄切片，而不是完整 inline/replaced-range 模型。这降低了 selection 和 DOM 映射风险，却把合法的内联图片、链接图片和复杂段落排除在 WYSIWYG 外。继续把更多语法分支塞入 `imagePreviewExtension.ts` 会同时扩大 detection、path resolution、StateField、异步 resolver 和 DOM widget 的职责；`DETAILED_ARCHITECTURE.md:272` 已明确记录这一膨胀风险。

第二，图片存在两条输入链：Tauri 原生文件路径拖放走 `localImageDrop`，DOM File/clipboard 走二进制导入。两条链的默认落盘策略不同：原生拖放默认保留绝对路径，DOM drop 即使文档已保存也复制进 assets。用户看到的都是“拖入图片”，结果却取决于事件来源，这是体验一致性和源码策略的根因。

第三，资源事务跨 editor、app controller、TypeScript service、Tauri command 和 Rust service。当前分层总体符合契约：editor 只消费注入 handler/resolver，Rust command 保持薄入口；但保存前草稿迁移会改 Markdown，导入又可能先写文件后插引用，缺少统一的资源事务与生命周期策略，导致孤儿文件、失败补偿和清理无明确所有者。

第四，远程图片采用“下载到文档旁缓存再授权”的安全方案，避免 WebView 直接访问任意远程图片，也实现 SSRF 约束；代价是预览依赖文档已保存、扩展名白名单、网络与缓存目录。缓存失效、清理、重试和离线状态必须属于 `services/assets`/Rust asset service，而不能回流到 React store 或 editor hot path。

第五，`copyImagesToAssets` 是 app store 中的低频布尔值，容量风险很小，但没有持久化 facade。未来路径策略若继续堆成多个布尔值，会让 app/controller 持有隐式规则。应建立类型化 `ImageInsertionPolicy`，由 settings feature 持久化，editor 只接收一次插入请求所需的不可变策略快照。

## 9. 详细改进方案

### 9.1 模块归属

- `src/editor/capabilities/image/`：只负责 Markdown image 节点检测、阅读/焦点 decoration、光标和选区语义、图片命令公共接口。先拆出 `imageBlockDetection.ts`、`imagePathResolver.ts`、`ImagePreviewWidget.ts`，再扩展内联图片，避免单文件继续膨胀。
- `src/features/image-actions/`：承载 Insert Local Images、图片上下文菜单、仅删引用/删除文件、移动/复制/重命名和批量处理的用户用例；不得让 UI 直接调用 Tauri。
- `src/services/assets/`：提供导入、路径政策、缓存、watch、补偿/清理和批量动作 facade；统一 Tauri 原生 drop 与 DOM File 输入的政策决策。
- `src-tauri/src/services/asset_service.rs`：继续负责真实文件校验、原子写入、重名、移动/复制、远程下载安全和清理；commands 只做参数解码、blocking 调度与授权。
- `src/shared/`：只放 `ImageInsertionPolicy` 等无 React 依赖的类型、i18n key 和纯路径格式化规则，不放图片业务编排。

### 9.2 成熟依赖优先

继续使用 CodeMirror/Lezer 的 `Image` 节点，不自研 Markdown parser；菜单、dialog、tooltip 和 context menu 复用仓库已有 Radix 组件（`package.json` 已含 `@radix-ui/react-context-menu`、dialog 等），图标复用 lucide-react。文件选择使用 Tauri 官方 dialog API，文件系统与拖放使用 Tauri 官方能力。只有“源码保真下的 live preview decoration、插入事务与资源策略”属于 LumaMark 差异化代码。若要更换 parser、引入图像处理库或自研基础 context menu，必须另写依赖/决策记录并提供限制证据。

### 9.3 数据流与事务

统一入口为 `requestImageInsertion({ sources, insertionPoint, policy, documentContext })`。feature 收集文件/clipboard/URL，service 根据策略生成一个 prepare 结果：待插 Markdown、已创建资源及 rollback token；editor 在仍属于同一文档和映射后的位置执行单次 transaction；成功后 service commit，失败或 stale 时 rollback 新资源。批量插入必须全有或明确报告部分结果，不能静默丢图。首次保存时以相同事务迁移草稿，成功后清理草稿目录；删除引用时只改 Markdown，删除磁盘文件必须二次确认并检查其他引用。

### 9.4 源码保真

解析与渲染不得重建整行 Markdown。保存前除显式草稿 URI 迁移外不得改写 alt、title、尖括号 destination、斜杠风格、`./`、URL 编码、相对层级或空白。新增路径偏好只影响新插入，不批量重写既有引用，除非用户明确执行 Move/Copy All。为 `typora-root-url` 建立只读解析上下文，不能擅自删除或规范化 YAML。

### 9.5 i18n、可访问性与错误处理

所有菜单、dialog、tooltip、确认文本、错误和状态必须同时提供中英文 key。预览 `img.alt` 继续来自 Markdown alt；空 alt 保持装饰图语义并避免重复朗读 caption。figure 点击需提供等价键盘动作，焦点状态可见，context menu 可由键盘打开；加载状态用不打断输入的 status/`aria-live="polite"`，致命导入失败用 `role="alert"`。错误需按类型映射为本地化、可执行结果：不支持格式、超过 12 MiB、无权限、路径不可用、网络失败、缓存冲突分别给出“选择其他文件/保存文档/重试/保留原 URL”等动作，禁止只显示通用失败。

### 9.6 阅读与焦点体验

先覆盖 CommonMark image 的完整 AST 位置矩阵：独占段落、正文内联、链接包裹、title、escaped destination。内联图片使用 decoration/widget，但选区进入其语法范围时完整露源码；不要把每次 selection change 变成全篇 O(n) 扫描。焦点态应通过与 Typora 实机截图/录屏对比决定是保留预览、隐藏预览还是局部展开，不能仅按当前测试固化未经验证的交互。

## 10. P0/P1/P2 分阶段计划

### P0：可靠的核心闭环

1. 把 `useFileWorkflow` 的 `onLocalImageChanged` 从 app document/shell 编排接到现有 `refreshLocalImage`，补 app 级集成测试与真实外部原子替换验证；现有 controller 局部测试不能替代这条链路。
2. 为 Format → Image 和命令面板接入 Tauri 本地文件多选 dialog；补 `Ctrl+Shift+I`，同时保留手写占位命令作为独立“插入图片语法”动作或合并成一致入口。
3. 统一原生 drop 与 DOM drop 的路径政策，消除同一用户动作因事件来源产生不同落盘结果。
4. 建立资源 prepare/commit/rollback，补草稿迁移后清理和插入失败的孤儿文件补偿。
5. 增加图片类型化错误映射、双语恢复动作和真 Tauri 最小桌面 E2E。
6. 建立图片专项 perf 基线后再扩展预览范围。

### P1：完整常用体验

1. 支持正文内联图片、链接图片、title 与复杂 destination 的阅读/焦点转换。
2. 持久化 `ImageInsertionPolicy`，支持相对/绝对、固定 `.assets`、`./` 与转义策略；设置变化只影响后续插入。
3. 支持浏览器 URL/HTML 图片拖入，并明确“保留远程 URL”或“下载本地”的选择。
4. 增加图片 context menu：编辑 alt/source/title、仅删引用、复制路径、在文件管理器显示；高风险删除磁盘文件必须确认和引用检查。
5. 支持 `typora-root-url` 只读解析兼容，并补跨平台路径矩阵。

### P2：资源治理与 parity

1. 支持移动、复制、重命名与 Move/Copy All Images，包含远程图片本地化、冲突预览、可取消进度和回滚。
2. 评估 `typora-copy-images-to` 兼容或提供显式迁移工具；若不兼容，在导入 Typora 文档时给出清晰说明。
3. 加入缓存/草稿/孤儿 assets 清理策略、磁盘占用展示与恢复机制。
4. 在 Typora 精确实机复核后决定缩放/尺寸编辑是否进入 parity，避免对未核实基线过度实现。

## 11. 可执行验收标准与测试计划

### 11.1 验收标准

1. 独占行、正文内联、链接图片、含 title、空 alt、中文 alt、空格/括号路径在 live preview 与源码模式间切换后原始字节不变。
2. `Ctrl+Shift+I`、Format 菜单和命令面板打开同一多选文件 dialog；取消不改文档、不创建资源，成功一次 undo 可撤销全部插入文本。
3. 本地原生 drop、DOM File drop、粘贴采用同一明确策略；多图顺序稳定，异步期间编辑/切换文档不会把结果插到错误文档。
4. 未保存位图可预览；首次保存迁移成功后不再含草稿 URI且草稿文件被清理；任一步失败时 Markdown、最终文件和草稿仍可重试，不产生半迁移。
5. 相对路径、Windows drive、UNC、POSIX、`./`、`../`、URL query/fragment、`typora-root-url` 均有明确结果；现有源文不会因打开/预览被规范化。
6. 破图、超限、非法 MIME、权限、远程失败、缓存冲突都显示双语具体原因和至少一个可执行恢复动作；键盘用户能完成与鼠标等价的插入和编辑。
7. asset scope 始终是逐文件授权，SSRF、重定向、大小上限和 symlink 防护不因 parity 功能放宽。
8. 本地图片被外部原子替换后，file-watch 事件经 app 编排调用 `refreshLocalImage`，预览 URL revision 更新且 Markdown 不变；该行为必须由 app 级集成测试和真实桌面链路共同证明。

### 11.2 Unit

- `imageBlockDetection`：所有 CommonMark 图片节点形态、选择相交、linked image、转义 alt、title、无 URL。
- `imagePathResolver`：Windows/POSIX/UNC/相对/YAML root、URL query/fragment、非法 scheme。
- `ImageInsertionPolicy`：所有入口产生一致策略结果，设置序列化/迁移可逆。
- 资源事务：prepare、stale、commit、rollback、重名、并发、同字节重试和清理。
- 错误映射与 i18n：每个 Rust/IPC code 在中英文都有专用文案和恢复动作。

### 11.3 Integration

- CodeMirror transaction 覆盖点击预览、键盘进入、选区跨图片、IME、undo/redo、模式切换和滚动锚点。
- React controller + service facade 覆盖 dialog/drop/paste、文档切换、unmount、watch revision 和设置重启恢复。
- Tauri command + Rust service 使用临时目录验证真实字节导入、逐文件 scope、草稿首次保存、失败回滚和孤儿清理。

### 11.4 E2E

- 浏览器层保留现有 9 项，并新增菜单文件选择、快捷键、内联/链接图片、失败提示、键盘访问和主题截图。
- 新增至少一条打包或 Tauri driver 真实桌面链路：真实拖入两个本地文件→磁盘策略→预览→Source Mode→保存→重开→外部替换图片→自动刷新。
- 浏览器拖图分别覆盖 File、`text/uri-list` 和 HTML 三种 DataTransfer；对不支持来源显示明确反馈。

### 11.5 Fixture

新增 `images-core.md` 或扩充现有图片 fixture，至少包含：独占行、内联、链接图片、title、空 alt、中文、空格、括号、`./`、`../`、Windows/UNC、远程 query/fragment、data URL、破图、`typora-root-url`。每次 editor/path/save 改动运行 open→save→diff，非显式资源迁移场景无关 diff 必须为 0；迁移场景只允许预先列出的 URI 替换。

### 11.6 Perf

性能测试必须独立运行，不与 E2E/build/typecheck 并行。建立 100/500/1000 个图片节点、20 个可视大图、重复远程 URL、快速滚动、连续输入、selection 移动和 watch burst 场景；记录 decoration 构建时间、输入 P95、滚动帧、图片解码前后内存、远程并发数和取消率。目标是普通输入尽量低于 16 ms、不可视图片不主动解码、重复 URL 共享请求、文档切换取消旧任务、全篇检测不随每次光标移动做不可控 O(n) 工作。只有独立 `pnpm perf:bench` 新增图片基准并稳定通过后，才能声称性能体验已验证。

## 12. 风险与未核实项

1. 当前工作树包含大量未提交改动；本报告描述的是 2026-07-12 本轮读取到的工作树，不代表主分支或已发布版本。
2. 聚焦 Vitest 80/80 通过，但只证明 watch target、revision URL 和 controller 刷新入口等局部行为；`useAppDocumentModel` 尚未传入 `onLocalImageChanged`，真实 app 事件链仍断开，该风险不能因局部测试全绿而关闭。
3. Playwright 图片输入测试注入 `__LUMAMARK_E2E_ASSET_COMMANDS__` 和 `convertFileSrc` 替身，没有验证真实 Tauri dialog、drag-drop、binary IPC、磁盘权限或 WebView scope 的联动。
4. `src-tauri/tests/remote_image_live.rs` 默认 ignored 且本轮未运行；公网服务器、代理、证书、DNS rebinding 和离线恢复的真实表现未核实。
5. 没有运行 `editor-image-visual.spec.ts`，因此亮/暗主题、缩放、长 alt、破图和焦点态的视觉追平未核实。
6. Typora 单击展开的精确 DOM/像素行为、未配置存放目录时粘贴反馈、缩放 UI 仍在基线未核实清单中；本文不把推测写成差距事实。
7. SVG 虽受扩展名和基础 XML 起始检查，但 SVG 主动内容、WebView 隔离与 CSP 的完整安全评审不在现有测试证据中。
8. 远程 cache、草稿和 assets 的清理/配额没有实现证据；长时间写作可能积累磁盘占用。
9. 设置未持久化意味着测试中的 checkbox 成功只代表当前会话状态，不代表重启体验。
10. 2026-07-22 的真实 Tauri 人机工学链路覆盖文件、保存点、恢复、代码块和通用 10MB 输入，没有执行图片拖放、剪贴板位图、远程缓存或外部图片替换；因此“真 Tauri 图片端到端”继续保持证据不足。

## 13. 证据索引

### 13.1 基线与契约

- `AGENTS.md`：架构分层、成熟组件优先、源码保真、i18n、图片性能与文档验证要求。
- `DEVELOPMENT_PROCESS.md`：纯文档例外、fixture round-trip、E2E、性能与完成门禁。
- `docs/product/typora-baseline/07-images.md`：Typora 1.13.7 图片专题事实与未核实项。
- `docs/product/typora-baseline/00-live-preview-model.md`：阅读态/焦点态/源码模式、复制粘贴和 IME 横切模型。

### 13.2 前端实现

- `src/editor/capabilities/image/createImageCapability.ts`
- `src/editor/capabilities/image/imagePreviewExtension.ts`
- `src/editor/capabilities/image/imageInputExtension.ts`
- `src/editor/capabilities/image/image.css`
- `src/editor/commands/markdownFormatCommands.ts`
- `src/editor/commands/markdownFormatKeymap.ts`
- `src/features/commands/createCommandModels.ts`
- `src/services/assets/assetCommands.ts`
- `src/services/assets/localImageDrop.ts`
- `src/app/controllers/useAppEditorCommands.ts`
- `src/app/controllers/useAppDocumentModel.ts`
- `src/features/settings/SettingsDialog.tsx`
- `src/app/stores/appStore.ts`
- `src/features/file-actions/FileErrorNotice.tsx`
- `src/shared/i18n/locales/en.json` 与 `zh-CN.json`

### 13.3 Rust、配置与依赖

- `src-tauri/src/commands/assets.rs`
- `src-tauri/src/services/asset_service.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`：`sha2`、`ureq` 来自项目配置的阿里云 registry。
- `package.json`、`pnpm-lock.yaml`：CodeMirror/Lezer Markdown、Radix context menu/dialog、lucide 等现有成熟依赖；未发现专用图片 UI/处理依赖。

### 13.4 测试与 fixture

- `src/editor/capabilities/image/*.test.ts`
- `src/services/assets/assetCommands.test.ts`
- `src/services/assets/localImageDrop.test.ts`
- `src/app/controllers/useAppEditorCommands.test.tsx`
- `src/features/file-actions/fileActions.test.ts`
- `tests/e2e/editor-image-input.spec.ts`
- `tests/e2e/editor-image-visual.spec.ts`
- `tests/quality/tauriAssetProtocol.test.ts`
- `tests/fixtures/roundTrip.test.ts`
- `tests/fixtures/markdown/links-images.md`
- `tests/fixtures/markdown/remote-images.md`
- `tests/fixtures/markdown/live-preview-rich.md`
- `tests/fixtures/markdownFixtureManifest.ts`
- `src-tauri/tests/remote_image_live.rs`
