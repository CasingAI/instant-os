import { BrowserIcon, NewsIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

const PANE_ICON_SIZE = 52
const paneSvg = (base: number) => Math.round(base * (PANE_ICON_SIZE / 32))

export function StoragePaneIcon() {
  return (
    <AppIconTile color="#6d7d8f" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        💾
      </span>
    </AppIconTile>
  )
}

export function AccountPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#3b8dd4" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="7" r="4" fill="#fff" />
        <path d="M4 20 C4 15.2 7.1 12 11 12 C14.9 12 18 15.2 18 20 Z" fill="#fff" />
      </svg>
    </AppIconTile>
  )
}

export function DisplayPaneIcon() {
  const svgWidth = paneSvg(22)
  const svgHeight = paneSvg(20)
  return (
    <AppIconTile color="#5c7fa6" size={PANE_ICON_SIZE}>
      <svg width={svgWidth} height={svgHeight} viewBox="0 0 22 20" aria-hidden="true">
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

export function ResourcesPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#6b8f71" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <path
          d="M4 6 L11 2 L18 6 L18 16 L11 20 L4 16 Z"
          fill="none"
          stroke="#fff"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <path d="M4 6 L11 10 L18 6" fill="none" stroke="#fff" stroke-width="1.2" />
        <path d="M11 10 L11 20" fill="none" stroke="#fff" stroke-width="1.2" />
      </svg>
    </AppIconTile>
  )
}

export function NewsPaneIcon() {
  return <NewsIcon size={PANE_ICON_SIZE} />
}

export function ExperimentalPaneIcon() {
  return (
    <AppIconTile color="#8a7bb8" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🧪
      </span>
    </AppIconTile>
  )
}
