> 语言：**中文** · [English](../../decisions/0022-default-full-width-page.md)

# ADR 0022：默认页面宽度改为适应窗口（fluid）

**状态：** 已接受

**日期：** 2026-08-30

## 背景

ADR 0021 把 `adaptive`（`clamp(720px, 70%, 1100px)`）设为默认页面宽度。用户要求改成默认适应屏幕/窗口宽度。`fluid` 已存在，值为 `100%`；现有纸张 CSS 仍会通过 `min(calc(100% - gutter), var(--lm-editor-page-width))` 套上桌面 96px / 移动 36px 的安全边距。

v4 配置里的 `pageWidth: "adaptive"` 无法与“从未改过的默认值”区分，因此升级时必须改写。

## 决策

- 将默认 `appearance.pageWidth` 改为 `fluid`。
- 设置 schema 升到第 5 版。
- 升级时，`sourceVersion < 5` 的 `adaptive` 改写为 `fluid`。ADR 0021 的改写（`sourceVersion < 4` 且 `standard` → `adaptive`）仍先执行，因此 v3 的 `standard` 最终变成 `fluid`。
- 保留 `adaptive` 预设，CSS 不变。
- 明确选过的 `narrow`、`standard`、`wide`、`fluid` 保持不变。
- 当前版本文档里明确保存的 `adaptive` 予以保留。
- 旧 localStorage 里的 `adaptive` 同样映射为 `fluid`：那是上一个默认值，无法与明确选择区分。

## 被否决方案

- **把 `adaptive` 的 CSS 改成 `100%`：** 会悄悄改变一个已命名预设的含义，以及之后选择“自适应”的用户的预期。
- **删除 `adaptive` 预设，只留 `fluid`：** 迁移面更大；自适应仍是有用的受限宽度选项。
- **只改新安装默认值：** 现有 v4 `adaptive` 配置会留在旧默认上，与这次产品要求相反。

## 影响

- 新安装，以及被迁移的 v4 `adaptive`（和更旧的 `standard`）会得到减去安全边距的满窗口写作栏。
- 宽表格、Mermaid、PlantUML、图片仍使用 `--lm-editor-block-track-width`。
- 想要以前自适应栏宽的用户仍可在设置里选择“自适应”。
- TypeScript 与 Rust 共用 `tests/fixtures/settings-v5-contract.json`。

## 回滚与复审条件

- 混合文档输入 P80 超出既有 8 ms 门禁。
- 32 张日常 GFM 表格文件打开 P80 超过 300 ms（适应窗口、自适应或标准宽度）。
- 安装包 UX 卡顿门禁在适应窗口为默认时滚动 longtask P95/max 超过 50 ms。

空闲内存度量（issue #32）必须在本次默认值变更后重跑，因为满窗口栏会改变滚动条与轨道宽度的交互。使用 `pnpm release:installed-idle-memory`（10 分钟采样加 `--duration-ms 600000`）。脚本汇总 `lumamark` 与 WebView2 进程树。2026-08-25 安装包在 Windows 上 30 秒空闲采样约为 430–520 MB working set，预热后趋于平稳，未复现报告中的空闲 3GB。
