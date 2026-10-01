# dsh-markdown-bubble

**DeepSeek Harness 用户消息 Markdown 渲染插件 —— 你发出去的每一条消息，都按 Markdown 渲染。** 标题、列表、加粗、行内代码、引用、代码块、表格与公式不再以源码形态躺在气泡里，而是经宿主自己的 Markdown 管线（`MarkdownText`）呈现；引用 chip、附件、时间/复制操作条与其它插件注入的按钮全部原样保留。实现方式是官方 keyed 槽位 `conversation.chat.node` 的 `user` / `steering` 座位替换，不修改 DSH 源码，不改写任何会话日志。

[中文](#中文) · [English](#english)

---

## 中文

<div align="center">
  <img src="https://raw.githubusercontent.com/DDDMUC/dsh-markdown-bubble/main/docs/screenshots/01-markdown-bubble.png" alt="用户消息气泡按 Markdown 渲染" width="820" />
  <br>
  <sub>▲ 发出的 Markdown 按格式渲染；单换行保留为换行，代码块带宿主同款语法高亮卡</sub>
  <br><br>
  <img src="https://raw.githubusercontent.com/DDDMUC/dsh-markdown-bubble/main/docs/screenshots/02-action-strip.png" alt="操作条上的复制、删除、重跑、编辑按钮" width="520" />
  <br>
  <sub>▲ 操作条原样保留：时间、复制，以及 dsh-delete-turn / dsh-rerun-turn / dsh-edit-turn 注入的按钮</sub>
</div>

### 为什么需要它

DSH 的用户消息气泡按原样显示你输入的文字（`white-space: pre-wrap`）：粘贴一段 README、写一段带列表的提示词、贴一段代码，都要先在脑子里解一遍 Markdown。助手回复有完整的 Markdown 管线，你自己的消息却没有。

这个插件把你这一侧的气泡也接到同一条管线上：

- 标题、列表、有序列表、任务列表、加粗 / 斜体 / 删除线、行内代码；
- 围栏代码块（宿主同款语法高亮与复制 / 换行工具条）、引用、分割线；
- 表格（宽表可横向滚动）、链接、图片、KaTeX 公式、脚注；
- 单换行保留为换行（GFM 语义会把 `第一行\n第二行` 合并成一段，聊天里没有人希望这样）。

### 特性

- **官方座位替换** —— 经 `ctx.slots` 在 `conversation.chat.node` 的 `user` / `steering` 两个 keyed 座位上以 `priority: -1` 遮蔽宿主渲染器；停用/卸载即恢复宿主自己的气泡，不改源码、不动日志
- **宿主同款渲染** —— 不自己造 Markdown 管线，直接调用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`：与助手回复同一套解析、高亮、表格、公式与代码卡
- **引用 chip 保留** —— 宿主投影函数 `projectUserText` 照常调用，返回的片段按 chip / 纯文本拆分：chip 仍是可点击的文件 / 技能 chip，纯文本段逐个进 Markdown
- **操作条与三方插件兼容** —— 时间 + 复制按钮用官方 primitives 重建，操作条保留 `_actions` / `_action` 类名后缀与 `data-clock` 锚点；dsh-edit-turn、dsh-delete-turn、dsh-rerun-turn 的按钮注入照常工作
- **附件与补充块** —— 图片走官方 `conversation.message.images` 座位（`renderMessageImages`），文件卡、引用摘要、`JsonBlock` 补充块与宿主同款
- **软换行保留** —— 仅对围栏代码之外的续行补 GFM 两空格硬换行；代码块一个字节不动，缩进代码与表格行不误伤
- **出错兜底** —— 单条消息的渲染错误被错误边界接住，回退为宿主的原始投影，不会连累整条座位被槽位机制摘除
- **中英双语** 随系统语言切换（代码卡文案复用宿主 `chat` 字典）

### 安装

```sh
# npm 安装（web profile）
dsh plugin --profile web add dsh-markdown-bubble

# 本地工作区（开发）
dsh plugin --profile web add link:/path/to/dsh-markdown-bubble
```

`dsh plugin add` 会把依赖写进 profile 并把包追加到 `dsh.profile.bundles`。实测宿主随即扫描到新行、浏览器端热挂载，无需重启；若你的宿主版本未热载，重启 DSH 进程后刷新页面即可。

### 使用

安装即生效，无命令、无设置项。发一条带 Markdown 的消息即可看到渲染结果：

````markdown
# 标题

- 列表 **加粗**
- 第二项 `行内代码`

> 引用一行

```js
const a = 1
```
````

排队中的消息预览、输入框本身与 goal 面板保持纯文本（见「已知限制」）。

### 工作原理

1. **座位遮蔽**：浏览器半区 `ctx.slots.inject('conversation.chat.node', …)` 注册 `user` 与 `steering` 两个 keyed 条目，`priority: -1` 低于宿主默认的 `0`（同 key 同优先级会抛错，最低者渲染）。
2. **内容拆分**：从节点数据取 `content`，按宿主 `UserStyleBubble` 的同一规则拆成文本 / 图片附件 / 文件卡 / 剩余块。
3. **chip 感知的 Markdown 合成**：调用宿主投影 `projectUserText`，把返回片段分成 chip 与纯文本；纯文本段逐个经 `MarkdownText` 渲染，chip 原样成为可点击元素。
4. **源码预处理**：CRLF 归一、会话回顾 wire 链接（`@[label](dsh-session:…)`）还原为显示名、围栏代码之外的续行补两空格硬换行。
5. **外壳复用**：行 / 堆栈 / 气泡 / 文件卡的度量值逐条对齐宿主样式表（`MessageItem.module.css`、`MessageIconActions.module.css`），颜色全部走主题 token；操作条在 DOM 序中前置、用 flex `order` 还原视觉顺序——这样三方插件 `querySelector('[class*="_actions"]')` 的首个命中永远是消息操作条，而不是气泡内代码卡的工具条。

### 已知限制

- **待确认气泡不覆盖**：本地回声与待发送 steering 由宿主 `PendingSubmissionBubble` / `PendingSteeringBubble` 直绘，不走 chat-node 座位，仍是纯文本；消息落盘后即切换为 Markdown。
- **队列预览不覆盖**：排队消息的一行预览与 goal 命令行保持纯文本。
- **行内 chip 的折衷**：chip 打断连排段落时，该段会拆成 chip 两边的块（与社区同类实现相同的取舍）；chip 在段首/段尾的常见情形无缝。
- **皮肤边界**：若某个皮肤直接针对宿主 CSS-module 类名定制用户气泡样式，不会命中本插件的气泡；主题 token 与 `.dshmb-*` / `.dshmb_*` 自定义样式正常生效。
- **多行语义**：单换行按硬换行渲染；连续空格、Tab 缩进等 Markdown 忽略的空白会被折叠（代码块内除外）。

### 兼容性

- 实测 DSH `0.2.0-rc.1`（web profile，Chromium）。依赖：keyed 槽位 `conversation.chat.node`、行锚点 `data-chat-flow-kind` / `data-pending-steering` / `data-submission-echo`、primitives 导出的 `MarkdownText` / `projectUserText` / `writeClipboard`。
- 与 `dsh-edit-turn`、`dsh-delete-turn`、`dsh-rerun-turn` 协同：三者的按钮注入基于 `[class*="_actions"]` / `[class*="_action"]`，本插件保留该契约；被 dsh-edit-turn 改写（rollback）的消息显示其自己的改写气泡，与本插件无关。
- 宿主半区为惰性入口（无运行时行为），全部逻辑在 `./client` 浏览器半区；不修改官方源码，不写私有事件类型。

### 修复记录

- **0.1.2** — 座位组件不再可能因渲染期异常被槽位机制摘除：`composeUserMarkdown` / `buildMarkdownLabels` 在座位渲染过程中运行，抛错不会被错误边界接住（错误边界只能接住其后代，接不住创建它的那次渲染），会冒泡到槽位机制并把该条目整条退掉——屏幕上就是气泡交还给宿主、Markdown 变回源码。现在合成与所有文案查询都在座位内部兜底：任何宿主形状不符（节点结构异常、投影返回不可识别、locale 席位不可调用）都退回宿主原始投影，气泡外壳、操作条与兄弟插件锚点全部保留。`data.content` 非数组、`t` 不可调用等情形一并加进回归测试。
- **0.1.1** — 修复两个引用 chip 之间只有空白时该空白被当作空 Markdown 块丢弃的问题：相邻 chip 不再粘成 `@a@b`，chip 之间的换行也按宿主 `pre-wrap` 气泡的样子保留为换行（空白段渲染为 `data-dshmb-gap` 的预换行节点，仍不产生空 Markdown 块）；自建的操作条 / 复制按钮补上 `data-dshmb-actions` / `data-dshmb-action` 命名空间标记；座位优先级 `-1` 的宿主依据（宿主默认 0、最低者渲染、同优先级抛错）与三个兄弟插件依赖的锚点结构一并加进回归测试。

### License

MIT

---

## English

**Markdown rendering for DeepSeek Harness sent messages — every message you send is rendered as Markdown.** Headings, lists, bold, inline code, quotes, code fences, tables and math stop sitting in the bubble as source text and render through the host's own Markdown pipeline (`MarkdownText`); reference chips, attachments, the clock/copy action strip and sibling plugins' injected buttons all stay exactly where they were. It works by shadowing the official `user` / `steering` keyed seats of `conversation.chat.node` — no DSH source changes, no session-log rewrites.

### Why you need it

DSH draws your own messages verbatim (`white-space: pre-wrap`): paste a README, write a prompt with a list, drop in a code snippet, and you parse the Markdown in your head first. Assistant replies get the full pipeline; your side does not. This plugin puts your side on the same pipeline: headings, lists, task lists, bold/italic/strikethrough, inline code, fenced code blocks (with the host's syntax highlighting and copy/wrap toolbar), quotes, rules, tables (wide ones scroll), links, images, KaTeX math and footnotes — with single line breaks preserved as line breaks.

### Features

- **Official seat replacement** — registers `user` and `steering` keyed entries in `conversation.chat.node` at `priority: -1` through `ctx.slots`; disabling or uninstalling restores the host's own bubble. No source edits, no log writes.
- **The host's own renderer** — calls `MarkdownText` from `@deepseek-ai/dsh-client-ui-primitives`, so user messages share the assistant pipeline: the same parsing, highlighting, tables, math and code cards.
- **Reference chips stay chips** — the host projection (`projectUserText`) is called as usual and split into chips and plain runs; chips keep their click targets, each plain run becomes a Markdown block.
- **Action strip and sibling-plugin compatibility** — clock and copy are rebuilt from exported primitives; the strip keeps the `_actions` / `_action` class suffixes and the `data-clock` anchor that dsh-edit-turn, dsh-delete-turn and dsh-rerun-turn search for.
- **Attachments and extra blocks** — images go through the official `conversation.message.images` seat (`renderMessageImages`); file cards, the reference summary and `JsonBlock` extras match the host.
- **Soft breaks preserved** — continuation lines outside fenced code get GFM's two-space hard break; code keeps every byte, indented code and table rows are left alone.
- **Crash containment** — a per-message error boundary falls back to the host's plain projection instead of having the slot machinery retire the whole seat.
- **Bilingual** copy follows the active locale (code-card chrome reuses the host `chat` dictionary).

### Install

```sh
# from npm (web profile)
dsh plugin --profile web add dsh-markdown-bubble

# local workspace (development)
dsh plugin --profile web add link:/path/to/dsh-markdown-bubble
```

`dsh plugin add` writes the dependency into the profile and appends the package to `dsh.profile.bundles`. In testing the host picked the new row up live and the browser hot-mounted it with no restart; if your host build does not hot-load, restart DSH and reload the page.

### Usage

Install and send Markdown — no command, no setting. A smoke test:

````markdown
# Heading

- list with **bold**
- second item `inline code`

> a quote

```js
const a = 1
```
````

Queued-message previews, the composer itself and the goal panel stay plain text (see limitations).

### How it works

1. **Seat shadowing** — the browser half registers `user` and `steering` keyed entries under `conversation.chat.node` at `priority: -1`, lower than the host's default `0` (same key at the same priority throws; the lowest renders).
2. **Content split** — the node's `content` is split exactly as the host's `UserStyleBubble` does: text, image attachments, file cards, remaining blocks.
3. **Chip-aware Markdown composition** — the host projection is split into chips and plain runs; each plain run renders through `MarkdownText`, chips stay clickable elements.
4. **Source preparation** — CRLF normalization, session-recall wire links (`@[label](dsh-session:…)`) reduced to their display label, and two-space hard breaks on continuation lines outside fenced code.
5. **Shell parity** — row/stack/bubble/file-card metrics are copied from the host sheets (`MessageItem.module.css`, `MessageIconActions.module.css`) while colors stay theme tokens; the action strip leads the row's DOM order with flex `order` restoring the visual order, so a sibling plugin's `querySelector('[class*="_actions"]')` always lands on the message bar — never on a code card's toolbar inside the bubble.

### Known limitations

- **Pending bubbles are not covered**: the local submission echo and the pending steering bubble are drawn directly by the host (not through the chat-node seats) and stay plain text until the message lands.
- **Queue previews are not covered**: the one-line queue preview and goal command rows stay plain text.
- **Inline-chip trade-off**: a chip interrupting a running paragraph splits that paragraph into blocks around the chip (the same trade-off community implementations take); boundary chips are seamless.
- **Skin boundary**: a skin that styles the host's CSS-module bubble classes directly will not hit this plugin's bubble; theme tokens and `.dshmb-*` / `.dshmb_*` custom styles work.
- **Multi-line semantics**: single newlines render as hard breaks; whitespace Markdown ignores (runs of spaces, tab indentation) is collapsed outside code blocks.

### Compatibility

- Verified against DSH `0.2.0-rc.1` (web profile, Chromium). Depends on the keyed `conversation.chat.node` slot, the `data-chat-flow-kind` / `data-pending-steering` / `data-submission-echo` row anchors, and the primitives exports `MarkdownText` / `projectUserText` / `writeClipboard`.
- Works alongside `dsh-edit-turn`, `dsh-delete-turn` and `dsh-rerun-turn`: their injection relies on `[class*="_actions"]` / `[class*="_action"]`, which this plugin preserves. A message rewritten (rolled back) by dsh-edit-turn shows that plugin's own replacement bubble, which is out of scope here.
- The host half is an inert entry (no runtime behavior); everything lives in the `./client` browser bundle. No official source is modified and no private event type is written.

### Fixes

- **0.1.2** — the seat component can no longer be retired by a render-time exception: `composeUserMarkdown` / `buildMarkdownLabels` run while the seat renders, and a throw there is not caught by the error boundary (a boundary catches its descendants, not the render that creates it) — it escapes to the slot machinery, which drops the whole entry and hands the row back to the host, so the bubble reverts to raw source on screen. Composition and every copy lookup now degrade inside the seat: any host-shape mismatch (an unexpected node, an unrecognised projection result, a locale seat that is not callable) falls back to the host's plain projection while the bubble shell, the action strip and the sibling-plugin anchors stay intact. `data.content` that is not an array and an uncallable `t` are covered by regression tests.
- **0.1.1** — fixed whitespace-only plain runs between two reference chips being dropped as an empty Markdown block: adjacent chips no longer glue into `@a@b`, and a newline between two chips stays a line break the way the host's `pre-wrap` bubble shows it (the run renders as a `data-dshmb-gap` pre-wrap node, still never an empty Markdown block); the self-created action strip and copy button now carry the `data-dshmb-actions` / `data-dshmb-action` namespace markers; and the host evidence behind `priority: -1` (host default 0, lowest renders, same priority throws) plus the anchor structure the three sibling plugins rely on are covered by regression tests.

### License

MIT
