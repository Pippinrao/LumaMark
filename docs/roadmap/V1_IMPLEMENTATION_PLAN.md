# V1 落地实施计划

> **历史状态（Alpha 基线）：** 本文保留 Foundation / MarkText+ 阶段最初的任务拆解与未完成 checkbox，不再作为当前执行计划，也不事后伪造逐项 TDD 完成记录。当前范围、顺序与退出门禁见 [Typora Parity 核心体验改进计划](TYPORA_PARITY_IMPLEMENTATION_PLAN.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `test-driven-development`、`verification-before-completion`，并按任务粒度使用 `subagent-driven-development` 或 `executing-plans` 执行。所有任务必须遵守根目录 `AGENTS.md` 和 `DEVELOPMENT_PROCESS.md`。步骤使用 checkbox 语法追踪。

**目标：** 将 LumaMark V1 设计落地为一个可日常试用的 Typora-like Markdown 编辑器基线，覆盖打开、编辑、WYSIWYG、Mermaid、保存、中文/英文、性能基准和 Windows 可用构建。

**架构：** 使用 Tauri v2 + React + TypeScript + CodeMirror 6。CodeMirror 持有 Markdown 正文和编辑热路径，React 负责应用外壳，Rust 负责文件和系统能力，复杂块渲染异步调度。

**技术栈：** Tauri v2、React、TypeScript、Vite、pnpm、CodeMirror 6、Radix Primitives、Zustand、i18next/react-i18next、Vitest、Playwright、Mermaid、Rust。

---

## 执行规则

本计划是 V1 的近期落地计划，属于 `docs/roadmap/` 下的执行文档。实现时必须遵守：

- 每个任务先写失败测试，再写生产代码。
- 每个任务只完成一个清晰切片。
- 每个任务结束前运行相关验证命令并读取输出。
- 重大改动后做独立代码审查。
- 不满足验收条件时，不得进入下一个依赖任务。
- 任何基础组件自研都必须先取得用户明确确认。

若验证命令尚未由前置任务建立，当前任务必须先建立命令或明确说明替代验证。不能因为命令缺失而跳过质量门禁。

## V1 任务图

```text
0 文档和仓库基线
└─ 1 应用脚手架和质量命令
   ├─ 2 i18n、主题和应用外壳
   ├─ 3 测试夹具和性能基准
   └─ 4 CodeMirror 编辑器核心
      └─ 5 文件读写闭环
         ├─ 6 Markdown 基础 WYSIWYG
         ├─ 7 Mermaid 异步渲染
         └─ 8 产品外壳：文件树、大纲、命令面板
            └─ 9 V1 收敛、E2E、性能和 Windows 构建
```

## 通用完成门禁

每个实现任务完成前都必须满足：

- 本任务新增行为有自动化测试。
- 测试经历过失败到通过。
- 相关 `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。
- 涉及 Rust 时，`cargo check` 和 `cargo test` 通过。
- 涉及 UI 时，相关 Playwright 用例通过。
- 涉及 Markdown 保存时，fixture round-trip 通过。
- 涉及编辑器时，检查 IME、撤销重做、选区、复制粘贴、源码保真风险。
- 涉及性能路径时，运行对应性能基准并记录结果。
- 涉及用户可见文案时，同步中文和英文 i18n。
- 最终汇报列出实际运行的命令和结果。

## 计划文件结构

V1 实现完成后，项目应形成以下主要结构：

```text
.
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ vite.config.ts
├─ tsconfig.json
├─ src/
│  ├─ app/
│  ├─ editor/
│  ├─ features/
│  ├─ services/
│  ├─ shared/
│  └─ tests/
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ src/
├─ tests/
│  ├─ e2e/
│  ├─ fixtures/
│  └─ perf/
└─ docs/
```

实际生成文件可以根据 Tauri 官方脚手架略有差异，但职责边界不能偏离 `docs/architecture/DETAILED_ARCHITECTURE.md`。

## Task 0：仓库和文档基线

**目标：** 让项目具备可追踪、可执行的基线，避免后续 AI 任务散落。

**文件：**

- 修改：`docs/README.md`
- 修改：`README.md`
- 修改：`AGENTS.md`
- 创建：`.gitignore`
- 创建：`.editorconfig`

**步骤：**

- [ ] 确认当前目录是否已初始化 Git。

  Run: `git status --short --branch`

  Expected: 如果不是 git 仓库，记录状态并执行仓库初始化；如果已是 git 仓库，继续。

- [ ] 如果不是 git 仓库，初始化仓库。

  Run: `git init`

  Expected: 当前目录成为 git 仓库。

- [ ] 创建 `.gitignore`，至少排除构建产物和依赖目录。

  必须包含：

  ```gitignore
  node_modules/
  dist/
  dist-ssr/
  target/
  src-tauri/target/
  .turbo/
  .vite/
  playwright-report/
  test-results/
  .env
  .env.*
  ```

- [ ] 创建 `.editorconfig`。

  必须包含：

  ```ini
  root = true

  [*]
  charset = utf-8
  end_of_line = lf
  insert_final_newline = true
  indent_style = space
  indent_size = 2

  [*.rs]
  indent_size = 4
  ```

- [ ] 验证文档地图包含本计划。

  Run: `Select-String -Path 'docs\\README.md' -Pattern 'V1 落地实施计划'`

  Expected: 找到 `roadmap/V1_IMPLEMENTATION_PLAN.md`。

- [ ] 验证没有未完成占位标记。

  Run:

  ```powershell
  $markers = @(
    ('TO' + 'DO'),
    ('T' + 'BD'),
    ('待' + '定'),
    ('以后' + '再说')
  )
  Select-String -Path 'README.md','AGENTS.md','DEVELOPMENT_PROCESS.md','docs\\README.md','docs\\product\\*.md','docs\\architecture\\*.md','docs\\quality\\*.md','docs\\roadmap\\*.md' -Pattern $markers
  ```

  Expected: 无输出。

- [ ] 提交基线。

  Run:

  ```powershell
  git add README.md AGENTS.md DEVELOPMENT_PROCESS.md docs .gitignore .editorconfig
  git commit -m "docs: establish V1 implementation baseline"
  ```

  Expected: 生成基线提交。

## Task 1：Tauri + React + TypeScript 脚手架和质量命令

**目标：** 建立可运行应用骨架和基础验证命令。

**文件：**

- 创建：`package.json`
- 创建：`pnpm-workspace.yaml`
- 创建：`vite.config.ts`
- 创建：`tsconfig.json`
- 创建：`tsconfig.node.json`
- 创建：`src/main.tsx`
- 创建：`src/app/App.tsx`
- 创建：`src/app/app.test.tsx`
- 创建：`src-tauri/Cargo.toml`
- 创建：`src-tauri/tauri.conf.json`
- 创建：`src-tauri/src/main.rs`

**成熟组件/工具：**

- 使用 Tauri 官方脚手架生成基础结构。
- 使用 Vite React TypeScript 模板。
- 使用 Vitest 做单元测试。

**步骤：**

- [ ] 使用官方脚手架创建 Tauri + React + TypeScript 应用骨架。

  Run: `pnpm create tauri-app@latest .`

  选择：

  - package manager: `pnpm`
  - frontend: `React`
  - language: `TypeScript`

  Expected: 生成 Tauri、React、Vite 基础项目。

- [ ] 配置 `package.json` 脚本。

  必须包含：

  ```json
  {
    "scripts": {
      "dev": "tauri dev",
      "build": "tauri build",
      "typecheck": "tsc --noEmit",
      "lint": "eslint .",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test",
      "test:fixtures": "vitest run tests/fixtures",
      "perf:bench": "vitest run tests/perf"
    }
  }
  ```

- [ ] 写第一个失败测试，验证 App 渲染应用名。

  Test file: `src/app/app.test.tsx`

  Behavior: 渲染 `App` 后能找到 `LumaMark` 应用名称或等价可访问标题。

  Run: `pnpm test src/app/app.test.tsx`

  Expected: 先失败，原因是测试或 App 尚未满足行为。

- [ ] 实现最小 `App`。

  要求：

  - 显示应用根节点。
  - 暂不做复杂 UI。
  - 用户可见文案后续必须迁入 i18n；本任务允许先建立最小骨架，但 Task 2 必须完成 i18n 替换。

- [ ] 安装并配置 ESLint、Vitest、Testing Library。

  验证：

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: 全部 exit 0。

- [ ] 提交。

  Run:

  ```powershell
  git add package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts tsconfig*.json src src-tauri
  git commit -m "chore: scaffold Tauri React app with quality gates"
  ```

## Task 2：i18n、主题和应用外壳

**目标：** 建立中英文、明暗主题和 Typora-like 应用壳，不硬编码用户可见文案。

**文件：**

- 创建：`src/shared/i18n/index.ts`
- 创建：`src/shared/i18n/locales/en.json`
- 创建：`src/shared/i18n/locales/zh-CN.json`
- 创建：`src/shared/styles/tokens.css`
- 创建：`src/shared/styles/global.css`
- 创建：`src/app/providers/I18nProvider.tsx`
- 创建：`src/app/providers/ThemeProvider.tsx`
- 创建：`src/app/shell/AppShell.tsx`
- 创建：`src/app/stores/appStore.ts`
- 修改：`src/app/App.tsx`
- 测试：`src/shared/i18n/i18n.test.ts`
- 测试：`src/app/shell/AppShell.test.tsx`

**成熟组件/工具：**

- `i18next`
- `react-i18next`
- `zustand`

**步骤：**

- [ ] 写失败测试：i18n 必须提供英文和简体中文的核心 key。

  Required keys:

  ```text
  app.name
  app.emptyTitle
  command.openFile
  command.save
  command.saveAs
  command.toggleTheme
  command.toggleLanguage
  status.ready
  ```

  Run: `pnpm test src/shared/i18n/i18n.test.ts`

  Expected: 先失败，直到资源文件和初始化完成。

- [ ] 写失败测试：AppShell 不出现硬编码英文标题，而通过 i18n 渲染应用名。

  Run: `pnpm test src/app/shell/AppShell.test.tsx`

  Expected: 先失败。

- [ ] 实现 i18n provider 和中英文资源。

  要求：

  - 默认语言：根据系统或配置，配置缺失时使用简体中文。
  - 语言切换状态进入 Zustand store。
  - 所有 AppShell 可见文案走 i18n。

- [ ] 实现主题 provider。

  要求：

  - 支持 `light` 和 `dark`。
  - 使用 CSS variables。
  - 不引入复杂主题市场。

- [ ] 实现 Typora-like 基础 AppShell。

  结构：

  ```text
  app frame
  ├─ title/menu zone
  ├─ left sidebar placeholder
  ├─ editor host placeholder
  └─ status bar
  ```

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  ```

  Expected: 全部 exit 0。

- [ ] 提交。

  Run:

  ```powershell
  git add src
  git commit -m "feat: add i18n theme and app shell"
  ```

## Task 3：测试夹具、round-trip 和性能基准框架

**目标：** 在功能变复杂前建立源码保真和性能基准框架。

**文件：**

- 创建：`tests/fixtures/markdown/basic.md`
- 创建：`tests/fixtures/markdown/headings.md`
- 创建：`tests/fixtures/markdown/emphasis.md`
- 创建：`tests/fixtures/markdown/lists.md`
- 创建：`tests/fixtures/markdown/task-list.md`
- 创建：`tests/fixtures/markdown/blockquote.md`
- 创建：`tests/fixtures/markdown/code-blocks.md`
- 创建：`tests/fixtures/markdown/links-images.md`
- 创建：`tests/fixtures/markdown/mermaid.md`
- 创建：`tests/fixtures/markdown/mixed-chinese-english.md`
- 创建：`tests/fixtures/markdown/large-1mb.md`
- 创建：`tests/fixtures/markdown/large-5mb.md`
- 创建：`tests/fixtures/markdown/large-10mb.md`
- 创建：`tests/fixtures/roundTrip.test.ts`
- 创建：`tests/perf/openLargeFile.bench.test.ts`
- 创建：`tests/e2e/smoke.spec.ts`
- 创建：`playwright.config.ts`

**步骤：**

- [ ] 写失败测试：round-trip 工具读取 fixture 后写入临时文件，内容必须完全一致。

  Run: `pnpm test:fixtures`

  Expected: 先失败，原因是测试工具或 fixture 尚未存在。

- [ ] 实现 fixture 和 round-trip 测试工具。

  要求：

  - 不依赖真实应用 UI。
  - 对文本做字节级或字符串级一致性比较。
  - 临时输出写入系统临时目录或 `test-results/`，并被 `.gitignore` 排除。

- [ ] 写性能基准框架。

  初始行为：

  - 读取 `large-1mb.md`、`large-5mb.md`、`large-10mb.md`。
  - 记录读取耗时。
  - 暂不强制硬阈值失败，先输出基准数据；从文件闭环完成后开始设门禁。

- [ ] 写 E2E smoke 测试。

  Behavior:

  - 启动应用。
  - 找到应用 shell。
  - 找到 editor host placeholder。

- [ ] 验证。

  Run:

  ```powershell
  pnpm test:fixtures
  pnpm perf:bench
  pnpm test:e2e
  ```

  Expected: 全部 exit 0。

- [ ] 提交。

  Run:

  ```powershell
  git add tests playwright.config.ts .gitignore
  git commit -m "test: add fixtures e2e and performance baselines"
  ```

## Task 4：CodeMirror 编辑器核心

**目标：** 接入 CodeMirror 6，让 Markdown 正文只归编辑器状态所有，React store 不持有全文。

**文件：**

- 创建：`src/editor/core/createEditorState.ts`
- 创建：`src/editor/core/EditorViewHost.tsx`
- 创建：`src/editor/core/editorEvents.ts`
- 创建：`src/editor/core/editorApi.ts`
- 创建：`src/editor/markdown/markdownLanguage.ts`
- 创建：`src/editor/metrics/editorMetrics.ts`
- 修改：`src/app/shell/AppShell.tsx`
- 测试：`src/editor/core/createEditorState.test.ts`
- 测试：`src/editor/core/editorApi.test.ts`

**成熟组件/工具：**

- `@codemirror/state`
- `@codemirror/view`
- `@codemirror/lang-markdown`
- `@codemirror/commands`
- `@codemirror/search`

**步骤：**

- [ ] 写失败测试：`createEditorState` 接收 Markdown 文本并创建可读取 doc 的 EditorState。

  Run: `pnpm test src/editor/core/createEditorState.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：editor API 可以 `loadDocument`、`getDocumentText`、`focus`。

  Run: `pnpm test src/editor/core/editorApi.test.ts`

  Expected: 先失败。

- [ ] 实现 CodeMirror state/view 初始化。

  要求：

  - Markdown 支持通过 CodeMirror 官方 language package。
  - App store 只接收 dirty 状态和轻量事件。
  - 不把 Markdown 全文写入 Zustand。

- [ ] 接入 AppShell editor host。

  要求：

  - 编辑器占据中央区域。
  - 支持主题变量。
  - 输入不触发整个 AppShell 频繁重渲染。

- [ ] 加入输入延迟采样接口。

  V1 可先记录 transaction 时间和渲染任务耗时，不做复杂面板。

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:e2e
  ```

  Expected: 全部 exit 0。

- [ ] 提交。

  Run:

  ```powershell
  git add src tests
  git commit -m "feat: add CodeMirror markdown editor core"
  ```

## Task 5：文件读写闭环和源码保真

**目标：** 实现打开、保存、另存为、最近文件和 dirty 状态，保证 round-trip 无无关 diff。

**文件：**

- 创建：`src/services/tauri/invokeCommand.ts`
- 创建：`src/services/files/fileCommands.ts`
- 创建：`src/features/recent-files/recentFilesStore.ts`
- 创建：`src/features/file-actions/fileActions.ts`
- 创建：`src-tauri/src/commands/files.rs`
- 创建：`src-tauri/src/services/file_service.rs`
- 创建：`src-tauri/src/errors.rs`
- 修改：`src-tauri/src/main.rs`
- 修改：`src/app/stores/appStore.ts`
- 测试：`src/services/files/fileCommands.test.ts`
- 测试：`tests/fixtures/roundTrip.test.ts`
- Rust 测试：`src-tauri/src/services/file_service.rs`

**步骤：**

- [ ] 写失败测试：TypeScript command wrapper 把 Rust result 转换为稳定 `CommandResult`。

  Run: `pnpm test src/services/files/fileCommands.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：Rust file service 读取 UTF-8 Markdown 文本。

  Run: `cargo test --manifest-path src-tauri/Cargo.toml file_service`

  Expected: 先失败。

- [ ] 写失败测试：保存失败时 dirty 状态不能清除。

  Run: `pnpm test src/features/file-actions`

  Expected: 先失败。

- [ ] 实现 Rust 文件 command。

  Commands:

  - `files.read_text`
  - `files.write_text`
  - `files.show_open_file_dialog`
  - `files.show_save_file_dialog`

  要求：

  - 错误转换为稳定 error code。
  - 用户可见错误由前端 i18n 显示。
  - 写入使用安全写入策略，避免失败时损坏原文件。

- [ ] 实现前端文件动作。

  要求：

  - 打开文件后内容进入 CodeMirror。
  - 保存时从 editor API 读取当前文本。
  - 最近文件只保存路径和元数据。
  - dirty 状态准确。

- [ ] 更新 fixture round-trip：通过应用保存路径验证无关 diff。

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:fixtures
  pnpm test:e2e
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: 全部 exit 0，fixture round-trip 无差异。

- [ ] 提交。

  Run:

  ```powershell
  git add src src-tauri tests
  git commit -m "feat: add markdown file open save round trip"
  ```

## Task 6：基础 Markdown WYSIWYG

**目标：** 实现 V1 P0 的基础 Markdown 视觉层，同时保护源码可编辑、撤销重做和 IME。

**文件：**

- 创建：`src/editor/wysiwyg/markdownDecorations.ts`
- 创建：`src/editor/wysiwyg/headingDecorations.ts`
- 创建：`src/editor/wysiwyg/emphasisDecorations.ts`
- 创建：`src/editor/wysiwyg/listDecorations.ts`
- 创建：`src/editor/wysiwyg/codeDecorations.ts`
- 创建：`src/editor/wysiwyg/blockquoteDecorations.ts`
- 创建：`src/editor/wysiwyg/taskListCommands.ts`
- 创建：`src/editor/wysiwyg/wysiwyg.css`
- 测试：`src/editor/wysiwyg/markdownDecorations.test.ts`
- 测试：`tests/e2e/editor-markdown.spec.ts`

**步骤：**

- [ ] 写失败测试：标题行生成对应 decoration 范围。

  Run: `pnpm test src/editor/wysiwyg/markdownDecorations.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：粗体、斜体、删除线生成对应 style 标记。

  Run: `pnpm test src/editor/wysiwyg/markdownDecorations.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：任务列表 checkbox command 修改 `[ ]` 和 `[x]` 源文。

  Run: `pnpm test src/editor/wysiwyg/markdownDecorations.test.ts`

  Expected: 先失败。

- [ ] 实现 decorations。

  范围：

  - heading
  - emphasis
  - strikethrough
  - blockquote
  - ordered list
  - unordered list
  - task list
  - inline code
  - code block

  要求：

  - 视觉层不修改源码。
  - 光标进入范围可编辑源码符号。
  - 代码块内优先稳定编辑，不做激进隐藏。

- [ ] 写 E2E：输入基础 Markdown 并看到视觉效果。

  Scenarios:

  - 输入 `# 标题`。
  - 输入 `**粗体**`。
  - 输入 `- [ ] task` 并点击 checkbox。
  - 撤销 checkbox 修改。

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:fixtures
  pnpm test:e2e
  ```

  Expected: 全部 exit 0，fixture round-trip 无差异。

- [ ] 提交。

  Run:

  ```powershell
  git add src tests
  git commit -m "feat: add basic markdown wysiwyg decorations"
  ```

## Task 7：Mermaid 异步渲染

**目标：** Mermaid fenced block 支持异步预览、缓存、取消过期任务和错误恢复。

**文件：**

- 创建：`src/editor/capabilities/mermaid/mermaidBlockDetection.ts`
- 创建：`src/editor/capabilities/mermaid/mermaidPreviewExtension.ts`
- 创建：`src/editor/capabilities/mermaid/mermaidRenderScheduler.ts`
- 创建：`src/editor/capabilities/mermaid/mermaidCache.ts`
- 创建：`src/editor/capabilities/mermaid/mermaid.css`
- 兼容导出：`src/editor/widgets/mermaid/MermaidWidget.ts`
- 创建：`src/services/render-jobs/renderJobTypes.ts`
- 测试：`src/editor/capabilities/mermaid/MermaidWidget.test.ts`
- 测试：`src/editor/capabilities/mermaid/mermaidRenderScheduler.test.ts`
- 测试：`tests/e2e/mermaid.spec.ts`

**成熟组件/工具：**

- Mermaid 官方包。
- 不引入第三方 Mermaid wrapper，先用官方 render API。

**步骤：**

- [ ] 写失败测试：检测 ` ```mermaid ` fenced block 的开始、结束和源码内容。

  Run: `pnpm test src/editor/capabilities/mermaid/MermaidWidget.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：scheduler 取消旧任务，旧结果不能覆盖新结果。

  Run: `pnpm test src/editor/capabilities/mermaid/mermaidRenderScheduler.test.ts`

  Expected: 先失败。

- [ ] 写失败测试：cache key 包含源码、主题、配置和 Mermaid 版本。

  Run: `pnpm test src/editor/capabilities/mermaid/mermaidRenderScheduler.test.ts`

  Expected: 先失败。

- [ ] 实现 Mermaid block widget。

  要求：

  - 动态 import Mermaid。
  - 渲染任务 debounce。
  - 支持 loading、success、error。
  - 光标进入 block 时可以编辑源码。
  - 渲染失败不影响编辑。

- [ ] 写 E2E：Mermaid 渲染期间仍可输入普通文本。

  Run: `pnpm test:e2e tests/e2e/mermaid.spec.ts`

  Expected: 先失败后通过。

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:e2e
  pnpm perf:bench
  ```

  Expected: 全部 exit 0，性能输出显示 Mermaid 渲染不阻塞输入路径。

- [ ] 提交。

  Run:

  ```powershell
  git add src tests
  git commit -m "feat: add async mermaid block rendering"
  ```

## Task 8：产品外壳：工作区、文件树、大纲、命令面板

**目标：** 让 V1 具备真实桌面应用外壳，同时保持成熟组件优先。

**文件：**

- 创建：`src/features/workspace/workspaceCommands.ts`
- 创建：`src/features/workspace/workspaceStore.ts`
- 创建：`src/features/file-tree/FileTree.tsx`
- 创建：`src/features/outline/outlineParser.ts`
- 创建：`src/features/outline/OutlinePanel.tsx`
- 创建：`src/features/command-palette/CommandPalette.tsx`
- 创建：`src/features/settings/SettingsDialog.tsx`
- 创建：`src/app/shell/StatusBar.tsx`
- 创建：`src-tauri/src/commands/workspace.rs`
- 创建：`src-tauri/src/services/workspace_service.rs`
- 测试：`src/features/outline/outlineParser.test.ts`
- 测试：`tests/e2e/app-shell.spec.ts`

**成熟组件/工具：**

- `react-resizable-panels` 候选用于分栏。
- `react-arborist` 候选用于文件树。
- `cmdk` 候选用于命令面板。
- Radix Primitives 用于 dialog、tabs、tooltip。

**步骤：**

- [ ] 验证候选成熟组件是否满足 V1。

  必须记录在任务提交说明或短文档中：

  - 文件树候选是否支持键盘导航、懒加载、Windows 路径显示。
  - 分栏候选是否支持折叠和尺寸持久化。
  - 命令面板候选是否支持 i18n、快捷键和大量命令。

  如果候选失败，先找成熟替代；不得直接自研。

- [ ] 写失败测试：outline parser 从 Markdown 标题提取层级。

  Run: `pnpm test src/features/outline/outlineParser.test.ts`

  Expected: 先失败。

- [ ] 写失败 E2E：用户可以打开命令面板并触发保存命令。

  Run: `pnpm test:e2e tests/e2e/app-shell.spec.ts`

  Expected: 先失败。

- [ ] 实现 workspace command。

  Commands:

  - 逻辑命令：`workspace.open_directory`
  - 逻辑命令：`workspace.list_children`
  - Tauri 实现命名沿用项目现有下划线约定：`workspace_open_directory`、`workspace_list_children`

  要求：

  - 只列出 V1 需要的 Markdown 文件和目录元数据。
  - 错误转换为稳定 error code。

- [ ] 实现文件树和大纲。

  要求：

  - 文件树不一次性渲染过多节点。
  - 大纲由当前文档派生，不进入主存储。
  - 大纲更新 debounce。

- [ ] 实现命令面板和设置页。

  V1 命令至少包含：

  - 打开文件。
  - 保存。
  - 另存为。
  - 切换主题。
  - 切换语言。
  - 聚焦编辑器。

- [ ] 验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:e2e
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: 全部 exit 0。

- [ ] 提交。

  Run:

  ```powershell
  git add src src-tauri tests
  git commit -m "feat: add workspace shell outline and commands"
  ```

## Task 8A：架构止血和边界收敛

**目标：** 在继续 V1 收敛前，拆解已经膨胀的 shell、workflow、service 和 editor widget 边界，避免后续功能继续堆进单文件和跨层调用。完成标准不是“文件变小”，而是渲染视图和功能行为分离、子功能边界可由自动化测试约束。

**文件：**

- 修改：`src/app/shell/AppShell.tsx`
- 创建：`src/app/shell/AppShellView.tsx`
- 创建：`src/app/controllers/`
- 创建：`src/app/containers/`
- 创建：`src/app/shell/TopChrome.tsx`
- 创建：`src/app/shell/WorkspaceSidebar.tsx`
- 创建：`src/app/shell/EditorPane.tsx`
- 创建：`src/app/shell/AppDialogs.tsx`
- 创建：`src/features/commands/`
- 创建：`src/features/file-actions/useFileWorkflow.ts`
- 创建：`src/features/workspace/useWorkspaceWorkflow.ts`
- 创建：`src/editor/commands/editorCommandPort.ts`
- 移动：`src/features/workspace/workspaceCommands.ts` -> `src/services/workspace/workspaceCommands.ts`
- 修改：`src/editor/widgets/mermaid/`
- 测试：`tests/quality/architectureBoundaries.test.ts`

**步骤：**

- [ ] 写架构边界测试，约束 AppShell 只做薄布局、shell render components 不 import store/service/workflow/editor commands/window controls、workspace command wrapper 只能在 service 层、Mermaid public entry 只做兼容导出。
- [ ] 拆 AppShell 为 `AppShell` + `AppShellView` + `useAppShellSlots`：`AppShellView` 只接收 view model、labels、callbacks 和 slots。
- [ ] 拆 AppShell UI 子组件，保留现有窗口布局、菜单、侧边栏、编辑器区域、状态栏、命令面板和设置弹窗行为；`TopChrome`、`WorkspaceSidebar`、`EditorPane`、`AppDialogs` 只能做纯渲染。
- [ ] 拆 app controller 为 document、workspace、commands、editor、settings、window 子 hook，避免 `useAppController` 成为新的总控。
- [ ] 建立 `features/commands`，菜单、命令面板和右键菜单共享同一组 command model，不在 JSX 或 controller 中重复定义动作。
- [ ] 建立 `editor/commands/editorCommandPort.ts`，app 层只调用 `EditorDocumentPort` 和 `EditorCommandPort`，不直接 import 表格命令或 Markdown format 命令。
- [ ] 文件打开、保存、另存为、dirty revision 和 recent files 通过 file workflow 收口；workflow 通过 `FileStateAdapter`、`StatusAdapter`、`EditorDocumentPort` 注入状态和编辑器能力，不硬依赖 `appStore`。
- [ ] 工作区打开、children lazy load 和 stale request 防护通过 workspace workflow 收口；打开文件只通过注入 callback，不知道 file workflow 实现。
- [ ] workspace Tauri wrapper 移入 `services/workspace/`，不改 Rust command 名称和 wire shape。
- [ ] Mermaid preview 按 public entry、extension、block detection、WidgetType lifecycle、DOM view、inline editor、editing state、render adapter 建立模块边界，保持 `mermaidPreviewExtension()` 对外 API 不变。
- [ ] 验证。

  Run:

  ```powershell
  pnpm test tests/quality/architectureBoundaries.test.ts
  pnpm test src/app/shell/AppShell.test.tsx src/features/file-actions/fileActions.test.ts src/services/workspace/workspaceCommands.test.ts src/editor/capabilities/mermaid/MermaidWidget.test.ts src/editor/capabilities/mermaid/mermaidRenderScheduler.test.ts
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:fixtures
  pnpm perf:bench
  pnpm test:e2e tests/e2e/app-shell.spec.ts tests/e2e/mermaid.spec.ts
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: 全部 exit 0。若某个环境门禁不可用，必须记录失败命令、原因和影响，不能把未运行命令描述为已通过。

## Task 8B：Editor 子功能独立化

**目标：** 把 Mermaid、表格、代码块、图片等编辑器子功能收敛到 `editor/capabilities/`，让每个复杂能力可以独立演进，避免主体实现散落在 `core`、`commands`、`wysiwyg` 和旧 `widgets` 路径。

**文件：**

- 创建：`src/editor/capabilities/editorCapability.ts`
- 创建：`src/editor/capabilities/mermaid/`
- 创建：`src/editor/capabilities/table/`
- 创建：`src/editor/capabilities/code-block/`
- 创建：`src/editor/capabilities/image/`
- 修改：`src/editor/core/editorDisplayMode.ts`
- 修改：`src/editor/core/createEditorState.ts`
- 修改：`src/editor/commands/markdownFormatCommands.ts`
- 修改：`src/editor/commands/editorCommandPort.ts`
- 修改：`src/editor/wysiwyg/markdownDecorations.ts`
- 修改：`tests/quality/architectureBoundaries.test.ts`

**步骤：**

- [ ] 写架构边界测试，约束 `editor/core/**` 只能消费 capability 聚合入口，`editor/commands/**` 不能直接 import table、Mermaid、code-block 或 image 的内部实现。
- [ ] 建立 `EditorCapability`、`EditorCapabilityCommands`、capability 聚合入口和 live preview extension 聚合函数。
- [ ] 迁移 Mermaid 到 `editor/capabilities/mermaid/`，旧 `editor/widgets/mermaid/MermaidWidget.ts` 只保留兼容 re-export。
- [ ] 迁移 table 到 `editor/capabilities/table/`，通过 capability command factory 暴露 insert/copy/delete，继续使用 `codemirror-markdown-tables`。
- [ ] 拆 code-block 到 `editor/capabilities/code-block/`，负责代码块 decoration 和 wrap command；通用 Markdown format command 只转发到 capability command。
- [ ] 迁移 image 到 `editor/capabilities/image/`，旧 `editor/widgets/image/ImageWidget.ts` 只保留兼容 re-export。
- [ ] 更新架构文档，明确 capability 是长期边界，旧 `widgets/*` 是兼容层。
- [ ] 验证。

  Run:

  ```powershell
  pnpm test tests/quality/architectureBoundaries.test.ts
  pnpm test src/editor/capabilities/mermaid src/editor/capabilities/table src/editor/capabilities/code-block src/editor/capabilities/image
  pnpm test src/editor/commands src/editor/core src/editor/wysiwyg/markdownDecorations.test.ts
  pnpm test:fixtures
  pnpm test:e2e tests/e2e/mermaid.spec.ts tests/e2e/editor-markdown.spec.ts tests/e2e/app-shell.spec.ts
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm perf:bench
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: 全部 exit 0。不得新增用户可见行为、快捷键或 i18n key。

## Task 9：V1 收敛、性能门禁和 Windows 构建

**目标：** 收敛 V1，证明核心路径可用、可测、可发布。

**文件：**

- 修改：`tests/e2e/smoke.spec.ts`
- 修改：`tests/e2e/editor-markdown.spec.ts`
- 修改：`tests/e2e/mermaid.spec.ts`
- 修改：`tests/e2e/app-shell.spec.ts`
- 修改：`tests/perf/openLargeFile.bench.test.ts`
- 创建：`docs/performance/V1_BASELINE.md`
- 创建：`docs/release/WINDOWS_V1_BUILD.md`
- 修改：`docs/README.md`
- 修改：`src-tauri/tauri.conf.json`

**步骤：**

- [ ] 创建 `docs/performance/` 和 `docs/release/`，并同步更新 `docs/README.md`。

  准入理由：

  - V1 需要性能基准结果作为发布门禁。
  - V1 需要 Windows 构建说明作为发布资料。

- [ ] 写完整 V1 E2E 路径。

  Scenarios:

  - 启动应用。
  - 切换中文和英文。
  - 切换亮色和暗色主题。
  - 打开 fixture Markdown。
  - 输入标题和任务列表。
  - 保存。
  - 渲染 Mermaid。
  - 关闭并重新打开文件，内容仍保真。

- [ ] 收紧性能基准。

  初始门禁：

  - 1MB 文件打开结果记录到 `docs/performance/V1_BASELINE.md`。
  - 5MB 文件打开结果记录到 `docs/performance/V1_BASELINE.md`。
  - 10MB 文件必须不冻结。
  - Mermaid 渲染不能阻塞普通输入 E2E。

  如果真实硬件数据不能满足初始目标，必须记录原因、瓶颈和下一步优化，不得静默放宽门禁。

- [ ] 运行全量验证。

  Run:

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm test:fixtures
  pnpm test:e2e
  pnpm perf:bench
  cargo check --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
  pnpm build
  ```

  Expected: 全部 exit 0。

- [ ] 构建 Windows 安装包。

  Run: `pnpm tauri build`

  Expected: 生成 Windows 安装产物。若签名或安装器配置尚未具备，必须在 `docs/release/WINDOWS_V1_BUILD.md` 记录实际产物、缺口和阻塞原因。

- [ ] 执行 V1 完成定义检查。

  必须逐项检查：

  - P0 全部完成。
  - P1 核心体验完成。
  - E2E 覆盖打开、编辑、保存、Mermaid、语言切换、主题切换。
  - fixture round-trip 无无关 diff。
  - 大文档不冻结。
  - Mermaid 不阻塞输入。
  - 中文和英文文案覆盖完整。
  - 没有已知数据损坏风险。

- [ ] 提交。

  Run:

  ```powershell
  git add src src-tauri tests docs package.json pnpm-lock.yaml
  git commit -m "chore: validate V1 alpha baseline"
  ```

## 质量执行节奏

每个 task 推荐用一个独立 agent 或独立工作批次执行：

1. 实现 agent 按本计划写失败测试和最小实现。
2. 验证 agent 运行命令并读取输出。
3. 审查 agent 检查架构边界、源码保真、成熟组件优先和测试覆盖。
4. 只有 Critical 和 Important 问题清零后，进入下一个 task。

不得把多个 task 合并成一次大提交。

## V1 总体验收清单

- [ ] 应用可启动。
- [ ] 中文和英文可切换。
- [ ] 亮色和暗色可切换。
- [ ] CodeMirror 6 是唯一主编辑核心。
- [ ] React store 不持有 Markdown 全文。
- [ ] 可以打开 `.md` 文件。
- [ ] 可以保存当前文件。
- [ ] 可以另存为。
- [ ] 保存无无关 diff。
- [ ] dirty 状态准确。
- [ ] 标题 WYSIWYG 可用。
- [ ] 粗体、斜体、删除线 WYSIWYG 可用。
- [ ] 引用 WYSIWYG 可用。
- [ ] 有序和无序列表 WYSIWYG 可用。
- [ ] 任务列表 checkbox 可修改源码。
- [ ] 行内代码和代码块样式可用。
- [ ] Mermaid fenced block 可异步渲染。
- [ ] Mermaid 错误不影响编辑。
- [ ] 文件树可用。
- [ ] 大纲可用。
- [ ] 命令面板可用。
- [ ] 基础设置页可用。
- [ ] 1MB 和 5MB 文件编辑顺畅。
- [ ] 10MB 文件不冻结。
- [ ] E2E 覆盖 V1 关键路径。
- [ ] Windows 构建产物可生成。

## 暂不纳入 V1 执行

以下能力不进入本计划，避免 V1 发散：

- 表格编辑体验。
- 数学公式完整体验。
- PDF/HTML 导出。
- 全文搜索索引。
- 自动保存和崩溃恢复。
- 自动更新。
- 插件系统。
- 云同步。
- AI 写作助手。
