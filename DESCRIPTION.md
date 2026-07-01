# Obsidian Homepage 插件描述文档

## 一、插件概述

Obsidian Homepage 是一个 Obsidian 插件，用自定义交互首页替代默认空白页，并附带一个与 Markdown 编辑器联动的学习模式。

插件注册两种自定义视图：

| 视图 | 类型 | 生命周期 |
|------|------|----------|
| **首页** | `ItemView` | 插件加载后自动打开，一个实例常驻 |
| **学习模式** | `ItemView` | 打开 md 文件时自动在左侧分屏创建，关闭所有 md 文件后自动销毁 |

首页承载所有功能模块（日历、待办、文件浏览、计时器等），每个模块以可拖拽、可缩放的卡片形式呈现。学习模式是一个内嵌浏览器，方便边看视频边记笔记。

## 二、首页概览

### 2.1 Header 栏

页面顶部固定栏，三区域布局：

**左侧**：时段问候语 + 可编辑名字。插件根据系统时间自动切换问候语——6:00–8:59 早上，9:00–11:59 上午，12:00–13:59 中午，14:00–18:59 下午，其余时段晚上。名字以 `input` 控件内联显示，底部虚线提示可编辑，输入内容自动调整宽度，回车或失焦后保存到插件持久化数据中，下次启动恢复。

**中间**：实时时钟，`HH:MM:SS` 格式，每秒刷新。使用 `font-variant-numeric: tabular-nums` 保证数字等宽，避免指针跳动引起的抖动。

**右侧**：日期 + 星期，如"2026年6月30日 星期二"，与时钟同步更新。当时钟跨天时会自动刷新问候语。

### 2.2 组件系统

首页采用组件化架构。每个功能模块是一个"组件"，拥有：
- **id**：唯一标识（如 `"schedule"`、`"timer"`）
- **name**：中文显示名（如"日程中心"）
- **added**：是否启用（Boolean）

组件通过**右侧侧边栏**管理。侧边栏固定在 header 下方，不随内容区滚动。点击 `◀`/`▶` 展开/折叠，展开宽度 236px，内有两个区域：
- **已添加组件**：`added === true` 的组件，显示在首页
- **待添加组件**：`added === false` 的组件，不显示

操作方式：**点击**组件图标在两组间切换，或**拖拽**到另一区域完成切换。顶部有搜索框支持按名称过滤，150ms debounce。展开时内容区覆盖透明遮罩，点击遮罩自动关闭侧边栏。

每个组件以独立 SVG 图标表示——日历、时钟、显示器、清单、书本五个图标均为内联 SVG。

### 2.3 卡片系统

所有已启用组件以圆角矩形卡片形式放在内容区，共享统一的交互机制：

**定位**：所有卡片 `position: absolute`，放在 `#homepage-content` 容器（`position: relative`）内。容器 `overflow-y: auto`，纵向可无限滚动。

**初始位置**：首次启用时卡片自动居中。若与已有卡片位置重叠，碰撞检测算法自动推开（沿最短方向，12px 间隙）。

**拖拽**：点击卡片任意位置即可拖动，自动排除按钮、输入框、日历日、待办操作按钮、计时器选择器等交互元素（通过 `isInteractiveTarget()` 递归 `closest()` 检测）。使用 `setPointerCapture` 确保拖拽不丢失。

**缩放**：CSS `resize: both` + `overflow: hidden`，右下角浏览器原生 resize handle。pointerdown 检测右下角 20px 区域触发缩放而非拖拽。

**碰撞检测**：`constrainNoOverlap()` 检测当前卡片与其他所有卡片的重叠，沿水平或垂直方向推开，含 12px 间隙。外层 while 循环最多迭代 10 次，直至所有卡片位置稳定，避免 A 推 B、B 推回 A 的连锁问题。拖拽时额外做 constrain + clamp 循环（最多 5 次），防止边界裁切破坏推离结果。

**持久化**：每次拖拽结束保存 `{x, y, width, height}` 到 `settings.cardLayouts[componentId]`。`ResizeObserver` 监听缩放变化（200ms debounce）保存宽高。下次打开自动恢复。

**纵向扩展**：每次拖拽结束后调用 `expandContentHeight()`，根据最低卡片的底部位置 + 60px 设置 `minHeight`，确保滚动条可达所有卡片。

## 三、组件功能详述

### 3.1 日程中心

最核心的组件，集成四项功能，默认启用。

**日历**：月视图，7×6 网格。左右箭头翻月，年份自动跨年；"今天"按钮一键跳回。今日日期以 accent 色实心填充，选中日期以 2px accent 色描边。有待办事项的日期下方显示 1–4 个彩色小圆点标记。

