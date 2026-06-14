import type { ComponentType } from 'preact'
import type { AppId } from '../os/types.ts'
import { DesktopFolderMiniIcon } from './desktop-folder-mini-icon.tsx'
import './desktop-folder-icon.css'

export type FolderPreviewApp = {
  appId: AppId
  kind: 'builtin'
  Icon: ComponentType<{ size?: number }>
} | {
  appId: AppId
  kind: 'generated'
  emoji: string
  themeColor: string
}

type DesktopFolderIconProps = {
  apps: FolderPreviewApp[]
  size?: number
  mergeTarget?: boolean
}

/** 与应用图标一致的圆角比例 */
const CORNER_RATIO = 0.22
/** 外圈浅灰边宽度（72px 基准约 5px） */
const BORDER_RATIO = 5 / 72
/** 九宫格内边距（固定 5px） */
const GRID_PADDING = 5
/** 格子间距（72px 基准约 2px） */
const GRID_GAP_RATIO = 2 / 72
/** 小图标占格子的比例 */
const ICON_IN_CELL = 0.72

function buildFolderIconGeometry(size: number) {
  const borderWidth = size * BORDER_RATIO
  const outerRadius = size * CORNER_RATIO
  const innerRadius = Math.max(0, outerRadius - borderWidth)
  const gap = Math.max(1, size * GRID_GAP_RATIO)
  const wellSize = size - borderWidth * 2
  const cellSize = (wellSize - GRID_PADDING * 2 - gap * 2) / 3
  const miniSize = Math.max(4, Math.round(cellSize * ICON_IN_CELL))
  const miniRadius = miniSize * CORNER_RATIO

  return {
    borderWidth,
    outerRadius,
    innerRadius,
    gap,
    wellSize,
    miniSize,
    miniRadius,
  }
}
export function DesktopFolderIcon({ apps, size = 72, mergeTarget = false }: DesktopFolderIconProps) {
  const previewApps = apps.slice(0, 9)
  const geometry = buildFolderIconGeometry(size)
  const {
    borderWidth,
    outerRadius,
    innerRadius,
    gap,
    miniSize,
    miniRadius,
  } = geometry

  return (
    <span
      class={`desktop-folder-icon${mergeTarget ? ' desktop-folder-icon--merge-target' : ''}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${outerRadius}px`,
      }}
      aria-hidden="true"
    >
      <span
        class="desktop-folder-icon__well"
        style={{
          inset: `${borderWidth}px`,
          borderRadius: `${innerRadius}px`,
        }}
      >
        <span
          class="desktop-folder-icon__grid"
          style={{
            gap: `${gap}px`,
            padding: `${GRID_PADDING}px`,
          }}
        >
          {Array.from({ length: 9 }, (_, index) => {
            const app = previewApps[index]
            if (!app) {
              return (
                <span
                  key={`slot-${index}`}
                  class="desktop-folder-icon__cell desktop-folder-icon__cell--empty"
                />
              )
            }

            return (
              <span
                key={app.appId}
                class="desktop-folder-icon__cell"
              >
                <DesktopFolderMiniIcon
                  app={app}
                  displaySize={miniSize}
                  borderRadius={miniRadius}
                />
              </span>
            )
          })}
        </span>
      </span>
      <span
        class="desktop-folder-icon__gloss"
        style={{ borderRadius: `${outerRadius}px ${outerRadius}px 0 0` }}
      />
      <span class="desktop-folder-icon__edge desktop-folder-icon__edge--top" />
    </span>
  )
}
