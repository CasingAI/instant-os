import { BrowserIcon, NewsIcon } from '../../icons/app-icons.tsx'
import { AppIconTile } from '../../icons/app-icon-tile.tsx'

const PANE_ICON_SIZE = 52
const paneSvg = (base: number) => Math.round(base * (PANE_ICON_SIZE / 32))

export function AiUsagePaneIcon() {
  return (
    <AppIconTile color="#7b6fd6" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        ✨
      </span>
    </AppIconTile>
  )
}

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

export function ExternalBridgeConsentPaneIcon() {
  return (
    <AppIconTile color="#4f8f6f" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🔗
      </span>
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

export function DateTimePaneIcon() {
  return (
    <AppIconTile color="#4f8fd1" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🕐
      </span>
    </AppIconTile>
  )
}

export function BackgroundRefreshPaneIcon() {
  return (
    <AppIconTile color="#34a0a4" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🔄
      </span>
    </AppIconTile>
  )
}

export function NotificationCenterPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#6b7a8f" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <rect x="3" y="3" width="16" height="16" rx="3" fill="#fff" opacity="0.95" />
        <rect x="5.5" y="6" width="11" height="2.2" rx="1.1" fill="#6b7a8f" opacity="0.85" />
        <rect x="5.5" y="10" width="8" height="2.2" rx="1.1" fill="#6b7a8f" opacity="0.55" />
        <rect x="5.5" y="14" width="10" height="2.2" rx="1.1" fill="#6b7a8f" opacity="0.4" />
      </svg>
    </AppIconTile>
  )
}

export function SpeechPaneIcon() {
  return (
    <AppIconTile color="#3d9b8f" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🎙️
      </span>
    </AppIconTile>
  )
}

export function SoundsPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#e08a2c" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <path
          d="M4 8.2h2.6L10.2 5v12L6.6 13.8H4V8.2Z"
          fill="#fff"
          opacity="0.95"
        />
        <path
          d="M12.4 7.2c1.05.85 1.7 2.1 1.7 3.55s-.65 2.7-1.7 3.55"
          fill="none"
          stroke="#fff"
          stroke-width="1.5"
          stroke-linecap="round"
          opacity="0.9"
        />
        <path
          d="M14.8 5.2c1.75 1.35 2.85 3.4 2.85 5.7s-1.1 4.35-2.85 5.7"
          fill="none"
          stroke="#fff"
          stroke-width="1.5"
          stroke-linecap="round"
          opacity="0.7"
        />
      </svg>
    </AppIconTile>
  )
}

export function SafariUsagePaneIcon() {
  return <BrowserIcon size={PANE_ICON_SIZE} />
}

export function ModelCachePaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#8a6fd6" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <rect x="3" y="3" width="16" height="16" rx="3" fill="#fff" opacity="0.95" />
        <circle cx="8.5" cy="8.5" r="2" fill="#8a6fd6" opacity="0.85" />
        <circle cx="14.5" cy="14.5" r="2" fill="#8a6fd6" opacity="0.7" />
        <path
          d="M8.5 10.5 C8.5 13 11 15 14.5 12.5"
          fill="none"
          stroke="#8a6fd6"
          stroke-width="1.4"
          stroke-linecap="round"
          opacity="0.6"
        />
      </svg>
    </AppIconTile>
  )
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

export function ResetPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#b0723a" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <path
          d="M4 11 L10 5 M4 11 L10 17"
          fill="none"
          stroke="#fff"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.95"
        />
        <path
          d="M4 11 H18"
          fill="none"
          stroke="#fff"
          stroke-width="2"
          stroke-linecap="round"
          opacity="0.95"
        />
      </svg>
    </AppIconTile>
  )
}

export function WallpaperPaneIcon() {
  return (
    <AppIconTile color="#5a9fd4" size={PANE_ICON_SIZE}>
      <svg width={paneSvg(22)} height={paneSvg(22)} viewBox="0 0 22 22" aria-hidden="true">
        <defs>
          <linearGradient id="wallpaper-pane-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7ec8ff" />
            <stop offset="100%" stop-color="#2f76c0" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="16" height="16" rx="2" fill="url(#wallpaper-pane-grad)" />
        <circle cx="8" cy="8" r="2.2" fill="rgba(255,255,255,0.55)" />
        <path
          d="M4 16 L9 11 L13 14 L18 9"
          fill="none"
          stroke="rgba(255,255,255,0.7)"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </AppIconTile>
  )
}

