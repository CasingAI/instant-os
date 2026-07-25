import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { supportsThinkingParam } from '../../ai/ai-thinking.ts'
import type { FlatEnabledModel } from '../../ai/ai-providers.ts'
import { FLOATING_PANEL_VIEWPORT_PADDING } from '../../ui/compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from '../../ui/floating-overlay-root.ts'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  describeVscodeAiModel,
  displayPartsForVscodeAiModel,
  formatVscodeAiModelContextLabel,
  resolveVscodeAiFastPair,
} from './vscode-ai-model-display.ts'
import {
  formatVscodeAiModelRefKey,
  labelForVscodeAiModel,
  resolveVscodeAiThinkingEnabledForModelKey,
} from './vscode-ai-models.ts'
import type { VscodeAiModelOptionPrefs } from './vscode-prefs.ts'
import './vscode-ai-model-picker.css'

const MAIN_PANEL_WIDTH = 280
const MAIN_PANEL_FALLBACK_HEIGHT = 288
const TIP_WIDTH = 248
const TIP_FALLBACK_HEIGHT = 110
const EDIT_WIDTH = 208
const EDIT_FALLBACK_HEIGHT = 120
const ARROW_EDGE_PAD = 14
/** 与 CSS --picker-arrow-size 一致；箭头计入壳尺寸，尖端与锚点间距 1px */
const PICKER_ARROW_SIZE = 8
const PICKER_ARROW_HALF = 6
const PICKER_RADIUS = 8
const PICKER_BORDER_INSET = 1
const PICKER_PANEL_GAP = 1

type ArrowSide = 'top' | 'bottom' | 'left' | 'right'

