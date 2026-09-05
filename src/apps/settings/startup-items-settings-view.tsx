import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { Switch } from '../../ui/switch.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { useStartupItemsShellHost } from '../../os/startup-items-host.ts'
import { runOneStartupItem } from '../../os/startup-items-service.ts'
import {
  createStartupItem,
  loadStartupItemsSettings,
  saveStartupItemsSettings,
  startupItemCommandPreview,
  startupItemDisplayLabel,
  subscribeStartupItemsSettings,
  type StartupItem,
} from '../../os/startup-items-settings-storage.ts'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'

type StartupItemsSettingsViewProps = {
  onBack: () => void
}

type RunStatus = {
  kind: 'running' | 'success' | 'error'
  message: string
}

const SAVE_ERROR_MESSAGE = '无法保存（存储空间可能已满）'

export function StartupItemsSettingsView({ onBack }: StartupItemsSettingsViewProps) {
  const host = useStartupItemsShellHost()
  const [items, setItems] = useState<StartupItem[]>(() => loadStartupItemsSettings().items)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState(false)
  const [runStatus, setRunStatus] = useState<RunStatus | undefined>(undefined)
  const [runBusy, setRunBusy] = useState(false)

  useEffect(() => {
    return subscribeStartupItemsSettings(() => {
      setItems(loadStartupItemsSettings().items)
    })
  }, [])

  const commit = (next: StartupItem[]): boolean => {
    setItems(next)
    if (!saveStartupItemsSettings({ version: 1, items: next })) {
      setSaveError(true)
      return false
    }
    setSaveError(false)
    return true
  }

  const updateItem = (id: string, patch: Partial<Omit<StartupItem, 'id'>>): void => {
    commit(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const handleAdd = () => {
    const item = createStartupItem({ enabled: true, label: '', command: '' })
    if (!commit([...items, item])) {
      return
    }
    setRunStatus(undefined)
    setEditingId(item.id)
  }

  const handleRemove = (id: string) => {
    if (!commit(items.filter((item) => item.id !== id))) {
      return
    }
    setRunStatus(undefined)
    setEditingId(undefined)
  }

  const handleReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return
    }
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    commit(next)
  }

  const handleRun = async (item: StartupItem) => {
    if (runBusy) {
      return
    }
    setRunBusy(true)
    setRunStatus({ kind: 'running', message: '正在执行…' })
    try {
      const result = await runOneStartupItem(item, host)
      if (result.ok) {
        setRunStatus({ kind: 'success', message: `已执行（${result.durationMs} ms）` })
        return
      }
      setRunStatus({ kind: 'error', message: result.error })
    } finally {
      setRunBusy(false)
    }
  }

  const editingItem = editingId ? items.find((item) => item.id === editingId) : undefined

  if (editingId) {
    if (!editingItem) {
      return (
        <div class="settings" data-settings-subpage>
          <div class="settings__nav">
            <IosNavBackButton
              label="启动项"
              onClick={() => {
                setRunStatus(undefined)
                setEditingId(undefined)
              }}
            />
          </div>
          <div class="settings__content settings__content--compact">
            <p class="settings__empty">未找到该启动项。</p>
          </div>
        </div>
      )
    }

    const canRun = editingItem.command.trim().length > 0 && !runBusy

    return (
      <div class="settings" data-settings-subpage>
        <div class="settings__nav">
          <IosNavBackButton
            label="启动项"
            onClick={() => {
              setRunStatus(undefined)
              setEditingId(undefined)
            }}
          />
        </div>
        <div class="settings__content settings__content--compact">
          <section class="settings__section">
            <h2 class="settings__section-title">{startupItemDisplayLabel(editingItem)}</h2>
            <div class="settings__list">
              <SettingsInlineInputRow
                label="名称"
                value={editingItem.label}
                placeholder="可选"
                onChange={(label) => updateItem(editingItem.id, { label })}
              />
              <SettingsSwitchRow
                label="启用"
                checked={editingItem.enabled}
                onChange={(enabled) => updateItem(editingItem.id, { enabled })}
              />
            </div>
          </section>

          <section class="settings__section">
            <h3 class="settings__section-title">命令</h3>
            <div class="settings__list">
              <div class="settings__startup-command-wrap">
                <textarea
                  class="settings__input settings__input--startup-command"
                  value={editingItem.command}
                  placeholder="await instant.openApp('files')"
                  autoComplete="off"
                  spellcheck={false}
                  rows={6}
                  aria-label="启动命令"
                  onInput={(event) =>
                    updateItem(editingItem.id, {
                      command: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
            </div>
            <p class="settings__section-footnote">
              语法与终端相同（JavaScript），可使用 <code>instant.openApp</code>、
              <code>instant.openPath</code> 等 API。空命令在启动时会跳过。
            </p>
          </section>

          <section class="settings__section">
            <div class="settings__list">
              <button
                type="button"
                class="settings__row settings__row--show-all"
                disabled={!canRun}
                onClick={() => void handleRun(editingItem)}
              >
                {runBusy ? '正在执行…' : '立即运行'}
              </button>
            </div>
            {runStatus ? (
              <p
                class={
                  runStatus.kind === 'error'
                    ? 'settings__section-footnote settings__form-status--error'
                    : runStatus.kind === 'success'
                      ? 'settings__section-footnote settings__form-status--ok'
                      : 'settings__section-footnote'
                }
                role="status"
              >
                {runStatus.message}
              </p>
            ) : undefined}
          </section>

          <section class="settings__section">
            <div class="settings__list">
              <button
                type="button"
                class="settings__row settings__row--show-all settings__row--destructive"
                onClick={() => handleRemove(editingItem.id)}
              >
                删除启动项
              </button>
            </div>
          </section>

          {saveError ? (
            <p class="settings__section-footnote settings__form-status--error">{SAVE_ERROR_MESSAGE}</p>
          ) : undefined}
        </div>
      </div>
    )
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">启动项</h2>
          <p class="settings__section-subtitle">桌面就绪后按列表顺序执行。</p>

          <div class="settings__list">
            {items.length === 0 ? (
              <div class="settings__row settings__row--static settings__startup-empty">
                暂无启动项
              </div>
            ) : (
              <StartupItemsReorderList
                items={items}
                onOpen={(id) => {
                  setRunStatus(undefined)
                  setEditingId(id)
                }}
                onToggle={(id, enabled) => updateItem(id, { enabled })}
                onReorder={handleReorder}
              />
            )}
          </div>
          {items.length > 1 ? (
            <p class="settings__section-footnote">拖拽左侧手柄调整顺序。</p>
          ) : undefined}
        </section>

        <section class="settings__section">
          <div class="settings__list">
            <button type="button" class="settings__row settings__row--show-all" onClick={handleAdd}>
              添加启动项
            </button>
          </div>
          <p class="settings__section-footnote">
            语法与终端相同（JavaScript），可使用 <code>instant.openApp</code>、
            <code>instant.openPath</code> 等 API。
          </p>
          {saveError ? (
            <p class="settings__section-footnote settings__form-status--error">{SAVE_ERROR_MESSAGE}</p>
          ) : undefined}
        </section>
      </div>
    </div>
  )
}

function StartupItemsReorderList({
  items,
  onOpen,
  onToggle,
  onReorder,
}: {
  items: StartupItem[]
  onOpen: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}) {
  const isDraggingRef = useRef(false)
  const preventClickRef = useRef(false)
  const dragIndexRef = useRef<number | undefined>(undefined)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined)
  const [gripActiveIndex, setGripActiveIndex] = useState<number | undefined>(undefined)

  const resolveHoverIndex = useCallback(
    (clientY: number): number => {
      for (let i = 0; i < items.length; i++) {
        const el = itemRefs.current.get(i)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (clientY < rect.top + rect.height / 2) {
          return i
        }
      }
      return Math.max(0, items.length - 1)
    },
    [items.length],
  )

  const finishReorder = useCallback(
    (fromIndex: number | undefined, toIndex: number | undefined) => {
      setDragIndex(undefined)
      setOverIndex(undefined)
      setGripActiveIndex(undefined)
      isDraggingRef.current = false
      dragIndexRef.current = undefined

      if (fromIndex === undefined || toIndex === undefined) return
      onReorder(fromIndex, toIndex)
    },
    [onReorder],
  )

  const handleGripPointerDown = useCallback(
    (index: number, event: PointerEvent) => {
      if (event.button !== 0) return

      event.preventDefault()
      event.stopPropagation()

      const grip = event.currentTarget as HTMLElement
      isDraggingRef.current = true
      preventClickRef.current = false
      dragIndexRef.current = index
      setDragIndex(index)
      setGripActiveIndex(index)
      grip.setPointerCapture(event.pointerId)

      const EDGE_PX = 48
      const MAX_SCROLL_STEP = 28
      let scrollRaf = 0
      let lastClientY = event.clientY

      const findScrollParent = (from: HTMLElement | null): HTMLElement | null => {
        let node: HTMLElement | null = from
        while (node) {
          const style = getComputedStyle(node)
          const overflowY = style.overflowY
          if (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            node.scrollHeight > node.clientHeight + 1
          ) {
            return node
          }
          node = node.parentElement
        }
        return null
      }
      const scrollParent = findScrollParent(grip)

      const tickAutoScroll = () => {
        scrollRaf = 0
        if (dragIndexRef.current === undefined || !scrollParent) return
        const rect = scrollParent.getBoundingClientRect()
        const y = lastClientY
        let delta = 0
        if (y < rect.top + EDGE_PX) {
          const t = Math.min(1, (rect.top + EDGE_PX - y) / EDGE_PX)
          delta = -Math.ceil(MAX_SCROLL_STEP * t)
        } else if (y > rect.bottom - EDGE_PX) {
          const t = Math.min(1, (y - (rect.bottom - EDGE_PX)) / EDGE_PX)
          delta = Math.ceil(MAX_SCROLL_STEP * t)
        }
        if (delta !== 0) {
          scrollParent.scrollTop += delta
          preventClickRef.current = true
          const nextOver = resolveHoverIndex(lastClientY)
          setOverIndex((prev) => (prev === nextOver ? prev : nextOver))
          scrollRaf = requestAnimationFrame(tickAutoScroll)
        }
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (dragIndexRef.current === undefined) return
        lastClientY = moveEvent.clientY
        const nextOver = resolveHoverIndex(moveEvent.clientY)
        setOverIndex((prev) => {
          if (prev !== nextOver) {
            preventClickRef.current = true
          }
          return nextOver
        })
        if (scrollParent && scrollRaf === 0) {
          const rect = scrollParent.getBoundingClientRect()
          const y = moveEvent.clientY
          if (y < rect.top + EDGE_PX || y > rect.bottom - EDGE_PX) {
            scrollRaf = requestAnimationFrame(tickAutoScroll)
          }
        }
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf)
        scrollRaf = 0
        grip.releasePointerCapture(endEvent.pointerId)
        grip.removeEventListener('pointermove', onPointerMove)
        grip.removeEventListener('pointerup', onPointerEnd)
        grip.removeEventListener('pointercancel', onPointerEnd)

        const fromIndex = dragIndexRef.current
        const toIndex =
          fromIndex === undefined ? undefined : resolveHoverIndex(endEvent.clientY)
        if (fromIndex !== undefined && toIndex !== undefined && fromIndex !== toIndex) {
          preventClickRef.current = true
        }
        finishReorder(fromIndex, toIndex)
      }

      grip.addEventListener('pointermove', onPointerMove)
      grip.addEventListener('pointerup', onPointerEnd)
      grip.addEventListener('pointercancel', onPointerEnd)
    },
    [finishReorder, resolveHoverIndex],
  )

  const handleOpenRow = useCallback(
    (id: string) => {
      if (isDraggingRef.current || preventClickRef.current) {
        preventClickRef.current = false
        return
      }
      onOpen(id)
    },
    [onOpen],
  )

  return (
    <div class={dragIndex !== undefined ? 'settings__list--startup-reordering' : undefined}>
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) {
              itemRefs.current.set(index, el)
            } else {
              itemRefs.current.delete(index)
            }
          }}
          class={`settings__startup-item-row${
            index === dragIndex ? ' settings__startup-item-row--dragging' : ''
          }${index === overIndex ? ' settings__startup-item-row--over' : ''}`}
          onClick={() => handleOpenRow(item.id)}
        >
          <div
            class={`settings__startup-grip${
              index === gripActiveIndex ? ' settings__startup-grip--active' : ''
            }`}
            aria-label="拖拽排序"
            onPointerDown={(event) => handleGripPointerDown(index, event)}
          >
            <span class="settings__startup-grip-line" />
            <span class="settings__startup-grip-line" />
            <span class="settings__startup-grip-line" />
          </div>
          <span class="settings__row-meta">
            <span class="settings__row-name">{startupItemDisplayLabel(item)}</span>
            <span class="settings__row-key-detail">{startupItemCommandPreview(item)}</span>
          </span>
          <div
            class="settings__startup-switch"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={item.enabled}
              onChange={(enabled) => onToggle(item.id, enabled)}
              label={`启用 ${startupItemDisplayLabel(item)}`}
            />
          </div>
          <SettingsDisclosureIcon />
        </div>
      ))}
    </div>
  )
}
