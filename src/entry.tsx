import { markBootModuleExecuted, reportCrash } from './boot/crash-guard.ts'

// 仅标记入口已执行（看门狗用）；大 chunk 仍在下载，此时不要切「正在启动…」
markBootModuleExecuted()

void import('./main.tsx').catch((error) => {
  const detail = String(error)
  if (detail.includes('Unable to preload CSS for')) {
    return
  }
  reportCrash('boot.main-import', error)
})
