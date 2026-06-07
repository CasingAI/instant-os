import type { MenuItem } from './menu-bar-types.ts'

export function aboutAppMenuPrefix(label: string, onShowAbout: () => void): MenuItem[] {
  return [
    { type: 'action', label, onClick: onShowAbout },
    { type: 'separator' },
  ]
}