/** 圆角矩形 + 箭头的一体气泡 path（chrome/face 共用同一坐标系） */
function bubbleClipPath(
  width: number,
  height: number,
  arrow: ArrowSide,
  arrowOffset: number,
  inset: number,
): string {
  if (width <= 0 || height <= 0) return ''

  const as = PICKER_ARROW_SIZE
  const ah = Math.max(PICKER_ARROW_HALF - inset * 0.7, 3)
  const r = Math.max(PICKER_RADIUS - inset, 0)
  const left = inset
  const top = inset
  const right = width - inset
  const bottom = height - inset

  let bodyLeft = left
  let bodyTop = top
  let bodyRight = right
  let bodyBottom = bottom
  let tipX = 0
  let tipY = 0
  let baseA = 0
  let baseB = 0

  if (arrow === 'bottom') {
    bodyBottom = height - as - inset
    tipX = arrowOffset
    tipY = bottom
    baseA = arrowOffset - ah
    baseB = arrowOffset + ah
  } else if (arrow === 'top') {
    bodyTop = as + inset
    tipX = arrowOffset
    tipY = top
    baseA = arrowOffset - ah
    baseB = arrowOffset + ah
  } else if (arrow === 'left') {
    bodyLeft = as + inset
    tipX = left
    tipY = arrowOffset
    baseA = arrowOffset - ah
    baseB = arrowOffset + ah
  } else {
    bodyRight = width - as - inset
    tipX = right
    tipY = arrowOffset
    baseA = arrowOffset - ah
    baseB = arrowOffset + ah
  }

  const rr = Math.min(
    r,
    Math.max(0, (bodyRight - bodyLeft) / 2),
    Math.max(0, (bodyBottom - bodyTop) / 2),
  )

  const f = (n: number) => Number(n.toFixed(2))
  const parts: string[] = []

  if (arrow === 'bottom') {
    parts.push(`M ${f(bodyLeft + rr)} ${f(bodyTop)}`)
    parts.push(`L ${f(bodyRight - rr)} ${f(bodyTop)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight)} ${f(bodyTop + rr)}`)
    parts.push(`L ${f(bodyRight)} ${f(bodyBottom - rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight - rr)} ${f(bodyBottom)}`)
    parts.push(`L ${f(baseB)} ${f(bodyBottom)}`)
    parts.push(`L ${f(tipX)} ${f(tipY)}`)
    parts.push(`L ${f(baseA)} ${f(bodyBottom)}`)
    parts.push(`L ${f(bodyLeft + rr)} ${f(bodyBottom)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft)} ${f(bodyBottom - rr)}`)
    parts.push(`L ${f(bodyLeft)} ${f(bodyTop + rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft + rr)} ${f(bodyTop)}`)
  } else if (arrow === 'top') {
    parts.push(`M ${f(bodyLeft + rr)} ${f(bodyTop)}`)
    parts.push(`L ${f(baseA)} ${f(bodyTop)}`)
    parts.push(`L ${f(tipX)} ${f(tipY)}`)
    parts.push(`L ${f(baseB)} ${f(bodyTop)}`)
    parts.push(`L ${f(bodyRight - rr)} ${f(bodyTop)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight)} ${f(bodyTop + rr)}`)
    parts.push(`L ${f(bodyRight)} ${f(bodyBottom - rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight - rr)} ${f(bodyBottom)}`)
    parts.push(`L ${f(bodyLeft + rr)} ${f(bodyBottom)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft)} ${f(bodyBottom - rr)}`)
    parts.push(`L ${f(bodyLeft)} ${f(bodyTop + rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft + rr)} ${f(bodyTop)}`)
  } else if (arrow === 'left') {
    parts.push(`M ${f(bodyLeft + rr)} ${f(bodyTop)}`)
    parts.push(`L ${f(bodyRight - rr)} ${f(bodyTop)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight)} ${f(bodyTop + rr)}`)
    parts.push(`L ${f(bodyRight)} ${f(bodyBottom - rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight - rr)} ${f(bodyBottom)}`)
    parts.push(`L ${f(bodyLeft + rr)} ${f(bodyBottom)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft)} ${f(bodyBottom - rr)}`)
    parts.push(`L ${f(bodyLeft)} ${f(baseB)}`)
    parts.push(`L ${f(tipX)} ${f(tipY)}`)
    parts.push(`L ${f(bodyLeft)} ${f(baseA)}`)
    parts.push(`L ${f(bodyLeft)} ${f(bodyTop + rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft + rr)} ${f(bodyTop)}`)
  } else {
    parts.push(`M ${f(bodyLeft + rr)} ${f(bodyTop)}`)
    parts.push(`L ${f(bodyRight - rr)} ${f(bodyTop)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight)} ${f(bodyTop + rr)}`)
    parts.push(`L ${f(bodyRight)} ${f(baseA)}`)
    parts.push(`L ${f(tipX)} ${f(tipY)}`)
    parts.push(`L ${f(bodyRight)} ${f(baseB)}`)
    parts.push(`L ${f(bodyRight)} ${f(bodyBottom - rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyRight - rr)} ${f(bodyBottom)}`)
    parts.push(`L ${f(bodyLeft + rr)} ${f(bodyBottom)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft)} ${f(bodyBottom - rr)}`)
    parts.push(`L ${f(bodyLeft)} ${f(bodyTop + rr)}`)
    parts.push(`A ${f(rr)} ${f(rr)} 0 0 1 ${f(bodyLeft + rr)} ${f(bodyTop)}`)
  }

  parts.push('Z')
  return parts.join(' ')
}

type AnchoredPanelPosition = {
  top: number
  left: number
  arrow: ArrowSide
  /** 箭头中心相对面板：上下箭头为距左，左右箭头为距顶 */
  arrowOffset: number
}

function clampArrowOffset(offset: number, span: number): number {
  return Math.min(Math.max(offset, ARROW_EDGE_PAD), Math.max(ARROW_EDGE_PAD, span - ARROW_EDGE_PAD))
}

function positionBeside(
  anchor: DOMRect,
  panelWidth: number,
  panelHeight: number,
  preferRight = true,
): AnchoredPanelPosition {
  const padding = FLOATING_PANEL_VIEWPORT_PADDING
  const gap = PICKER_PANEL_GAP
  const maxLeft = window.innerWidth - panelWidth - padding
  const maxTop = window.innerHeight - panelHeight - padding

  const rightLeft = anchor.right + gap
  const leftLeft = anchor.left - panelWidth - gap
  let left: number
  let arrow: ArrowSide
  if (preferRight) {
    if (rightLeft + panelWidth <= window.innerWidth - padding) {
      left = rightLeft
      arrow = 'left'
    } else {
      left = leftLeft
      arrow = 'right'
    }
  } else if (leftLeft >= padding) {
    left = leftLeft
    arrow = 'right'
  } else {
    left = rightLeft
    arrow = 'left'
  }

  let top = anchor.top
  if (top > maxTop) top = Math.max(padding, maxTop)
  if (top < padding) top = padding

  left = Math.min(Math.max(left, padding), Math.max(padding, maxLeft))
  const arrowOffset = clampArrowOffset(
    anchor.top + anchor.height / 2 - top,
    panelHeight,
  )
  return { top, left, arrow, arrowOffset }
}

