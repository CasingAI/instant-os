import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, RefObject } from 'preact'
import { createPortal } from 'preact/compat'
import { supportsThinkingParam } from '../../ai/ai-thinking.ts'
import type { FlatEnabledModel } from '../../ai/ai-providers.ts'
import { FLOATING_PANEL_VIEWPORT_PADDING } from '../../ui/compute-floating-panel-position.ts'
import { getFloatingOverlayRoot } from '../../ui/floating-overlay-root.ts'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { PopoverNavHeader } from '../../ui/popover-nav-header.tsx'
import { PopoverNavRow } from '../../ui/popover-nav-row.tsx'
import {
  PopoverNavStack,
  usePopoverNavStack,
} from '../../ui/popover-nav-stack.tsx'
import {
  describeVscodeAiModel,
  displayPartsForVscodeAiModel,
  formatVscodeAiContextWindowPrefLabel,
  formatVscodeAiModelContextLabel,
  formatVscodeAiThinkingEffortPrefLabel,
  labelForVscodeAiModelProvider,
  listVscodeAiContextWindowPrefOptions,
  listVscodeAiThinkingEffortPrefOptions,
  resolveVscodeAiFastPair,
  resolveVscodeAiSystemContextWindow,
  shouldShowVscodeAiThinkingEffortPicker,
} from './vscode-ai-model-display.ts'
import {
  formatVscodeAiModelRefKey,
  isVscodeModelCapabilityValue,
  labelForVscodeAiModel,
  resolveVscodeAiContextWindowPrefForModelKey,
  resolveVscodeAiThinkingEffortPrefForModelKey,
  resolveVscodeAiThinkingEnabledForModelKey,
  resolveVscodeCapabilityPickerModelKey,
  tagsForVscodeAiModelKey,
  type VscodeAiCapabilityTags,
} from './vscode-ai-models.ts'
import {
  filterVscodeAiModelPickerPins,
  filterVscodeAiModelsByQuery,
  labelForVscodeModelPickerDisplay,
  listVscodeAiModelCapabilityPins,
  withVscodeAiContextWindow,
  withVscodeAiThinkingEffort,
  withVscodeAiThinkingEnabled,
} from './vscode-ai-model-picker-data.ts'
import type {
  VscodeAiContextWindowPref,
  VscodeAiModelOptionPrefs,
  VscodeAiThinkingEffortPref,
} from './vscode-prefs.ts'
import './vscode-ai-model-picker.css'

const MAIN_PANEL_WIDTH = 280
const MAIN_PANEL_FALLBACK_HEIGHT = 220
const TIP_WIDTH = 248
const TIP_FALLBACK_HEIGHT = 110
const EDIT_WIDTH = 208
const EDIT_FALLBACK_HEIGHT = 220
const ARROW_EDGE_PAD = 14
/** 与 CSS --picker-arrow-size 一致；箭头计入壳尺寸，尖端与锚点间距 1px */
const PICKER_ARROW_SIZE = 8
const PICKER_ARROW_HALF = 6
const PICKER_RADIUS = 8
const PICKER_BORDER_INSET = 1
const PICKER_PANEL_GAP = 1

