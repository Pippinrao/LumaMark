# ADR 0003：Live Preview 图片缓存、代码高亮和表格内嵌语法

日期：2026-07-09

更新：2026-07-12（补充本地图片授权与插入策略）

更新：2026-07-27（接通本地图片定点刷新与保存前草稿图片 finalize）

更新：2026-08-04（收紧表格 inline preview 与原生 cell editor 的光标几何合同）

更新：2026-08-04（取消 sibling overlay，改为组件源码 DOM 的 token 级呈现）

更新：2026-08-12（明确代码块语言提示、围栏补齐与行盒几何合同）

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
- 表格仍以 `codemirror-markdown-tables` 为整表交互核心。inactive `.tbl-cell-view` 与激活后的 nested CodeMirror 都直接使用 CodeMirror/Lezer 的 syntax token DOM：定界符和链接目标仅以 CSS 隐藏，粗体、斜体、删除线、代码和链接标签在同一源码 DOM 上呈现。禁止再创建 sibling overlay、第二份 HTML 文本表面或手工坐标映射。
- 组件管理的 `.tbl-cell` 不增加额外 padding；组件 cell view 与 nested editor 共享固定字号、字体族和 token CSS。隐藏 token 的规则必须同时覆盖 inactive view 与 nested editor，保证点击坐标、显示 caret 和源码 selection 使用同一布局。
- 表格光标回归必须使用真实浏览器坐标验证：按可见字符 `Range` 计算点击点，断言激活后的 nested CodeMirror selection 和 root selection 都落在同一字符边界，并在输入后继续保持同一单元格。jsdom 不提供可靠的字体布局与原生 caret，不能替代这项 E2E。

### 2026-07-27 实现更新

- 本地图片引用由 `ImageAssetResolver.syncLocalSources` 同步为 watcher targets。图片事件把规范化 path 对应的 revision 写入 resolver、失效旧授权缓存，再通过 `EditorDocumentPort.refreshImages(path)` 向 image capability 派发刷新 effect。
- decoration 会重建图片 widget 候选，但 widget identity 包含对应 source 的 revision；只有命中该 path 的图片获得新 asset URL（`lmv=<revision>`），无关 widget 复用，Markdown source 不发生 transaction。
- 首次保存前，file workflow 从 editor 的精确序列化快照调用 `finalizeAllDraftImages`，按文档中首次出现顺序迁移各 draft batch 并替换 `lumamark-draft://` 引用。只有文件写入成功且原快照仍是当前文档时，转换文本才以最小 CodeMirror changes 映射回主文档并标记保存点；失败时不把占位替换提交到正文，并保留 dirty。
- 当前 finalize 会先原子复制目标图片，再写 Markdown 文件；若图片迁移成功而后续文档写入失败，可能留下未被文档引用的 asset 文件。这不是完整文件系统事务，图片策略持久化与事务回滚仍属于 [当前计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)的 Next 阶段。精确快照与最小 changes 合同见 [ADR 0006](0006-parity-reliability-editor-contracts.md)。

### 2026-08-12 代码块实现更新

- “上下空一行”按稳定视觉节奏实现，不作为打开、渲染或保存时的源码规范化规则。已有 Markdown 不会被补写块外空行；只有用户在 live preview 中对一个真实、尚未闭合的 opening fence 明确按 Enter 时，输入 transaction 才生成可编辑的空正文行和匹配 closing fence。
- 自动闭合保留反引号或波浪线字符、围栏长度、0–3 个前导空格和完整 info string；已有 closing fence 不重复生成。paste、IME composition、非空选区、程序化载入、undo/redo 与 source mode 不被当作自动闭合触发源。
- 语言提示继续复用 `@codemirror/language-data` 的名称与 alias。已知语言显示官方规范名称，未知语言只显示用户原始 info 首词并保持无高亮降级；不引入语言选择器或另一份 alias 表。
- 聚焦提示消费 ADR 0006 的共享 `EditorInteractionContext.activeBlocks`，在 code-block capability 的 opening `Decoration.line` 上附加视觉属性，并把语言描述同步到活动代码行及当前聚焦的 CodeMirror content DOM。视觉由绝对定位、`pointer-events: none` 的伪元素呈现；它不是 block widget，不创建第二份可交互文本，也不修改通用 fence/source reveal 合同。
- 代码块 focused/inactive 两态只改变背景色和 inset border token。禁止在代码块行或多行 mark 上增加专属 vertical margin、padding、line-height、transform 或不可选占位；真实 `.cm-line` 的 DOM 边界与 CodeMirror height map 必须保持一致。

