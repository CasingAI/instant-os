/**
 * 圆饼进度本体：fraction 已知按比例填充扇形；undefined 画旋转弧线（不定态）。
 * 从 files-write-progress-icon.tsx 抽出，供列表行内写入徽章使用。
 * 容器尺寸由调用方的 className 决定，svg 自适应填满。
 * 旋转动画 keyframes（files-progress-pie-spin）定义在 files.css。
 */
export function FilesOpProgressPie({ fraction }: { fraction: number | undefined }) {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      {fraction === undefined ? (
        <g class="files-progress-pie__spin">
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
  )
}

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
