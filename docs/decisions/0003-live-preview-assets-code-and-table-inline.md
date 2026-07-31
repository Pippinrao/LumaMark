# ADR 0003：Live Preview 图片缓存、代码高亮和表格内嵌语法

日期：2026-07-09

更新：2026-07-12（补充本地图片授权与插入策略）

更新：2026-07-27（接通本地图片定点刷新与保存前草稿图片 finalize）

## 背景

V1 live preview 需要补齐图片、代码块和表格内嵌语法体验，同时继续遵守源码保真、成熟组件优先和 editor capability 边界。远程图片如果直接使用网络 URL，离线和跨平台稳定性较弱；如果自动改写 Markdown，又会破坏用户源码意图。代码块需要常见语言语法高亮，但不应替换 CodeMirror。表格交互已经由 `codemirror-markdown-tables` 承担，不能回退到自研整表编辑器。

## 决策

- 远程图片采用文档旁本地缓存展示：下载到 `.lumamark/assets/remote-cache/`，预览使用本地 asset URL，Markdown 源码保持原 URL。
- 远程图片缓存仅接受无凭据的公网 HTTP(S) 地址：拒绝 localhost、私网/链路本地/保留直连 IP 和 DNS 解析出的非公网地址；下载禁用自动重定向，并设置连接与总请求超时。
- 既有缓存条目必须是小于 12 MiB 的普通文件；拒绝目录、符号链接和其他非普通文件，避免将缓存命中变成任意路径读取或写入入口。
- 远程图片下载完成后复用文件服务的同目录原子写入基础设施发布缓存；写入或同步失败时不覆盖既有缓存文件。
- `assets_cache_remote_image` 是异步 Tauri command，阻塞 HTTP 下载在 Tauri runtime 的 blocking worker 中执行，不占用 command 线程。
- 图片缓存通过 app/service 层注入 `ImageAssetResolver` 给 editor capability；editor capability 不直接依赖 Tauri、app、features 或 services。
- service 层按“文档路径 + 远程 URL”共享进行中的缓存请求；重复图片 block 不会重复触发 IPC、网络下载或缓存写入，任务结束后立即释放 key。
- Tauri asset protocol 静态 scope 保持为空；成功打开或保存文档后，由 Rust 文件 command 为该文档父目录动态授予递归 asset scope。这样相对图片和文档旁远程缓存可加载，同时不会让 WebView 在启动时拥有整个文件系统的 asset 读取范围。
- 既有 Markdown 中的本地绝对路径、相对路径和远程 URL 只做运行时解析、授权或缓存，预览不得改写 Markdown 源码。文档目录之外的本地绝对图片必须先由 Rust 验证为受支持的普通图片，再通过 `allow_file` 仅授权该文件。
- 原生本地文件拖放默认保留 Tauri 返回的原绝对路径作为 Markdown `src`。只有用户在设置中开启“复制插入的本地图片到文档资源目录”，且当前文档已经有保存路径时，才把图片复制到 `<文档名>.assets/` 并插入相对引用；未保存文档没有稳定目标目录时仍保留原路径。
- 剪贴板位图没有可保留的原文件路径：已保存文档直接写入 `<文档名>.assets/`；未保存文档先写入应用草稿图片目录并使用 `lumamark-draft://` 占位，首次保存时迁移到 `<文档名>.assets/` 并只替换对应占位引用。
- Windows 原生拖放使用 Tauri `onDragDropEvent` 获取文件路径；物理坐标在进入 editor 层前按窗口 scale factor 转换为 CSS 逻辑坐标。只有落点位于编辑器内才插入，异步复制完成前若文档已切换或控制器已卸载则丢弃结果。
- 代码块语言高亮使用 CodeMirror 官方语言包：`@codemirror/language-data` 覆盖常见语言，`@codemirror/lang-javascript` 直接支持 `js/jsx/ts/tsx`。
- 代码块整块预览只使用 CodeMirror 行级 decoration。禁止在通用 WYSIWYG 链路中对 `FencedCode` 施加跨多行 mark decoration，因为跨行 mark 上的 padding、border 或 line-height 会破坏光标定位、选区和背景对齐。
- 表格仍以 `codemirror-markdown-tables` 为整表交互核心；LumaMark 只补 inactive cell 的 inline Markdown 薄渲染层。该薄层必须使用 sibling overlay 呈现视觉预览，保留 `.tbl-cell-view` 源码 DOM 给成熟组件负责选区和编辑。默认显示 overlay、隐藏源码视觉；鼠标 hover 或 focus 时隐藏 overlay、露出源码符号，点击后进入 cell editor 编辑原 Markdown。

### 2026-07-27 实现更新

