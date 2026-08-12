import { markBootModuleExecuted, reportCrash } from './boot/crash-guard.ts'

markBootModuleExecuted()

// 开发模式下单次动态 import 可能因 dev server 重启 / optimizeDeps 重优化 / 文件保存中途
// 短暂返回非 JS 响应而失败（浏览器报 "Failed to fetch dynamically imported module"），
// 但几秒后重试即可成功。直接上报会让整个 OS 停在崩溃页，故先带退避重试。
const MAIN_IMPORT_RETRY_LIMIT = 5
const MAIN_IMPORT_RETRY_BASE_MS = 500

async function loadMainModule(): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt < MAIN_IMPORT_RETRY_LIMIT; attempt++) {
    try {
      await import('./main.tsx')
      return
    } catch (error) {
      lastError = error
      const detail = String(error)
      if (detail.includes('Unable to preload CSS for')) {
        return
      }
      console.debug(`[boot] 主模块加载失败，将重试 (${attempt + 1}/${MAIN_IMPORT_RETRY_LIMIT}): ${detail}`)
      if (attempt < MAIN_IMPORT_RETRY_LIMIT - 1) {
        const delayMs = MAIN_IMPORT_RETRY_BASE_MS * (attempt + 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  reportCrash(
    'boot.main-import',
    lastError,
    `已重试 ${MAIN_IMPORT_RETRY_LIMIT} 次仍无法加载主模块`,
  )
}

void loadMainModule()
