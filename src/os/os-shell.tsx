import { useRef } from 'preact/hooks'
import { Desktop } from '../desktop/desktop.tsx'
import { Dock } from '../dock/dock.tsx'
import { IconContextMenuProvider } from './icon-context-menu-context.tsx'
import { LauncherLayoutProvider } from './launcher-layout-context.tsx'
import { AboutAppProvider } from './about-app-context.tsx'
import { GeneratedAppsProvider } from './generated-apps-context.tsx'
import { MenuBarProvider } from './menu-bar-context.tsx'
import { NotificationCenterProvider } from './notification-center-context.tsx'
import { MenuBar } from './menu-bar.tsx'
import { OsProvider } from './os-context.tsx'
import { useWallpaper } from './use-wallpaper.ts'
import { WindowManager } from '../window/window-frame.tsx'
import './os-shell.css'

function OsShellContent() {
  const shellRef = useRef<HTMLDivElement>(null)
  useWallpaper(shellRef)

  return (
    <div class="os-shell" ref={shellRef}>
      <MenuBar />
      <Desktop />
      <WindowManager />
      <Dock />
    </div>
  )
}

export function OsShell() {
  return (
    <OsProvider>
      <MenuBarProvider>
        <AboutAppProvider>
          <GeneratedAppsProvider>
            <NotificationCenterProvider>
              <LauncherLayoutProvider>
                <IconContextMenuProvider>
                  <OsShellContent />
                </IconContextMenuProvider>
              </LauncherLayoutProvider>
            </NotificationCenterProvider>
          </GeneratedAppsProvider>
        </AboutAppProvider>
      </MenuBarProvider>
    </OsProvider>
  )
}
