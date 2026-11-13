# Changelog

## 中文

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

