import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  formatVmBackendLabel,
  getVmBackend,
  vmPowerUnavailableMessage,
} from './virtual-machine-backends.ts'
import {
  defaultVirtualMachineSettings,
  formatVmDisplayModeLabel,
  formatVmMemoryLabel,
  settingsFromRecord,
} from './virtual-machine-config.ts'
import { virtualMachineHasBootMedia, vmMountedDiskSlots } from './virtual-machine-disks.ts'
import { listVmDiskStreamIds } from './virtual-machine-disk-stream-metrics.ts'
import { VirtualMachineActivity } from './virtual-machine-activity.tsx'
import { VirtualMachineInspectorOverlay } from './virtual-machine-inspector-overlay.tsx'
import {
  createVmClipboardSyncState,
  onGuestClipboardReceived,
  onHostClipboardChanged,
} from './virtual-machine-clipboard.ts'
import { saveVirtualMachineSnapshot } from './virtual-machine-save-snapshot.ts'
import { postVirtualMachineDiskWriteFailedNotification } from './virtual-machine-disk-write-notification.ts'
import {
  handleVmFileEvent,
  registerVmFileTransferBackend,
  subscribeVmFileOffers,
} from './virtual-machine-file-transfer.ts'
import { postOsNotification } from '../../os/os-notifications.ts'
import { vmAgentFor } from './virtual-machine-agent.ts'
import type {
  InstantVmNativeKeyMessage,
  VmGuestFileEvent,
} from './virtual-machine-protocol.ts'
import { VmRuntimeSurface } from './virtual-machine-runtime-surface.tsx'
import {
  DISK_IMAGE_INCOMPLETE_HINT,
  DISK_WRITE_FAILED_FORCE_STOP_HINT,
  pickDisplayedMachineId,
  useVirtualMachineRuntimePool,
} from './virtual-machine-runtime.ts'
import {
  buildKeyboardSequence,
  VM_COMBO_KEY_PRESETS,
  VM_FUNCTION_KEY_PRESETS,
  type VmSendKeyPreset,
} from './virtual-machine-send-keys.ts'
import {
  compileVmKeyMappings,
  isVmImeKeyEvent,
  VmKeyboardTranslator,
} from './virtual-machine-keymap.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import { VirtualMachineSettingsDialog } from './virtual-machine-settings-dialog.tsx'
import {
  addVirtualMachine,
  moveVirtualMachine,
  nextVirtualMachineName,
  readVirtualMachineStore,
  removeVirtualMachine,
  setLastSelectedVirtualMachine,
  subscribeVirtualMachineStore,
  updateVirtualMachine,
} from './virtual-machine-store.ts'
import type { VirtualMachineRecord, VirtualMachineSettings } from './virtual-machine-types.ts'
import { VM_DISPLAY_MODE_IDS, type VmDisplayModeId } from './virtual-machine-types.ts'
import './virtual-machine.css'

const APP_ID = 'virtual-machine' as const
const THEME = '#3d5a80'
const POWER_HINT_MS = 4000
/** agent 探测周期：运行时控制面每 5s 下发一次 PING，宿主按同周期轮询 state()。 */
const VM_AGENT_POLL_MS = 5_000
/** PONG 年龄超过约 3 个 PING 周期视为失联（agent 挂了 hint 自动消失）。 */
const VM_AGENT_PONG_MAX_AGE_MS = 15_000
/** 现场验证时补发 PING，等一个串口往返的余量再重读 state。 */
const VM_AGENT_PONG_RECHECK_DELAY_MS = 300
/** 点关机遇状态灯 off 的现场验证上限；超过即按真失联处理。 */
const VM_AGENT_VERIFY_TIMEOUT_MS = 3_000
/** 宿主剪贴板轮询周期（推给客机的方向）；客机→宿主由客机侧 150ms 轮询自发上行。 */
const VM_CLIPBOARD_SYNC_POLL_MS = 1_000
/** 页面失焦时浏览器拒绝读写剪贴板；连续失败到该秒数才提示（首次失败属预期）。 */
const VM_CLIPBOARD_READ_WARN_AFTER_FAILURES = 5
/** 客机文本补写重试上限（1s 一次）；页面持续失焦超过则放弃并提示。 */
const VM_CLIPBOARD_WRITE_MAX_ATTEMPTS = 30
/** 「关机」（XP 软关机）命令发出后，等客机断电的最大时限；超时安静解锁，不提示不指挥。 */
const GUEST_SHUTDOWN_TIMEOUT_MS = 90_000
const GUEST_SHUTDOWN_SENT_HINT = '正在关机（XP 软关机）…'

const DISPLAY_MODE_SEGMENTS: readonly { id: VmDisplayModeId; label: string }[] =
  VM_DISPLAY_MODE_IDS.map((id) => ({
    id,
    label: formatVmDisplayModeLabel(id),
  }))

type SettingsSession =
  | { mode: 'create'; initial: VirtualMachineSettings }
  | { mode: 'edit'; id: string; initial: VirtualMachineSettings }

function formatMachineMeta(machine: VirtualMachineRecord): string {
  return formatVmMemoryLabel(machine.memoryMb)
}

function formatStatus(machine: VirtualMachineRecord | undefined, running: boolean): string {
  if (!machine) {
    return '未选择'
  }
  return `${running ? '运行中' : '已停止'} · ${formatVmBackendLabel(machine.backend)}`
}

function isVmHostTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type VirtualMachineListProps = {
  machines: VirtualMachineRecord[]
  selectedId: string | undefined
  runningIds: readonly string[]
  startingIds: readonly string[]
  onFocus: (machineId: string) => void
  onOpenSettings: (machineId: string) => void
  /** 松手落位：fromIndex 行移到 toIndex（钥匙串同款插入位语义）。 */
  onMove: (fromIndex: number, toIndex: number) => void
}

