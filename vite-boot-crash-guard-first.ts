import type { Plugin } from 'vite'

const BOOT_CRASH_GUARD_SRC = '/boot-crash-guard.js'
const MAIN_MODULE_ID = 'instant-os-main-module'
const BRIDGE_HTML_NAME = 'bridge.html'

function ensureMainModuleScriptId(moduleTag: string): string {
  if (moduleTag.includes(`id="${MAIN_MODULE_ID}"`) || moduleTag.includes(`id='${MAIN_MODULE_ID}'`)) {
    return moduleTag
  }

  return moduleTag.replace('<script type="module"', `<script type="module" id="${MAIN_MODULE_ID}"`)
}

/** 构建产物中保证 boot-crash-guard 先于入口 module 执行（仅主应用 index，不含 bridge 页）。 */
export function bootCrashGuardFirst(): Plugin {
  return {
    name: 'boot-crash-guard-first',
    transformIndexHtml(html, ctx) {
      if (ctx.filename.endsWith(BRIDGE_HTML_NAME)) {
        return html
      }
      const withoutGuard = html.replace(
        new RegExp(
          `\\s*<script(?:\\s[^>]*?)?\\ssrc="${BOOT_CRASH_GUARD_SRC.replace('/', '\\/')}"[^>]*><\\/script>`,
          'g',
        ),
        '',
      )

      const moduleScriptMatch = withoutGuard.match(
        /<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/,
      )
      if (!moduleScriptMatch) {
        return withoutGuard
      }

      // defer：等 HTML 解析完（含 splash DOM）再执行，避免 head 内同步脚本跑太早
      const guardScript = `<script defer src="${BOOT_CRASH_GUARD_SRC}"></script>`
      const moduleScript = ensureMainModuleScriptId(moduleScriptMatch[0])
      return withoutGuard.replace(moduleScriptMatch[0], `${guardScript}\n    ${moduleScript}`)
    },
  }
}