- 本地图片引用由 `ImageAssetResolver.syncLocalSources` 同步为 watcher targets。图片事件把规范化 path 对应的 revision 写入 resolver、失效旧授权缓存，再通过 `EditorDocumentPort.refreshImages(path)` 向 image capability 派发刷新 effect。
- decoration 会重建图片 widget 候选，但 widget identity 包含对应 source 的 revision；只有命中该 path 的图片获得新 asset URL（`lmv=<revision>`），无关 widget 复用，Markdown source 不发生 transaction。
- 首次保存前，file workflow 从 editor 的精确序列化快照调用 `finalizeAllDraftImages`，按文档中首次出现顺序迁移各 draft batch 并替换 `lumamark-draft://` 引用。只有文件写入成功且原快照仍是当前文档时，转换文本才以最小 CodeMirror changes 映射回主文档并标记保存点；失败时不把占位替换提交到正文，并保留 dirty。
- 当前 finalize 会先原子复制目标图片，再写 Markdown 文件；若图片迁移成功而后续文档写入失败，可能留下未被文档引用的 asset 文件。这不是完整文件系统事务，图片策略持久化与事务回滚仍属于 [当前计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)的 Next 阶段。精确快照与最小 changes 合同见 [ADR 0006](0006-parity-reliability-editor-contracts.md)。

## 被否决方案

- 自动把远程图片链接改写成本地相对路径：离线更彻底，但会主动修改用户 Markdown 源码。
- 默认把拖入的本地图片复制到 `.assets`：会在用户未选择资源管理策略时改变路径语义，因此只允许显式 opt-in。
- 恢复 `$HOME/**/*`、`$PICTURE/**/*` 等宽泛静态 asset scope：实现简单，但让 WebView 在启动时获得不必要的文件读取范围。
- 在 editor capability 内直接调用 Tauri command：会破坏 editor 与 service/app 层边界。
- 自研代码高亮或完整表格编辑器：没有证据证明成熟组件不能满足当前主要目标，维护成本和编辑器热路径风险更高。

## 影响

- 新增 npm 依赖：`@codemirror/language-data`、`@codemirror/lang-javascript`、`@lezer/highlight`、`@lezer/markdown`、`markdown-it`。
- 新增 Rust 依赖：`ureq` 和 `sha2`。`ureq` 自带的 HTTP URI 解析能力负责 URL 结构校验，并使用受控 resolver 过滤 DNS 结果。阿里云 registry 下 `reqwest 0.13.4` 与当前 lockfile 的 `wasm-bindgen` 链接版本冲突，因此本轮选择更小的成熟阻塞 HTTP 客户端 `ureq`。
- asset protocol scope 从全局 `**/*` 收紧为按成功打开或保存过的文档目录动态授权。打开多个文档会累计这些目录的 scope；Tauri 当前 scope API 没有对应的允许模式移除接口，因此如果未来需要在关闭文档时回收访问权，应改用受当前文档上下文验证的自定义 asset 服务。
- 未保存文档不创建文档旁远程图片缓存；UI 显示可本地化提示。
- 本地文件插入设置是低频应用状态，不进入 CodeMirror 文档状态或输入热路径；切换设置不会重建编辑器。
- watcher revision 只影响运行时 resolver 与 widget identity；不会修改图片引用、dirty 状态或撤销历史。
- 代码块预览不再把整段 fenced code 包成跨行 mark；视觉表面由 `.lm-md-code-block-line` 行级类承担，避免改变 CodeMirror 行盒模型。
- 表格 inline 渲染当前覆盖 mature table widget 能稳定承载的 inactive cell 内容；overlay 预览层不能改写 `.tbl-cell-view.innerHTML`，否则会破坏 `codemirror-markdown-tables` 的 selectionchange、cell editor 同步和后续源码更新。

## 回滚或复审条件

- 图片缓存破坏源码保真、产生不可控目录污染，或下载路径带来安全风险。
- 图片 watcher 刷新导致无关 widget 重建、源码变化、undo 记录或可测量输入延迟。
- 草稿图片迁移的孤立 asset 文件不可接受，或需要跨图片与 Markdown 写入的原子回滚。
- 动态 asset scope 无法满足多文档或关闭文档后的最小权限要求，需要改用自定义受控 asset protocol。
- 远程图片并发量、取消策略或下载进度需求超过当前 blocking worker + 去重模型的承载范围，需要引入可取消任务注册表或流式下载器。
- 受控 resolver 所依赖的 `ureq::unversioned` 扩展 API 在后续 `ureq` 小版本升级时出现兼容性变化，或出现无法在不阻塞 command 线程的前提下保证取消与并发去重。
- CodeMirror 语言包显著增加启动时间或包体积。
- `codemirror-markdown-tables` 对内嵌语法、IME、撤销重做或复制粘贴的限制阻塞 V1 写作体验。
