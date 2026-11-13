# Changelog

## 中文

**0.2.0** —— 两种外观 + 设置卡。

- `layout: bubble`（气泡 Lite，默认）与 `layout: full`（气泡 Pro：铺满整列、与输入框同宽、静默只留顶线、悬浮出现圆角框）。
- Pro 模式下宿主乐观回显的气泡也按同一外观渲染，不再先闪一下右侧气泡。
- 动作条与下一轮之间留白 16px。
- 插件自己的页面注册「气泡外观」设置卡（Lite / Pro 即时切换）。

**0.1.6** —— 两种外观：气泡 Lite / 气泡 Pro（同一个插件，可在设置里切换）。

- `layout: bubble`（默认）保持现有右对齐气泡；`layout: full` 铺满对话列、去掉气泡底色、与输入框同宽。
- 外观存 `~/.dsh/dsh-markdown-bubble/config.json`，经 `/api/dsh-markdown-bubble/config` 读写；切换即时生效。

