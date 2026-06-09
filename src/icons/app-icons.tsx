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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" overflow="visible" aria-hidden="true">
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
        <rect x="2" y="2" width="17" height="8" rx="1" fill="currentColor" class="battery-icon__fill" />
      ) : (
        <>
          <rect x="2" y="2" width={fillWidth} height="8" rx="1" fill="currentColor" class="battery-icon__fill" />
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

  return (
    <AppIconTile color="#8b6914" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
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
        <rect x="0" y="0" width="64" height="64" fill="url(#gomoku-board-face)" />
        {gridLines.map((line) => (
          <g key={line} stroke={line === 32 ? 'rgba(50, 35, 10, 0.65)' : 'rgba(50, 35, 10, 0.4)'} stroke-width={line === 32 ? 1.2 : 0.7}>
            <line x1={line} y1="0" x2={line} y2="64" />
            <line x1="0" y1={line} x2="64" y2={line} />
          </g>
        ))}
        <circle cx="16" cy="16" r="7.25" fill="url(#gomoku-black-stone)" />
        <circle cx="48" cy="48" r="7.25" fill="url(#gomoku-white-stone)" stroke="rgba(0,0,0,0.12)" stroke-width="0.6" />
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
