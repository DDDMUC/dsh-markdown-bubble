# Changelog

## 中文

**0.2.2** —— 引用 chip 修复：从「猜投影里的 chip」改成「用宿主规则分段、宿主组件渲染」。

- 0.1.5 把投影改成 `renderFactorySlot('conversation.user.text', …)` 后，工厂返回的是单个 `<FactoryOutlet>`，而插件仍按 chip / 纯文本片段拆分；`data-ref-chip` 永远不存在，消息里的 session / file / skill 引用全部退化成纯文本，session chip 不再蓝、也不再可交互。
- 现在用 `uiConversation.userText.createEvaluator()` 取得宿主自己的节点边界（规则由宿主的 chat / reference / skill / quote / secret 插件共同注册），再把每个引用节点的原始 token 交回 `conversation.user.text` 工厂；chip 的外观与交互完全由宿主 keyed renderer 决定，纯文本节点仍进 `MarkdownText`。
- 求值器不可用、节点区间不连续 / 越界、或任一渲染步骤抛错时，保留原来的整条投影 / 裸文本兜底；座位不会被摘除。
- 新增回归：节点覆盖与 facts 传递、每个引用只投影自己的 token 且 `interactive: true`、chip 夹在两段 Markdown 之间、chip 间空白保留、全文本节点不调用引用投影、畸形节点与抛错求值器都走兜底。

**0.2.1** —— 卡片文案。

- 「气泡 Lite」的描述去掉「（默认）」，默认值仍在卡片里标明。

**0.2.0** —— 对比 v0.1.5：两种外观（气泡 Lite / Pro）与设置卡。

- 新增 `layout`：`bubble`（Lite，右对齐气泡）与 `full`（Pro，铺满整列、与输入框同宽）。
- Pro 静默态只有一条两端内收的顶线（伪元素画的直线），悬浮才出现 1px 圆角框；只过渡边框颜色，不会先黑后灰。
- 首帧用本地缓存打好外观标记，新消息不再先画成右侧气泡再跳变；宿主乐观回显的 `data-message-bubble` 也按 Pro 排版。
- 动作条与下一轮之间留白 16px。
- 插件自己的页面新增「气泡 Lite / Pro」设置卡，切换即时生效（配置存 `~/.dsh/dsh-markdown-bubble/config.json`）。


**0.1.6** —— 两种外观：气泡 Lite / 气泡 Pro（同一个插件，可在设置里切换）。

- `layout: bubble`（默认）保持现有右对齐气泡；`layout: full` 铺满对话列、去掉气泡底色、与输入框同宽。
- 外观存 `~/.dsh/dsh-markdown-bubble/config.json`，经 `/api/dsh-markdown-bubble/config` 读写；切换即时生效。

