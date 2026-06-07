import { BrowserIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

const PANE_ICON_SIZE = 32

export function UsagePaneIcon() {
  return (
    <AppIconTile color="#8c8c91" size={PANE_ICON_SIZE}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2" y="11" width="3.5" height="7" rx="0.6" fill="#fff" opacity="0.92" />
        <rect x="8" y="7" width="3.5" height="11" rx="0.6" fill="#fff" opacity="0.92" />
        <rect x="14" y="3" width="3.5" height="15" rx="0.6" fill="#fff" opacity="0.92" />
      </svg>
    </AppIconTile>
  )
}

export function AccountPaneIcon() {
  return (
    <AppIconTile color="#3b8dd4" size={PANE_ICON_SIZE}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="7" r="4" fill="#fff" />
        <path d="M4 20 C4 15.2 7.1 12 11 12 C14.9 12 18 15.2 18 20 Z" fill="#fff" />
      </svg>
    </AppIconTile>
  )
}

export function DisplayPaneIcon() {
  return (
    <AppIconTile color="#5c7fa6" size={PANE_ICON_SIZE}>
      <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
        <rect x="2" y="2" width="18" height="13" rx="1.5" fill="#fff" opacity="0.95" />
        <rect x="4" y="4" width="14" height="9" rx="0.8" fill="#5c7fa6" opacity="0.35" />
        <rect x="8" y="16" width="6" height="2" rx="0.6" fill="#fff" opacity="0.9" />
      </svg>
    </AppIconTile>
  )
}

export function SafariUsagePaneIcon() {
  return <BrowserIcon size={PANE_ICON_SIZE} />
}
