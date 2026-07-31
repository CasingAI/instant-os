export type BlockControlsProps = {
  /** 相对 pages-editor 根节点的定位（已换算） */
  top: number
  left: number
  onPlus: () => void
  onHandle: () => void
}

export function PagesBlockControls({ top, left, onPlus, onHandle }: BlockControlsProps) {
  return (
    <div
      class="pages-block-controls"
      style={{ top: `${top}px`, left: `${left}px` }}
      contentEditable={false}
    >
      <button
        type="button"
        class="pages-block-controls__btn pages-block-controls__btn--plus"
        title="插入块"
        aria-label="插入块"
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
