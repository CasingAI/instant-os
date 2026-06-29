import type { Plugin } from 'vite'

const BOOT_CRASH_GUARD_SRC = '/boot-crash-guard.js'

const BRIDGE_HTML_NAME = 'bridge.html'

/** 构建产物中保证 boot-crash-guard 先于入口 module 执行（仅主应用 index，不含 bridge 页）。 */
export function bootCrashGuardFirst(): Plugin {
  return {
    name: 'boot-crash-guard-first',
    transformIndexHtml(html, ctx) {
      if (ctx.filename.endsWith(BRIDGE_HTML_NAME)) {
        return html
      }
      const withoutGuard = html.replace(
        new RegExp(`\\s*<script src="${BOOT_CRASH_GUARD_SRC.replace('/', '\\/')}"><\\/script>`, 'g'),
        '',
      )

      const moduleScriptMatch = withoutGuard.match(
        /<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/,
      )
      if (!moduleScriptMatch) {
        return withoutGuard
      }

      const guardScript = `<script src="${BOOT_CRASH_GUARD_SRC}"></script>`
      return withoutGuard.replace(
        moduleScriptMatch[0],
        `${guardScript}\n    ${moduleScriptMatch[0]}`,
      )
    },
  }
}
