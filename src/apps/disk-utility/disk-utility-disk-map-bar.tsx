import { formatStorageSize } from '../../os/format-storage-size.ts'
import type { DiskMapSegment } from './disk-utility-disk-map.ts'

export function DiskMapBar({
  segments,
  diskBytes,
  selectedId,
  compact,
  onSelect,
}: {
  segments: DiskMapSegment[]
  diskBytes: number
  selectedId?: string
  compact?: boolean
  onSelect?: (nodeId: string) => void
}): preact.JSX.Element | undefined {
  if (segments.length === 0 || diskBytes <= 0) return undefined

  return (
    <div class={`disk-utility__map${compact ? ' disk-utility__map--compact' : ''}`}>
      <div class="disk-utility__map-bar" role="list" aria-label="分区布局">
        {segments.map((segment) => {
          const selected = segment.nodeId !== undefined && segment.nodeId === selectedId
          const interactive = Boolean(segment.nodeId && onSelect)
          const className = [
            'disk-utility__map-seg',
            `disk-utility__map-seg--${segment.tone}`,
            selected ? 'disk-utility__map-seg--selected' : '',
            interactive ? 'disk-utility__map-seg--interactive' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const title = `${segment.label} · ${segment.typeLabel} · ${formatStorageSize(segment.sizeBytes)}`
          const style = { flexGrow: Math.max(segment.sizeBytes, 1), flexBasis: 0 }
          const body = (
            <>
              <span class="disk-utility__map-seg-label">{segment.label}</span>
              <span class="disk-utility__map-seg-meta">
                {segment.typeLabel} · {formatStorageSize(segment.sizeBytes)}
              </span>
            </>
          )
          if (interactive) {
            return (
              <button
                key={segment.id}
                type="button"
                role="listitem"
                class={className}
                style={style}
                title={title}
                aria-pressed={selected}
                onClick={() => onSelect?.(segment.nodeId!)}
              >
                {body}
              </button>
            )
          }
          return (
            <div key={segment.id} role="listitem" class={className} style={style} title={title}>
              {body}
            </div>
          )
        })}
      </div>
      {compact ? undefined : (
        <ul class="disk-utility__map-legend">
          {segments.map((segment) => {
            const selected = segment.nodeId !== undefined && segment.nodeId === selectedId
            const interactive = Boolean(segment.nodeId && onSelect)
            return (
              <li key={segment.id}>
                <button
                  type="button"
                  class={`disk-utility__map-legend-item${selected ? ' disk-utility__map-legend-item--selected' : ''}${interactive ? '' : ' disk-utility__map-legend-item--static'}`}
                  disabled={!interactive}
                  onClick={() => {
                    if (segment.nodeId) onSelect?.(segment.nodeId)
                  }}
                >
                  <span class={`disk-utility__map-swatch disk-utility__map-seg--${segment.tone}`} />
                  <span class="disk-utility__map-legend-name">{segment.label}</span>
                  <span class="disk-utility__map-legend-type">{segment.typeLabel}</span>
                  <span class="disk-utility__map-legend-size">{formatStorageSize(segment.sizeBytes)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
