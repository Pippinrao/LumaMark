# LumaMark 设置系统设计

> 本文定义 LumaMark 设置对话框的信息结构、`LumaMarkSettings` schema、持久化与迁移合同、设置与会话状态边界、i18n/a11y 与验收标准。它面向设置实现者、测试人员与后续 Markdown capability 维护者；当前实施顺序仍以 [Typora Parity 核心体验改进计划](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md) 为准。持久化后端决策见 [ADR 0014](../decisions/0014-settings-persistence.md)。

## 用途与范围

本设计解决以下已确认问题：

- 设置页只有水平 Tab 与少量可配项，缺少 Typora 式左侧分区导航。
- 偏好散落在多个 localStorage key 与内存 store；`copyImagesToAssets` 与 `fontZoomPercent` 重启丢失。
- 无统一 settings schema 与 Rust 侧配置文件，跨会话/跨重装不可迁移。
- 设置与会话状态边界不清，容易把最近文件、临时侧栏状态塞进配置文件。

范围包括：

- 设置对话框的垂直分区导航与分区内容。
- `LumaMarkSettings` 版本化 schema。
- Rust 配置文件读写、损坏处理与 localStorage 一次性迁移。
- 设置变更对主题、i18n、阅读外观与编辑器 compartment 的消费合同。
- 分层测试设计与验收标准。

## 非目标

- 本轮不实现 Markdown 语法开关 UI（Inline Math、Highlight、上下标、Diagrams、GitHub Style Alert），也不把无消费者的字段写入代码 schema。
- 不把「关于 LumaMark」搬进设置页；版本信息继续由 Help → 关于对话框承载。
- 不把最近文件列表、最后会话路径、当前窗口临时侧栏开合写入 `settings.json`。
- 不在本轮加入 issue #13 的自动保存或应用内回收站。恢复草稿继续遵守 ADR 0004 的独立安全边界；文件删除只使用工作区动作定义的 OS 回收站语义。
- 不引入第二套设置 UI 组件库；继续使用 Radix Dialog/Tabs，并用同族官方 AlertDialog 承担破坏性确认的焦点与键盘合同。
- 不替换 CodeMirror、Zustand、Tauri 或现有命令面板架构。

## 事实来源

- Typora Preferences 事实取自 [Typora 行为基线](typora-baseline/README.md)；多数 Markdown 偏好出处为 `support`，未经本机逐条核实的项不得写成已确认 GUI 事实。
- LumaMark 当前状态取自代码、[Typora 专题竞争分析](typora-competitive-analysis/README.md) 与 [菜单系统设计](MENU_SYSTEM_DESIGN.md)。
- 持久化后端以 [ADR 0014](../decisions/0014-settings-persistence.md) 为准。

## 当前问题与根因

改造前的 `SettingsDialog` 使用水平 Tabs，持久化由各 feature store 自行读写 `lumamark.*.v1` localStorage key；图片复制策略与字体缩放仅存在于内存。当前实现已收敛到 v2 schema、Rust settings service 与垂直 Radix Tabs；保留本段是为了说明迁移来源，而不是当前状态清单。根因是缺少单一 settings 事实源与「设置 vs 会话状态」边界，而不是缺少 CSS。

## 方案选择

### 采用：Radix Dialog + Fluent/Mica 自适应工作区 + Rust `settings.json`

- UI：保留应用内模态对话框，把 `Tabs.Root` 设为 `orientation="vertical"`（左侧分区导航 + 右侧可滚动内容）。宽窗口使用大尺寸自适应工作区；半透明、模糊与分层 surface 形成明确的 Fluent/Mica 气质，同时为不支持 `backdrop-filter`、强制色与低视觉效果环境提供不透明回退。Radix 负责 Dialog、Tabs、RadioGroup、Switch 与 AlertDialog 的 ARIA、焦点和键盘合同。
- 数据：单一 `LumaMarkSettings`，经 `services/settings/settingsClient` 调用薄 Tauri command，由 Rust `settings_service` 原子写入 `app_config_dir()/settings.json`。
- 前端 `features/settings/settingsStore` 为唯一可写 settings store；既有分散 preference store 逐步收敛到该 store 的字段投影或直接替换。

