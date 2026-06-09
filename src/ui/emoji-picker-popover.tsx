import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { EmojiPicker } from 'frimousse'
import {
  computeFloatingPanelPosition,
  resolveFloatingPanelWidth,
} from './compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from './floating-overlay-root.ts'
import './emoji-picker-popover.css'

const EMOJI_PICKER_PANEL_WIDTH = 320
const EMOJI_PICKER_PANEL_HEIGHT = 360

type EmojiPickerPanelProps = {
  onSelect: (emoji: string) => void
  className?: string
}

export function EmojiPickerPanel({ onSelect, className }: EmojiPickerPanelProps) {
  return (
    <EmojiPicker.Root
      class={`emoji-picker-panel${className ? ` ${className}` : ''}`}
      locale="zh"
      skinTone="none"
      onEmojiSelect={(entry) => onSelect(entry.emoji)}
    >
      <div class="emoji-picker-panel__toolbar">
        <EmojiPicker.Search
          class="emoji-picker-panel__search"
          placeholder="搜索表情…"
        />
      </div>
      <EmojiPicker.Viewport class="emoji-picker-panel__viewport">
        <EmojiPicker.Loading class="emoji-picker-panel__status">加载中…</EmojiPicker.Loading>
        <EmojiPicker.Empty class="emoji-picker-panel__status">未找到表情</EmojiPicker.Empty>
        <EmojiPicker.List
          class="emoji-picker-panel__list"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div class="emoji-picker-panel__category" {...props}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div class="emoji-picker-panel__row" {...props}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button type="button" class="emoji-picker-panel__emoji" {...props}>
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
      <EmojiPicker.ActiveEmoji>
        {({ emoji }) => (
          <div class="emoji-picker-panel__preview">
            {emoji ? (
              <>
                <span class="emoji-picker-panel__preview-glyph" aria-hidden="true">
                  {emoji.emoji}
                </span>
                <span class="emoji-picker-panel__preview-label">{emoji.label}</span>
              </>
            ) : (
              <span class="emoji-picker-panel__preview-label">选择表情</span>
            )}
          </div>
        )}
      </EmojiPicker.ActiveEmoji>
    </EmojiPicker.Root>
  )
}

type EmojiPickerPopoverProps = {
  value: string
  onChange: (emoji: string) => void
  triggerLabel?: string
  children?: ComponentChildren
  disabled?: boolean
}

export function EmojiPickerPopover({
  value,
  onChange,
  triggerLabel = '选择图标',
  children,
  disabled = false,
}: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }

    const panel = panelRef.current
    const fallbackWidth = resolveFloatingPanelWidth(EMOJI_PICKER_PANEL_WIDTH)
    const measured = panel?.getBoundingClientRect()
    const panelWidth = measured && measured.width > 0 ? measured.width : fallbackWidth
    const panelHeight =
      measured && measured.height > 0 ? measured.height : EMOJI_PICKER_PANEL_HEIGHT

    setPanelPosition(
      computeFloatingPanelPosition(trigger.getBoundingClientRect(), panelWidth, panelHeight),
    )
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    updatePanelPosition()

    const frame = window.requestAnimationFrame(() => {
      updatePanelPosition()
    })

    window.addEventListener('resize', updatePanelPosition)
    document.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePanelPosition)
      document.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [open, updatePanelPosition])

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) {
        return
      }
      if (panelRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const floatingPanel = open
    ? createPortal(
        <div
          ref={panelRef}
          class="emoji-picker-popover__panel emoji-picker-popover__panel--floating"
          style={{
            top: `${panelPosition.top}px`,
            left: `${panelPosition.left}px`,
          }}
          role="dialog"
          aria-label="选择表情"
        >
          <EmojiPickerPanel
            onSelect={(emoji) => {
              onChange(emoji)
              setOpen(false)
            }}
          />
        </div>,
        getFloatingOverlayRoot(),
      )
    : undefined

  return (
    <>
      <div class="emoji-picker-popover">
        <button
          ref={triggerRef}
          type="button"
          class="emoji-picker-popover__trigger"
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          {children ?? (
            <>
              <span class="emoji-picker-popover__trigger-glyph" aria-hidden="true">
                {value || '📦'}
              </span>
              <span class="emoji-picker-popover__trigger-label">{triggerLabel}</span>
            </>
          )}
        </button>
      </div>
      {floatingPanel}
    </>
  )
}
