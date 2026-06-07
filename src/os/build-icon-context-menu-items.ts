import type { IconContextMenuItem } from './icon-context-menu.tsx'

export function buildBuiltinIconContextMenuItems(onOpen: () => void): IconContextMenuItem[] {
  return [{ type: 'action', label: '打开', onClick: onOpen }]
}

export function buildGeneratedIconContextMenuItems(options: {
  onOpen: () => void
  onViewInAppStore: () => void
  openDisabled?: boolean
}): IconContextMenuItem[] {
  return [
    { type: 'action', label: '打开', disabled: options.openDisabled, onClick: options.onOpen },
    { type: 'separator' },
    { type: 'action', label: '在 App Store 中查看', onClick: options.onViewInAppStore },
  ]
}