type EditNavPage = 'root' | 'context' | 'thinking'

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
  onPointerDown,
  children,
}: {
  panelRef?: RefObject<HTMLDivElement>
  className: string
  arrow: ArrowSide
  position: AnchoredPanelPosition
  role?: 'listbox'
  ariaLabel?: string
  onMouseEnter?: () => void
  onPointerDown?: (event: PointerEvent) => void
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
      onPointerDown={onPointerDown}
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

export type VscodeAiModelPickerProps = {
  label: string
  value: string
  models: readonly FlatEnabledModel[]
  onChange: (modelKey: string) => void
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  /** 传入时在列表项显示「基座」「副基座」标签 */
  capabilityTags?: VscodeAiCapabilityTags
  /**
   * agent / completion：列表顶部均插入副基座/基座快捷项；
   * 值为 encodeVscodeModelPickerValue 结果。
   */
  selectionMode?: 'agent' | 'completion'
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
  capabilityTags,
  selectionMode = 'agent',
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
  /** 实际模型键，用于读写 aiModelOptions */
  const [editKey, setEditKey] = useState<string | undefined>()
  /** DOM 锚点行 id（快捷项为 @capability:…，列表为 modelKey） */
  const [editRowKey, setEditRowKey] = useState<string | undefined>()
  const {
    page: editNavPage,
    transition: editNavTransition,
    canPop: editNavCanPop,
    push: pushEditNav,
    pop: popEditNav,
    reset: resetEditNav,
    finishTransition: finishEditNavTransition,
  } = usePopoverNavStack<EditNavPage>('root')
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
    return filterVscodeAiModelsByQuery(models, query)
  }, [models, query])

  const displayValue = labelForVscodeModelPickerDisplay(value, models, selectionMode)

  const completionPinned = useMemo(
    () => listVscodeAiModelCapabilityPins(selectionMode),
    [selectionMode],
  )

  const visiblePinned = useMemo(
    () => filterVscodeAiModelPickerPins(completionPinned, query),
    [completionPinned, query],
  )

  const hoveredModel = (() => {
    if (!hoveredKey) return undefined
    const key = isVscodeModelCapabilityValue(hoveredKey)
      ? resolveVscodeCapabilityPickerModelKey(hoveredKey)
      : hoveredKey
    return key ? modelByKey.get(key) : undefined
  })()
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
      const row = rowRefs.current.get(editRowKey ?? editKey)
      const edit = editPanelRef.current?.getBoundingClientRect()
      const editWidth = edit && edit.width > 0 ? edit.width : EDIT_WIDTH
      const editHeight = edit && edit.height > 0 ? edit.height : EDIT_FALLBACK_HEIGHT
      const anchor = row?.getBoundingClientRect() ?? main
      setEditPosition(positionBeside(anchor, editWidth, editHeight, true))
    }
  }, [editKey, editRowKey, hoveredKey])

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
  }, [open, hoveredKey, editKey, editRowKey, updateSidePositions, aiModelOptions, editNavPage, editNavTransition])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHoveredKey(undefined)
      setEditKey(undefined)
      setEditRowKey(undefined)
      resetEditNav()
      return
    }
    setHoveredKey(value || undefined)
    const selectedKey = value
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus()
      rowRefs.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
    // 仅在打开瞬间滚到当前选中项；勿依赖 value/hover，否则滚动会被反复拽回
  }, [open, resetEditNav])

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
          if (editNavCanPop && popEditNav()) return
          setEditKey(undefined)
          setEditRowKey(undefined)
          resetEditNav()
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
  }, [open, editKey, editNavCanPop, popEditNav, resetEditNav])

  const clearEdit = () => {
    setEditKey(undefined)
    setEditRowKey(undefined)
    resetEditNav()
  }

  const toggleEdit = (modelKey: string, rowKey: string) => {
    if (editKey === modelKey && editRowKey === rowKey) {
      clearEdit()
      return
    }
    resetEditNav()
    setEditKey(modelKey)
    setEditRowKey(rowKey)
  }

  const setThinkingForKey = (modelKey: string, thinkingEnabled: boolean) => {
    onAiModelOptionsChange(
      withVscodeAiThinkingEnabled(aiModelOptions, modelKey, thinkingEnabled),
    )
  }

  const setThinkingEffortForKey = (
    modelKey: string,
    thinkingEffort: VscodeAiThinkingEffortPref,
  ) => {
    onAiModelOptionsChange(
      withVscodeAiThinkingEffort(aiModelOptions, modelKey, thinkingEffort),
    )
  }

  const setContextWindowForKey = (
    modelKey: string,
    contextWindow: VscodeAiContextWindowPref,
  ) => {
    onAiModelOptionsChange(
      withVscodeAiContextWindow(aiModelOptions, modelKey, contextWindow),
    )
  }

  const handleSelect = (modelKey: string) => {
    onChange(modelKey)
    setOpen(false)
  }

  const handleEditFocusPointerDown = (event: PointerEvent) => {
    if (!editKey) return
    const target = event.target as Node
    const editingRow = rowRefs.current.get(editRowKey ?? editKey)
    if (editingRow?.contains(target)) return
    clearEdit()
  }

  const darkClass = dark ? ' vscode-ai-model-picker__panel--dark' : ''
  const tipDarkClass = dark ? ' vscode-ai-model-picker__tip--dark' : ''
  const editDarkClass = dark ? ' vscode-ai-model-picker__edit-panel--dark' : ''

  const floating = open
    ? createPortal(
        <>
          <PickerBubbleShell
            panelRef={panelRef}
            className={`vscode-ai-model-picker__panel${darkClass}${editKey ? ' vscode-ai-model-picker__panel--edit-focus' : ''}`}
            arrow={mainPosition.arrow}
            position={mainPosition}
            role="listbox"
            ariaLabel={ariaLabel ?? label}
            onPointerDown={handleEditFocusPointerDown}
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
            <div
              class="vscode-ai-model-picker__list"
              onWheel={(event) => {
                if (!editKey) return
                event.preventDefault()
              }}
            >
              {visiblePinned.map((item) => {
                const selected = item.key === value
                const resolvedKey = resolveVscodeCapabilityPickerModelKey(item.key)
                const resolvedModel = resolvedKey ? modelByKey.get(resolvedKey) : undefined
                const parts = resolvedModel
                  ? displayPartsForVscodeAiModel(resolvedModel, aiModelOptions)
                  : undefined
                const editing = editRowKey === item.key
                const hot = !editing && item.key === hoveredKey
                return (
                  <div
                    key={item.key}
                    ref={(node) => {
                      if (node) rowRefs.current.set(item.key, node)
                      else rowRefs.current.delete(item.key)
                    }}
                    role="option"
                    aria-selected={selected}
                    class={`vscode-ai-model-picker__item${hot ? ' vscode-ai-model-picker__item--hot' : ''}${editing ? ' vscode-ai-model-picker__item--editing' : ''}`}
                    onMouseEnter={() => setHoveredKey(item.key)}
                  >
                    <button
                      type="button"
                      class="vscode-ai-model-picker__item-select"
                      onFocus={() => setHoveredKey(item.key)}
                      onClick={() => handleSelect(item.key)}
                    >
                      {selected ? (
                        <span class="vscode-ai-model-picker__check" aria-hidden="true">
                          ✓
                        </span>
                      ) : undefined}
                      <span class="vscode-ai-model-picker__item-text vscode-ai-model-picker__item-text--stacked">
                        <span class="vscode-ai-model-picker__item-primary-row">
                          <span class="vscode-ai-model-picker__item-primary">
                            {item.primary}
                          </span>
                          <span
                            class={`vscode-ai-model-picker__capability-tag${item.tag === '副基座' ? ' vscode-ai-model-picker__capability-tag--secondary' : ''}`}
                          >
                            {item.tag}
                          </span>
                          {parts?.configBits && parts.configBits.length > 0 ? (
                            <span class="vscode-ai-model-picker__item-config">
                              {parts.configBits.join(' · ')}
                            </span>
                          ) : undefined}
                        </span>
                        {item.secondary ? (
                          <span class="vscode-ai-model-picker__item-secondary vscode-ai-model-picker__item-secondary--below">
                            {item.secondary}
                          </span>
                        ) : undefined}
                      </span>
                    </button>
                    {resolvedKey && resolvedModel ? (
                      <span class="vscode-ai-model-picker__item-actions">
                        <button
                          type="button"
                          class={`vscode-ai-model-picker__edit${editing ? ' vscode-ai-model-picker__edit--open' : ''}`}
                          aria-label="编辑"
                          title="编辑"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggleEdit(resolvedKey, item.key)
                            setHoveredKey(item.key)
                          }}
                        >
                          <EditPencilIcon />
                        </button>
                      </span>
                    ) : undefined}
                  </div>
                )
              })}
              {visiblePinned.length > 0 && filteredModels.length > 0 ? (
                <div class="vscode-ai-model-picker__list-divider" aria-hidden="true" />
              ) : undefined}
              {filteredModels.length === 0 && visiblePinned.length === 0 ? (
                <div class="vscode-ai-model-picker__empty">无匹配模型</div>
              ) : (
                filteredModels.map((model) => {
                  const key = formatVscodeAiModelRefKey({
                    providerEntryId: model.providerEntryId,
                    modelId: model.modelId,
                  })
                  const parts = displayPartsForVscodeAiModel(model, aiModelOptions)
                  const capabilityLabels = capabilityTags
                    ? tagsForVscodeAiModelKey(key, capabilityTags)
                    : []
                  const selected = key === value
                  const editing = editRowKey === key
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
                        <span class="vscode-ai-model-picker__item-text vscode-ai-model-picker__item-text--stacked">
                          <span class="vscode-ai-model-picker__item-primary-row">
                            <span class="vscode-ai-model-picker__item-primary">{parts.primary}</span>
                            {capabilityLabels.map((tag) => (
                              <span
                                key={tag}
                                class={`vscode-ai-model-picker__capability-tag${tag === '副基座' ? ' vscode-ai-model-picker__capability-tag--secondary' : ''}`}
                              >
                                {tag}
                              </span>
                            ))}
                            {parts.configBits && parts.configBits.length > 0 ? (
                              <span class="vscode-ai-model-picker__item-config">
                                {parts.configBits.join(' · ')}
                              </span>
                            ) : undefined}
                          </span>
                          <span class="vscode-ai-model-picker__item-secondary vscode-ai-model-picker__item-secondary--below">
                            {labelForVscodeAiModelProvider(model)}
                          </span>
                        </span>
                      </button>
                      <span class="vscode-ai-model-picker__item-actions">
                        <button
                          type="button"
                          class={`vscode-ai-model-picker__edit${editing ? ' vscode-ai-model-picker__edit--open' : ''}`}
                          aria-label="编辑"
                          title="编辑"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            toggleEdit(key, key)
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
                {labelForVscodeAiModelProvider(hoveredModel)}
              </p>
              <p class="vscode-ai-model-picker__tip-meta vscode-ai-model-picker__tip-meta--secondary">
                {formatVscodeAiModelContextLabel(hoveredModel, aiModelOptions)}
              </p>
            </PickerBubbleShell>
          ) : undefined}

          {editModel && editKey ? (
            <PickerBubbleShell
              panelRef={editPanelRef}
              className={`vscode-ai-model-picker__edit-panel${editDarkClass}`}
              arrow={editPosition.arrow}
              position={editPosition}
              onMouseEnter={() => setHoveredKey(editRowKey ?? editKey)}
            >
              <PopoverNavStack
                page={editNavPage}
                transition={editNavTransition}
                onTransitionEnd={finishEditNavTransition}
                dark={dark}
                renderPage={(page) => {
                  if (page === 'context') {
                    const current = resolveVscodeAiContextWindowPrefForModelKey(
                      editKey,
                      aiModelOptions,
                    )
                    const options = listVscodeAiContextWindowPrefOptions(
                      resolveVscodeAiSystemContextWindow(editModel),
                    )
                    return (
                      <>
                        <PopoverNavHeader
                          title="上下文长度"
                          backLabel="选项"
                          onBack={() => {
                            popEditNav()
                          }}
                          dark={dark}
                        />
                        {options.map((option) => {
                          const checked = current === option.value
                          return (
                            <button
                              key={String(option.value)}
                              type="button"
                              class={`vscode-ai-model-picker__edit-choice${checked ? ' vscode-ai-model-picker__edit-choice--checked' : ''}`}
                              onClick={() =>
                                setContextWindowForKey(editKey, option.value)
                              }
                            >
                              <span
                                class="vscode-ai-model-picker__edit-choice-check"
                                aria-hidden="true"
                              >
                                {checked ? '✓' : ''}
                              </span>
                              <span class="vscode-ai-model-picker__edit-choice-label">
                                {option.label}
                              </span>
                            </button>
                          )
                        })}
                      </>
                    )
                  }

                  if (page === 'thinking') {
                    const current = resolveVscodeAiThinkingEffortPrefForModelKey(
                      editKey,
                      aiModelOptions,
                    )
                    const options = listVscodeAiThinkingEffortPrefOptions(
                      editModel.providerId,
                      editModel.modelId,
                    )
                    return (
                      <>
                        <PopoverNavHeader
                          title="思考深度"
                          backLabel="选项"
                          onBack={() => {
                            popEditNav()
                          }}
                          dark={dark}
                        />
                        {options.map((option) => {
                          const checked = current === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              class={`vscode-ai-model-picker__edit-choice${checked ? ' vscode-ai-model-picker__edit-choice--checked' : ''}`}
                              onClick={() =>
                                setThinkingEffortForKey(editKey, option.value)
                              }
                            >
                              <span
                                class="vscode-ai-model-picker__edit-choice-check"
                                aria-hidden="true"
                              >
                                {checked ? '✓' : ''}
                              </span>
                              <span class="vscode-ai-model-picker__edit-choice-label">
                                {option.label}
                              </span>
                            </button>
                          )
                        })}
                      </>
                    )
                  }

                  const contextPref = resolveVscodeAiContextWindowPrefForModelKey(
                    editKey,
                    aiModelOptions,
                  )
                  const showThinking = supportsThinkingParam(
                    editModel.providerId,
                    editModel.modelId,
                  )
                  const thinkingOn =
                    showThinking &&
                    resolveVscodeAiThinkingEnabledForModelKey(
                      editKey,
                      aiModelOptions,
                    )
                  const thinkingEffort = resolveVscodeAiThinkingEffortPrefForModelKey(
                    editKey,
                    aiModelOptions,
                  )
                  const pair = resolveVscodeAiFastPair(editModel, models)
                  return (
                    <>
                      <PopoverNavHeader title="选项" dark={dark} />
                      <p class="vscode-ai-model-picker__edit-provider">
                        {labelForVscodeAiModelProvider(editModel)}
                      </p>
                      {showThinking ? (
                        <div class="vscode-ai-model-picker__edit-row">
                          <span class="vscode-ai-model-picker__edit-row-label">思考</span>
                          <IosSwitch
                            label="思考"
                            checked={thinkingOn}
                            onChange={(checked) => {
                              setThinkingForKey(editKey, checked)
                              if (!checked && editNavPage === 'thinking') {
                                popEditNav()
                              }
                            }}
                          />
                        </div>
                      ) : undefined}
                      {thinkingOn &&
                      shouldShowVscodeAiThinkingEffortPicker(
                        editModel.providerId,
                        editModel.modelId,
                      ) ? (
                        <div class="vscode-ai-model-picker__edit-nav-row">
                          <PopoverNavRow
                            label="思考深度"
                            value={formatVscodeAiThinkingEffortPrefLabel(
                              thinkingEffort,
                            )}
                            dark={dark}
                            onClick={() => pushEditNav('thinking')}
                          />
                        </div>
                      ) : undefined}
                      {pair ? (
                        <div
                          class={`vscode-ai-model-picker__edit-row${showThinking || thinkingOn ? ' vscode-ai-model-picker__edit-row--spaced' : ''}`}
                        >
                          <span class="vscode-ai-model-picker__edit-row-label">极速</span>
                          <IosSwitch
                            label="极速"
                            checked={editKey === pair.fastKey}
                            onChange={(checked) => {
                              const nextKey = checked ? pair.fastKey : pair.baseKey
                              onChange(nextKey)
                              setEditKey(nextKey)
                              if (
                                !editRowKey ||
                                !isVscodeModelCapabilityValue(editRowKey)
                              ) {
                                setEditRowKey(nextKey)
                              }
                              setHoveredKey(editRowKey ?? nextKey)
                            }}
                          />
                        </div>
                      ) : undefined}
                      <div class="vscode-ai-model-picker__edit-nav-row">
                        <PopoverNavRow
                          label="上下文长度"
                          value={formatVscodeAiContextWindowPrefLabel(
                            contextPref,
                            resolveVscodeAiSystemContextWindow(editModel),
                          )}
                          dark={dark}
                          onClick={() => pushEditNav('context')}
                        />
                      </div>
                    </>
                  )
                }}
              />
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