## 被否决方案

- 自动把远程图片链接改写成本地相对路径：离线更彻底，但会主动修改用户 Markdown 源码。
- 默认把拖入的本地图片复制到 `.assets`：会在用户未选择资源管理策略时改变路径语义，因此只允许显式 opt-in。
- 恢复 `$HOME/**/*`、`$PICTURE/**/*` 等宽泛静态 asset scope：实现简单，但让 WebView 在启动时获得不必要的文件读取范围。
- 在 editor capability 内直接调用 Tauri command：会破坏 editor 与 service/app 层边界。
- 自研代码高亮或完整表格编辑器：没有证据证明成熟组件不能满足当前主要目标，维护成本和编辑器热路径风险更高。
- 保留或继续调参 sibling overlay：即使短期对齐，格式化 token、字体、换行或组件 DOM 变化仍会形成两套几何事实来源。
- 继续把表格字号设为相对 `em`，再为每个嵌套层单独反向补偿：组件会在 cell、view 和 nested editor 多层消费同一 token，补偿链脆弱且会随 DOM 层级变化。
- 拦截 pointer 事件并手工修正表格 caret 坐标：会侵入成熟组件负责的选区、IME 和跨单元格交互，且无法覆盖键盘、触摸与辅助技术的所有入口。

## 影响

- 新增 npm 依赖：`@codemirror/language-data`、`@codemirror/lang-javascript`、`@lezer/highlight`、`@lezer/markdown`。表格不再需要 `markdown-it`，已移除该直接依赖及类型包。
- 新增 Rust 依赖：`ureq` 和 `sha2`。`ureq` 自带的 HTTP URI 解析能力负责 URL 结构校验，并使用受控 resolver 过滤 DNS 结果。阿里云 registry 下 `reqwest 0.13.4` 与当前 lockfile 的 `wasm-bindgen` 链接版本冲突，因此本轮选择更小的成熟阻塞 HTTP 客户端 `ureq`。
- asset protocol scope 从全局 `**/*` 收紧为按成功打开或保存过的文档目录动态授权。打开多个文档会累计这些目录的 scope；Tauri 当前 scope API 没有对应的允许模式移除接口，因此如果未来需要在关闭文档时回收访问权，应改用受当前文档上下文验证的自定义 asset 服务。
- 未保存文档不创建文档旁远程图片缓存；UI 显示可本地化提示。
- 本地文件插入设置是低频应用状态，不进入 CodeMirror 文档状态或输入热路径；切换设置不会重建编辑器。
- watcher revision 只影响运行时 resolver 与 widget identity；不会修改图片引用、dirty 状态或撤销历史。
- 代码块预览不再把整段 fenced code 包成跨行 mark；视觉表面由 `.lm-md-code-block-line` 行级类承担，避免改变 CodeMirror 行盒模型。
- 表格 inline 呈现复用 mature table widget 生成的源码 token DOM，不改写 `.tbl-cell-view.innerHTML`，也不维护额外渲染调度或 HTML 状态。
- 2026-08-04 的真实浏览器诊断先确认额外 padding、复合 `em` 和 hover 字体切换会令 overlay/source 漂移；进一步的格式化单元格用例证明 sibling overlay 即使纯文本几何对齐，仍会把可见偏移直接当作源码偏移。最终移除 overlay 后，粗体单元格点击、变宽中英混排点击、输入和源码 selection 共用同一 token 几何。

## 回滚或复审条件

- 图片缓存破坏源码保真、产生不可控目录污染，或下载路径带来安全风险。
- 图片 watcher 刷新导致无关 widget 重建、源码变化、undo 记录或可测量输入延迟。
- 草稿图片迁移的孤立 asset 文件不可接受，或需要跨图片与 Markdown 写入的原子回滚。
- 动态 asset scope 无法满足多文档或关闭文档后的最小权限要求，需要改用自定义受控 asset protocol。
- 远程图片并发量、取消策略或下载进度需求超过当前 blocking worker + 去重模型的承载范围，需要引入可取消任务注册表或流式下载器。
- 受控 resolver 所依赖的 `ureq::unversioned` 扩展 API 在后续 `ureq` 小版本升级时出现兼容性变化，或出现无法在不阻塞 command 线程的前提下保证取消与并发去重。
- CodeMirror 语言包显著增加启动时间或包体积。
- `codemirror-markdown-tables` 对内嵌语法、IME、撤销重做或复制粘贴的限制阻塞 V1 写作体验。
