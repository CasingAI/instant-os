import { AppIconTile } from './app-icon-tile.tsx'
import { CompassMark } from '../apps/browser/compass-mark.tsx'
import {
  formatCalendarYearLabel,
  formatChineseMonthLabel,
} from '../os/calendar-instant.ts'
import { formatChineseDynastyCalendarIconParts } from '../os/chinese-dynasty-label.ts'
import { useOsNowInstant } from '../os/use-os-clock.ts'

type IconProps = {
  size?: number
}

export function BrowserIcon({ size = 64 }: IconProps) {
  const compassSize = Math.round(size * 0.7)
  return (
    <AppIconTile color="#3a7bd5" size={size}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: `${compassSize}px`,
          height: `${compassSize}px`,
          filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35))',
        }}
      >
        <CompassMark />
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

export function FilesIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#a67c42" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M14 22.5c0-2 1.6-3.6 3.6-3.6h11c.8 0 1.5.3 2 .9l1.5 1.7c.3.3.7.5 1.1.5H46c2 0 3.6 1.6 3.6 3.6V28H14v-5.5z"
          fill="#f0d9a8"
          opacity="0.95"
        />
        <path
          d="M12 28.5c0-2.2 1.8-4 4-4h32c2.2 0 4 1.8 4 4V45c0 2.5-2 4.5-4.5 4.5h-31C14 49.5 12 47.5 12 45V28.5z"
          fill="#f7f1e6"
        />
        <path d="M16 26.2h32c1.1 0 2.1.5 2.7 1.3H13.3c.6-.8 1.6-1.3 2.7-1.3z" fill="#e8c56a" opacity="0.9" />
      </svg>
    </AppIconTile>
  )
}

export function TextEditIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#3d7a4a" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="14" y="12" width="36" height="42" rx="4" fill="#f7f4ec" />
        <path d="M20 22h24M20 30h24M20 38h18" stroke="#3d7a4a" stroke-width="2.4" stroke-linecap="round" />
        <path
          d="M40 40l8 2.5-2.5 8-8.8-8.8L40 40z"
          fill="#f4d35e"
          stroke="#c9a227"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
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

export function ModelVisionIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#ff9f0a" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        👁️
      </span>
    </AppIconTile>
  )
}

export function ICodeIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#147efb" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <text
          x="32"
          y="40"
          text-anchor="middle"
          fill="#fff"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          font-size="22"
          font-weight="700"
        >
          {'</>'}
        </text>
      </svg>
    </AppIconTile>
  )
}