function positionMainPanel(
  trigger: DOMRect,
  panelWidth: number,
  panelHeight: number,
): AnchoredPanelPosition {
  const padding = FLOATING_PANEL_VIEWPORT_PADDING
  const maxLeft = window.innerWidth - panelWidth - padding
  const maxTop = window.innerHeight - panelHeight - padding

  let top = trigger.bottom + PICKER_PANEL_GAP
  let left = trigger.left
  let arrow: ArrowSide = 'top'

  if (top > maxTop) {
    const aboveTop = trigger.top - panelHeight - PICKER_PANEL_GAP
    if (aboveTop >= padding) {
      top = aboveTop
      arrow = 'bottom'
    } else {
      top = Math.max(padding, maxTop)
    }
  }

  left = Math.min(Math.max(left, padding), Math.max(padding, maxLeft))
  const arrowOffset = clampArrowOffset(
    trigger.left + trigger.width / 2 - left,
    panelWidth,
  )
  return { top, left, arrow, arrowOffset }
}

function arrowStyle(position: AnchoredPanelPosition): Record<string, string> {
  return {
    top: `${position.top}px`,
    left: `${position.left}px`,
    '--picker-arrow-size': `${PICKER_ARROW_SIZE}px`,
  }
}

function PickerBubbleShell({
  panelRef,
  className,
  arrow,
  position,
  role,
  ariaLabel,
  onMouseEnter,
  children,
}: {
  panelRef?: RefObject<HTMLDivElement>
  className: string
  arrow: ArrowSide
  position: AnchoredPanelPosition
  role?: 'listbox'
  ariaLabel?: string
  onMouseEnter?: () => void
  children: ComponentChildren
}) {
  const chromeRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  const setShellRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (panelRef) {
        ;(panelRef as { current: HTMLDivElement | null }).current = node
      }
    },
    [panelRef],
  )

  useLayoutEffect(() => {
    const el = chromeRef.current
    if (!el) return
    const measure = () => {
      setBox({ width: el.offsetWidth, height: el.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [arrow, position.arrowOffset])

  const shapePath = bubbleClipPath(
    box.width,
    box.height,
    arrow,
    position.arrowOffset,
    0,
  )

  return (
    <div
      ref={setShellRef}
      class={`${className} vscode-ai-model-picker__shell--arrow-${arrow}`}
      style={arrowStyle(position)}
      role={role}
      aria-label={ariaLabel}
      onMouseEnter={onMouseEnter}
    >
      <div
        ref={chromeRef}
        class="vscode-ai-model-picker__chrome"
        style={shapePath ? { clipPath: `path('${shapePath}')` } : undefined}
      >
        <div class="vscode-ai-model-picker__face">{children}</div>
      </div>
      {shapePath && box.width > 0 && box.height > 0 ? (
        <svg
          class="vscode-ai-model-picker__stroke"
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={shapePath}
            fill="none"
            stroke="currentColor"
            stroke-width={PICKER_BORDER_INSET}
            stroke-linejoin="round"
          />
        </svg>
      ) : undefined}
    </div>
  )
}

function EditPencilIcon() {
  return (
    <svg
      class="vscode-ai-model-picker__edit-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fill-opacity="0.28"
        d="M10.9 2.7c.5-.5 1.3-.5 1.8 0l.6.6c.5.5.5 1.3 0 1.8L6.6 11.8l-2.4.6.6-2.4L10.9 2.7Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M10.9 2.7c.5-.5 1.3-.5 1.8 0l.6.6c.5.5.5 1.3 0 1.8L6.6 11.8l-2.4.6.6-2.4L10.9 2.7Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        d="M2.25 13.5h11.5"
      />
    </svg>
  )
}

function modelMatchesQuery(model: FlatEnabledModel, query: string): boolean {
  if (!query) return true
  const haystack = `${labelForVscodeAiModel(model)} ${model.modelId}`.toLowerCase()
  return haystack.includes(query)
}

export type VscodeAiModelPickerProps = {
  label: string
  value: string
  models: readonly FlatEnabledModel[]
  onChange: (modelKey: string) => void
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  disabled?: boolean
  dark?: boolean
  presentation?: 'composer' | 'form'
  fieldClass?: string
  labelClass?: string
  ariaLabel?: string
  children?: (props: {
    open: boolean
    setOpen: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement>
    displayValue: string
    disabled?: boolean
  }) => ComponentChildren
}

export function VscodeAiModelPicker({
  label,
  value,
  models,
  onChange,
  aiModelOptions,
  onAiModelOptionsChange,
  disabled,
  dark,
  presentation = 'composer',
  fieldClass,
  labelClass,
  ariaLabel,
  children,
}: VscodeAiModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredKey, setHoveredKey] = useState<string | undefined>()
  const [editKey, setEditKey] = useState<string | undefined>()
  const [mainPosition, setMainPosition] = useState<AnchoredPanelPosition>({
    top: 0,
    left: 0,
    arrow: 'bottom',
    arrowOffset: 24,
  })
  const [tipPosition, setTipPosition] = useState<AnchoredPanelPosition>({
    top: 0,
    left: 0,
    arrow: 'left',
    arrowOffset: 24,
  })
  const [editPosition, setEditPosition] = useState<AnchoredPanelPosition>({
    top: 0,
    left: 0,
    arrow: 'left',
    arrowOffset: 24,
  })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const editPanelRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const searchRef = useRef<HTMLInputElement>(null)

  const modelByKey = useMemo(() => {
    const map = new Map<string, FlatEnabledModel>()
    for (const model of models) {
      map.set(
        formatVscodeAiModelRefKey({
          providerEntryId: model.providerEntryId,
          modelId: model.modelId,
        }),
        model,
      )
    }
    return map
  }, [models])

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return models.filter((model) => modelMatchesQuery(model, normalized))
  }, [models, query])

  const selectedModel = modelByKey.get(value)
  const displayValue = selectedModel
    ? labelForVscodeAiModel(selectedModel)
    : value || '未配置文本模型'

  const hoveredModel = hoveredKey ? modelByKey.get(hoveredKey) : undefined
  const editModel = editKey ? modelByKey.get(editKey) : undefined
  const showTip = open && !!hoveredModel && !editKey

  const updateMainPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const panel = panelRef.current
    const measured = panel?.getBoundingClientRect()
    const panelWidth = measured && measured.width > 0 ? measured.width : MAIN_PANEL_WIDTH
    const panelHeight =
      measured && measured.height > 0 ? measured.height : MAIN_PANEL_FALLBACK_HEIGHT
    setMainPosition(positionMainPanel(trigger.getBoundingClientRect(), panelWidth, panelHeight))
  }, [])

  const updateSidePositions = useCallback(() => {
    const main = panelRef.current?.getBoundingClientRect()
    if (!main) return

    if (hoveredKey && !editKey) {
      const row = rowRefs.current.get(hoveredKey)
      const tip = tipRef.current?.getBoundingClientRect()
      const tipWidth = tip && tip.width > 0 ? tip.width : TIP_WIDTH
      const tipHeight = tip && tip.height > 0 ? tip.height : TIP_FALLBACK_HEIGHT
      const anchor = row?.getBoundingClientRect() ?? main
      setTipPosition(positionBeside(anchor, tipWidth, tipHeight, true))
    }

    if (editKey) {
      const row = rowRefs.current.get(editKey)
      const edit = editPanelRef.current?.getBoundingClientRect()
      const editWidth = edit && edit.width > 0 ? edit.width : EDIT_WIDTH
      const editHeight = edit && edit.height > 0 ? edit.height : EDIT_FALLBACK_HEIGHT
      const anchor = row?.getBoundingClientRect() ?? main
      setEditPosition(positionBeside(anchor, editWidth, editHeight, true))
    }
  }, [editKey, hoveredKey])

  useLayoutEffect(() => {
    if (!open) return
    updateMainPosition()
    const frame = window.requestAnimationFrame(() => {
      updateMainPosition()
      updateSidePositions()
    })
    window.addEventListener('resize', updateMainPosition)
    document.addEventListener('scroll', updateMainPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateMainPosition)
      document.removeEventListener('scroll', updateMainPosition, true)
    }
  }, [open, updateMainPosition, updateSidePositions, filteredModels.length])

  useLayoutEffect(() => {
    if (!open) return
    updateSidePositions()
    const frame = window.requestAnimationFrame(updateSidePositions)
    return () => window.cancelAnimationFrame(frame)
  }, [open, hoveredKey, editKey, updateSidePositions, aiModelOptions])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHoveredKey(undefined)
      setEditKey(undefined)
      return
    }
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      if (tipRef.current?.contains(target)) return
      if (editPanelRef.current?.contains(target)) return
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editKey) {
          setEditKey(undefined)
          return
        }
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, editKey])

  const setThinkingForKey = (modelKey: string, thinkingEnabled: boolean) => {
    const next = { ...aiModelOptions }
    const current = next[modelKey] ?? {}
    next[modelKey] = { ...current, thinkingEnabled }
    onAiModelOptionsChange(next)
  }

  const handleSelect = (modelKey: string) => {
    onChange(modelKey)
    setOpen(false)
  }

  const darkClass = dark ? ' vscode-ai-model-picker__panel--dark' : ''
  const tipDarkClass = dark ? ' vscode-ai-model-picker__tip--dark' : ''
  const editDarkClass = dark ? ' vscode-ai-model-picker__edit-panel--dark' : ''

  const floating = open
    ? createPortal(
        <>
          <PickerBubbleShell
            panelRef={panelRef}
            className={`vscode-ai-model-picker__panel${darkClass}`}
            arrow={mainPosition.arrow}
            position={mainPosition}
            role="listbox"
            ariaLabel={ariaLabel ?? label}
          >
            <div class="vscode-ai-model-picker__search-wrap">
              <input
                ref={searchRef}
                type="search"
                class="vscode-ai-model-picker__search"
                placeholder="搜索模型"
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="vscode-ai-model-picker__list">
              {filteredModels.length === 0 ? (
                <div class="vscode-ai-model-picker__empty">无匹配模型</div>
              ) : (
                filteredModels.map((model) => {
                  const key = formatVscodeAiModelRefKey({
                    providerEntryId: model.providerEntryId,
                    modelId: model.modelId,
                  })
                  const parts = displayPartsForVscodeAiModel(model, aiModelOptions)
                  const selected = key === value
                  const editing = key === editKey
                  const hot = !editing && key === hoveredKey
                  return (
                    <div
                      key={key}
                      ref={(node) => {
                        if (node) rowRefs.current.set(key, node)
                        else rowRefs.current.delete(key)
                      }}
                      role="option"
                      aria-selected={selected}
                      class={`vscode-ai-model-picker__item${hot ? ' vscode-ai-model-picker__item--hot' : ''}${editing ? ' vscode-ai-model-picker__item--editing' : ''}`}
                      onMouseEnter={() => setHoveredKey(key)}
                    >
                      <button
                        type="button"
                        class="vscode-ai-model-picker__item-select"
                        onFocus={() => setHoveredKey(key)}
                        onClick={() => handleSelect(key)}
                      >
                        {selected ? (
                          <span class="vscode-ai-model-picker__check" aria-hidden="true">
                            ✓
                          </span>
                        ) : undefined}
                        <span class="vscode-ai-model-picker__item-text">
                          <span class="vscode-ai-model-picker__item-primary">{parts.primary}</span>
                          {parts.secondary ? (
                            <span class="vscode-ai-model-picker__item-secondary">
                              {parts.secondary}
                            </span>
                          ) : undefined}
                        </span>
                      </button>
                      <span class="vscode-ai-model-picker__item-actions">
                        <button
                          type="button"
                          class={`vscode-ai-model-picker__edit${editKey === key ? ' vscode-ai-model-picker__edit--open' : ''}`}
                          aria-label="编辑"
                          title="编辑"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setEditKey((current) => (current === key ? undefined : key))
                            setHoveredKey(key)
                          }}
                        >
                          <EditPencilIcon />
                        </button>
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </PickerBubbleShell>

          {showTip && hoveredModel ? (
            <PickerBubbleShell
              panelRef={tipRef}
              className={`vscode-ai-model-picker__tip${tipDarkClass}`}
              arrow={tipPosition.arrow}
              position={tipPosition}
            >
              <p class="vscode-ai-model-picker__tip-title">
                {labelForVscodeAiModel(hoveredModel)}
              </p>
              <p class="vscode-ai-model-picker__tip-body">
                {describeVscodeAiModel(hoveredModel)}
              </p>
              <p class="vscode-ai-model-picker__tip-meta">
                {formatVscodeAiModelContextLabel(hoveredModel)}
              </p>
            </PickerBubbleShell>
          ) : undefined}

          {editModel && editKey ? (
            <PickerBubbleShell
              panelRef={editPanelRef}
              className={`vscode-ai-model-picker__edit-panel${editDarkClass}`}
              arrow={editPosition.arrow}
              position={editPosition}
              onMouseEnter={() => setHoveredKey(editKey)}
            >
              {supportsThinkingParam(editModel.providerId, editModel.modelId) ? (
                <>
                  <div class="vscode-ai-model-picker__edit-section-label">选项</div>
                  <div class="vscode-ai-model-picker__edit-row">
                    <span class="vscode-ai-model-picker__edit-row-label">深度思考</span>
                    <IosSwitch
                      label="深度思考"
                      checked={resolveVscodeAiThinkingEnabledForModelKey(
                        editKey,
                        aiModelOptions,
                      )}
                      onChange={(checked) => setThinkingForKey(editKey, checked)}
                    />
                  </div>
                </>
              ) : undefined}
              {(() => {
                const pair = resolveVscodeAiFastPair(editModel, models)
                if (!pair) return undefined
                const fastOn = editKey === pair.fastKey
                return (
                  <>
                    {!supportsThinkingParam(editModel.providerId, editModel.modelId) ? (
                      <div class="vscode-ai-model-picker__edit-section-label">选项</div>
                    ) : undefined}
                    <div class="vscode-ai-model-picker__edit-row">
                      <span class="vscode-ai-model-picker__edit-row-label">极速</span>
                      <IosSwitch
                        label="极速"
                        checked={fastOn}
                        onChange={(checked) => {
                          const nextKey = checked ? pair.fastKey : pair.baseKey
                          onChange(nextKey)
                          setEditKey(nextKey)
                          setHoveredKey(nextKey)
                        }}
                      />
                    </div>
                  </>
                )
              })()}
              {!supportsThinkingParam(editModel.providerId, editModel.modelId) &&
              !resolveVscodeAiFastPair(editModel, models) ? (
                <div class="vscode-ai-model-picker__empty">无可调选项</div>
              ) : undefined}
            </PickerBubbleShell>
          ) : undefined}
        </>,
        getFloatingOverlayRoot(),
      )
    : undefined

  const triggerProps = {
    open,
    setOpen: (next: boolean) => {
      if (disabled) return
      setOpen(next)
    },
    triggerRef,
    displayValue,
    disabled,
  }

  if (children) {
    return (
      <>
        {children(triggerProps)}
        {floating}
      </>
    )
  }

  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      class={`vscode-ai-model-picker__trigger${open ? ' vscode-ai-model-picker__trigger--open' : ''}${dark ? ' vscode-ai-model-picker__trigger--dark' : ''}`}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel ?? label}
      onClick={() => {
        if (disabled) return
        setOpen((current) => !current)
      }}
    >
      <span class="vscode-ai-model-picker__trigger-label">{displayValue}</span>
    </button>
  )

  if (presentation === 'form') {
    return (
      <div class={fieldClass ?? 'vscode-ai-model-picker__field'}>
        <span class={labelClass ?? 'vscode-ai-model-picker__field-label'}>{label}</span>
        <div class="vscode-ai-model-picker">
          {triggerButton}
          {floating}
        </div>
      </div>
    )
  }

  return (
    <div class="vscode-ai-model-picker">
      {triggerButton}
      {floating}
    </div>
  )
}
