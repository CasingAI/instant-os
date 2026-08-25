/**
 * 写入中文件的行内进度图标（替换原文件图标位，Finder 风格）：
 * 已知总量（expectedSize）画比例填充的圆饼；未知总量画旋转弧线。
 */
import type { FilesWriteProgressEntry } from './files-write-progress.ts'

/** 从正上方起顺时针的圆饼扇形路径；fraction∈[0,1]。 */
function piePath(cx: number, cy: number, r: number, fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction))
  if (clamped <= 0) return ''
  if (clamped >= 1) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
  }
  const angle = clamped * Math.PI * 2 - Math.PI / 2
  const x = cx + r * Math.cos(angle)
  const y = cy + r * Math.sin(angle)
  const largeArc = clamped > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`
}

export function FilesWriteProgressGlyph({
  entry,
  size = 'grid',
}: {
  entry: FilesWriteProgressEntry
  size?: 'list' | 'grid'
}) {
  const fraction = entry.total && entry.total > 0 ? entry.written / entry.total : undefined
  return (
    <span class={`files-write-progress files-write-progress--${size}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        {fraction === undefined ? (
          <g class="files-write-progress__spin">
            <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="3.5" />
            <circle
              cx="16"
              cy="16"
              r="12"
              fill="none"
              stroke="#3f8ee0"
              stroke-width="3.5"
              stroke-linecap="round"
              stroke-dasharray="18 76"
            />
          </g>
        ) : (
          <>
            <circle cx="16" cy="16" r="13" fill="rgba(0,0,0,0.08)" />
            {fraction > 0 ? <path d={piePath(16, 16, 13, fraction)} fill="#3f8ee0" /> : null}
          </>
        )}
      </svg>
    </span>
  )
}