export function VscodeIcon({ size = 64 }: IconProps) {
  const cornerRadius = 14

  return (
    <AppIconTile color="#0078d4" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="vscode-icon-window" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3a3f4a" />
            <stop offset="45%" stop-color="#252830" />
            <stop offset="100%" stop-color="#16181e" />
          </linearGradient>
          <linearGradient id="vscode-icon-chrome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4a5160" />
            <stop offset="100%" stop-color="#2c313c" />
          </linearGradient>
          <linearGradient id="vscode-icon-sidebar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#2aa0f0" />
            <stop offset="55%" stop-color="#0078d4" />
            <stop offset="100%" stop-color="#005a9e" />
          </linearGradient>
          <linearGradient id="vscode-icon-gloss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,255,255,0.28)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </linearGradient>
          <clipPath id="vscode-icon-window-clip">
            <rect x="0" y="0" width="64" height="64" rx={cornerRadius} ry={cornerRadius} />
          </clipPath>
        </defs>

        <g clip-path="url(#vscode-icon-window-clip)">
          <rect x="0" y="0" width="64" height="64" fill="url(#vscode-icon-window)" />

          {/* 顶栏 */}
          <rect x="0" y="0" width="64" height="15" fill="url(#vscode-icon-chrome)" />
          <g>
            <circle cx="10" cy="7.5" r="2.1" fill="#ff5f57" />
            <circle cx="17.5" cy="7.5" r="2.1" fill="#febc2e" />
            <circle cx="25" cy="7.5" r="2.1" fill="#28c840" />
          </g>
          <rect x="36" y="5.8" width="22" height="3.4" rx="1.7" fill="rgba(255,255,255,0.14)" />

          {/* 活动栏 */}
          <rect x="0" y="15" width="12" height="49" fill="url(#vscode-icon-sidebar)" />
          <g fill="#fff">
            <rect x="3.2" y="20" width="5.6" height="5.6" rx="1.2" opacity="0.95" />
            <rect x="3.2" y="30" width="5.6" height="5.6" rx="1.2" opacity="0.45" />
            <rect x="3.2" y="40" width="5.6" height="5.6" rx="1.2" opacity="0.45" />
            <rect x="3.2" y="52" width="5.6" height="5.6" rx="1.2" opacity="0.35" />
          </g>

          {/* 编辑区语法行 */}
          <g stroke-linecap="round">
            <line x1="18" y1="22" x2="38" y2="22" stroke="#c586c0" stroke-width="2.6" />
            <line x1="41" y1="22" x2="58" y2="22" stroke="#9cdcfe" stroke-width="2.6" />
            <line x1="21" y1="29" x2="48" y2="29" stroke="#ce9178" stroke-width="2.6" />
            <line x1="21" y1="36" x2="34" y2="36" stroke="#4ec9b0" stroke-width="2.6" />
            <line x1="37" y1="36" x2="58" y2="36" stroke="#dcdcaa" stroke-width="2.6" />
            <line x1="21" y1="43" x2="54" y2="43" stroke="#9cdcfe" stroke-width="2.6" />
            <line x1="18" y1="50" x2="30" y2="50" stroke="#c586c0" stroke-width="2.6" />
            <line x1="33" y1="50" x2="44" y2="50" stroke="#ce9178" stroke-width="2.6" />
            <line x1="21" y1="57" x2="50" y2="57" stroke="#6a9955" stroke-width="2.6" opacity="0.85" />
          </g>

          {/* 顶部高光 */}
          <rect x="0" y="0" width="64" height="18" fill="url(#vscode-icon-gloss)" opacity="0.5" />
        </g>
      </svg>
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

const CHEVRON_VIEW_SIZE = 12

type ChevronIconProps = {
  size?: number
}

export function BackIcon({ size = 12 }: ChevronIconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CHEVRON_VIEW_SIZE} ${CHEVRON_VIEW_SIZE}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2.25 L4 6 L8 9.75"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function ForwardIcon({ size = 12 }: ChevronIconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CHEVRON_VIEW_SIZE} ${CHEVRON_VIEW_SIZE}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 2.25 L8 6 L4 9.75"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

type ReloadIconProps = {
  size?: number
}

export function ReloadIcon({ size = 16 }: ReloadIconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 2v6h-6"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36L21 8"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
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

export function TabsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="4.5" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M3.5 4.5 H12.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <rect x="4" y="2.5" width="8" height="2.5" rx="1" fill="currentColor" opacity="0.35" />
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

type NotificationCenterIconProps = {
  size?: number
}

export function NotificationCenterIcon({ size = 18 }: NotificationCenterIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 1.5a5.25 5.25 0 0 0-5.25 5.25v.38a2.63 2.63 0 0 0-1.88 2.5v3.12A2.63 2.63 0 0 0 4.5 15.25h9a2.63 2.63 0 0 0 2.63-2.62V9.63A2.63 2.63 0 0 0 14.25 7.1V6.75A5.25 5.25 0 0 0 9 1.5Zm0 1.5a3.75 3.75 0 0 1 3.75 3.75v.38H5.25V6.75A3.75 3.75 0 0 1 9 3Zm-3.75 5.25h7.5a1.13 1.13 0 0 1 1.13 1.13v3.12a1.13 1.13 0 0 1-1.13 1.12h-7.5a1.13 1.13 0 0 1-1.12-1.12V9.63A1.13 1.13 0 0 1 5.25 8.38Z"
      />
    </svg>
  )
}

const BATTERY_FILL_X = 2
const BATTERY_FILL_Y = 2
const BATTERY_FILL_HEIGHT = 8
const BATTERY_FILL_MAX_WIDTH = 19

type BatteryIconProps = {
  levelPercent?: number
  charging?: boolean
}

export function BatteryIcon({ levelPercent, charging }: BatteryIconProps) {
  const fillWidth =
    levelPercent === undefined
      ? BATTERY_FILL_MAX_WIDTH
      : Math.max(0, Math.min(BATTERY_FILL_MAX_WIDTH, (levelPercent / 100) * BATTERY_FILL_MAX_WIDTH))
  const fillFull = fillWidth >= BATTERY_FILL_MAX_WIDTH
  const label =
    levelPercent === undefined
      ? '电池'
      : charging
        ? `电池 ${levelPercent}%，已连接电源`
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
        <rect
          x={BATTERY_FILL_X}
          y={BATTERY_FILL_Y}
          width={BATTERY_FILL_MAX_WIDTH}
          height={BATTERY_FILL_HEIGHT}
          rx="0"
          fill="currentColor"
          class="battery-icon__fill"
        />
      ) : (
        <>
          <rect
            x={BATTERY_FILL_X}
            y={BATTERY_FILL_Y}
            width={fillWidth}
            height={BATTERY_FILL_HEIGHT}
            rx={fillFull ? 0 : 1}
            fill="currentColor"
            class="battery-icon__fill"
          />
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

export function NewsIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#c43c2e" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        📰
      </span>
    </AppIconTile>
  )
}

/** 按可用宽度压字号，避免日历图标红顶/白底文案溢出。 */
function fitCalendarIconLabelFontSize(
  label: string,
  availableWidth: number,
  maxFontSize: number,
  minFontSize: number,
): number {
  if (label.length === 0) {
    return maxFontSize
  }
  // 中文约 1em 宽；略收紧以给字重留边。
  const fitted = Math.floor((availableWidth * 0.96) / label.length)
  return Math.max(minFontSize, Math.min(maxFontSize, fitted))
}

export function CalendarIcon({ size = 64 }: IconProps) {
  const now = useOsNowInstant(60_000)
  const dynastyParts = formatChineseDynastyCalendarIconParts(now)
  const header = dynastyParts?.dynastyName ?? formatCalendarYearLabel(now)
  const bodyLabel = dynastyParts?.yearLabel ?? formatChineseMonthLabel(now.month)
  const headerHeight = Math.round(size * 0.28)
  const bodyHeight = size - headerHeight
  const horizontalPad = Math.max(2, Math.round(size * 0.05))
  const availableWidth = Math.max(1, size - horizontalPad * 2)
  const headerFontSize = fitCalendarIconLabelFontSize(
    header,
    availableWidth,
    Math.round(size * 0.14),
    6,
  )
  const bodyFontSize = fitCalendarIconLabelFontSize(
    bodyLabel,
    availableWidth,
    Math.min(Math.round(size * 0.36), Math.round(bodyHeight * 0.72)),
    7,
  )

  return (
    <AppIconTile color="#c83a32" size={size}>
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: `${size}px`,
          height: `${size}px`,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.12)',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: `${headerHeight}px`,
            padding: `0 ${horizontalPad}px`,
            background: 'linear-gradient(180deg, #ef5a4f 0%, #c83a32 55%, #a82822 100%)',
            color: '#fff',
            fontSize: `${headerFontSize}px`,
            fontWeight: 700,
            letterSpacing: header.length > 4 ? '-0.04em' : '0.02em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            textShadow: '0 0.5px 0 rgba(0, 0, 0, 0.25)',
          }}
        >
          {header}
        </span>
        <span
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#1c1c1e',
            fontSize: `${bodyFontSize}px`,
            fontWeight: 700,
            letterSpacing: bodyLabel.length > 3 ? '-0.04em' : '0',
            lineHeight: 1,
            padding: `0 ${horizontalPad}px`,
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {bodyLabel}
        </span>
      </span>
    </AppIconTile>
  )
}