export function DeveloperPaneIcon() {
  return (
    <AppIconTile color="#5c6bc0" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (50 / 72)}px` }}
        aria-hidden="true"
      >
        🛠️
      </span>
    </AppIconTile>
  )
}

/** @deprecated 使用 DeveloperPaneIcon */
export const ExperimentalPaneIcon = DeveloperPaneIcon

export function DockPaneIcon() {
  const svgWidth = paneSvg(22)
  const svgHeight = paneSvg(10)
  const iconSize = 4
  const gap = 1.5
  const startX = (22 - (iconSize * 3 + gap * 2)) / 2
  const iconY = 3
  return (
    <AppIconTile color="#4a5568" size={PANE_ICON_SIZE}>
      <svg width={svgWidth} height={svgHeight} viewBox="0 0 22 10" aria-hidden="true">
        <rect
          x="2.5"
          y="1.5"
          width="17"
          height="7"
          rx="3.5"
          fill="rgba(255,255,255,0.22)"
          stroke="rgba(255,255,255,0.55)"
          stroke-width="1"
        />
        <rect x={startX} y={iconY} width={iconSize} height={iconSize} rx="1" fill="#fff" opacity="0.95" />
        <rect
          x={startX + iconSize + gap}
          y={iconY}
          width={iconSize}
          height={iconSize}
          rx="1"
          fill="#fff"
          opacity="0.85"
        />
        <rect
          x={startX + (iconSize + gap) * 2}
          y={iconY}
          width={iconSize}
          height={iconSize}
          rx="1"
          fill="#fff"
          opacity="0.75"
        />
      </svg>
    </AppIconTile>
  )
}

export function ProxyServerPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#3d7ea6" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <path
          d="M7 16.5 C6 16.2 4.8 15 4.6 13.4 C4.4 11.7 5.4 10.2 6.9 9.7 C7.1 7.9 8.7 6.5 10.7 6.5 C12.1 6.5 13.3 7.2 14 8.3 C14.9 7.7 16.1 7.6 17.1 8.1 C18.6 8.8 19.3 10.5 18.8 12 C18.5 13 17.8 13.7 16.9 13.9 L16.9 16.5 Z"
          fill="#fff"
          opacity="0.95"
        />
        <rect x="9" y="17" width="4" height="1.8" rx="0.9" fill="#fff" opacity="0.8" />
        <path d="M6.5 19 H15.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.6" />
      </svg>
    </AppIconTile>
  )
}

export function SystemEnvPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#5a7a8f" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <rect x="3" y="4" width="16" height="14" rx="1.5" fill="#fff" opacity="0.95" />
        <path
          d="M6 8 H16 M6 11 H14 M6 14 H12"
          stroke="#5a7a8f"
          stroke-width="1.5"
          stroke-linecap="round"
          opacity="0.85"
        />
      </svg>
    </AppIconTile>
  )
}

export function StartupItemsPaneIcon() {
  const svgSize = paneSvg(22)
  return (
    <AppIconTile color="#3f8f6b" size={PANE_ICON_SIZE}>
      <svg width={svgSize} height={svgSize} viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="7.5" fill="#fff" opacity="0.95" />
        <path d="M9.2 7.8 L15.2 11 L9.2 14.2 Z" fill="#3f8f6b" opacity="0.9" />
      </svg>
    </AppIconTile>
  )
}

export function NpmPaneIcon() {
  return (
    <AppIconTile color="#cb3837" size={PANE_ICON_SIZE}>
      <span
        class="app-icon-tile__emoji"
        style={{ fontSize: `${PANE_ICON_SIZE * (42 / 72)}px`, fontWeight: 700 }}
        aria-hidden="true"
      >
        npm
      </span>
    </AppIconTile>
  )
}