### 未采用

- 继续只用 localStorage：无法跨 WebView 数据清除与重装迁移，且已有字段丢失证明不可靠。
- 独立设置窗口/路由页：当前产品仍是单窗口写作壳，独立窗口增加焦点与测试成本，收益不足。
- 自研侧栏导航：违反成熟组件优先原则。
- 常驻设置搜索：当前只有约十项真实设置；不实现检索却显示搜索框会形成装饰性假能力。字段规模显著增长时再以可检索标题、描述与分类的真实索引重新评估。

## 形态与交互

- 打开入口：文件菜单「设置」、命令面板 `open-settings`、既有快捷键（若有）。
- 对话框使用约 `980 × 680` 的理想尺寸并始终受 viewport 安全边距约束；不是固定像素窗口。对话框标题、各分区标题和说明进入 i18n；关闭按钮有可访问名称。
- 左侧分区列表顺序固定：通用 → 外观 → 编辑器 → 图片。
- 左栏使用单色图标、可见文字、柔和选中 surface 与 accent 指示条；它不能与内容区的 segmented/radio 控件共用同一视觉样式。
- 每个右侧分区都有独立标题、简短说明与语义设置组。设置组共用一层轻量 surface；禁止每一行再套独立卡片。行内包含设置名、必要的一句 helper text 与右侧紧凑控件。
- 右侧内容区是唯一主滚动区；分区切换不重置未保存的控件草稿——本设计采用即时写入模型（改即生效并 debounce 落盘），无「应用」按钮，也不为正常保存显示 toast。
- 主题与页面宽度是需要视觉判断的例外：主题使用亮色/暗色/跟随系统预览卡，页面宽度使用版心宽度图形；其他枚举和布尔值继续使用紧凑的成熟控件，避免整页卡片化。
- Mica 是应用内视觉材质，不是新的 Tauri 原生窗口。背景模糊不能成为信息可读性的必要条件；禁用模糊、Windows 强制色或透明效果不可用时，必须降级为完整不透明 surface。
- 宽度充足时固定左栏与内容区；窄窗口切换为单栏分区导航/内容 drill-in，不得把双栏与长 segmented 控件机械挤压，也不得产生横向滚动。
- Escape / 关闭按钮关闭对话框；关闭后焦点按既有菜单焦点合同归还触发器或编辑器。清空最近文件使用 Radix AlertDialog，默认焦点落在取消，Tab/Shift+Tab 保持在确认框内，Escape 只取消子确认并回到触发器。
- 亮色/暗色与 Windows 高对比下分区与控件信息可辨；尊重 `prefers-reduced-motion`。

## 分区与逐项清单

只列有真实执行路径的项。括号内为控件类型与默认值。

### 通用（`settings.sectionGeneral`）

| 项 | 控件 | 默认 | 数据字段 | 说明 |
|---|---|---|---|---|
| 语言 | Radix RadioGroup：`zh-CN` / `en` | `zh-CN` | `general.language` | 与顶栏语言菜单共用同一事实源 |
| 启动行为 | Radix RadioGroup：`home` / `restoreLastSession` | `home` | `general.startupBehavior` | 从 `startupStore` 迁出该字段 |
| 启动时自动检查更新 | Radix Switch | `true` | `updates.autoCheckOnStartup` | 取代独立的 `updatePreferencesStore`；更新下载进度仍属于 updates feature 的会话状态 |
| 清空最近文件 | 按钮 + 二次确认 | — | 操作 `recentFilesStore` | 列表本身是会话状态，不进 `settings.json`；`settings.recentFilesPersistenceError` 提示放在本分区 |

### 外观（`settings.sectionAppearance`）

