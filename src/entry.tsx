import { markBootModuleExecuted, reportCrash } from './boot/crash-guard.ts'

markBootModuleExecuted()

void import('./main.tsx').catch((error) => {
  const detail = String(error)
  if (detail.includes('Unable to preload CSS for')) {
    return
  }
  reportCrash('boot.main-import', error)
})
