import { useId } from 'preact/hooks'
import { AppIconTile } from './app-icon-tile.tsx'

type IconProps = {
  size?: number
}

/** 头版轮廓：右上折角斜切下来，四角圆角。 */
const PAGE_PATH = [
  'M 22.6 19',
  'H 38.5',
  'L 43 23.5',
  'V 43.4',
  'A 1.6 1.6 0 0 1 41.4 45',
  'H 22.6',
  'A 1.6 1.6 0 0 1 21 43.4',
  'V 20.6',
  'A 1.6 1.6 0 0 1 22.6 19',
  'Z',
].join(' ')

/** 新闻 App 图标：红盘白报纸，照帮助/下载器图标同款拟物画法。 */
export function NewsIcon({ size = 64 }: IconProps) {
  const pageClip = `news-icon-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  return (
    <AppIconTile color="#c43c2e" size={size}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <clipPath id={pageClip}>
            <path d={PAGE_PATH} />
          </clipPath>
        </defs>
        {/* 底座阴影 */}
        <ellipse cx="32" cy="54" rx="21" ry="3.6" fill="rgba(0,0,0,0.2)" />
        {/* 金属外环：几何中心约 32,31，略上抬给阴影留空 */}
        <circle cx="32" cy="31" r="24" fill="#6e1b0e" />
        <circle cx="32" cy="30.3" r="23.1" fill="#f6cfc0" />
        <circle cx="32" cy="31.5" r="21.7" fill="#c85a40" />
        {/* 环内缘暗槽，衔接内盘 */}
        <circle cx="32" cy="31.4" r="19.7" fill="#98331e" />
        {/* 内盘：上缘露出深边，做出凹沿 */}
        <circle cx="32" cy="31" r="18.8" fill="#a12413" />
        <circle cx="32" cy="31.8" r="18" fill="#d94f30" />
        {/* 顶部高光 */}
        <ellipse cx="32" cy="22" rx="12" ry="6.5" fill="rgba(255,255,255,0.5)" />
        {/* 内盘内阴影 */}
        <circle
          cx="32"
          cy="31"
          r="18"
          fill="none"
          stroke="rgba(96,10,4,0.28)"
          stroke-width="1.5"
        />
        {/* 白报纸：深色投影层右下错位垫底，两层错位出浮雕 */}
        <g transform="translate(0 1)">
          <path d={PAGE_PATH} fill="rgba(94,16,8,0.42)" transform="translate(0.9 1.1)" />
          <path d={PAGE_PATH} fill="#fffdf6" />
          <g clip-path={`url(#${pageClip})`}>
            {/* 红报头 */}
            <rect x="21" y="19" width="22" height="6" fill="#b3271a" />
            <rect x="21" y="19.4" width="22" height="1.5" fill="rgba(255,255,255,0.25)" />
            <rect x="21" y="24.5" width="22" height="0.5" fill="rgba(60,6,2,0.35)" />
            {/* 头条标题行 */}
            <rect x="23" y="26.6" width="14" height="1.3" rx="0.5" fill="rgba(70,42,22,0.6)" />
            {/* 配图：灰蓝照片 + 山与太阳 */}
            <rect x="23" y="29.3" width="8.2" height="7" rx="0.5" fill="#b9c8d6" />
            <path
              d="M 23 34.6 L 25.6 32.2 L 27.3 33.6 L 29.4 31.4 L 31.2 33.5 V 36.3 H 23 Z"
              fill="#58708c"
            />
            <circle cx="29.6" cy="31" r="0.7" fill="#f5e9c8" />
            {/* 正文线 */}
            <g fill="rgba(96,64,38,0.45)">
              <rect x="32.6" y="30.1" width="8.4" height="1.15" rx="0.5" />
              <rect x="32.6" y="32" width="8.4" height="1.15" rx="0.5" />
              <rect x="32.6" y="33.9" width="6.4" height="1.15" rx="0.5" />
              <rect x="23" y="38.4" width="18" height="1.15" rx="0.5" />
              <rect x="23" y="40.4" width="18" height="1.15" rx="0.5" />
              <rect x="23" y="42.4" width="10.5" height="1.15" rx="0.5" />
            </g>
          </g>
          {/* 折角翻页：翻下来的角 + 折线与高光，角下垫一条影 */}
          <path d="M 38.5 19 L 43 23.5 L 38.5 23.5 Z" fill="#f4e6d2" />
          <rect x="38.5" y="23.5" width="4.5" height="0.7" fill="rgba(60,10,4,0.3)" />
          <path
            d="M 38.5 19 L 43 23.5"
            fill="none"
            stroke="rgba(120,66,28,0.4)"
            stroke-width="0.45"
          />
          <path
            d="M 39.2 19.9 L 42.6 23.3"
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            stroke-width="0.55"
            stroke-linecap="round"
          />
        </g>
      </svg>
    </AppIconTile>
  )
}
