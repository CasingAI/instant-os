import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

export function BrowserIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#4285f4" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        🌐
      </span>
    </AppIconTile>
  )
}

export function MailIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#2b8fd9" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        📧
      </span>
    </AppIconTile>
  )
}

export function PhotosIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#e85d3a" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="22" cy="24" r="5" fill="#ffe08a" />
        <path d="M10 48 L24 32 L36 42 L46 28 L54 48 Z" fill="#fff" opacity="0.95" />
      </svg>
    </AppIconTile>
  )
}

export function Scene3dLabIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#5856d6" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        🧊
      </span>
    </AppIconTile>
  )
}

export function SettingsIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#6d737c" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <g transform="translate(8, 8) scale(2)">
          <path
            fill="#fff"
            d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"
          />
        </g>
      </svg>
    </AppIconTile>
  )
}

export function MarketplaceIcon({ size = 64 }: IconProps) {
  const stroke = 6
  const leftLeg = 'M17 47 L32 13'
  const rightLeg = 'M47 47 L32 13'
  const crossbar = 'M21 35 H43'

  return (
    <AppIconTile color="#0a84ff" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <g transform="translate(1.5, 2.5)" opacity="0.28">
          <path d={leftLeg} fill="none" stroke="#001a33" stroke-width={stroke + 1} stroke-linecap="round" />
          <path d={rightLeg} fill="none" stroke="#001a33" stroke-width={stroke + 1} stroke-linecap="round" />
          <path d={crossbar} fill="none" stroke="#001a33" stroke-width={stroke + 1} stroke-linecap="round" />
        </g>
        <path
          d={leftLeg}
          fill="none"
          stroke="url(#appstore-stroke-depth)"
          stroke-width={stroke}
          stroke-linecap="round"
        />
        <path
          d={rightLeg}
          fill="none"
          stroke="url(#appstore-stroke-depth)"
          stroke-width={stroke}
          stroke-linecap="round"
        />
        <path
          d={crossbar}
          fill="none"
          stroke="url(#appstore-stroke-depth)"
          stroke-width={stroke}
          stroke-linecap="round"
        />
        <path
          d={leftLeg}
          fill="none"
          stroke="url(#appstore-stroke-face)"
          stroke-width={stroke - 1.2}
          stroke-linecap="round"
        />
        <path
          d={rightLeg}
          fill="none"
          stroke="url(#appstore-stroke-face)"
          stroke-width={stroke - 1.2}
          stroke-linecap="round"
        />
        <path
          d={crossbar}
          fill="none"
          stroke="url(#appstore-stroke-face)"
          stroke-width={stroke - 1.2}
          stroke-linecap="round"
        />
        <defs>
          <linearGradient id="appstore-stroke-depth" x1="32" y1="13" x2="32" y2="47" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#b8d4f0" />
            <stop offset="45%" stop-color="#6aabf0" />
            <stop offset="100%" stop-color="#2a6db8" />
          </linearGradient>
          <linearGradient id="appstore-stroke-face" x1="32" y1="13" x2="32" y2="47" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#fff" />
            <stop offset="55%" stop-color="#eef5ff" />
            <stop offset="100%" stop-color="#c8ddf5" />
          </linearGradient>
        </defs>
      </svg>
    </AppIconTile>
  )
}

const CHEVRON_VIEW_WIDTH = 14
const CHEVRON_VIEW_HEIGHT = 18

type ChevronIconProps = {
  size?: number
}

