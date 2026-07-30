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
- 大文本可写 os.tmpdir()（session 级 /tmp/Terminal/{id} 或 /tmp/Npm/{id}）；不要塞满上下文，用 fs 分段读取即可

【WebView · globalThis.webview】
终端另注入 \`webview\`（与 instant 并列）。用于在终端脚本里**打开真实网页、读取结构/正文、操作 DOM、截图、调试**——不是 AI 假页面（browser），也不是用户手点的 Chromo 窗口。
每个 create 创建一个浏览单元（可含多标签），默认离屏；依附当前终端会话。.reset / 关闭终端会立刻销毁该会话下全部单元。与 Chromo 共用同一套 virtual-chromo 代理与站点数据（cookie 等互通）。

何时用：
- 需要抓取/操作真实网页内容 → webview.create + wait + snapshot（优先）/ eval
- 用户要看见页面 → show；默认不要 show（离屏即可）
- 调试页面 → openDevTools（默认独立窗口）
- 仅「打开网址给人看」且不需读 DOM → 优先 instant.openUrl / openApp('chromo')，不必强开 WebView

API（均返回 Promise，须 await）：
- webview.create({ url }) → { unitId, tabId }（url 必填）
- webview.wait({ unitId, tabId?, timeoutMs? }) — 等到 ready 且非 loading；fault/超时 reject。tabId 可省略或传 'default'（当前 UI 展示 tab）
- webview.show({ unitId }) / destroy({ unitId })
- webview.listUnits() → 本会话单元摘要；listTabs({ unitId }) → 各 tab 的 url/title/loading/fault
- webview.openTab({ unitId, url }) → { unitId, tabId }；closeTab({ unitId, tabId? }) — 关最后一 tab 会销毁整个单元（先 tabClosed 再 unitDestroyed）
- webview.navigate({ unitId, tabId?, url }) / eval({ unitId, tabId?, code }) / screenshot({ unitId, tabId?, format?, quality?, fullPage?, scale?, timeout?, options? })
  - tabId 可传 'default'；操作类 API 均支持
  - screenshot 选项可写在顶层，或放在 options 对象里（后者优先）
  - eval：fault 后可读错误页 DOM；navigate/screenshot/wait/snapshot/markdown 对 fault tab 会 reject
- webview.snapshot({ unitId, tabId? }) → { title, url, tree, refCount, truncated, generation }
  - 返回结构化页面树（角色/名称/状态 + [eN] 编号）；同时在页内安装 __vcRef
  - 复杂页可能 truncated=true（节点/深度上限）；用 markdown({ ref }) 或 eval 缩小范围
- webview.markdown({ unitId, tabId?, ref? }) → { markdown, ref?, truncated }
  - 传 ref：提取该编号对应子树的 Markdown；不传：整页 body
  - 输出里可交互节点仍带 [eN]，可接着用 __vcRef 操作
- webview.openDevTools({ unitId, tabId?, mode? }) — mode 默认 undocked；可传 'embedded'（内嵌到 WebView 窗口）
- const stop = webview.on(event, fn) — 返回取消函数；webview.off(event) 清空该事件全部监听
  - 事件：unitCreated / unitDestroyed / unitShown / tabOpened / tabClosed / tabFault / navigated

推荐工作流（读结构 → 操作 / 读长文）：
const { unitId, tabId } = await webview.create({ url: 'https://example.com' })
await webview.wait({ unitId, tabId })
const snap = await webview.snapshot({ unitId, tabId })
console.log(snap.tree) // 看 [eN] 编号
// 读长文（可传 ref 只读某一块，如 main）
const md = await webview.markdown({ unitId, tabId })
console.log(md.markdown.slice(0, 2000))
// 操作：在 eval 里用 __vcRef 取节点（必须先 snapshot）
await webview.eval({ unitId, tabId, code: \`__vcRef('e1').click(); 'ok'\` })
// 页面变化后重新 snapshot；旧编号失效
await webview.destroy({ unitId })

__vcRef 常用配方（写在 eval 的 code 里）：
// 点击
__vcRef('e3').click()
// 填输入框（兼容 React 受控组件）
const el = __vcRef('e7')
const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
desc.set.call(el, 'hello')
el.dispatchEvent(new Event('input', { bubbles: true }))
el.dispatchEvent(new Event('change', { bubbles: true }))
// 回车
el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
// 滚到可见
__vcRef('e12').scrollIntoView({ block: 'center' })

典型用法（低层 eval / 截图 / 调试）：
const { unitId, tabId } = await webview.create({ url: 'https://example.com' })
await webview.wait({ unitId, tabId })
const title = await webview.eval({ unitId, tabId, code: 'document.title' })
console.log(title)
await webview.show({ unitId })
await webview.openDevTools({ unitId, tabId })
await webview.destroy({ unitId }) // 用完销毁；终端结束也会级联销毁

注意：
- 务必 await webview.wait 后再 snapshot / eval / markdown；不要盲 sleep
- 必须先 snapshot 再 __vcRef；编号在下次 snapshot 或导航后失效；失效错误会提示重新 snapshot
- fault 的 tab 已死（不可再 navigate，UI 也无重试）；eval 可读错误提示页；用 openTab 或再 create 继续浏览
- 不要用 webview 代替 fs 读写本地文件；本地路径用 fs / instant.openPath
- 不要用 innerText/outerHTML 整页硬读；优先 snapshot + markdown`

/** 拼进任意 Agent system prompt 的标准入口。 */
export function buildInstantShellSystemPromptSection(): string {
  return INSTANT_SHELL_RUNTIME_SECTION
}

/** 更短的提示行（欢迎语 / 工具描述旁注）。 */
export function buildInstantShellPromptHint(): string {
  return '终端可用 globalThis.instant（openApp / openPath / openUrl / grep / …）与 globalThis.webview（create / wait / snapshot / markdown / eval / show / …），详见壳层 API 说明。'
}
