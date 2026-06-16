import { useRef } from 'preact/hooks'
import { Desktop } from '../desktop/desktop.tsx'
import { Dock } from '../dock/dock.tsx'
import { useDockViewportFit } from '../dock/use-dock-viewport-fit.ts'
import { IconContextMenuProvider } from './icon-context-menu-context.tsx'
import { LauncherLayoutProvider } from './launcher-layout-context.tsx'
import { AboutAppProvider } from './about-app-context.tsx'
import { GeneratedAppsProvider } from './generated-apps-context.tsx'
import { GeneratedAppHeartbeatProvider } from './generated-app-heartbeat-context.tsx'
import { MenuBarProvider } from './menu-bar-context.tsx'
import { NotificationCenterProvider } from './notification-center-context.tsx'
import { MenuBar } from './menu-bar.tsx'
import { OsProvider } from './os-context.tsx'
import { FullscreenChromeRevealProvider } from './fullscreen-chrome-reveal-context.tsx'
import { ImmersiveDesktopBackdrop } from './immersive-desktop-backdrop.tsx'
import { useWallpaper } from './use-wallpaper.ts'
import { WindowManager } from '../window/window-frame.tsx'
import { SystemDeadlockDialog } from './system-deadlock-dialog.tsx'
import './os-shell.css'

function OsShellContent() {
  const shellRef = useRef<HTMLDivElement>(null)
  useWallpaper(shellRef)
  useDockViewportFit()

  return (
    <div class="os-shell" ref={shellRef}>
      <ImmersiveDesktopBackdrop />
      <MenuBar />
      <Desktop />
      <WindowManager />
      <Dock />
      <div class="system-deadlock-dialog-host">
        <SystemDeadlockDialog />
      </div>
    </div>
  )
}

export function OsShell() {
  return (
    <OsProvider>
      <GeneratedAppHeartbeatProvider>
        <MenuBarProvider>
          <AboutAppProvider>
            <GeneratedAppsProvider>
              <NotificationCenterProvider>
                <LauncherLayoutProvider>
                  <IconContextMenuProvider>
                    <FullscreenChromeRevealProvider>
                      <OsShellContent />
                    </FullscreenChromeRevealProvider>
                  </IconContextMenuProvider>
                </LauncherLayoutProvider>
              </NotificationCenterProvider>
            </GeneratedAppsProvider>
          </AboutAppProvider>
        </MenuBarProvider>
      </GeneratedAppHeartbeatProvider>
    </OsProvider>
  )
}