function VirtualMachineList({
  machines,
  selectedId,
  runningIds,
  startingIds,
  onFocus,
  onOpenSettings,
  onMove,
}: VirtualMachineListProps) {
  // 拖拽会话（钥匙串同款）：按住行首手柄立即起拖，被拖行半透明留在原地，
  // 目标插入位显示指示线，松手才 onMove 落盘；列表边缘自动滚动。
  const isDraggingRef = useRef(false)
  const preventClickRef = useRef(false)
  const dragIndexRef = useRef<number | undefined>(undefined)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [overIndex, setOverIndex] = useState<number | undefined>(undefined)
  const [gripActiveIndex, setGripActiveIndex] = useState<number | undefined>(
    undefined,
  )

  const resolveHoverIndex = useCallback(
    (clientY: number): number => {
      for (let i = 0; i < machines.length; i++) {
        const el = itemRefs.current.get(i)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (clientY < rect.top + rect.height / 2) {
          return i
        }
      }
      return Math.max(0, machines.length - 1)
    },
    [machines.length],
  )

  const finishReorder = useCallback(
    (fromIndex: number | undefined, toIndex: number | undefined) => {
      setDragIndex(undefined)
      setOverIndex(undefined)
      setGripActiveIndex(undefined)
      isDraggingRef.current = false
      dragIndexRef.current = undefined

      if (fromIndex === undefined || toIndex === undefined) return
      onMove(fromIndex, toIndex)
    },
    [onMove],
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
          fromIndex === undefined
            ? undefined
            : resolveHoverIndex(endEvent.clientY)
        if (
          fromIndex !== undefined &&
          toIndex !== undefined &&
          fromIndex !== toIndex
        ) {
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

  const handleRowClick = useCallback(
    (machineId: string) => {
      if (isDraggingRef.current || preventClickRef.current) {
        preventClickRef.current = false
        return
      }
      onFocus(machineId)
    },
    [onFocus],
  )

  return (
    <ul
      class={`virtual-machine__list${
        dragIndex !== undefined ? ' virtual-machine__list--reordering' : ''
      }`}
    >
      {machines.map((machine, index) => {
        const active = machine.id === selectedId
        const running = runningIds.includes(machine.id)
        const starting = startingIds.includes(machine.id)
        const statusClass = starting
          ? 'virtual-machine__status-dot virtual-machine__status-dot--starting'
          : running
            ? 'virtual-machine__status-dot virtual-machine__status-dot--running'
            : 'virtual-machine__status-dot'
        const statusLabel = starting ? '启动中' : running ? '运行中' : '已停止'
        return (
          <li
            key={machine.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(index, el)
              } else {
                itemRefs.current.delete(index)
              }
            }}
            class={
              'virtual-machine__row-slot' +
              (index === overIndex ? ' virtual-machine__row-slot--over' : '')
            }
          >
            <button
              type="button"
              class={
                'virtual-machine__row' +
                (active ? ' virtual-machine__row--active' : '') +
                (index === dragIndex ? ' virtual-machine__row--dragging' : '')
              }
              aria-current={active ? 'true' : undefined}
              onClick={() => handleRowClick(machine.id)}
              onDblClick={() => onOpenSettings(machine.id)}
            >
              <span
                class={`virtual-machine__grip${
                  index === gripActiveIndex ? ' virtual-machine__grip--active' : ''
                }`}
                aria-hidden="true"
                onPointerDown={(e) => handleGripPointerDown(index, e)}
              >
                <span class="virtual-machine__grip-line" />
                <span class="virtual-machine__grip-line" />
                <span class="virtual-machine__grip-line" />
              </span>
              <span class="virtual-machine__row-body">
                <span class="virtual-machine__row-name">
                  {machine.name}
                  <span class={statusClass} aria-label={statusLabel} />
                </span>
                <span class="virtual-machine__row-meta">
                  {formatMachineMeta(machine)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function VirtualMachineApp({ windowId }: { windowId?: string }) {
  const { activeWindowId, toggleFullscreen, windows } = useOs()
  const isActiveWindow = windowId === undefined || windowId === activeWindowId
  // 「视图 > 全屏」作用于本窗口；windowId 缺省时退回当前活动窗口。
  const ownWindowId = windowId ?? activeWindowId
  const vmWindowFullscreen =
    ownWindowId !== undefined &&
    windows.find((window) => window.id === ownWindowId)?.fullscreen === true
  const modal = useWindowModal()
  const runtimeOrigin = getVmRuntimeOrigin()
  const pool = useVirtualMachineRuntimePool(runtimeOrigin, {
    // 硬盘回写类警告升级为弹窗：右上角小字没人看，关键事件必须打断
    onDiskWriteForceStop: () => {
      void modal.alert({
        title: '硬盘回写失败',
        message: DISK_WRITE_FAILED_FORCE_STOP_HINT,
        themeColor: THEME,
      })
    },
    onDiskWriteIncomplete: () => {
      void modal.alert({
        title: '关机落盘未完成',
        message: DISK_IMAGE_INCOMPLETE_HINT,
        themeColor: THEME,
      })
    },
  })
  const [machines, setMachines] = useState<VirtualMachineRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [powerBusy, setPowerBusy] = useState(false)
  const [powerHint, setPowerHint] = useState<string | undefined>(undefined)
  /** 客机关机命令已发出、正等客机断电的时间点；null = 无待收口的关机。 */
  const guestShutdownAtRef = useRef<number | null>(null)
  const selected = useMemo(
    () => machines.find((machine) => machine.id === selectedId),
    [machines, selectedId],
  )
  // 启动中的机器 id：列表状态点橙色脉冲。
  const startingIds = useMemo(
    () =>
      pool.runningIds.filter((id) => {
        const snapshot = pool.snapshots.get(id)
        return snapshot !== undefined && !snapshot.ready
      }),
    [pool.runningIds, pool.snapshots],
  )
  const selectedRunning = Boolean(selected && pool.runningIds.includes(selected.id))
  // 运行时存活：true=已就绪；false=未响应；undefined=探测中。
  // 点开机之前 iframe 还不存在，没人能发 postMessage，只能由宿主发请求确认。
  const [runtimeAlive, setRuntimeAlive] = useState<boolean | undefined>(undefined)
  const runtimeAliveRef = useRef<boolean | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [settingsSession, setSettingsSession] = useState<SettingsSession | undefined>(undefined)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [guestKeyboardArmed, setGuestKeyboardArmed] = useState(false)
  const { hostRef: narrowHostRef } = useAppNarrowLayout()
  const keyboardSinkRef = useRef<HTMLDivElement>(null)
  const settingsOpenRef = useRef(false)
  const inspectorOpenRef = useRef(false)
  const stealFocusTokenRef = useRef(0)

  const applyStore = useCallback((next: VirtualMachineRecord[], preferredId?: string) => {
    setMachines(next)
    setSelectedId((current) => {
      if (current && next.some((machine) => machine.id === current)) {
        return current
      }
      // 没有有效选中时优先恢复「上一次选中的机器」（打开 App / 选中机器被删后的回落）。
      if (preferredId && next.some((machine) => machine.id === preferredId)) {
        return preferredId
      }
      return next[0]?.id
    })
    setReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void readVirtualMachineStore().then((store) => {
        if (!cancelled) {
          applyStore(store.machines, store.lastSelectedId)
        }
      })
    }
    refresh()
    const unsubscribe = subscribeVirtualMachineStore(refresh)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyStore])

  useEffect(() => {
    if (!powerHint || powerBusy) {
      return
    }
    const timer = window.setTimeout(() => setPowerHint(undefined), POWER_HINT_MS)
    return () => window.clearTimeout(timer)
  }, [powerBusy, powerHint])

  // 客机关机收口：命令已发出的状态下，runningIds 移除（onGuestPoweredOff →
  // 切电 → 写回落盘完成）即解锁；超时未断电则安静解锁——系统没关成用户自己
  // 看得见屏幕，不需要宿主提示原因或指挥下一步，按钮恢复可用即可。
  useEffect(() => {
    if (!selectedRunning) {
      guestShutdownAtRef.current = null
      setPowerBusy(false)
      setPowerHint(undefined)
      return
    }
    if (guestShutdownAtRef.current === null) {
      return
    }
    const timer = window.setTimeout(() => {
      guestShutdownAtRef.current = null
      setPowerBusy(false)
      // 不提示：用户自己会看到机器仍在运行。
      setPowerHint(undefined)
    }, GUEST_SHUTDOWN_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [selectedRunning])

  // 运行时存活探测：未就绪期间每 2 秒重试，服务器慢启动也能自动恢复为可点；
  // 一旦就绪就停止重试（正常运行零后台流量），只在窗口聚焦时复查一次。
  const probeRuntimeAlive = useCallback(async (): Promise<boolean> => {
    if (!runtimeOrigin) {
      return false
    }
    try {
      await fetch(runtimeOrigin, {
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      })
      runtimeAliveRef.current = true
      setRuntimeAlive(true)
      return true
    } catch {
      runtimeAliveRef.current = false
      setRuntimeAlive(false)
      return false
    }
  }, [runtimeOrigin])

  useEffect(() => {
    runtimeAliveRef.current = undefined
    setRuntimeAlive(undefined)
    let cancelled = false
    let inFlight = false
    const probe = () => {
      if (inFlight) {
        return
      }
      inFlight = true
      void probeRuntimeAlive().finally(() => {
        inFlight = false
      })
    }
    probe()
    const interval = window.setInterval(() => {
      if (!cancelled && runtimeAliveRef.current !== true) {
        probe()
      }
    }, 2_000)
    const onFocus = () => probe()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [probeRuntimeAlive])

  const selectedBackend = selected ? getVmBackend(selected.backend) : undefined
  const runningMachines = useMemo(
    () => machines.filter((machine) => pool.runningIds.includes(machine.id)),
    [machines, pool.runningIds],
  )
  // 只陈述事实的提示，不带「请启动」之类的操作指令；只在屏幕中央显示，不进顶部工具栏。
  const runtimeUnreachableHint = `虚拟机运行时未响应（${runtimeOrigin}）`
  const selectedHint = selected ? pool.hints.get(selected.id) : undefined
  const [agentLink, setAgentLink] = useState<'off' | 'command' | 'full'>('off')

  // 现场连通验证：补一刀 PING，等一个串口往返的余量后重读 state，以新鲜的
  // lastPongAgeMs 为准。后台标签页节流会把 PING 拖过期，状态灯 off 里大量是
  // 这种假掉线；真断（agent 进程没了）不会有新 PONG，读数依旧过期。
  const verifyAgentAlive = useCallback(
    async (machineId: string): Promise<boolean> => {
      try {
        await pool.agentCommand(machineId, 'ping')
        await new Promise((resolve) => {
          window.setTimeout(resolve, VM_AGENT_PONG_RECHECK_DELAY_MS)
        })
        const state = (await pool.agentCommand(machineId, 'state')) as
          | { lastPongAgeMs?: number | null; shmBase?: number | null }
          | undefined
        const commandOk =
          typeof state?.lastPongAgeMs === 'number' &&
          state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
        if (!document.hidden) {
          const mailboxOk = typeof state?.shmBase === 'number' && state.shmBase > 0
          setAgentLink(!commandOk ? 'off' : mailboxOk ? 'full' : 'command')
        }
        return commandOk
      } catch {
        return false
      }
    },
    [pool.agentCommand],
  )

  // agent 连通探测：轮询 __vm.state()。两条链独立判定——串口命令链看
  // lastPongAgeMs（PING→PONG），剪贴板信箱看 shmBase（SHM= 握手）；
  // 只亮命令链也要如实显示，否则信箱半通/全断会被误读成全通。
  useEffect(() => {
    setAgentLink('off')
    if (!selectedId || !selectedRunning) {
      return
    }
    let cancelled = false
    let timer = 0
    let checking = false
    // 隐藏期间 setTimeout 被浏览器节流，PING→PONG 读数必然失真，据其降级只会
    // 制造「切回来变未连接」的假象；读数照刷，状态只在可见时更新。
    const applyState = (
      state: { lastPongAgeMs?: number | null; shmBase?: number | null } | undefined,
    ) => {
      if (cancelled || document.hidden) {
        return
      }
      const commandOk =
        typeof state?.lastPongAgeMs === 'number' &&
        state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
      const mailboxOk = typeof state?.shmBase === 'number' && state.shmBase > 0
      setAgentLink(!commandOk ? 'off' : mailboxOk ? 'full' : 'command')
    }
    const check = async () => {
      if (checking) {
        return
      }
      checking = true
      try {
        const state = (await pool.agentCommand(selectedId, 'state')) as
          | { lastPongAgeMs?: number | null; shmBase?: number | null }
          | undefined
        const commandOk =
          typeof state?.lastPongAgeMs === 'number' &&
          state.lastPongAgeMs < VM_AGENT_PONG_MAX_AGE_MS
        if (commandOk || document.hidden) {
          applyState(state)
        } else if (!cancelled) {
          // 可见却 pong 过期，多半是刚切回页面：现场补一刀尽快翻正，
          // 不必等下个轮询周期。
          await verifyAgentAlive(selectedId)
        }
      } catch {
        // state 调用本身挂了（运行时不可达）才算真失联；隐藏期间不降级。
        if (!cancelled && !document.hidden) {
          setAgentLink('off')
        }
      } finally {
        checking = false
      }
      if (!cancelled) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          void check()
        }, VM_AGENT_POLL_MS)
      }
    }
    // 切回标签页/窗口聚焦立即复查并顺延下个周期：等 5s 定时器自然触发的话，
    // 用户头几秒的点关机会被过期状态误拦。
    const poke = () => {
      if (cancelled || checking) {
        return
      }
      window.clearTimeout(timer)
      void check()
    }
    const onVisible = () => {
      if (!document.hidden) {
        poke()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', poke)
    void check()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', poke)
    }
  }, [pool.agentCommand, selectedId, selectedRunning, verifyAgentAlive])

  const statusHint =
    powerHint ??
    selectedHint ??
    (agentLink === 'full'
      ? 'Agent 已连通'
      : agentLink === 'command'
        ? 'Agent 已连通 · 剪贴板信箱未就绪'
        : undefined)
  const hasSelection = selected !== undefined
  const settingsOpen = settingsSession !== undefined
  settingsOpenRef.current = settingsOpen
  inspectorOpenRef.current = inspectorOpen
  // 开机按钮只看运行时就绪状态：探测中 / 未响应都不可点。
  const canStart = Boolean(
    hasSelection &&
      !powerBusy &&
      !selectedRunning &&
      selectedBackend?.available &&
      Boolean(runtimeOrigin) &&
      runtimeAlive === true,
  )
  const canStop = Boolean(hasSelection && selectedRunning && !powerBusy)
  const canReset = canStop
  const canSaveSnapshot = canStop

  const showVmError = useCallback(
    (message: string, title = '虚拟机错误') => {
      void modal.alert({ title, message, themeColor: THEME })
    },
    [modal],
  )

  const displayedId = pickDisplayedMachineId(selected?.id, pool.runningIds)
  const selectedSnapshot = pool.snapshots.get(selectedId ?? '')
  const selectedDiskStreamIds = listVmDiskStreamIds(
    selectedId ? pool.startMessages.get(selectedId) : undefined,
  )
  const displayedBusy = Boolean(
    displayedId !== undefined && selectedSnapshot && !selectedSnapshot.ready,
  )
  // 发送按键始终发给当前显示的画面，有运行中的画面就可用。
  const canSendKeys = displayedId !== undefined

  // 按键映射：翻译器只服务当前显示的画面；设置保存后经 store 刷新自动生效（含运行中）。
  const keyTranslatorRef = useRef(new VmKeyboardTranslator())
  const displayedMachine = machines.find((machine) => machine.id === displayedId)
  // 体验增强开关：只控制宿主这一侧要不要参与（未配置时按开处理）。
  const enhanceClipboard = displayedMachine?.enhanceClipboard ?? true
  const enhanceFileTransfer = displayedMachine?.enhanceFileTransfer ?? true
  useEffect(() => {
    keyTranslatorRef.current.setKeymap(
      compileVmKeyMappings(
        displayedMachine && displayedMachine.keyMappingEnabled
          ? displayedMachine.keyMappings
          : undefined,
      ),
    )
  }, [displayedMachine?.keyMappingEnabled, displayedMachine?.keyMappings])

  // #region 剪贴板双向同步（ivm-shm 信箱；todo/vm-remote-control）
  // 只同步当前显示的虚拟机：多机并发时背景机不应悄悄改写宿主剪贴板。
  const clipboardSyncRef = useRef(createVmClipboardSyncState())
  /** 客机→宿主写失败待补的文本（页面失焦被拒时排队，聚焦后补写）。 */
  const clipboardPendingWriteRef = useRef<{ text: string; attempts: number } | null>(null)
  useEffect(() => {
    // 切换显示目标 = 换了剪贴板域：清空回声指纹，避免旧文本被误判。
    clipboardSyncRef.current = createVmClipboardSyncState()
    clipboardPendingWriteRef.current = null
  }, [displayedId])

  useEffect(() => {
    if (displayedId === undefined) {
      return
    }
    let cancelled = false
    let readFailures = 0
    const tick = async () => {
      if (cancelled) {
        return
      }
      // 「体验增强」关掉剪贴板同步：宿主这侧完全不读不写。
      if (!enhanceClipboard) {
        return
      }
      // 失败补写：客机文本曾因页面失焦写不进系统剪贴板，聚焦恢复后 1s 内补上。
      const pending = clipboardPendingWriteRef.current
      if (pending !== null) {
        try {
          await navigator.clipboard?.writeText(pending.text)
          if (!cancelled) {
            console.info(
              '[vm-clipboard] 宿主: 补写成功',
              JSON.stringify(pending.text.slice(0, 60)),
              `(第 ${pending.attempts + 1} 次尝试)`,
            )
            if (clipboardPendingWriteRef.current === pending) {
              clipboardPendingWriteRef.current = null
            }
          }
        } catch {
          pending.attempts += 1
          if (!cancelled && pending.attempts >= VM_CLIPBOARD_WRITE_MAX_ATTEMPTS) {
            clipboardPendingWriteRef.current = null
            console.warn('[vm] 客机剪贴板文本补写放弃（页面持续失焦）：', JSON.stringify(pending.text))
          }
        }
      }
      try {
        const hostText = await navigator.clipboard?.readText()
        if (cancelled || hostText === undefined) {
          return
        }
        readFailures = 0
        const push = onHostClipboardChanged(clipboardSyncRef.current, hostText)
        if (push !== null) {
          console.info(
            `[vm-clipboard] 宿主: 剪贴板变化，推向客机(${push.length}字符) ${JSON.stringify(push.slice(0, 60))}`,
          )
          void pool
            .agentCommand(displayedId, 'clipboardWrite', [push])
            .catch(() => {})
        }
      } catch {
        // 页面失焦期间浏览器拒绝访问剪贴板属预期，聚焦后下一秒自愈；
        // 只在持续失败时提示一次，避免「权限被拒」与「暂时失焦」无法区分。
        readFailures += 1
        if (!cancelled && readFailures === VM_CLIPBOARD_READ_WARN_AFTER_FAILURES) {
          console.warn(
            '[vm] 宿主剪贴板连续读取失败——页面失焦期间属预期会自愈；若聚焦后仍出现，检查浏览器剪贴板权限',
          )
        }
      }
    }
    const timer = window.setInterval(() => void tick(), VM_CLIPBOARD_SYNC_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [displayedId, enhanceClipboard, pool.agentCommand])

  const handleGuestClipboard = useCallback(
    (machineId: string, text: string) => {
      if (machineId !== displayedId) {
        console.info(
          `[vm-clipboard] 宿主: 文本来自 ${machineId}，当前显示 ${displayedId ?? '无'}，忽略`,
        )
        return
      }
      if (!enhanceClipboard) {
        return
      }
      const write = onGuestClipboardReceived(clipboardSyncRef.current, text)
      if (write === null) {
        console.info('[vm-clipboard] 宿主: 重复/回声文本，跳过写入', JSON.stringify(text.slice(0, 60)))
        return
      }
      console.info(
        `[vm-clipboard] 宿主: 待写系统剪贴板(${write.length}字符) ${JSON.stringify(write.slice(0, 60))}`,
      )
      // 入补写队列再立即试一次：聚焦时 ~350ms 内落进系统剪贴板；页面失焦
      // 被拒属预期（用户正切去外部应用），由轮询 tick 持续补写直到成功。
      const entry = { text: write, attempts: 0 }
      clipboardPendingWriteRef.current = entry
      navigator.clipboard?.writeText(write).then(
        () => {
          // 立即写入已成功：清掉队列，防止 tick 再补写一遍。
          if (clipboardPendingWriteRef.current === entry) {
            clipboardPendingWriteRef.current = null
          }
          console.info('[vm-clipboard] 宿主: writeText 成功')
        },
        (error: unknown) =>
          console.info(
            '[vm-clipboard] 宿主: writeText 首次失败（已入补写队列，聚焦后自动补）:',
            error instanceof Error ? error.message : String(error),
          ),
      )
    },
    [displayedId, enhanceClipboard],
  )

  /** 文件通道上行（offer/data/req/done）：按显示机器过滤后交给传输服务。 */
  const handleGuestFileEvent = useCallback(
    (machineId: string, event: VmGuestFileEvent) => {
      if (machineId !== displayedId) {
        return
      }
      // 「体验增强」关掉文件互传：客机主动推来的文件事件一律不接。
      if (!enhanceFileTransfer) {
        return
      }
      handleVmFileEvent(event)
    },
    [displayedId, enhanceFileTransfer],
  )

  /**
   * iframe 抢到焦点时真实按键经此回宿主：与 armed 路径共用同一个翻译器，
   * 按键映射在两条路上行为一致。仅当前显示的机器接（背景机 iframe 拿不到焦点）。
   */
  const handleNativeKey = useCallback(
    (machineId: string, message: InstantVmNativeKeyMessage) => {
      if (machineId !== displayedId) {
        return
      }
      pool.sendKeyboard(machineId, keyTranslatorRef.current.translate(message, message.phase))
    },
    [displayedId, pool.sendKeyboard],
  )

  // 传输服务后端随显示机器切换注册/注销（文件APP 经此调用当前虚拟机）。
  useEffect(() => {
    registerVmFileTransferBackend(
      displayedId !== undefined && enhanceFileTransfer ? vmAgentFor(pool, displayedId) : null,
    )
    return () => registerVmFileTransferBackend(null)
    // pool.agentCommand 是稳定的命令入口；用它与 displayedId 做依赖即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedId, enhanceFileTransfer, pool.agentCommand])

  // XP 里复制了文件 → OS 通知提示（文件APP里粘贴即导入）
  useEffect(() => {
    const unsubscribe = subscribeVmFileOffers((files) => {
      const subtitle =
        files.length === 1
          ? `${files[0]?.name ?? '文件'}（可在文件APP粘贴）`
          : `${files.length} 个文件（可在文件APP粘贴）`
      postOsNotification({
        id: 'virtual-machine:clipboard-files',
        title: '虚拟机剪贴板',
        subtitle,
        phase: 'neutral',
        icon: { kind: 'app', appId: 'virtual-machine' },
      })
    })
    return unsubscribe
  }, [])
  // #endregion

  const captureGuestKeyboard = useCallback(() => {
    // 不要把焦点交给 iframe：跨域画面看起来像聚焦了，按键却进不去。
    // 焦点留在宿主，按键由窗口监听转发进模拟器。
    if (settingsOpenRef.current || inspectorOpenRef.current) {
      return
    }
    setGuestKeyboardArmed(true)
    const token = ++stealFocusTokenRef.current
    const steal = () => {
      if (token !== stealFocusTokenRef.current) {
        return
      }
      if (settingsOpenRef.current || inspectorOpenRef.current) {
        return
      }
      keyboardSinkRef.current?.focus({ preventScroll: true })
    }
    steal()
    requestAnimationFrame(steal)
    window.setTimeout(steal, 0)
  }, [])

  const releaseGuestKeyboard = useCallback(() => {
    stealFocusTokenRef.current += 1
    setGuestKeyboardArmed(false)
    if (displayedId !== undefined) {
      pool.releaseKeyboard(displayedId)
    }
  }, [displayedId, pool.releaseKeyboard])

  useEffect(() => {
    if (!settingsOpen && !inspectorOpen && displayedId !== undefined) {
      return
    }
    stealFocusTokenRef.current += 1
    setGuestKeyboardArmed(false)
    if (displayedId !== undefined) {
      pool.releaseKeyboard(displayedId)
    }
  }, [displayedId, inspectorOpen, pool.releaseKeyboard, settingsOpen])

  const handleNew = useCallback(() => {
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'create',
        initial: defaultVirtualMachineSettings(nextVirtualMachineName(machines)),
      }
    })
    setPowerHint(undefined)
  }, [machines])

  const handleSettings = useCallback(() => {
    if (!selected) {
      return
    }
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'edit',
        id: selected.id,
        initial: settingsFromRecord(selected),
      }
    })
    setPowerHint(undefined)
  }, [selected])

  const focusMachine = useCallback((machineId: string) => {
    setSelectedId(machineId)
    setPowerHint(undefined)
    // 记住「上一次选中的机器」，下次打开 App 自动恢复。落盘失败不阻断交互。
    void setLastSelectedVirtualMachine(machineId).catch(() => {})
  }, [])

  const handleOpenSettings = useCallback(
    (machineId: string) => {
      const machine = machines.find((item) => item.id === machineId)
      if (!machine) {
        return
      }
      focusMachine(machineId)
      setSettingsSession((current) => {
        if (current) {
          return current
        }
        return {
          mode: 'edit',
          id: machine.id,
          initial: settingsFromRecord(machine),
        }
      })
    },
    [focusMachine, machines],
  )

  const handleListMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      const machine = machines[fromIndex]
      if (!machine || fromIndex === toIndex) {
        return
      }
      void moveVirtualMachine(machine.id, toIndex).catch((error: unknown) => {
        showVmError(error instanceof Error ? error.message : '调整虚拟机顺序失败')
      })
    },
    [machines, showVmError],
  )

  const handleSaveSettings = useCallback(
    async (settings: VirtualMachineSettings) => {
      if (!settingsSession) {
        return
      }
      if (settingsSession.mode === 'create') {
        const machine = await addVirtualMachine(settings)
        focusMachine(machine.id)
      } else {
        await updateVirtualMachine(settingsSession.id, settings)
        if (pool.runningIds.includes(settingsSession.id)) {
          // 立即生效的设置推给运行中的实例；重启才生效的只落盘，下次开机读取。
          try {
            await pool.setActivePointerMode(settingsSession.id, settings.pointerMode)
            await pool.setActiveDisplayMode(settingsSession.id, settings.displayMode)
            await pool.setActiveAbsoluteMouse(settingsSession.id, settings.enhanceAbsoluteMouse)
          } catch (error) {
            showVmError(error instanceof Error ? error.message : '应用设置失败')
          }
        }
      }
      setSettingsSession(undefined)
      setPowerHint(undefined)
    },
    [focusMachine, pool, settingsSession, showVmError],
  )

  const handleDisplayMode = useCallback(
    async (mode: VmDisplayModeId) => {
      if (!selected) {
        return
      }
      if (selectedRunning) {
        try {
          await pool.setActiveDisplayMode(selected.id, mode)
        } catch (error) {
          showVmError(error instanceof Error ? error.message : '切换显示比例失败')
          return
        }
      }
      await updateVirtualMachine(selected.id, {
        ...settingsFromRecord(selected),
        displayMode: mode,
      })
      setPowerHint(undefined)
    },
    [pool, selected, selectedRunning],
  )

  const handleDelete = useCallback(() => {
    if (!selected) {
      return
    }
    const target = selected
    void (async () => {
      const confirmed = await modal.confirm({
        title: '删除虚拟机',
        message: `要删除「${target.name}」吗？此操作无法撤销。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!confirmed) {
        return
      }
      if (pool.runningIds.includes(target.id)) {
        try {
          await pool.shutdown(target.id)
        } catch (error) {
          showVmError(error instanceof Error ? error.message : '关机失败')
          return
        }
      }
      const index = machines.findIndex((machine) => machine.id === target.id)
      const remaining = await removeVirtualMachine(target.id)
      const next = remaining[Math.min(Math.max(index, 0), Math.max(remaining.length - 1, 0))]
      if (next) {
        focusMachine(next.id)
      } else {
        setSelectedId(undefined)
      }
      setPowerHint(undefined)
    })()
  }, [focusMachine, machines, modal, pool, selected, showVmError])

  const handlePower = useCallback(
    (action: 'start' | 'shutdown' | 'stop' | 'reset') => {
      const powerStartAt = performance.now()
      const machineId = selected?.id
      const trace = (op: string, extra?: Record<string, unknown>) => {
        recordSystemDebugTimeline({
          layer: 'vm',
          op,
          detail: {
            action,
            machineId,
            running: machineId !== undefined ? pool.runningIds.includes(machineId) : undefined,
            ...extra,
          },
          durationMs: Math.round(performance.now() - powerStartAt),
        })
      }
      trace('power-pressed')
      if (!selected || !selectedBackend) {
        trace('power-skipped', { reason: 'no-selection-or-backend' })
        return
      }
      if (!selectedBackend.available || !runtimeOrigin) {
        setPowerHint(vmPowerUnavailableMessage(action))
        trace('power-skipped', { reason: 'backend-unavailable', runtimeOrigin })
        return
      }
      if (action === 'start') {
        if (pool.runningIds.includes(selected.id)) {
          trace('power-skipped', { reason: 'already-running' })
          return
        }
        if (!virtualMachineHasBootMedia(selected)) {
          setPowerHint('请先在设置里挂载硬盘、光盘或软盘')
          trace('power-skipped', { reason: 'no-boot-media' })
          return
        }
      } else if (!pool.runningIds.includes(selected.id)) {
        setPowerHint(action === 'reset' ? '请先开机' : '这台虚拟机未在运行')
        trace('power-skipped', { reason: 'not-running' })
        return
      }
      const machine = selected
      void (async () => {
        setPowerBusy(true)
        let waitForGuestShutdown = false
        try {
          if (action === 'shutdown') {
            // 软关机只依赖串口命令链，信箱没就绪不影响关机，不必拦。状态灯 off
            // 里有大量「假掉线」——后台标签页节流把 PING 拖过期了——现场补一刀
            // PING 再决定拦不拦：真断才弹错，假掉线直接放行关机。
            if (agentLink === 'off') {
              setPowerHint('正在确认 Agent 连接…')
              trace('power-agent-verify')
              const alive = await Promise.race([
                verifyAgentAlive(machine.id),
                new Promise<false>((resolve) => {
                  window.setTimeout(() => resolve(false), VM_AGENT_VERIFY_TIMEOUT_MS)
                }),
              ])
              if (!alive) {
                setPowerHint(undefined)
                trace('power-skipped', { reason: 'agent-not-connected' })
                showVmError('客机 Agent 未连通，关机命令无法送达')
                return
              }
            }
            // XP 软关机：agent SHUTDOWN → ExitWindowsEx → 客机切电 →
            // guest-poweroff watcher → 宿主侧写回落盘 → runningIds 移除（收口）。
            // 成功后保持 busy，等待收口 effect；失败（agent 不可达）弹窗告知。
            await pool.agentCommand(machine.id, 'shutdown')
            trace('power-guest-shutdown-sent')
            setPowerHint(GUEST_SHUTDOWN_SENT_HINT)
            guestShutdownAtRef.current = Date.now()
            waitForGuestShutdown = true
            return
          }
          if (action === 'stop') {
            const forced = await pool.shutdown(machine.id)
            trace('power-stop-done', { forced })
            setPowerHint(undefined)
            return
          }
          if (action === 'reset') {
            const outcome = await pool.resetInstance(machine.id)
            if (outcome === 'acked') {
              trace('power-reset-done')
              setPowerHint(undefined)
              return
            }
            // 客机无响应：拆 iframe 重新装载，等效硬重置（冷启动）。
            // shutdown 自身也有 3 秒期限，运行时若恰好恢复还能借机干净收尾落盘。
            // 不向用户弹提示：强拆达成的就是重置本身，用户只看到多等了几秒。
            trace('power-reset-force', { outcome })
            await pool.shutdown(machine.id)
            await pool.boot(machine)
            return
          }
          await pool.boot(machine)
          trace('power-boot-issued')
          setPowerHint(undefined)
        } catch (error) {
          trace('power-failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          showVmError(error instanceof Error ? error.message : '操作失败')
        } finally {
          if (!waitForGuestShutdown) {
            setPowerBusy(false)
          }
        }
      })()
    },
    [agentLink, pool, runtimeOrigin, selected, selectedBackend, showVmError, verifyAgentAlive],
  )

  const handleSaveSnapshot = useCallback(() => {
    if (!selected || !selectedBackend) {
      return
    }
    if (!selectedBackend.available || !runtimeOrigin) {
      setPowerHint(vmPowerUnavailableMessage('start'))
      return
    }
    if (!pool.runningIds.includes(selected.id)) {
      setPowerHint('这台虚拟机未在运行')
      return
    }

    const machine = selected
    void (async () => {
      setPowerBusy(true)
      setPowerHint('正在保存快照，画面可能会停顿…')
      const startedAt = performance.now()
      const ticker = window.setInterval(() => {
        const elapsed = Math.round((performance.now() - startedAt) / 1000)
        setPowerHint(`正在保存快照，画面可能会停顿…（已 ${elapsed} 秒）`)
      }, 2000)
      try {
        const state = await pool.saveInstanceState(machine.id)
        const result = await saveVirtualMachineSnapshot(machine, state)
        setPowerHint(`快照已保存至 ${result.path}`)
      } catch (error) {
        showVmError(error instanceof Error ? error.message : '保存快照失败')
      } finally {
        window.clearInterval(ticker)
        setPowerBusy(false)
      }
    })()
  }, [pool, runtimeOrigin, selected, selectedBackend, showVmError])

  const handleSendKeyPreset = useCallback(
    (preset: VmSendKeyPreset) => {
      if (displayedId === undefined) {
        return
      }
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'send-key',
        detail: `${preset.id} (${preset.label})`,
      })
      // 组合键就是一串键盘消息：按下顺序 down、逆序 up，走现有键盘注入通道。
      for (const message of buildKeyboardSequence(preset)) {
        pool.sendKeyboard(displayedId, message)
      }
    },
    [displayedId, pool.sendKeyboard],
  )

  const handleBootError = useCallback(
    (machineId: string, message: string, detail?: string) => {
      pool.onBootError(machineId, message, detail)
      showVmError(message)
    },
    [pool, showVmError],
  )

  const handleIframeLoadFailed = useCallback(
    (machineId: string, detail: string) => {
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'iframe-load-failed',
        detail: `${machineId}: ${detail.slice(0, 200)}`,
      })
      // ready 超时说明运行时实际不可用：打回未就绪状态，按钮随即禁用并恢复重试。
      runtimeAliveRef.current = false
      setRuntimeAlive(false)
      // 从运行列表移除：surface 连同 iframe 一起卸载，浏览器画的错误页随之消失；
      // hint 落到状态栏，屏幕回到「已关机。点开机启动。」
      pool.onBootError(machineId, detail)
    },
    [pool],
  )

  const handleDiskWriteFailed = useCallback(
    (machineId: string, detail: string) => {
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'disk-write-failed',
        detail: `${machineId}: ${detail.slice(0, 200)}`,
      })
      pool.armDiskWriteFailedWatchdog(machineId)
      const machine = machines.find((item) => item.id === machineId)
      postVirtualMachineDiskWriteFailedNotification({
        machineId,
        machineName: machine?.name ?? 'Virtual Machine',
        detail,
      })
    },
    [machines, pool.armDiskWriteFailedWatchdog],
  )

  const selectedDisplayMode = selected?.displayMode
  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建虚拟机',
            shortcut: '⌘N',
            onClick: handleNew,
          },
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '删除',
            disabled: !hasSelection || powerBusy,
            onClick: handleDelete,
          },
        ],
      },
      {
        label: '虚拟机',
        items: [
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'submenu',
            label: '电源',
            items: [
              {
                type: 'action',
                label: '开机',
                disabled: !canStart,
                onClick: () => handlePower('start'),
              },
              {
                type: 'action',
                label: '关机',
                disabled: !canStop,
                onClick: () => handlePower('shutdown'),
              },
              {
                type: 'action',
                label: '断电',
                disabled: !canStop,
                onClick: () => handlePower('stop'),
              },
              {
                type: 'action',
                label: '重置',
                disabled: !canReset,
                onClick: () => handlePower('reset'),
              },
            ],
          },
          {
            type: 'submenu',
            label: '发送按键',
            items: [
              ...VM_COMBO_KEY_PRESETS.map((preset) => ({
                type: 'action' as const,
                label: preset.label,
                disabled: !canSendKeys,
                onClick: () => handleSendKeyPreset(preset),
              })),
              { type: 'separator' as const },
              {
                type: 'submenu' as const,
                label: '功能键',
                items: VM_FUNCTION_KEY_PRESETS.map((preset) => ({
                  type: 'action' as const,
                  label: preset.label,
                  disabled: !canSendKeys,
                  onClick: () => handleSendKeyPreset(preset),
                })),
              },
            ],
          },
          {
            type: 'action',
            label: '保存快照',
            disabled: !canSaveSnapshot,
            onClick: handleSaveSnapshot,
          },
          {
            type: 'action',
            label: '详细信息',
            disabled: !hasSelection,
            onClick: () => setInspectorOpen(true),
          },
        ],
      },
      {
        label: '视图',
        items: [
          {
            type: 'submenu',
            label: '屏幕比例',
            items: VM_DISPLAY_MODE_IDS.map((mode) => ({
              type: 'action' as const,
              label:
                selectedDisplayMode === mode
                  ? `✓ ${formatVmDisplayModeLabel(mode)}`
                  : formatVmDisplayModeLabel(mode),
              disabled: !hasSelection,
              onClick: () => void handleDisplayMode(mode),
            })),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: vmWindowFullscreen ? '✓ 全屏' : '全屏',
            disabled: ownWindowId === undefined,
            onClick: () => {
              if (ownWindowId !== undefined) {
                toggleFullscreen(ownWindowId)
              }
            },
          },
        ],
      },
    ]
  }, [
    canReset,
    canSaveSnapshot,
    canSendKeys,
    canStart,
    canStop,
    handleDelete,
    handleDisplayMode,
    handleNew,
    handlePower,
    handleSaveSnapshot,
    handleSendKeyPreset,
    handleSettings,
    hasSelection,
    ownWindowId,
    powerBusy,
    selectedDisplayMode,
    toggleFullscreen,
    vmWindowFullscreen,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  useEffect(() => {
    if (!isActiveWindow) {
      return
    }
    // 键盘流中断过（切显示画面 / 开关弹窗）就作废按住集合，防修饰位粘住。
    keyTranslatorRef.current.reset()
    const onBlurWindow = () => keyTranslatorRef.current.reset()
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        handleNew()
        return
      }
      if (
        !guestKeyboardArmed ||
        displayedId === undefined ||
        settingsOpen ||
        inspectorOpen ||
        isVmImeKeyEvent(event) ||
        isVmHostTypingTarget(event.target)
      ) {
        return
      }
      event.preventDefault()
      pool.sendKeyboard(displayedId, keyTranslatorRef.current.translate(event, 'down'))
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        !guestKeyboardArmed ||
        displayedId === undefined ||
        settingsOpen ||
        inspectorOpen ||
        isVmImeKeyEvent(event) ||
        isVmHostTypingTarget(event.target)
      ) {
        return
      }
      event.preventDefault()
      pool.sendKeyboard(displayedId, keyTranslatorRef.current.translate(event, 'up'))
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlurWindow)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlurWindow)
    }
  }, [
    displayedId,
    guestKeyboardArmed,
    handleNew,
    inspectorOpen,
    isActiveWindow,
    pool.sendKeyboard,
    settingsOpen,
  ])

  const screenMessage = !ready
    ? '正在加载…'
    : !runtimeOrigin
      ? '未配置虚拟机运行时'
      : runtimeAlive === undefined
        ? '正在连接虚拟机运行时…'
        : runtimeAlive === false
          ? runtimeUnreachableHint
          : !selected
            ? '选择左侧的虚拟机，或新建一台。'
            : displayedId === undefined
              ? '已关机。点开机启动。'
              : undefined

  return (
    <div
      class={`virtual-machine${vmWindowFullscreen ? ' virtual-machine--fullscreen' : ''}`}
      ref={narrowHostRef}
    >
      <div class="virtual-machine__toolbar" onPointerDown={releaseGuestKeyboard}>
        <div class="virtual-machine__toolbar-actions">
          <IosButton size="compact" onClick={handleNew}>
            新建
          </IosButton>
          <IosButton size="compact" disabled={!hasSelection} onClick={handleSettings}>
            设置
          </IosButton>
          <IosButton
            size="compact"
            disabled={!canStart}
            onClick={() => handlePower('start')}
          >
            开机
          </IosButton>
          <IosButton size="compact" disabled={!canStop} onClick={() => handlePower('shutdown')}>
            关机
          </IosButton>
          <IosButton size="compact" disabled={!canStop} onClick={() => handlePower('stop')}>
            断电
          </IosButton>
          <IosButton size="compact" disabled={!canReset} onClick={() => handlePower('reset')}>
            重置
          </IosButton>
        </div>
        {selected ? (
          <SegmentedControl
            value={selected.displayMode}
            items={DISPLAY_MODE_SEGMENTS}
            onChange={(mode) => void handleDisplayMode(mode)}
            ariaLabel="显示比例"
            className="virtual-machine__display-mode"
          />
        ) : null}
        <span class="virtual-machine__status" role="status">
          {formatStatus(selected, selectedRunning)}
          {statusHint ? (
            <span class="virtual-machine__status-hint"> · {statusHint}</span>
          ) : null}
        </span>
      </div>
      <div class="virtual-machine__body">
        <aside
          class="virtual-machine__list-pane"
          aria-label="虚拟机列表"
          onPointerDown={releaseGuestKeyboard}
        >
          <div class="virtual-machine__list-head">虚拟机</div>
          {machines.length === 0 && ready ? (
            <p class="virtual-machine__list-empty">还没有虚拟机。点「新建」添加一台。</p>
          ) : (
            <VirtualMachineList
              machines={machines}
              selectedId={selectedId}
              runningIds={pool.runningIds}
              startingIds={startingIds}
              onFocus={focusMachine}
              onOpenSettings={handleOpenSettings}
              onMove={handleListMove}
            />
          )}
        </aside>
        <section class="virtual-machine__display-pane" aria-label="显示器">
          <div
            ref={keyboardSinkRef}
            class="virtual-machine__keyboard-sink"
            tabIndex={-1}
            aria-hidden="true"
          />
          <div class="virtual-machine__monitors">
            {runningMachines.map((machine) => {
              const isDisplayed = machine.id === displayedId
              return (
                <div
                  key={machine.id}
                  class={
                    isDisplayed
                      ? 'virtual-machine__screen virtual-machine__screen--main'
                      : 'virtual-machine__screen virtual-machine__screen--background'
                  }
                  aria-hidden={isDisplayed ? undefined : 'true'}
                >
                  <VmRuntimeSurface
                    machineId={machine.id}
                    origin={runtimeOrigin}
                    buildMode={machine.buildMode}
                    startMessage={pool.startMessages.get(machine.id)}
                    resolutionAutoAlign={machine.resolutionAutoAlign}
                    onRegister={pool.onRegister}
                    onUnregister={pool.onUnregister}
                    onStateChange={pool.onStateChange}
                    onStarted={pool.onStarted}
                    onGuestPoweredOff={pool.onGuestPoweredOff}
                    onBootError={handleBootError}
                    onIframeLoadFailed={handleIframeLoadFailed}
                    onDiskWriteFailed={handleDiskWriteFailed}
                    onGuestClipboard={handleGuestClipboard}
                    onGuestFileEvent={handleGuestFileEvent}
                    onNativeKey={handleNativeKey}
                    onCaptureKeyboard={captureGuestKeyboard}
                    isDisplayed={isDisplayed}
                  />
                </div>
              )
            })}
            {displayedId === undefined ? (
              <div class="virtual-machine__screen virtual-machine__screen--single">
                {screenMessage ? (
                  <div class="virtual-machine__screen-message">{screenMessage}</div>
                ) : null}
              </div>
            ) : null}
            {displayedBusy ? (
              <div class="virtual-machine__screen-message">正在连接模拟器…</div>
            ) : null}
          </div>
          <div
            class="virtual-machine__activity-slot"
            onPointerDown={releaseGuestKeyboard}
          >
            <VirtualMachineActivity
              stats={selectedSnapshot?.stats}
              running={selectedRunning && !displayedBusy}
              diskStreamIds={selectedDiskStreamIds}
              mountedSlots={vmMountedDiskSlots(selected?.devices)}
            />
          </div>
          {inspectorOpen && selected ? (
            <VirtualMachineInspectorOverlay
              machine={selected}
              running={selectedRunning}
              snapshot={selectedSnapshot}
              onClose={() => setInspectorOpen(false)}
            />
          ) : null}
        </section>
      </div>
      <VirtualMachineSettingsDialog
        open={settingsOpen}
        mode={settingsSession?.mode ?? 'create'}
        initial={settingsSession?.initial ?? defaultVirtualMachineSettings()}
        running={
          settingsSession?.mode === 'edit' &&
          pool.runningIds.includes(settingsSession.id)
        }
        onClose={() => setSettingsSession(undefined)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