export function BooksIcon({ size = 64 }: IconProps) {
  const books = [
    { x: 11, y: 26, w: 8, h: 16, grad: 'books-icon-spine-red' },
    { x: 21, y: 22, w: 9, h: 20, grad: 'books-icon-spine-blue' },
    { x: 32, y: 24, w: 8, h: 18, grad: 'books-icon-spine-green' },
    { x: 42, y: 20, w: 9, h: 22, grad: 'books-icon-spine-amber' },
  ] as const

  return (
    <AppIconTile color="#e8b050" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="books-icon-shelf-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f5dba0" />
            <stop offset="55%" stop-color="#e8b050" />
            <stop offset="100%" stop-color="#c4923a" />
          </linearGradient>
          <linearGradient id="books-icon-shelf-lip" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a87830" />
            <stop offset="100%" stop-color="#8b6914" />
          </linearGradient>
          <linearGradient id="books-icon-spine-red" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#7a1818" />
            <stop offset="45%" stop-color="#d43838" />
            <stop offset="100%" stop-color="#7a1818" />
          </linearGradient>
          <linearGradient id="books-icon-spine-blue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1a4a8a" />
            <stop offset="45%" stop-color="#3a7ad8" />
            <stop offset="100%" stop-color="#1a4a8a" />
          </linearGradient>
          <linearGradient id="books-icon-spine-green" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1a6030" />
            <stop offset="45%" stop-color="#3a9850" />
            <stop offset="100%" stop-color="#1a6030" />
          </linearGradient>
          <linearGradient id="books-icon-spine-amber" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#a06010" />
            <stop offset="45%" stop-color="#ff9500" />
            <stop offset="100%" stop-color="#a06010" />
          </linearGradient>
        </defs>
        <rect x="7" y="42" width="50" height="5.5" rx="1.2" fill="url(#books-icon-shelf-face)" />
        <rect x="7" y="47.5" width="50" height="2.5" rx="0.8" fill="url(#books-icon-shelf-lip)" />
        {books.map((book) => (
          <g key={book.grad}>
            <rect
              x={book.x}
              y={book.y}
              width={book.w}
              height={book.h}
              rx="1"
              fill={`url(#${book.grad})`}
            />
            <rect
              x={book.x + 1}
              y={book.y + 1}
              width={book.w - 2}
              height={2}
              rx="0.5"
              fill="rgba(255,255,255,0.28)"
            />
            <rect
              x={book.x + book.w - 1.5}
              y={book.y + 2}
              width="1"
              height={book.h - 4}
              rx="0.5"
              fill="rgba(0,0,0,0.18)"
            />
          </g>
        ))}
      </svg>
    </AppIconTile>
  )
}