**统计栏**（日历左侧）：顶部显示选中日期的"X月X日"；中间按四种颜色分组展示柱状图——圆点 + 标签 + 完成数/总数 + 进度条，宽度百分比动画过渡；底部显示昨日未完成待办（"昨X月X日"），每项旁有 `→` 按钮可逐项同步到选中日期，标题栏有 `全→` 一键全部同步；再下方显示当日已完成项（删除线）。

**待办面板**（日历右侧）：标题行显示日期 + 搜索框 + `+` 添加按钮；下方四个彩色圆点按钮用于颜色筛选（再点一次取消筛选）；搜索结果实时过滤；每条待办显示勾选框（☐/☑）+ 文字 + 可选时间段 + 删除按钮（×，hover 显示）。点击 `+` 弹出添加弹窗。

**联动**：若待办列表组件也启用了，待办面板的内容会被待办列表的嵌入模式覆盖。

**昨日复盘**：`getYesterdayKey()` 根据选中日期计算前一天，过滤出 `date === yesterdayKey && !done` 的待办。`syncTodoToToday(id)` 直接修改 `todo.date`；`syncAllYesterday()` 遍历所有待办逐条修改日期。

### 3.2 待办列表

独立的时间范围视图，默认未启用。与日程中心共享 `todos` 数据数组，双向同步。

**三种模式**：

1. **今天**：展示当日待办。若存在带时段的待办，以纵向甘特图呈现——时间轴从最早时段的小时到最晚时段的小时，每小时 40px 高，左侧时间标签，彩色细条（5px 宽）+ 右侧文字。甘特条可点击勾选，hover 显示删除按钮。无时段待办列在甘特图下方普通列表。

2. **本周**：按日期分组（周一至周日），每组日期标题 + 待办列表。

3. **本月**：按日期分组（1 日至月末），格式同上。

**两种呈现方式**：

- **嵌入模式**：日程中心也启用时，内容渲染到日程中心右侧面板（`#homepage-todo`），替换原始待办区域，独立卡片隐藏。标题栏更紧凑，Tab 按钮更小。
- **独立模式**：仅在待办列表启用时，显示为独立可拖拽卡片，带完整标题栏和 Tab。

`refresh()` 方法自动判断当前启用状态选择嵌入或独立渲染。

### 3.3 超级桌面

多实例文件浏览器，默认未启用。

**实例管理**：每实例有独立的文件夹路径和显示名称。`+` 按钮新增实例（向 `desktopFolders` 和 `desktopNames` push 空字符串）；`×` 按钮删除实例（数组 length > 1 时才显示）。标题可内联编辑。

**文件展示**：通过 `app.vault.adapter.list(path)` 读取目录内容。文件夹和文件分别按名称排序。文件夹用 📁 图标，文件根据扩展名映射到对应 emoji（📕 PDF/DOC、🖼 图片、🎵 音频、🎬 视频、📝 Markdown、💛 JS、🐍 Python、🌐 HTML 等，未知类型用 📄）。网格自适应列数（`grid-template-columns: repeat(auto-fill, minmax(88px, 1fr))`），文件和文件夹名最多显示 2 行（`-webkit-line-clamp: 2`）。

**导航**：`currentPaths` 数组维护每个实例的当前路径（非持久化）。双击文件夹进入（路径拼接），`← 返回` 按钮回到上级（目录部分 pop），返回按钮仅在当前路径不等于根目录时显示。

**打开文件**：双击 `.md` 文件调用 `workspace.openLinkText(path, "", false)` 在 Obsidian 新标签页打开。其他类型尝试通过 `require("electron").shell.openPath()` 调用系统默认应用。

**内联创建**：`📁+` 和 `📝+` 按钮在网格首位插入创建表单（图标 + 输入框）。`Enter` 调用 `vault.createFolder()` 或 `vault.create()`，`Esc` / 失焦（150ms 延迟，允许点击其他元素）取消。

**右键菜单**：右键文件或文件夹弹出上下文菜单（`position: fixed`），显示"删除文件"或"删除文件夹"，点击后调用 `vault.trash(file, true)` 移至回收站。菜单外点击自动关闭。

**实例间隔离**：每个实例独立存储 —— `desktopFolders[i]`、`desktopNames[i]`；卡片布局键为 `desktop-{i}`。碰撞检测通过 `data-component-wrapper` 属性选择器正确感知所有实例。

### 3.4 计时器

倒计时工具，默认未启用。

