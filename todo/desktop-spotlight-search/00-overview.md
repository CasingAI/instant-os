# 桌面搜索 Spotlight 化改造 · 总览

日期：2026-08-28 · 分支：experimental · 执行模式：自主迭代（无需用户确认）

## 背景

桌面「直接打字即搜索」已存在（`src/desktop/desktop-app-search*`），但存在两类问题：

1. **Bug**：打开几个窗口 → 点击 Dock 左右热区让窗口散开（desktop reveal）→
   再打字无反应。根因：`toggleDesktopReveal` 只清了 WM 级焦点
   （`setActiveWindowId(undefined)`），**从不 blur DOM 焦点**；Dock 热区
   pointerdown 又 `preventDefault()` 阻止了浏览器默认焦点转移。于是
   `document.activeElement` 仍停留在原窗口内容里：
   - 焦点在 `INPUT/TEXTAREA/contentEditable` → `isDesktopAppSearchBlockedTarget`
     直接放行拦截，搜索永不触发（desktop-app-search.ts L140-148）；
   - 焦点在 iframe（浏览器/虚拟机/生成应用）→ keydown 派发在 iframe 文档内，
     根本不会冒泡到父 window，desktop.tsx L921 的监听收不到。
2. **功能太简单**：匹配只有小写 `startsWith`/`includes`（应用名 + id），
   不支持中文拼音检索（全拼/简拼）、英文模糊匹配，也没有「无结果时的预设项」。

## 目标设计（对齐 macOS 27 Golden Gate Spotlight）

上网调研结论（Apple/Macworld/The Verge，2026-06 WWDC）：macOS 27「Golden Gate」
的 Spotlight 三大特点——**Siri AI 直接融入 Spotlight**（自然语言提问、AI 直接作答/
代办）、**Liquid Glass 视觉**（半透明玻璃质感面板）、**更相关的建议**。对应到本系统：

- **检索内核**：分层匹配（原名前缀 > 原名包含 > 全拼前缀 > 全拼包含 >
  拼音简写（声母/逐音节前缀，如 sz/shzh/shez → 设置）> id 前缀/包含 >
  模糊子序列），拼音数据复用 vendor 的 pinyin-pro
  （`src/apps/align/vendor/pinyin-pro/`，纯 JS、node 单测可用）。
- **视觉**：Liquid Glass 风格——backdrop 模糊、半透明面板、更大居中、
  搜索图标、匹配高亮、分组（应用 / 建议）。
- **AI 预设项（iOS 6 无结果预设的现代版）**：无结果（及有结果时固定底部）展示
  「在『帮助』里让 AI 代办：〈query〉」，点击 → `openApp('help', { helpQuery })`
  → 帮助应用预填并**自动发送**给 help agent，AI 直接开始执行操作。

## 迭代划分（每次迭代前另写详细计划）

| 迭代 | 主题 | 关键产出 |
| --- | --- | --- |
| 一 | Bug 修复 + 检索内核 | reveal 焦点修复；拼音/模糊匹配模块 + 分层排序 + 单测 |
| 二 | Spotlight 重构 + AI 预设项 | Liquid Glass 视觉；helpQuery 全链路（类型/openApp/帮助自动发送） |
| 三 | 边缘打磨 + 回归 | flip3d 打字、重复消费去重、IME 边缘、typecheck/测试/构建回归 |

## 验证方式

- 单测：`node --experimental-strip-types src/desktop/desktop-app-search.test.ts`
  及新增测试（沿用仓库 node assert 风格）；在 package.json 挂 `test:desktop-search`。
- 类型：`pnpm typecheck`（pre-commit 同款）。
- 构建：迭代三末跑一次 `pnpm build` 兜底打包回归。
