import { render } from 'preact'
import {
  BootErrorBoundary,
  getCrashTestMode,
  markBootComplete,
  reportCrash,
} from './boot/crash-guard.ts'
import { scheduleEmojiOffsetAutoCalibration } from './fonts/auto-calibrate-emoji-offset.ts'
import { ensureAppleColorEmojiFonts } from './fonts/ensure-apple-color-emoji-fonts.ts'
import './global.css'
import { initBrowserPageCache } from './apps/browser/browser-page-cache.ts'
import { initializeDockAppearance } from './dock/apply-dock-settings.ts'
import { blockBrowserZoom } from './os/block-browser-zoom.ts'
import { blockDocumentOverscroll } from './os/block-document-overscroll.ts'
import { patchSystemVolumeBus } from './os/audio-bus.ts'
import { preloadSystemSounds, unlockSystemSounds } from './os/system-sounds.ts'
import { App } from './app.tsx'

// 早于任何音频模块初始化：让全部 Web Audio 发声源自动经过系统主音量
patchSystemVolumeBus()
blockBrowserZoom()
blockDocumentOverscroll()
unlockSystemSounds()

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

      initializeDockAppearance()

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
      preloadSystemSounds()
      void initBrowserPageCache()
      void import('./apps/github-desktop/github-repo-attributes.ts')
        .then((m) => m.reconcileGithubRepoAttributes())
        .catch(() => undefined)
      scheduleEmojiOffsetAutoCalibration()
    })
    .catch((error) => {
      reportCrash('boot.font-init', error)
    })
}