export function WeatherIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#147efb" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        🌤
      </span>
    </AppIconTile>
  )
}

export function CatGptIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#10a37f" size={size}>
      <span class="app-icon-tile__emoji" style={{ fontSize: `${size * (50 / 72)}px` }}>
        🐱
      </span>
    </AppIconTile>
  )
}

export function GomokuIcon({ size = 64 }: IconProps) {
  const gridLines = [16, 32, 48]
  const cornerRadius = 14

  return (
    <AppIconTile color="#8b6914" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <clipPath id="gomoku-icon-clip">
            <rect x="0" y="0" width="64" height="64" rx={cornerRadius} ry={cornerRadius} />
          </clipPath>
          <linearGradient id="gomoku-board-face" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f0dca0" />
            <stop offset="100%" stop-color="#c9a050" />
          </linearGradient>
          <radialGradient id="gomoku-black-stone" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stop-color="#666" />
            <stop offset="100%" stop-color="#111" />
          </radialGradient>
          <radialGradient id="gomoku-white-stone" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stop-color="#fff" />
            <stop offset="100%" stop-color="#ccc" />
          </radialGradient>
        </defs>
        <g clip-path="url(#gomoku-icon-clip)">
          <rect x="0" y="0" width="64" height="64" rx={cornerRadius} ry={cornerRadius} fill="url(#gomoku-board-face)" />
          {gridLines.map((line) => (
            <g key={line} stroke={line === 32 ? 'rgba(50, 35, 10, 0.65)' : 'rgba(50, 35, 10, 0.4)'} stroke-width={line === 32 ? 1.2 : 0.7}>
              <line x1={line} y1="0" x2={line} y2="64" />
              <line x1="0" y1={line} x2="64" y2={line} />
            </g>
          ))}
          <circle cx="16" cy="16" r="7.25" fill="url(#gomoku-black-stone)" />
          <circle cx="48" cy="48" r="7.25" fill="url(#gomoku-white-stone)" stroke="rgba(0,0,0,0.12)" stroke-width="0.6" />
        </g>
      </svg>
    </AppIconTile>
  )
}

