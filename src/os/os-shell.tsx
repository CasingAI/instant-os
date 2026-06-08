import { Desktop } from '../desktop/desktop.tsx'
import { Dock } from '../dock/dock.tsx'
import { IconContextMenuProvider } from './icon-context-menu-context.tsx'
import { AboutAppProvider } from './about-app-context.tsx'
import { GeneratedAppsProvider } from './generated-apps-context.tsx'
import { MenuBarProvider } from './menu-bar-context.tsx'
import { NotificationCenterProvider } from './notification-center-context.tsx'
import { MenuBar } from './menu-bar.tsx'
import { OsProvider } from './os-context.tsx'
import { WindowManager } from '../window/window-frame.tsx'
import './os-shell.css'

function OsShellContent() {
  return (
    <div class="os-shell">
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
              <IconContextMenuProvider>
                <OsShellContent />
              </IconContextMenuProvider>
            </NotificationCenterProvider>
          </GeneratedAppsProvider>
        </AboutAppProvider>
      </MenuBarProvider>
    </OsProvider>
  )
}
