import { markBootModuleExecuted, reportCrash } from './boot/crash-guard.ts'

markBootModuleExecuted()

void import('./main.tsx').catch((error) => {
  reportCrash('boot.main-import', error)
})
