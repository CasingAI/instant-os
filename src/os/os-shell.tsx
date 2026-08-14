import { useEffect, useRef } from 'preact/hooks'
import { Desktop } from '../desktop/desktop.tsx'
import { Dock } from '../dock/dock.tsx'
import { useDockViewportFit } from '../dock/use-dock-viewport-fit.ts'
import { FilesMountPermissionDialog } from '../apps/files/files-mount-permission-dialog.tsx'
import { scanMountPermissionsNeedingPrompt } from '../apps/files/files-mount-permission-gate.ts'
import { WebViewOffscreenPool } from '../apps/webview/webview-offscreen-pool.tsx'
import { IconContextMenuProvider } from './icon-context-menu-context.tsx'
import { LauncherLayoutProvider } from './launcher-layout-context.tsx'
import { AboutAppProvider } from './about-app-context.tsx'
import { GeneratedAppsProvider } from './generated-apps-context.tsx'
import { DevExtAppsProvider } from './dev-ext-apps-context.tsx'
import { GeneratedAppHeartbeatProvider } from './generated-app-heartbeat-context.tsx'
import { MenuBarProvider } from './menu-bar-context.tsx'
import { NotificationCenterProvider } from './notification-center-context.tsx'
import { MenuBar } from './menu-bar.tsx'
import { OsProvider } from './os-context.tsx'
import { FullscreenChromeRevealProvider } from './fullscreen-chrome-reveal-context.tsx'
import { ImmersiveDesktopBackdrop } from './immersive-desktop-backdrop.tsx'
import { StartupItemsBootstrap } from './startup-items-bootstrap.tsx'
import { useWallpaper } from './use-wallpaper.ts'
import { WindowManager } from '../window/window-frame.tsx'
import { MonacoDialogHost } from '../monaco/monaco-dialog-host.tsx'
import { SystemDeadlockDialog } from './system-deadlock-dialog.tsx'
import { TerminalPrivilegeDialog } from '../terminal/terminal-privilege-dialog.tsx'
import './host-export-menu.ts'
import './os-shell.css'

function OsShellContent() {
  const shellRef = useRef<HTMLDivElement>(null)
  useWallpaper(shellRef)
  useDockViewportFit()

  useEffect(() => {
    void scanMountPermissionsNeedingPrompt()
  }, [])

  return (
    <div class="os-shell" ref={shellRef}>
      <StartupItemsBootstrap />
      <ImmersiveDesktopBackdrop />
      <MenuBar />
      <Desktop />
      <WindowManager />
      <WebViewOffscreenPool />
      <Dock />
      <div class="system-deadlock-dialog-host">
        <SystemDeadlockDialog />
      </div>
      <FilesMountPermissionDialog />
      <TerminalPrivilegeDialog />
      <MonacoDialogHost />
    </div>
  )
}

export function OsShell() {
  return (
    <OsProvider>
      <DevExtAppsProvider>
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
      </DevExtAppsProvider>
    </OsProvider>
  )
}