| 项 | 控件 | 默认 | 数据字段 | 说明 |
|---|---|---|---|---|
| 主题 | 视觉 RadioGroup：`light` / `dark` / `system` | `light` | `appearance.theme` | 显示三个紧凑预览；与顶栏主题菜单共用；`system` 由 `prefers-color-scheme` 动态解析，首帧与运行期系统切换都不改写所存偏好 |
| 页面宽度 | 视觉 RadioGroup：`narrow` / `standard` / `wide` / `fluid` | `standard` | `appearance.pageWidth` | 用版心图形表达宽度，像素映射保持现有 680 / 810 / 1040 / null |
| 字体缩放 | number + stepper，50–250，步进 10 | `100` | `appearance.fontZoomPercent` | 不用连续 slider，避免拖拽让整个 shell 高频重渲染；Ctrl+滚轮与「重置缩放」继续可用 |
| 启动时展开侧栏 | Radix Switch | `true` | `appearance.sidebarOpenOnStartup` | 仅影响启动默认值；运行时侧栏开合仍是会话状态 |

### 编辑器（`settings.sectionEditor`）

| 项 | 控件 | 默认 | 数据字段 | 说明 |
|---|---|---|---|---|
| 默认显示模式 | Radix RadioGroup：`livePreview` / `source` | `livePreview` | `editor.defaultDisplayMode` | 新建/打开文档时的初始模式；不重建已打开 `EditorView` 的当前模式，除非产品后续另定 |
| 启动时进入专注模式 | Radix Switch | `false` | `editor.focusModeOnStartup` | 启动后应用一次 |

### 图片（`settings.sectionImages`）

| 项 | 控件 | 默认 | 数据字段 | 说明 |
|---|---|---|---|---|
| 复制本地图片到文档 assets | Radix Switch | `false` | `images.copyImagesToAssets` | UI 已有；本轮补持久化 |

### 关于

不在设置页承载。

## Schema

```ts
export type LumaMarkSettings = {
  appearance: {
    fontZoomPercent: number;
    pageWidth: 'fluid' | 'narrow' | 'standard' | 'wide';
    sidebarOpenOnStartup: boolean;
    theme: 'dark' | 'light' | 'system';
  };
  editor: {
    defaultDisplayMode: 'livePreview' | 'source';
    focusModeOnStartup: boolean;
  };
  general: {
    language: 'en' | 'zh-CN';
    startupBehavior: 'home' | 'restoreLastSession';
  };
  images: {
    copyImagesToAssets: boolean;
  };
  updates: {
    autoCheckOnStartup: boolean;
  };
  version: 2;
};
```

校验规则：

- `fontZoomPercent` 必须为 50–250 的整数且为 10 的倍数；否则回退默认并上报一次可见错误。
- 枚举字段遇未知值回退默认并上报一次可见错误，不静默吞。
- 布尔字段遇缺失或非布尔值时按字段回退默认并上报；v0/v1 缺少 v2 新增的 `updates` 分区属于正常 schema migration，不算损坏。
- 未知顶层/分区字段读取时忽略；服务端规范化写回时只保留已知 v2 字段。若未来需要插件扩展，再修订未知字段保留合同。
- 缺失版本、v0、v1 读取后迁移为 v2。高于当前版本的文件返回 `settings.unsupported_version`，原文件不得备份、覆盖或降级写回。

## 设置与会话状态边界

| 类别 | 存放处 | 示例 |
|---|---|---|
| 设置 | `settings.json` | 语言、主题、页面宽度、字体缩放、启动行为、图片复制策略、默认显示模式、自动检查更新 |
| 会话状态 | WebView localStorage | `lastSession`、`recentWorkspaces`、最近文件列表、当前窗口临时侧栏开合 |

因此：

- `startupStore` 只把 `startupBehavior` 迁入 settings；`lastSession` 与 `recentWorkspaces` 原地保留。
- `recentFilesStore` 完全不迁移；设置页只提供「清空」操作。
- 运行时 `sidebarOpen` 仍可由视图菜单切换；`sidebarOpenOnStartup` 只在启动时读取。

## 持久化与迁移合同

数据流：

```text
SettingsDialog
    → features/settings/settingsStore
    → services/settings/settingsClient
    → commands/settings.rs（AppHandle / env / 验收路径 adapter）
    → services/settings_service.rs
    → app_config_dir()/settings.json
```

规则：