export function TranslateIcon({ size = 64 }: IconProps) {
  const fontSize = size * (22 / 72)

  return (
    <AppIconTile color="#30b0c7" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <text
          x="14"
          y="38"
          fill="#fff"
          font-size={fontSize}
          font-weight="700"
          font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
        >
          文
        </text>
        <text
          x="36"
          y="44"
          fill="#fff"
          font-size={fontSize * 0.92}
          font-weight="700"
          font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
        >
          A
        </text>
        <path
          d="M18 46 Q32 54 46 46"
          fill="none"
          stroke="#fff"
          stroke-width="2.5"
          stroke-linecap="round"
          opacity="0.85"
        />
      </svg>
    </AppIconTile>
  )
}

type CandlestickProps = {
  bodyX: number
  bodyY: number
  bodyW: number
  bodyH: number
  wickX: number
  wickTop: number
  wickBottom: number
}

function Candlestick({ bodyX, bodyY, bodyW, bodyH, wickX, wickTop, wickBottom }: CandlestickProps) {
  return (
    <g>
      <g transform="translate(0.5, 1)" opacity="0.2">
        <line
          x1={wickX}
          y1={wickTop}
          x2={wickX}
          y2={wickBottom}
          stroke="#120000"
          stroke-width="1.4"
          stroke-linecap="butt"
        />
      </g>
      <line
        x1={wickX}
        y1={wickTop}
        x2={wickX}
        y2={wickBottom}
        stroke="url(#stocks-wick-face)"
        stroke-width="1.8"
        stroke-linecap="butt"
      />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx="1" fill="url(#stocks-candle-face)" />
      <circle cx={wickX + 0.5} cy={wickTop + 1} r="1.1" fill="#120000" opacity="0.18" />
      <circle cx={wickX + 0.5} cy={wickBottom + 1} r="1.1" fill="#120000" opacity="0.18" />
      <circle cx={wickX} cy={wickTop} r="1.5" fill="#fff" stroke="rgba(40, 0, 0, 0.32)" stroke-width="0.8" />
      <circle cx={wickX} cy={wickBottom} r="1.5" fill="#fff" stroke="rgba(40, 0, 0, 0.32)" stroke-width="0.8" />
    </g>
  )
}

export function StocksIcon({ size = 64 }: IconProps) {
  const trendLine = 'M6 48 L14 42 L22 46 L30 32 L38 36 L46 20 L54 14 L58 12'
  const gridLines = [0, 8, 16, 24, 32, 40, 48, 56, 64]
  const candles: CandlestickProps[] = [
    { bodyX: 11, bodyY: 38, bodyW: 5, bodyH: 10, wickX: 13.5, wickTop: 34, wickBottom: 51 },
    { bodyX: 25, bodyY: 28, bodyW: 5, bodyH: 12, wickX: 27.5, wickTop: 22, wickBottom: 44 },
    { bodyX: 39, bodyY: 18, bodyW: 5, bodyH: 14, wickX: 41.5, wickTop: 12, wickBottom: 36 },
  ]

  return (
    <AppIconTile color="#ff3b30" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="stocks-candle-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff" />
            <stop offset="100%" stop-color="#ffe8e8" />
          </linearGradient>
          <linearGradient id="stocks-wick-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fff" />
            <stop offset="100%" stop-color="#ffd6d6" />
          </linearGradient>
          <linearGradient id="stocks-line-face" x1="32" y1="12" x2="32" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#fff" />
            <stop offset="55%" stop-color="#fff5f5" />
            <stop offset="100%" stop-color="#ffd6d6" />
          </linearGradient>
        </defs>
        <g opacity="0.18" stroke="#fff" stroke-width="0.9">
          {gridLines.map((offset) => (
            <line key={`h-${offset}`} x1="0" y1={offset} x2="64" y2={offset} />
          ))}
          {gridLines.map((offset) => (
            <line key={`v-${offset}`} x1={offset} y1="0" x2={offset} y2="64" />
          ))}
        </g>
        <path
          d={trendLine}
          fill="none"
          stroke="#2a0000"
          stroke-width="6.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.42"
        />
        <path
          d={trendLine}
          fill="none"
          stroke="url(#stocks-line-face)"
          stroke-width="3.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="59.5" cy="13.5" r="3.6" fill="#120000" opacity="0.45" />
        <circle cx="58" cy="12" r="3.2" fill="#fff" stroke="rgba(40, 0, 0, 0.3)" stroke-width="1" />
        {candles.map((candle) => (
          <Candlestick key={`${candle.wickX}-${candle.bodyY}`} {...candle} />
        ))}
      </svg>
    </AppIconTile>
  )
}

