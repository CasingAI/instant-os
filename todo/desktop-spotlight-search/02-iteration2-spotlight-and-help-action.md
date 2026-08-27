# 迭代二 · macOS 27 风格 Spotlight 重构 + 「让帮助 AI 代办」预设项

迭代目标：视觉对齐 macOS 27 Golden Gate 的 Spotlight（Liquid Glass 玻璃质感、
居中大面板、Siri/AI 建议常驻），并打通「搜索词 → 帮助应用自动发送」链路，
实现 iOS 6 式「无结果预设项」的现代版：AI 代办。

## 1. helpQuery 全链路（类型 + WM + 帮助应用消费）

| 文件 | 改动 |
| --- | --- |
| `src/os/types.ts` | `OpenAppOptions` 与 `WindowState` 各加 `helpQuery?: string`（帮助应用打开/聚焦时待自动发送的预设问题；与 documentId/url 互不排斥） |
| `src/os/os-context.tsx` | `openApp` 读取 `options.helpQuery`：`applyOpenPayload` 无条件叠加（定义时）；新建窗口路径（含 multiWindow）透传 `createWindow`；仿照 `setAppWindowDocumentId` 新增 **`setAppWindowHelpQuery(appId, helpQuery \| undefined)`**（undefined 即清除），挂进 OsContext 接口、value 与依赖数组 |
| `src/apps/help/help-app.tsx` | 读自身窗口的 `helpQuery`；effect：`pendingHelpQuery && !busy` 时 → 先 `setAppWindowHelpQuery('help', undefined)` 清状态（消费即去重，同词再次打开会重新触发），再 `sendMessage(pendingHelpQuery)` 自动发送。busy 时挂起等上一轮答完自动续发 |

不引入 windowId 透传（沿用 browser 的「按 appId 找自己窗口」惯例）。

## 2. 桌面搜索 overlay 重构（`desktop-app-search-overlay.tsx` + `.css`）

### 2.1 数据与交互

- 过滤改用 `rankDesktopAppSearchResults`（带 tier/tie/highlight ranges）。
- **组合可选列表 = 应用结果 + 「AI 代办」行**（query 非空时恒有，无结果时成为主推荐）：
  - 键盘 ↑/↓/Enter 覆盖组合列表；Enter 在应用结果空时直接落到 AI 代办行。
  - 鼠标 hover 选中，点击执行。
- AI 代办行动作：`openApp('help', { helpQuery: buildDesktopHelpPresetPrompt(query) })` 后关闭搜索。
- 名称高亮：按 `match.nameRanges`（码点区间）切分渲染；id 命中（idRanges 非空）时右侧灰字小 chip 显示 `entry.id`。
- 分组标签：「应用」（结果非空时）/「建议」（AI 代办行上方）；无结果时显示
  「没有匹配的应用」+ 代办行加副文案「让帮助助手直接帮你完成」。

### 2.2 预设提示词（纯函数，进 desktop-app-search.ts，可单测）

```ts
export function buildDesktopHelpPresetPrompt(query: string): string {
  const text = query.trim()
  if (!text) return ''
  return `我想完成这件事，请帮我办成：${text}。请给最短完成路径；需要动手或确认的操作请尽量直接发起（必要时打开终端让我确认）。`
}
```

（与 help agent 系统提示对齐：它面向操作指引 + 可发起 request_terminal_action
特权确认；不会承诺「已代你完成」。）

### 2.3 视觉（Liquid Glass 要点）

- backdrop：`rgba(0,0,0,0.18)` + `backdrop-filter: blur(10px)`；面板顶部留白约 14vh。
- 面板：宽 `min(100%, 560px)`、圆角 18px、
  `background: rgba(250,251,253,0.74)` + `backdrop-filter: blur(28px) saturate(170%)`、
  白色发丝边 + 大投影 + 内高光。
- 搜索行：内联放大镜 SVG + 无边框大输入（覆盖 `.ios-text-field` 样式：
  透明底、无边框、17px、去 focus 光圈），下缘发丝分隔线。
- 行高 46px；图标 28；选中态从「蓝色渐变满行」改为玻璃高亮
  `rgba(10,60,120,0.14)` + 左侧 3px 蓝色指示条 + 名称主色加深（更 Golden Gate）。
- AI 代办行：帮助图标 + 主文案「让「帮助」AI 代办」+ query 摘要副行，蓝色系。
- 高亮命中字符：`background: rgba(255,214,0,0.45)` 圆角小标记。

## 3. 测试与自验

- `desktop-app-search.test.ts` 增加 `buildDesktopHelpPresetPrompt` 用例
  （空串、常规、首尾空格裁剪）。
- `pnpm test:desktop-search`、`pnpm typecheck`。
- 走查：无结果 → 仅 AI 代办行且 Enter 生效；有结果 → 代办行在列表尾部可 ↑↓ 到达；
  帮助应用已在跑且 busy → 搜索词挂起、答完自动发出。

## 4. 风险与边界

- `applyOpenPayload` 只在 helpQuery 定义时写入，不清空存量（防止打开 help 不带
  query 时误清未消费的问题）——消费端读后即清，无脏残留。
- overlay 的 aria 结构保持 listbox/option；AI 代办行也作 option（键盘模型统一）。
- iOS 6 输入框组件（IosTextField）样式只做局部覆盖，不动全局组件。

## 5. 实施记录与自验

- [x] types.ts：`OpenAppOptions.helpQuery` + `WindowState.helpQuery`
- [x] os-context：createWindow 三条返回路径、openApp（applyOpenPayload + 两条
      createWindow 调用）透传；新增 `setAppWindowHelpQuery` 并挂进接口/value/依赖
- [x] help-app：pendingHelpQuery effect（busy 挂起、消费即清、自动 sendMessage）
- [x] overlay 重写：rankDesktopAppSearchResults + 高亮 + 「应用/建议」分组 +
      AI 代办行（无结果时唯一推荐，Enter 直接生效）+ 放大镜图标 + 新 placeholder
- [x] css 重写：Liquid Glass（backdrop blur、玻璃面板、发丝边、指示条选中态、
      黄色命中高亮、代办行蓝色系）
- [x] `buildDesktopHelpPresetPrompt` 纯函数 + 3 组断言
- [x] `pnpm test:desktop-search` 全绿（9 + 7 组）、`pnpm typecheck` 通过

与计划的偏差：无实质偏差；`DesktopAppSearchResult.match` 改为可选
（空查询直接罗列目录时无匹配信息），overlay 据此跳过高亮。