1. 文件不存在时返回默认值且不创建文件；首次用户写入才落盘。
2. 写入使用现有 `atomic-write-file` 原子替换；成功后无残留临时文件。
3. JSON 损坏：把原文件移动为唯一的 `settings.corrupt-<timestamp>[-n].json`（字节与损坏原文一致），再原子写入默认文件并返回结构化恢复结果；下一次启动读取已恢复文件，不重复备份同一损坏内容。
4. 前端 `settingsClient` 不依赖 React；invoke 失败抛出明确错误，不静默回落默认值（启动 hydration 的「损坏后默认值」路径由 Rust 服务显式返回结构化结果，与「写入失败」区分）。
5. 写盘 debounce（建议 300–500ms），避免拖动字体缩放时每帧写盘；设置变更不进入编辑器输入热路径。
6. 设置变更通过现有 provider / compartment 消费，不重建 `EditorView`。
7. 迁移一次性执行：`settings_get` 的 `settingsFileExists` 为 `false` 时，前端纯读取旧 localStorage key → 映射为 v2 → 成功写入 `settings.json` → 最后写 localStorage 标记 `lumamark.settings.migrated-from-localStorage.v2`。迁移函数本身不写 marker；保存失败不写 marker，因此下次可重试。旧 key 不删除。
8. 配置文件是否存在是防覆盖的第一护栏；只要 `settings.json` 已存在，即使 localStorage marker 缺失也不迁移。已有 marker 时同样不重复迁移。无任何 legacy 值时既不创建配置文件，也不写 marker。
9. 字段可恢复错误返回 `hadInvalidFields`，由前端显示一次可见提示并写回规范化文档；JSON 损坏、普通 IO 错误、未来版本分别处理，不能共用静默 fallback。
10. 读取无版本、v0 或 v1 文件时，Rust 在返回前用同一原子写路径持久写回 canonical v2；正常版本迁移不冒充字段损坏。读取未来版本或其他无法安全读取的文件失败后，前端阻断该会话后续 settings 写入并丢弃待写队列，避免以默认值覆盖未知文档。
11. 前端只暴露结构化生命周期：`loadState` 区分 ready/read failed/unsupported，`recoveryState` 区分字段恢复与损坏恢复（含备份路径），`writeState` 区分 pending/saving/failed。UI 按稳定 code 映射本地化、可行动文案，不展示 Rust 英文原文。
12. 写失败保留当前 canonical 快照；`retryPendingWrites` 重试同一快照，后续新变更仍按串行队列合并。应用级 close coordinator 同步拦截 Tauri close request，等待 `flushPendingWrites` 成功后才 `destroy`；失败保持窗口并打开可重试提示。标题栏 X、Alt+F4 与系统关闭共用该合同。
13. TS 与 Rust 的默认值和校验器通过 `tests/fixtures/settings-v2-contract.json` 做跨语言自动核对，字段新增或枚举扩展必须同步更新夹具与两侧测试。

旧 key 映射：

| 旧 key | 迁入字段 |
|---|---|
| `lumamark.app-preferences.v1` → `language` / `theme` | `general.language` / `appearance.theme` |
| `lumamark.reading-appearance.v1` → `pageWidth` | `appearance.pageWidth` |
| `lumamark.startup.v1` → `startupBehavior` | `general.startupBehavior` |
| `lumamark.sidebar-open.v1` | `appearance.sidebarOpenOnStartup` |
| `lumamark.update-preferences.v1` → `autoCheckOnStartup` | `updates.autoCheckOnStartup` |
| `appStore.copyImagesToAssets`（内存，无 key） | 无历史可迁；默认 `false` |
| `fontZoomPercent`（内存） | 无历史可迁；默认 `100` |

## Markdown 门控延后策略

本轮代码 schema 不包含 `markdown` 分区。设计上预先固定，供 capability 落地时同批实现：

1. 分区命名：`markdown`。
2. 门控读取方：对应 editor capability / language compartment；变更通过 `Compartment.reconfigure` 热重配，不重建 `EditorView`。
3. 关闭时的降级语义：源码原样可见，不得误判为其他结构（与当前 protected-source 安全降级一致）。