export function SpeechIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#3a3d4d" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="speech-mic-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f4f6fb" />
            <stop offset="55%" stop-color="#d6dbe6" />
            <stop offset="100%" stop-color="#aab2c2" />
          </linearGradient>
          <linearGradient id="speech-mic-stem" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#cfd4df" />
            <stop offset="100%" stop-color="#8d95a6" />
          </linearGradient>
        </defs>
        {/* 麦克风胶囊头 */}
        <rect x="24" y="10" width="16" height="28" rx="8" ry="8" fill="url(#speech-mic-body)" stroke="rgba(0,0,0,0.18)" stroke-width="1" />
        {/* 麦克风网纹 */}
        <g stroke="rgba(40,45,60,0.28)" stroke-width="0.9">
          <line x1="24" y1="20" x2="40" y2="20" />
          <line x1="24" y1="26" x2="40" y2="26" />
          <line x1="24" y1="32" x2="40" y2="32" />
        </g>
        {/* U 形托架 */}
        <path d="M17 33 a15 15 0 0 0 30 0" fill="none" stroke="url(#speech-mic-stem)" stroke-width="3.4" stroke-linecap="round" />
        {/* 立柱 */}
        <line x1="32" y1="48" x2="32" y2="54" stroke="url(#speech-mic-stem)" stroke-width="3.2" stroke-linecap="round" />
        {/* 底座 */}
        <line x1="23" y1="54" x2="41" y2="54" stroke="url(#speech-mic-stem)" stroke-width="3.4" stroke-linecap="round" />
        {/* 声波 */}
        <g stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.85" fill="none">
          <path d="M9 26 q-3 6 0 12" />
          <path d="M55 26 q3 6 0 12" />
        </g>
      </svg>
    </AppIconTile>
  )
}

export function KeychainIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#f5a623" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        {/* 钥匙环 */}
        <circle
          cx={Math.round(64 * 0.5)}
          cy={Math.round(64 * 0.28)}
          r={Math.round(64 * 0.38) / 2}
          fill="none"
          stroke="#fff"
          stroke-width="5"
          opacity="0.92"
        />
        {/* 钥匙杆 */}
        <rect
          x={Math.round(64 * 0.5 - 64 * 0.12 / 2)}
          y={Math.round(64 * 0.42)}
          width={Math.round(64 * 0.12)}
          height={Math.round(64 * 0.4)}
          rx={Math.round(64 * 0.06)}
          fill="#fff"
          opacity="0.92"
        />
        {/* 钥匙齿 */}
        <rect
          x={Math.round(64 * 0.5 + 64 * 0.12 / 2 - 2)}
          y={Math.round(64 * 0.6)}
          width={Math.round(64 * 0.1)}
          height="4"
          rx="1.5"
          fill="#f5a623"
          opacity="0.85"
        />
        <rect
          x={Math.round(64 * 0.5 + 64 * 0.12 / 2 - 2)}
          y={Math.round(64 * 0.7)}
          width={Math.round(64 * 0.06)}
          height="4"
          rx="1.5"
          fill="#f5a623"
          opacity="0.85"
        />
      </svg>
    </AppIconTile>
  )
}

export function TaskManagerIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#1f1f22" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="10" y="12" width="44" height="40" rx="6" fill="#2a2a2e" />
        <polyline
          points="16,40 24,30 32,34 40,22 48,28"
          fill="none"
          stroke="#34c759"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="16" cy="40" r="2.5" fill="#34c759" />
        <circle cx="24" cy="30" r="2.5" fill="#34c759" />
        <circle cx="32" cy="34" r="2.5" fill="#34c759" />
        <circle cx="40" cy="22" r="2.5" fill="#34c759" />
        <circle cx="48" cy="28" r="2.5" fill="#34c759" />
        <rect x="16" y="46" width="32" height="2" rx="1" fill="#5ac8fa" opacity="0.9" />
      </svg>
    </AppIconTile>
  )
}

