import { render } from 'preact'
import {
  BootErrorBoundary,
  getCrashTestMode,
  markBootComplete,
  markBootModuleExecuted,
  reportCrash,
} from './boot/crash-guard.ts'

markBootModuleExecuted()
import { scheduleEmojiOffsetAutoCalibration } from './fonts/auto-calibrate-emoji-offset.ts'
import { ensureAppleColorEmojiFonts } from './fonts/ensure-apple-color-emoji-fonts.ts'
import './global.css'
import { initBrowserPageCache } from './apps/browser/browser-page-cache.ts'
import { App } from './app.tsx'

function CrashTestThrow(): null {
  throw new Error('[instant_crash] 模拟 React 组件崩溃（react）')
}

const appRoot = document.getElementById('app')
const crashTestMode = getCrashTestMode()

if (!appRoot) {
  reportCrash('boot.missing-root', '找不到 #app 挂载节点')
} else {
  void ensureAppleColorEmojiFonts()
    .then(() => {
      if (crashTestMode === 'font') {
        reportCrash('instant_crash.font', new Error('[instant_crash] 模拟字体初始化后崩溃（font）'))
        return
      }

      const tree =
        crashTestMode === 'react' ? (
          <BootErrorBoundary>
            <CrashTestThrow />
          </BootErrorBoundary>
        ) : (
          <BootErrorBoundary>
            <App />
          </BootErrorBoundary>
        )

      render(tree, appRoot)
      markBootComplete()
      void initBrowserPageCache()
      scheduleEmojiOffsetAutoCalibration()
    })
    .catch((error) => {
      reportCrash('boot.font-init', error)
    })
}
