import { osOpenApp } from './os-open-app-bridge.ts'

export const OPEN_SETTINGS_ACCOUNT_EVENT = 'instant-os:open-settings-account'
export const OPEN_SETTINGS_DATE_TIME_EVENT = 'instant-os:open-settings-date-time'

let pendingAccountView = false
let pendingDateTimeView = false

function openSettingsWith(eventName: string): void {
  try {
    osOpenApp('settings')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，设置打开后会 consume
  }
  window.dispatchEvent(new CustomEvent(eventName))
}

export function openSettingsAccountView() {
  pendingAccountView = true
  openSettingsWith(OPEN_SETTINGS_ACCOUNT_EVENT)
}

export function openSettingsDateTimeView() {
  pendingDateTimeView = true
  openSettingsWith(OPEN_SETTINGS_DATE_TIME_EVENT)
}

export function consumePendingOpenSettingsAccountView(): boolean {
  if (!pendingAccountView) {
    return false
  }
  pendingAccountView = false
  return true
}

export function consumePendingOpenSettingsDateTimeView(): boolean {
  if (!pendingDateTimeView) {
    return false
  }
  pendingDateTimeView = false
  return true
}
