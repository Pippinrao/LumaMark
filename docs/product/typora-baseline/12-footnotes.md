# 脚注

| 字段 | 值 |
|---|---|
| Typora 版本 | 1.13.7 |
| 最后核实 | 2026-07-11 |
| 复核状态 | partial |
| 主来源 | Markdown Reference → Footnotes |
| Support URL | https://support.typora.io/Markdown-Reference/ |
| Preferences 依赖 | 无（MultiMarkdown 风格脚注为默认记载能力） |
| 横切模型 | [00-live-preview-model.md](00-live-preview-model.md) |

## 1. 范围与非范围

- **范围内：** MultiMarkdown 风格引用脚注 `[^id]` 与定义 `[^id]:`；上标悬停查看内容。
- **范围外：** 行内脚注的第二种 MultiMarkdown 写法若未在本节展开则不臆造；导出时的脚注排版细节。

## 2. 语法表面

```markdown
You can create footnotes like this[^fn1] and this[^fn2].

[^fn1]: Here is the *text* of the first **footnote**.
[^fn2]: Here is the *text* of the second **footnote**.
```

- 标识符需唯一且与标记匹配。`support`
- 悬停上标可查看脚注内容。`support`

## 3. 阅读态（非当前 / 非焦点）

- 正文中显示为上标引用；定义区通常在文档合适位置呈现（具体是否折叠）GUI `unknown`。
- 悬停为阅读态主要交互。`support`

## 4. 编辑态（光标进入 / 焦点）

- 编辑 `[^id]` 或定义行文本；是否像 span 一样展开定界符：未逐步核实，`unknown`。
- 见 [00 §3](00-live-preview-model.md#3-行内-span-展开模型光标进入-span-时) 总则。

## 5. 输入与创建路径

| 路径 | 行为 | 出处 |
|---|---|---|
| 键入触发 | 输入 `[^id]` 与定义行 | support |
| 快捷键 | 不适用（未记载） | support |
| 菜单 | 不适用（未记载专用项） | support |
| 拖拽 | 不适用 | support |
| 粘贴 | 粘贴含脚注语法的文本 | unknown |
| 其它UI | 悬停上标查看内容 | support |

## 6. 源码模式与落盘形态

- 落盘保留标记与定义行；定义行可含行内 Markdown。`support`
- 源码模式完整显示。见 [00 §1](00-live-preview-model.md#1-模式总览live-preview-vs-源码模式)。

## 7. 边界、失败与保真

- 缺失定义的悬空引用：行为未详述，`unknown`。
- 重复 id：未详述，`unknown`。
- 定义中的强调等应可渲染。`support`（示例含 * 与 **）

## 8. LumaMark 对齐

| ID | 行为点 | Typora 事实摘要（一句） | 出处 | LumaMark | 理由（一句） | 阶段 |
|---|---|---|---|---|---|---|
| fn-01 | [^id] 标记 | MultiMarkdown 引用脚注 | support | defer | 非 V1 基础语法列表 | Parity |
| fn-02 | [^id]: 定义行 | 脚注正文定义 | support | defer | 随脚注能力 | Parity |
| fn-03 | 悬停查看 | 上标 hover 显示内容 | support | defer | 交互随脚注 | Parity |
| fn-04 | 定义内行内 MD | 定义可含强调等 | support | defer | 随脚注 | Parity |
| fn-05 | 源码保真 | 落盘为标记+定义 | support | defer | 实现时保真 | Parity |
| fn-06 | 阅读态上标 | 正文显示上标 | support | defer | 随脚注 | Parity |
| fn-07 | 悬空引用 | 行为未核实 | unknown | unknown | 需实测 | Parity |
| fn-08 | 自动编号显示 | 上标数字如何映射未核实 | unknown | unknown | 需实测 | Parity |

## 9. 未核实清单

| 项 | 建议步骤 | 影响对齐 ID |
|---|---|---|
| 悬停弹出层内容与格式 | 悬停 [^fn1] | fn-03 |
| 点击上标是否跳转定义 | 单击上标 | fn-06 |
| 无定义引用 | 只写 [^x] | fn-07 |
| 定义区在文档末的自动整理 | 在中部写定义 | fn-02 |

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-11 | 初版 |
