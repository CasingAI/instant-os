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

示例（经 run_in_terminal 下发）：
await instant.openApp('settings')
await instant.openPath('/user/readme.txt')
await instant.openUrl('example.com')
const apps = await instant.listApps()
await instant.focus('files')

注意：
- 无 instant 时（未注入宿主）为 undefined；不要假设沙箱/非终端环境有此全局
- 不要用它改账户、API Key 或系统设置存储；壳层只覆盖打开应用/路径/URL 与窗口操作
- 与 fs / path 等 Node 兼容 API 正交：改文件仍用 fs，打开编辑器用 instant.openPath / openApp`

/** 拼进任意 Agent system prompt 的标准入口。 */
export function buildInstantShellSystemPromptSection(): string {
  return INSTANT_SHELL_RUNTIME_SECTION
}

/** 更短的提示行（欢迎语 / 工具描述旁注）。 */
export function buildInstantShellPromptHint(): string {
  return '终端可用 globalThis.instant（openApp / openPath / openUrl / listApps / listWindows / focus / close / …），详见壳层 API 说明。'
}