export function EventLogIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#4a5568" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="14" y="10" width="36" height="44" rx="4" fill="#fff" opacity="0.95" />
        <rect x="20" y="18" width="24" height="3" rx="1.5" fill="#4a5568" opacity="0.85" />
        <rect x="20" y="26" width="20" height="2.5" rx="1.25" fill="#718096" opacity="0.75" />
        <rect x="20" y="33" width="22" height="2.5" rx="1.25" fill="#718096" opacity="0.75" />
        <rect x="20" y="40" width="16" height="2.5" rx="1.25" fill="#718096" opacity="0.75" />
        <circle cx="44" cy="46" r="8" fill="#34c759" />
        <path
          d="M41 46 L43.5 48.5 L47.5 43.5"
          fill="none"
          stroke="#fff"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </AppIconTile>
  )
}

export function HelpIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#e8b014" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        {/* 底座阴影 */}
        <ellipse cx="32" cy="54" rx="21" ry="3.6" fill="rgba(0,0,0,0.2)" />
        {/* 金属外环：几何中心约 32,31，略上抬给阴影留空 */}
        <circle cx="32" cy="31" r="24" fill="#b87f06" />
        <circle cx="32" cy="30.3" r="23.1" fill="#f4d25a" />
        <circle cx="32" cy="31.5" r="21.8" fill="#d9a20f" />
        {/* 内盘 */}
        <circle cx="32" cy="31" r="18.6" fill="#fff8dc" />
        <circle cx="32" cy="32" r="17.8" fill="#ffe9a0" />
        {/* 顶部高光 */}
        <ellipse cx="32" cy="22.5" rx="12.5" ry="7" fill="rgba(255,255,255,0.58)" />
        {/* 内盘内阴影 */}
        <circle
          cx="32"
          cy="31"
          r="17.8"
          fill="none"
          stroke="rgba(140,90,0,0.2)"
          stroke-width="1.5"
        />
        {/* 问号：路径按 x=32 光学居中，略下移 */}
        <g transform="translate(0 1.5)">
          <path
            d="M25.2 22.8c0-4.2 3.2-7.2 7.2-7.2s7 2.7 7 6.5c0 2.9-1.4 4.5-3.7 6-2 1.3-3.1 2.5-3.1 4.8v1"
            fill="none"
            stroke="rgba(90,45,0,0.26)"
            stroke-width="4.8"
            stroke-linecap="round"
            transform="translate(0.8 1.05)"
          />
          <circle cx="32.95" cy="42.05" r="3" fill="rgba(90,45,0,0.26)" />
          <path
            d="M25.2 22.8c0-4.2 3.2-7.2 7.2-7.2s7 2.7 7 6.5c0 2.9-1.4 4.5-3.7 6-2 1.3-3.1 2.5-3.1 4.8v1"
            fill="none"
            stroke="#6b3600"
            stroke-width="4.2"
            stroke-linecap="round"
          />
          <circle cx="32" cy="41" r="2.8" fill="#6b3600" />
          <path
            d="M25.2 22.8c0-4.2 3.2-7.2 7.2-7.2s7 2.7 7 6.5c0 2.9-1.4 4.5-3.7 6-2 1.3-3.1 2.5-3.1 4.8v1"
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            stroke-width="1.45"
            stroke-linecap="round"
            transform="translate(-0.75 -0.85)"
          />
          <circle cx="31.15" cy="40.1" r="1.1" fill="rgba(255,255,255,0.42)" />
        </g>
      </svg>
    </AppIconTile>
  )
}


export function TerminalIcon({ size = 64 }: IconProps) {
  return (
    <AppIconTile color="#2c2c2e" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="6" y="9" width="52" height="46" rx="6" fill="#1a1a1c" />
        <rect x="7.4" y="10.4" width="49.2" height="43.2" rx="4.8" fill="#0d0d0f" />
        <path
          d="M16.5 24.5l10 8.2-10 8.2"
          fill="none"
          stroke="#7ddea5"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M29.5 40.5h18"
          fill="none"
          stroke="#d0d0d6"
          stroke-width="3"
          stroke-linecap="round"
        />
      </svg>
    </AppIconTile>
  )
}
