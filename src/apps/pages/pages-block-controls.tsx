export type BlockControlsProps = {
  /** 相对 pages-editor__main 的定位 */
  top: number
  left: number
  /** 与目标块同高，整行左侧 gutter 都可悬停 */
  height: number
  plusActive?: boolean
  onPlus: () => void
  onHandle: () => void
}

export function PagesBlockControls({
  top,
  left,
  height,
  plusActive,
  onPlus,
  onHandle,
}: BlockControlsProps) {
  return (
    <div
      class="pages-block-controls"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        height: `${Math.max(height, 28)}px`,
      }}
      contentEditable={false}
    >
      <button
        type="button"
        class={`pages-block-controls__btn pages-block-controls__btn--plus${plusActive ? ' pages-block-controls__btn--active' : ''}`}
        title="插入块"
        aria-label="插入块"
        aria-expanded={plusActive ? 'true' : 'false'}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onPlus()
        }}
      >
        +
      </button>
      <button
        type="button"
        class="pages-block-controls__btn pages-block-controls__btn--handle"
        title="选中块"
        aria-label="选中块"
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onHandle()
        }}
      >
        ⋮⋮
      </button>
    </div>
  )
}