在 capability 与基线实机核实完成前，不得渲染对应开关 UI。

## i18n

- 所有分区名、行标签、选项、按钮、确认文案、错误提示进入 `en` 与 `zh-CN` 资源。
- 不拼接翻译片段。
- 新增与既有遗漏的 `settings.*` key 全部加入 `i18n.test.ts` 的 `requiredCoreKeys`。

建议 key 前缀：

- `settings.sectionGeneral` / `settings.sectionAppearance` / `settings.sectionEditor` / `settings.sectionImages`
- `settings.fontZoom` / `settings.sidebarOpenOnStartup`
- `settings.defaultDisplayMode` / `settings.displayLivePreview` / `settings.displaySource`
- `settings.focusModeOnStartup`
- `settings.clearRecentFiles` / `settings.clearRecentFilesConfirmTitle` / `settings.clearRecentFilesConfirm`
- 既有 `settings.theme*`、`settings.pageWidth*`、`settings.startup*`、`settings.copyImagesToAssets`、持久化错误 key 继续使用

## 可访问性

- 垂直 Tabs：`aria-orientation="vertical"`；ArrowUp/ArrowDown 切换分区。
- 枚举使用 Radix RadioGroup 的 `radiogroup` / `radio` 语义；布尔值使用 Radix Switch 的 `switch` / `checked` 语义，不以普通按钮和手写 `aria-pressed` 伪装基础控件。
- 字体缩放控件暴露 `aria-valuemin` / `aria-valuemax` / `aria-valuenow`。
- 主题和页面宽度视觉选项不能只靠颜色或缩略图表达选中态；必须同时提供文字、边框/指示与可访问 checked 状态。
- Mica 背景与透明度在 forced-colors、`backdrop-filter` 不可用及减少透明效果的等价环境中回退为不透明表面；焦点环和选中态仍清晰。
- 字段恢复、损坏恢复、读取失败、未来版本阻断与写失败分别使用 `role="alert"`；写失败提供“重试保存”。
- 清空最近文件必须使用 Radix AlertDialog 二次确认；取消不执行清空，默认焦点、trap、Escape 与回焦均由自动化覆盖。

## 架构边界

- `services/settings` 不得依赖 React、Zustand store 或 app shell。
- `features/settings` 不得直接 `invoke`；只通过 `settingsClient`。
- settings store 不持有 Markdown 全文或编辑器高频 selection。
- 设置 schema、默认值、迁移、字段校验与 settings 文件 IO 在 `settings_service`；Rust command 只适配 `AppHandle`、环境变量与 fail-closed 的验收专用配置路径，不承载生产设置业务规则。

## 测试设计

沿用 Vitest + jsdom、测试与源码同目录、Rust 内联 `#[cfg(test)]` + `unique_test_dir`、Playwright `tests/e2e/`。按 `DEVELOPMENT_PROCESS.md` 测试先行。

### Rust 单元

1. 配置文件不存在时返回默认设置，且不创建文件。
2. 写入后读回逐字段等值。
3. 原子写入成功后目录内无残留临时文件。
4. JSON 损坏时返回默认值，并生成内容与损坏字节一致的备份文件。
5. 配置目录不存在时首次写入自动创建。
6. 未知字段被忽略；`version` 不被写回为更低值。
7. 非法枚举、布尔和 zoom 仅恢复对应字段，`hadInvalidFields=true`；zoom 回 `100`。
8. v0/v1/缺失版本迁移并原子写回 v2；未来版本原文件保持不动、不生成 corrupt backup，且当前会话不得再覆盖该文件。
9. 损坏 JSON 只备份一次；第二次读取恢复后的默认文件。
10. 读写 IO 错误使用 `settings.read_failed` / `settings.write_failed`。

### 前端单元

