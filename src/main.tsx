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
import { initSystemDebugLogBridge, recordSystemDebugTimeline } from './os/system-debug-log.ts'
import { patchSystemVolumeBus } from './os/audio-bus.ts'
import { preloadSystemSounds, unlockSystemSounds } from './os/system-sounds.ts'
import { hydrateInstalledAppsFromFiles } from './os/generated-apps-store.ts'
import { runAppRegistryMigration } from './os/app-registry-migration.ts'
import { restorePersistedImageMounts } from './apps/files/files-image-actions.ts'
import { App } from './app.tsx'

// 诊断黑匣子最早接线：开关打开时立刻起 Worker 并挂 pong 心跳（之后主线程卡死仍能判未响应）
initSystemDebugLogBridge()

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
    .then(async () => {
      if (crashTestMode === 'font') {
        reportCrash('instant_crash.font', new Error('[instant_crash] 模拟字体初始化后崩溃（font）'))
        return
      }
      const bootStage0 = performance.now()

      // 先 hydrate 生成应用本体（含一次性迁移），保证程序坞 / 应用目录拿到完整应用列表
      await hydrateInstalledAppsFromFiles().catch(() => undefined)
      recordSystemDebugTimeline({
        layer: 'system',
        op: 'boot-hydrate-apps-done',
        durationMs: Math.round(performance.now() - bootStage0),
      })
      // 再迁移应用数据 localStorage → 注册表（幂等），保证任何应用打开前迁移已完成
      await runAppRegistryMigration().catch(() => undefined)
      await restorePersistedImageMounts().catch(() => undefined)
      recordSystemDebugTimeline({
        layer: 'system',
        op: 'boot-migration-done',
        durationMs: Math.round(performance.now() - bootStage0),
      })

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
