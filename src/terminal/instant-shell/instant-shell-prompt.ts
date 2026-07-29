/**
 * 终端 `globalThis.instant` 壳层 API 的系统 Prompt 片段。
 * 供任意 Agent / 生成管线按需拼接（即插即用），不依赖 React。
 */

/** 完整运行时说明（可直接拼进 system prompt）。 */
export const INSTANT_SHELL_RUNTIME_SECTION = `【Instant 壳层 API · globalThis.instant】
真终端（InstantREPL / QuickJS）在注入宿主绑定后提供全局 \`instant\`（不是 Node 的 require('os')，也不是微应用的 InstantOS.*）。
全部方法返回 Promise，须 await。相对路径相对当前 process.cwd。

打开：
- instant.openApp(appId, opts?) — 打开内置 / 已安装生成应用（gen:…）/ 外链应用（ext:…）
  - opts.documentId?：VFS 绝对路径，交给文档类应用
  - opts.url?：仅浏览器；与 documentId 互斥
- instant.openPath(path) — 按文件关联打开；目录打开「文件」应用；无默认程序则抛错
- instant.openUrl(url) — 在系统浏览器打开；仅 http/https；无 scheme 时补 https://
  - 拒绝 javascript: / data: / file: 等

发现与窗口：
- instant.listApps() → { id, name, kind: 'builtin'|'generated'|'ext' }[]
- instant.listWindows() → { windowId, appId, title, minimized, maximized, fullscreen, zIndex }[]
- instant.focus(target) / close(target) / minimize(target) / restore(target)
- instant.toggleFullscreen(target) / toggleMaximize(target)
  - target 为 appId 或 windowId；按 appId 时作用该应用最前/最近窗口
  - close：若终端已长时间执行中可能弹出确认；用户取消则抛「用户取消」

搜索：
- instant.grep(query, opts?) → { matches: [{ path, line, column, preview, matchedText }], truncated, scannedFiles, patternError? }
  - opts.path?：相对 cwd 或绝对 VFS 路径，默认 cwd；可为目录或单文件
  - opts.filesToInclude?：glob（逗号分隔）
  - opts.caseSensitive?：默认 false
  - opts.regex?：将 query 当作正则，默认 false
  - opts.maxMatches?：默认 40
  - 尊重 gitignore 与默认排除（如 node_modules）；不要手写 fs 递归搜索

示例（经 run_in_terminal 下发）：
await instant.openApp('settings')
await instant.openPath('/user/readme.txt')
await instant.openUrl('example.com')
const apps = await instant.listApps()
await instant.focus('files')
const r = await instant.grep('foo', { path: 'src' })
console.log(r.matches)

注意：
- 无 instant 时（未注入宿主）为 undefined；不要假设沙箱/非终端环境有此全局
- 不要用它改账户、API Key 或系统设置存储；壳层覆盖打开应用/路径/URL、窗口操作与文本搜索
- 与 fs / path 等 Node 兼容 API 正交：搜索用 instant.grep，读整文件 / 改文件仍用 fs，打开编辑器用 instant.openPath / openApp

【WebView · globalThis.webview】
终端另注入 \`webview\`（与 instant 并列）。用于在终端脚本里**打开真实网页、读取 DOM、截图、调试**——不是 AI 假页面（browser），也不是用户手点的 Chromo 窗口。
每个 create 创建一个浏览单元（可含多标签），默认离屏；依附当前终端会话。.reset / 关闭终端会立刻销毁该会话下全部单元。与 Chromo 共用同一套 virtual-chromo 代理与站点数据（cookie 等互通）。

何时用：
- 需要抓取/操作真实网页内容 → webview.create + wait + eval
- 用户要看见页面 → show；默认不要 show（离屏即可）
- 调试页面 → openDevTools（默认独立窗口）
- 仅「打开网址给人看」且不需读 DOM → 优先 instant.openUrl / openApp('chromo')，不必强开 WebView

API（均返回 Promise，须 await）：
- webview.create({ url }) → { unitId, tabId }（url 必填）
- webview.wait({ unitId, tabId?, timeoutMs? }) — 等到 ready 且非 loading；fault/超时 reject。tabId 可省略或传 'default'（当前 UI 展示 tab）
- webview.show({ unitId }) / destroy({ unitId })
- webview.listUnits() → 本会话单元摘要；listTabs({ unitId }) → 各 tab 的 url/title/loading/fault
- webview.navigate({ unitId, tabId?, url }) / eval({ unitId, tabId?, code }) / screenshot({ unitId, tabId? })
  - tabId 可传 'default'；操作类 API 均支持
  - eval：fault 后可读错误页 DOM；navigate/screenshot/wait 对 fault tab 会 reject
- webview.openDevTools({ unitId, tabId?, mode? }) — mode 默认 undocked；可传 'embedded'
- const stop = webview.on(event, fn) — 返回取消函数；webview.off(event) 清空该事件全部监听
  - 事件：unitCreated / unitDestroyed / unitShown / tabOpened / tabClosed / tabFault / navigated

典型用法：
const { unitId, tabId } = await webview.create({ url: 'https://example.com' })
await webview.wait({ unitId, tabId })
const title = await webview.eval({ unitId, tabId, code: 'document.title' })
const html = await webview.eval({
  unitId,
  tabId: 'default',
  code: 'document.documentElement.outerHTML.slice(0, 8000)',
})
console.log(title, html)
await webview.show({ unitId })
await webview.openDevTools({ unitId, tabId })
await webview.destroy({ unitId }) // 用完销毁；终端结束也会级联销毁

注意：
- 务必 await webview.wait 后再 eval；不要盲 sleep
- fault 的 tab 已死（不可再 navigate）；eval 可读错误提示页；需新 tab/新单元继续浏览
- 不要用 webview 代替 fs 读写本地文件；本地路径用 fs / instant.openPath`

/** 拼进任意 Agent system prompt 的标准入口。 */
export function buildInstantShellSystemPromptSection(): string {
  return INSTANT_SHELL_RUNTIME_SECTION
}

/** 更短的提示行（欢迎语 / 工具描述旁注）。 */
export function buildInstantShellPromptHint(): string {
  return '终端可用 globalThis.instant（openApp / openPath / openUrl / grep / …）与 globalThis.webview（create / wait / eval / show / …），详见壳层 API 说明。'
}
