# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Obsidian 插件，启动时自动展示可编辑的首页（一篇普通 Markdown 笔记）。用户可以自行编辑首页内容。

## 技术栈

- TypeScript + esbuild 打包
- 输出 `main.js`（CommonJS 格式），供 Obsidian 加载
- 依赖类型库 `obsidian`（仅在编译时使用，external 不打包）

## 命令

```bash
npm run build      # 编译并打包（生产模式，无 sourcemap）
npm run dev        # 开发模式（watch + inline sourcemap）
npm run lint       # TypeScript 类型检查
```

## 文件结构

```
main.ts              # 插件入口，Plugin 类 + 设置面板 + 命令
manifest.json        # 插件元数据（id, name, minAppVersion）
esbuild.config.mjs   # esbuild 打包配置
```

- `main.ts` 包含全部逻辑：`HomepagePlugin` 类、`HomepageSettingTab` 类、设置接口、默认值。目前代码量不大，不拆文件。
- `DEFAULT_SETTINGS` 是设置的顶层常量，`HomepagePlugin` 构造时用它初始化 `settings`，`loadSettings()` 会与 `loadData()` 合并。
- 首页打开逻辑在 `openHomepage()` 方法中：检查文件是否存在 → 不存在则自动创建（写入默认欢迎内容） → 用 `openLinkText` 打开。
- `layout-ready` 事件中检查 `markdown` 类型叶子数，为 0 时才自动打开首页（避免覆盖用户上次关闭时的文件恢复）。

## 部署到 Obsidian

编译产物是 `main.js`，将其与 `manifest.json`、`styles.css` 一起复制到 vault 的 `.obsidian/plugins/homepage/` 目录。在 Obsidian 设置中启用插件即可。