export function BackIcon({ size = 12 }: ChevronIconProps = {}) {
  const height = size
  const width = (size * CHEVRON_VIEW_WIDTH) / CHEVRON_VIEW_HEIGHT

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CHEVRON_VIEW_WIDTH} ${CHEVRON_VIEW_HEIGHT}`}
      fill="none"
      overflow="visible"
      aria-hidden="true"
    >
      <path
        d="M11 2 L3 9 L11 16"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function ForwardIcon({ size = 12 }: ChevronIconProps = {}) {
  const height = size
  const width = (size * CHEVRON_VIEW_WIDTH) / CHEVRON_VIEW_HEIGHT

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CHEVRON_VIEW_WIDTH} ${CHEVRON_VIEW_HEIGHT}`}
      fill="none"
      overflow="visible"
      aria-hidden="true"
    >
      <path
        d="M3 2 L11 9 L3 16"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function ReloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M12.5 3.5 V6.5 H9.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M3.5 8 A4.5 4.5 0 1 0 12.5 6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path
        d="M8 4.75 V8 L10.75 10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5 V10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M1.5 6 H10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 2 L8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <path d="M8 2 L2 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true">
      <rect x="1.5" y="5.5" width="8" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M3.5 5.5 V4a2 2 0 0 1 4 0 v1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  )
}

export function SidebarIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <rect x="1" y="1" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M5.5 1 V13" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

export function ShareIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M8 2 L8 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      <path d="M5 5 L8 2 L11 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="2" y="10" width="12" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
    </svg>
  )
}

export function BookmarksIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <path
        d="M2 1.5 H12 A1.5 1.5 0 0 1 13.5 3 V15 L7 11.5 L0.5 15 V3 A1.5 1.5 0 0 1 2 1.5 Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export function SignalIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
      <rect x="0" y="8" width="3" height="4" rx="0.5" fill="currentColor" />
      <rect x="5" y="5" width="3" height="7" rx="0.5" fill="currentColor" />
      <rect x="10" y="2" width="3" height="10" rx="0.5" fill="currentColor" />
      <rect x="15" y="0" width="3" height="12" rx="0.5" fill="currentColor" />
    </svg>
  )
}

type BrandIconProps = {
  size?: number
}

export function InstantLogoIcon({ size = 18 }: BrandIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 46" aria-hidden="true">
      <path
        fill="currentColor"
        d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
      />
    </svg>
  )
}

export function FinderIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#1a9cf5" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="14" y="10" width="36" height="44" rx="4" fill="#fff" />
        <rect x="14" y="10" width="36" height="12" rx="4" fill="#007aff" />
        <circle cx="24" cy="16" r="2.5" fill="#fff" />
        <circle cx="32" cy="16" r="2.5" fill="#fff" />
        <circle cx="40" cy="16" r="2.5" fill="#fff" />
        <path
          d="M22 34 Q32 28 42 34 Q32 46 22 34 Z"
          fill="#007aff"
          opacity="0.85"
        />
      </svg>
    </AppIconTile>
  )
}

type BatteryIconProps = {
  levelPercent?: number
  charging?: boolean
}

export function BatteryIcon({ levelPercent, charging }: BatteryIconProps) {
  const fillWidth = levelPercent === undefined ? 17 : Math.max(0, Math.min(18, (levelPercent / 100) * 18))
  const label =
    levelPercent === undefined
      ? '电池'
      : charging
        ? `电池 ${levelPercent}%，正在充电`
        : `电池 ${levelPercent}%`

  return (
    <svg
      width="26"
      height="12"
      viewBox="0 0 26 12"
      class={charging ? 'battery-icon battery-icon--charging' : 'battery-icon'}
      role="img"
      aria-label={label}
    >
      <rect x="0.5" y="0.5" width="22" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1" />
      <rect x="23" y="3.5" width="2.5" height="5" rx="1" fill="currentColor" />
      {levelPercent === undefined ? (
        <rect x="2" y="2" width="17" height="8" rx="1" fill="currentColor" />
      ) : (
        <>
          <rect x="2" y="2" width={fillWidth} height="8" rx="1" fill="currentColor" />
          {charging && (
            <path
              d="M12.2 1.2 9.4 6.2h2.1L10.8 10.8l4.4-5.4h-2.1L12.2 1.2Z"
              fill="currentColor"
              class="battery-icon__bolt"
            />
          )}
        </>
      )}
    </svg>
  )
}