**显示模式**：两种模式通过按钮切换。
- **表盘模式**：140×140 SVG。外层灰色圆环 + accent 色进度弧（`stroke-dasharray/dashoffset` 动画，旋转 -90° 从 12 点开始顺时针消耗）。12 个刻度标记。分针（accent 色，粗）+ 秒针（normal 色，细）+ 中心圆点。下方数字时间文字。
- **数字模式**：大字体 `HH:MM:SS`（`font-weight: 300`）+ 下方细进度条，到点时文字变 accent 色。

**时间设定**：时/分/秒三个滚动选择器。每个选择器由标签（显示当前值）和弹出滚轮组成。点击标签展开滚轮（28px 行高，`scroll-snap-align: center`），点击数值选定并关闭。滚轮高度固定 3 行（84px），高亮当前值。外部点击关闭所有滚轮。时 0–99，分/秒 0–59。

**操作**：开始（设置倒计时并启动 `setInterval` 1s tick）→ 暂停（清除 interval）→ 重置（恢复设定值）。计时中 picker 禁止交互（透明 + `pointer-events: none`），暂停后恢复。重置按钮仅在暂停或结束时显示。

**通知**：倒计时归零后触发半透明遮罩 + 居中弹窗，显示 ⏰ "时间到！" + 设定时长文字 + 关闭按钮。点击关闭或点击遮罩关闭后自动重置到原设定值。

### 3.5 学习模式

Markdown 编辑器辅助工具，默认未启用。不是首页的卡片组件，而是一个独立的 ItemView。

**自动联动**：通过监听 `active-leaf-change` 事件实现。当有 md 文件打开且学习模式组件已启用时，自动在活跃编辑器左侧调用 `createLeafBySplit(activeLeaf, "vertical", true)` 创建分屏。关闭所有 md 文件后 200ms debounce 自动关闭（防止 leaf 移除事件先于 `getLeavesOfType` 更新）。

**浏览器**：使用 `<iframe>`（非 `<webview>`，因 Obsidian 未启用 `webviewTag`），sandbox 属性为 `allow-scripts allow-same-origin allow-forms allow-popups allow-presentation`，allow 属性包含全屏和媒体控制。

**URL 导航**：
- 输入完整 URL（`https?://`）直接导航
- 输入含 `.` 不含空格的文本自动补 `https://`
- 其他文本转 Bing 搜索

**视频平台识别**：三套正则匹配规则检测 YouTube（`watch?v=` / `youtu.be`）、Bilibili（`BV` 号）、Vimeo（`/数字ID`）。匹配后自动转换为对应的 embed 播放器 URL。YouTube 保留 `t=` 时间戳参数，Bilibili 保留 `p=` 分P参数。

**工具栏**：地址栏 + `◀` 后退 / `▶` 前进（调用 iframe 的 `contentWindow.history`）+ `↻` 刷新 + `☰` 历史 + `📷` 截图。

**起始页**：未加载页面时显示搜索栏 + 6 个快捷链接卡片（Bilibili/Bing/百度/知乎/码云/百度百科），全部国内直连无需科学上网。每个卡片有品牌色圆形首字母图标，hover 背景高亮。

**浏览历史**：`navigate()` 时自动 push URL（连续重复去重），最多 50 条，持久化到 `settings.studyMode.history`。历史面板从右侧滑出，最新在前，带序号和视频标记，点击恢复导航。

**内嵌失败处理**：`<iframe>` 的 load 事件正常触发；error 事件仅捕获网络错误；对于 X-Frame-Options 阻止，8 秒超时后显示"该页面不允许嵌入显示"+ "用默认浏览器打开"按钮（调用 `window.open(url, "_blank")`）。

#### 截图系统

截图是学习模式的核心功能，支持从 iframe 中选取区域截取并自动插入当前编辑器。

**选取界面**：
- 半透明遮罩覆盖整个 iframe wrapper
- 虚线选取框（2px dashed accent 色，4 角 accent 色方块手柄）
- 拖动框体移动，拖动四角 resize（最小 60×60）
- 底部工具栏："截取选中区域" + "取消"
- Enter 确认 / Esc 取消 / 点击按钮

**截图引擎 4 层降级**：