11. `settingsClient` 保留 invoke 的 `code/recoverable`，失败不回落默认值。
12. `settingsStore` 在 debounce 窗口内连续变更只触发一次写盘；`flushPendingWrites` 写入最后值并保持串行；写入失败保留 canonical 快照，重试成功后回到 idle。
13. 并发 close request 只 flush/destroy 一次；失败不 destroy 且下一次可重试。
14. 迁移：旧 localStorage 快照映射正确；`lastSession` / `recentWorkspaces` 不被迁移；updater 偏好进入 v2。
15. 新配置存在时不读 legacy；保存成功后才写 marker，失败可重试；无 legacy 不写文件/marker。
16. 非法值回退默认并产生一次可见错误。
17. 迁移后旧 key 仍然存在。

### 组件

18. 垂直分区名称与顺序、`aria-orientation="vertical"`、方向键切换。
19. 各新增项的可访问名称与状态，中英文各一遍。
20. 字体缩放范围、步进与 `aria-valuenow`。
21. 清空最近文件 Radix AlertDialog 的默认取消焦点、focus trap、Escape、确认单次执行与回焦。
22. invalid fields、corruption + backup path、read failure、unsupported/block、write failure + retry 的 `role="alert"` 双语文案在任一分区都保持可见。

### 集成

23. 主题 / 页面宽度 / 字体缩放同步到 DOM 或编辑器容器。
24. browser fallback adapter 的 reload 后 `copyImagesToAssets` 与 `fontZoomPercent` 反映持久值；该结果只证明 Web/E2E facade，不冒充 Rust 配置文件证据。
25. 设置变更不重建 `EditorView` 实例。

### E2E

26. 打开设置 → 键盘切换分区 → 改字体缩放 → reload → 值保留。
27. 1440×900 截取并人工批准[亮色中文](../../artifacts/settings-report/settings-light-zh.png)、[暗色中文](../../artifacts/settings-report/settings-dark-zh.png)、[暗色英文](../../artifacts/settings-report/settings-dark-en.png)四分区代表截图；自动化同时断言大面板不溢出 viewport、英文控件不发生不必要截断、主题/页面宽度选中态可辨。历史截图只能说明当时结构，不自动成为新版视觉基线。
28. 520×620 与关键中间断点验证单栏导航/内容切换、主内容独立滚动、无横向溢出；forced-colors 与无 `backdrop-filter` 条件下 surface 不透明且焦点、radio、switch 状态可辨。
29. 当前工作树 Release exe 在隔离的系统临时 config 中，先形成已落盘基线，再用真实 OS 指针从顶部主题菜单切到 `system`，不预等该变更写盘即立即用窗口 X 关闭；close coordinator flush 后，以同一 exe、同一隔离 config 和全新 WebView profile 重启，从设置 UI 与 canonical v2 `settings.json` 同时读回。browser localStorage reload、Rust service 单测或直接预写 JSON 均不能单独替代这条组合证据。

### i18n 与架构

30. 全部 `settings.*` 相关 core key 进入 `requiredCoreKeys`。
31. `tests/quality` 架构边界：services 不依赖 React；features 不直接 invoke。

### 门禁命令

`pnpm typecheck`、`pnpm lint`、`pnpm test`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm test:e2e`、`pnpm quality:web-build`；涉及编辑器 transaction 时加 `pnpm test:fixtures`；性能基准单独串行 `pnpm perf:bench`。

## 验收标准

1. 设置对话框为应用内 Fluent/Mica 自适应工作区；宽窗垂直分区、窄窗单栏，四分区内容与本文清单一致，无虚假搜索或未实现开关。
2. `copyImagesToAssets` 与 `fontZoomPercent` 重启后保留。
3. 配置读写走 Rust `settings.json`；损坏有备份与可见错误，无静默清空。
4. localStorage 迁移以配置存在为防覆盖护栏，成功保存后才写 marker，幂等且不删除旧 key；会话状态字段未迁入配置文件。
5. 中英文资源对称；`requiredCoreKeys` 覆盖 settings 相关 key。
6. 设置变更不重建 `EditorView`，不把 Markdown 全文放入 React store。
7. 本文测试设计中的自动化项有新鲜通过证据；人工抽检项单独标明。

## 更新时机

- 增删设置分区或字段。
- 改变持久化后端、迁移策略或损坏处理。
- Markdown 门控 capability 落地并需要开关 UI。
- 设置相关测试门禁或 a11y 合同变化。
