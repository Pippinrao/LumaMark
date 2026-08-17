> 语言：**中文** · [English](../../decisions/0016-tauri-text-clipboard-adapter.md)

# ADR 0016：桌面纯文本剪贴板适配

## 用途与范围

记录 LumaMark 在桌面与浏览器环境中读写纯文本剪贴板的唯一平台边界。本决策不包含图片、HTML、RTF、文件列表或剪贴板历史管理。

## 背景

浏览器 Playwright 可以显式授予 `clipboard-read` / `clipboard-write`，但安装版 Windows WebView 中 `navigator.clipboard.readText()` 可能不完成。继续把 WebView Clipboard API 当作桌面事实来源，会让真实菜单的 Paste 命令永久等待，并且浏览器 E2E 无法覆盖该失败。

## 决策

- 桌面运行时采用官方 `tauri-plugin-clipboard-manager`，仅向主窗口授予 `clipboard-manager:allow-read-text` 与 `clipboard-manager:allow-write-text`。
- `services/clipboard` 是平台 facade：Tauri 运行时只调用插件；浏览器预览和浏览器测试才解析 navigator adapter。
- app controller 把结构化的纯文本端口注入 `EditorCommandPort`。editor、feature 与 shell 不 import Tauri plugin，也不持有平台检测逻辑。
- 原生调用失败必须原样 reject，由现有命令错误通道本地化显示；禁止探测或回退到 navigator，以免重新进入已知的 WebView pending 路径。
- 表格、链接地址、图片路径与文件树路径等纯文本复制复用同一端口/facade。图片或富媒体剪贴板不因插件依赖而获得产品入口或 capability。

## 否决方案

- **桌面继续使用 `navigator.clipboard`：** 安装版已有不完成的真实证据，否决。
- **自研 Rust clipboard command：** 官方 Tauri v2 plugin 已提供跨平台命令、权限清单和 JS API，没有自研收益。
- **授予 `clipboard-manager:default` 或图片/HTML 权限：** default 不表达本产品能力，额外格式超出当前需求和最小权限边界。
- **原生失败后回退 navigator：** 会掩盖原生错误并重新引入不可完成路径，否决。

## 影响

- JS 与 Rust lockfile 会新增官方插件；Rust plugin 通过 `arboard` 带入平台相关依赖，即使产品 capability 仍仅限文本。
- 桌面安装包大小、构建时间和 hash 可能变化，发布验收必须记录最终 EXE 版本、大小与 SHA-256。
- 浏览器 adapter 保留，因此非 Tauri 的单元测试和浏览器 E2E 无需模拟桌面 IPC。

## 复审条件

- Tauri 官方插件改变 read/write-text 命令、权限名、错误语义或最低版本。
- WebView 提供可验证、跨平台且无需额外授权的稳定剪贴板能力，并通过安装版真实菜单验收。
- 产品需要图片、HTML 或文件列表剪贴板；届时另行设计权限、隐私与恢复合同，不能直接扩大本 ADR。