| 优先级 | 策略 | 原理 | 约束 |
|--------|------|------|------|
| 1 | Canvas `drawImage` | `ctx.drawImage(iframe, 0, 0)`，直接绘制 iframe 内容到 canvas | 仅同源页面可用，跨域抛异常 |
| 2 | macOS `screencapture` | 通过 `require("child_process")` 执行 `screencapture -x -R x,y,w,h /tmp/xxx.png`，读文件 → base64 → dataURL | 仅 macOS，需要 Node API 权限 |
| 3 | `getUserMedia` 屏幕捕获 | 5 种子模式降级：`getDisplayMedia({video:true})` → `getDisplayMedia()` → legacy `chromeMediaSource:"desktop"` maxSize → legacy `chromeMediaSource:"screen"` → legacy `chromeMediaSource:"desktop"` basic。捕获全屏视频帧 → canvas 裁剪目标区域 | 仅 Electron/Chrome，部分模式仅捕获主显示器 |
| 4 | 视频平台缩略图 | YouTube: `img.youtube.com/vi/{id}/maxresdefault.jpg` 等 4 种分辨率降级；Bilibili: API + CORS 代理 | 仅支持 YouTube 和 Bilibili |

**坐标计算**：选取框坐标相对于 iframe wrapper。策略 2 中，通过 `wrapper.getBoundingClientRect()` + `window.screenX/screenY` + `window.outerHeight - window.innerHeight`（Chrome 顶部栏高度）将 wrapper 相对坐标转为全局桌面坐标。策略 3 中，通过 `track.getSettings().width` 与 `window.innerWidth * dpr` 比较判断是否为全桌面捕获（`isFullDesktop = vidW > windowDeviceW + 200`），决定坐标偏移方式。

**保存与插入**：截图转为 `data:image/png;base64,...`，base64 部分解码为 `Uint8Array`，通过 `vault.createBinary(path, buffer)` 保存到 `assets/study-screenshots/截图_YYYY-MM-DDTHH-MM-SS.png`。获取当前活跃（或第一个）markdown view，调用 `editor.replaceSelection("![[path]]\n")` 插入。若无 markdown view 则仅保存。

## 四、待办事项数据模型

```
TodoItem {
  id: string;          // 唯一 ID，Date.now().toString(36) + 随机 4 位
  text: string;        // 事项文本
  color: string;       // 重要程度颜色：红/橙/黄/绿
  done: boolean;       // 是否完成
  date: string;        // 关联日期，"YYYY-MM-DD" 格式
  startTime?: string;  // 开始时间，"HH:MM" 格式
  endTime?: string;    // 结束时间，"HH:MM" 格式
}
```

待办通过 `TodoAddModal` 弹窗添加——输入文本 + 选择重要程度（4 色圆点）+ 可选时间段（两个 `<input type="time">`）+ 取消/确认按钮。`addTodo` 在 `HomepageView` 层统一调度，创建 TodoItem 后 push 到 `settings.todos`，`saveSettings()` 持久化，然后刷新所有相关面板。

## 五、关键实现细节

### 5.1 颜色与日期

- 四种颜色常量 `TODO_COLORS`：`#e53935`（高）、`#fb8c00`（中高）、`#fdd835`（中）、`#43a047`（低）
- 日期键格式 `YYYY-MM-DD`，通过 `formatDateKey(year, month, day)` 生成，month 为 0-based（JS Date），函数内部 +1
- `getYesterdayKey(dateKey)` 通过 `new Date(y, m-1, d); date.setDate(date.getDate()-1)` 计算，JS Date 自动处理跨月跨年

### 5.2 渲染模式

`render()` 每次用 `container.empty()` + `innerHTML` 重建整个 DOM。所有组件通过各自的 `init()` / `renderXXX()` 方法在新 DOM 上重新绑定事件。由于旧事件随旧 DOM 销毁，不会重复绑。

组件渲染顺序：侧边栏 → 日程中心 → 计时器 → 超级桌面 → 待办列表。组件间通过 `view` 协调对象相互访问。

### 5.3 多实例组件

超级桌面的每个实例有独立的 DOM（`#homepage-desktop-wrapper-{i}`）和独立的数据存储。碰撞检测通过 `data-component-wrapper` 属性选择器找到所有桌面实例卡片。`constrainNoOverlap` 跳过未定位卡片（`!el.style.left`），避免新实例干扰。

### 5.4 预览/提示

待办列表嵌入/独立双模式之间切换无闪烁——相同的方法（`renderContent`、`renderListItem`、`renderGanttView`）在两个模式下共享，仅容器元素不同。

## 六、编译与部署

技术栈：TypeScript → esbuild → CommonJS 单文件 `main.js`，直接输出到 vault 插件目录。外部依赖 `obsidian`/`electron`/CodeMirror 包标记为 external，不打包。`manifest.json` 和 `styles.css` 通过 symlink 指向开发目录。

开发命令：`npm run dev`（watch + inline sourcemap）、`npm run build`（生产模式）、`npm run lint`（类型检查）。

配合 hot-reload 插件 + `.hotreload` 标记文件实现保存即热重载。
