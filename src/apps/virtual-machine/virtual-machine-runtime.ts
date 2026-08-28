import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  buildStartMessage,
  claimVirtualMachineDiskImageOccupancy,
  loadVirtualMachineDisks,
  releaseVirtualMachineDiskImageOccupancy,
} from './virtual-machine-disks.ts'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { releaseVirtualMachineDiskStreams } from './virtual-machine-disk-stream-host.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isInstantVmRuntimeToHostMessage,
  type InstantVmAgentResultMessage,
  type InstantVmDisplayMode,
  type InstantVmKeyboardMessage,
  type InstantVmPointerMode,
  type InstantVmSaveStateResultMessage,
  type InstantVmStartMessage,
  type InstantVmStatsSnapshot,
} from './virtual-machine-protocol.ts'
import type { VirtualMachineRecord } from './virtual-machine-types.ts'

function hasRemoteDisk(message: InstantVmStartMessage): boolean {
  return Boolean(
    message.hdaUrl ||
      message.hdbUrl ||
      message.cdromUrl ||
      message.fdaUrl ||
      message.fdbUrl ||
      message.stateUrl ||
      message.hdaBlob ||
      message.hdbBlob ||
      message.cdromBlob ||
      message.fdaBlob ||
      message.fdbBlob ||
      message.stateBlob ||
      message.hdaStream ||
      message.hdbStream ||
      message.cdromStream ||
      message.fdaStream ||
      message.fdbStream ||
      message.stateStream,
  )
}

function diskPresence(disks: Partial<InstantVmStartMessage>): {
  hda: boolean
  hdb: boolean
  cdrom: boolean
  fda: boolean
  fdb: boolean
  state: boolean
} {
  return {
    hda: Boolean(disks.hda ?? disks.hdaBlob ?? disks.hdaUrl ?? disks.hdaStream),
    hdb: Boolean(disks.hdb ?? disks.hdbBlob ?? disks.hdbUrl ?? disks.hdbStream),
    cdrom: Boolean(disks.cdrom ?? disks.cdromBlob ?? disks.cdromUrl ?? disks.cdromStream),
    fda: Boolean(disks.fda ?? disks.fdaBlob ?? disks.fdaUrl ?? disks.fdaStream),
    fdb: Boolean(disks.fdb ?? disks.fdbBlob ?? disks.fdbUrl ?? disks.fdbStream),
    state: Boolean(disks.state ?? disks.stateBlob ?? disks.stateUrl ?? disks.stateStream),
  }
}

const REQUEST_TIMEOUT_MS = 60_000
const REMOTE_DISK_REQUEST_TIMEOUT_MS = 180_000
// 保存快照要同步序列化整个虚拟机物理内存（可达 2GB）并传回宿主，远超普通请求阈值。
const SNAPSHOT_SAVE_TIMEOUT_MS = 10 * 60_000
const DISK_LOAD_TIMEOUT_MS = 120_000
// 运行时页面加载完成后会立刻发 ready 消息；超过这个时间还没来，
// 基本可以断定 iframe 里是浏览器的网络错误页（服务器没起 / 不可达）。
const RUNTIME_READY_TIMEOUT_MS = 8_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    }),
  ])
}

type Pending = {
  resolve: (value?: unknown) => void
  reject: (error: Error) => void
}

export function newVmRequestId(): string {
  return `vm-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
}

/** 右侧主屏只跟当前选中项走：选中项在跑才显示它，否则不显示任何其它机器的画面。 */
export function pickDisplayedMachineId(
  selectedId: string | undefined,
  runningIds: readonly string[],
): string | undefined {
  if (selectedId !== undefined && runningIds.includes(selectedId)) {
    return selectedId
  }
  return undefined
}

/** 后台保持挂载（但不显示）的实例：除主显实例外的所有运行中实例。 */
export function pickBackgroundMachineIds(
  displayedId: string | undefined,
  runningIds: readonly string[],
): readonly string[] {
  if (displayedId === undefined) {
    return runningIds
  }
  return runningIds.filter((id) => id !== displayedId)
}

/** 客机自己关完后发来的停止，没有对应的宿主请求号。 */
export function isUnsolicitedVmStopped(message: {
  type: string
  requestId?: string
}): boolean {
  return message.type === INSTANT_VM_MESSAGE_TYPE.stopped && message.requestId === undefined
}

/** 开机完成后模拟器自己报错：没有对应请求号，且当时也没有未完成的宿主请求。 */
export function shouldSurfaceUnsolicitedVmError(
  message: { type: string; requestId?: string },
  pendingCount: number,
): boolean {
  return (
    message.type === INSTANT_VM_MESSAGE_TYPE.error &&
    message.requestId === undefined &&
    pendingCount === 0
  )
}

export const DISK_WRITE_FAILED_FORCE_STOP_MS = 30_000
export const DISK_WRITE_FAILED_FORCE_STOP_HINT =
  '硬盘回写失败，已强制标记为已关机；镜像可能不完整'
export const DISK_IMAGE_INCOMPLETE_HINT = '硬盘回写未完成，镜像可能不完整'
export const READING_DISK_IMAGE_HINT = '正在读取镜像…'
export const STARTING_EMULATOR_HINT = '正在启动模拟器…'

/** 临时开机进度文案：模拟器回报已启动后就该清掉；警告类 hint 不算，开机后仍有用。 */
export function isTransientBootHint(hint: string | undefined): boolean {
  return hint === READING_DISK_IMAGE_HINT || hint === STARTING_EMULATOR_HINT
}

export function createDiskWriteFailedWatchdog(options: {
  delayMs?: number
  isRunning: (id: string) => boolean
  onForceStop: (id: string) => void
  schedule?: (callback: () => void, ms: number) => () => void
}) {
  const delayMs = options.delayMs ?? DISK_WRITE_FAILED_FORCE_STOP_MS
  const schedule =
    options.schedule ??
    ((callback, ms) => {
      const timer = globalThis.setTimeout(callback, ms)
      return () => globalThis.clearTimeout(timer)
    })
  const cancels = new Map<string, () => void>()

  const cancel = (id: string) => {
    const clear = cancels.get(id)
    if (!clear) {
      return
    }
    cancels.delete(id)
    clear()
  }

  return {
    arm(id: string) {
      if (cancels.has(id) || !options.isRunning(id)) {
        return
      }
      const clear = schedule(() => {
        cancels.delete(id)
        if (!options.isRunning(id)) {
          return
        }
        options.onForceStop(id)
      }, delayMs)
      cancels.set(id, clear)
    },
    cancel,
    dispose() {
      for (const id of [...cancels.keys()]) {
        cancel(id)
      }
    },
  }
}

export type VmRuntimeApi = {
  start(message: InstantVmStartMessage): Promise<void>
  stop(): Promise<void>
  reset(): Promise<void>
  saveState(): Promise<ArrayBuffer>
  setDisplayMode(mode: InstantVmDisplayMode): Promise<void>
  setPointerMode(mode: InstantVmPointerMode): Promise<void>
  setResolution(width: number, height: number): Promise<void>
  sendKeyboard(message: InstantVmKeyboardMessage): void
  captureKeyboard(): void
  releaseKeyboard(): void
  /** 转调运行时页 window.__vm 白名单方法；失败（含控制面未启用）时 reject。 */
  agentCommand(method: string, args?: readonly unknown[]): Promise<unknown>
}

/**
 * iframe 文档级加载状态。`loading` 是默认值；`ready` 表示文档至少 load 完毕；
 * `error` 表示后端不可达、跨域被拒等导致 iframe 渲染了浏览器错误页。
 */
export type VmIframeStatus = 'loading' | 'ready' | 'error'

export type VmRuntimeSnapshot = {
  ready: boolean
  stats: InstantVmStatsSnapshot | undefined
  bootProgress: string | undefined
  iframeStatus: VmIframeStatus
}

/**
 * 单个虚拟机运行时实例。每个实例有独立的 iframe 与状态，消息按 iframe 来源隔离，
 * 因此可同时存在多个互不干扰的实例。
 */
export function useVirtualMachineRuntime(
  origin: string | undefined,
  onGuestPoweredOff?: () => void,
  onDiskWriteFailed?: (message: string) => void,
  onRuntimeError?: (message: string, detail?: string) => void,
  onIframeLoadFailed?: (detail: string) => void,
  onGuestClipboard?: (text: string) => void,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(new Map<string, Pending>())
  const onGuestPoweredOffRef = useRef(onGuestPoweredOff)
  onGuestPoweredOffRef.current = onGuestPoweredOff
  const onDiskWriteFailedRef = useRef(onDiskWriteFailed)
  onDiskWriteFailedRef.current = onDiskWriteFailed
  const onRuntimeErrorRef = useRef(onRuntimeError)
  onRuntimeErrorRef.current = onRuntimeError
  const onIframeLoadFailedRef = useRef(onIframeLoadFailed)
  onIframeLoadFailedRef.current = onIframeLoadFailed
  const onGuestClipboardRef = useRef(onGuestClipboard)
  onGuestClipboardRef.current = onGuestClipboard
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [stats, setStats] = useState<InstantVmStatsSnapshot | undefined>(undefined)
  const [bootProgress, setBootProgress] = useState<string | undefined>(undefined)
  const [iframeStatus, setIframeStatus] = useState<VmIframeStatus>('loading')

  // iframe src 可能带 ?v86= 参数，但 postMessage 的 event.origin 只包含 scheme/host/port。
  const targetOrigin = useMemo(
    () => (origin ? new URL(origin).origin : origin),
    [origin],
  )

  const failAll = useCallback((error: Error) => {
    for (const pending of pendingRef.current.values()) {
      pending.reject(error)
    }
    pendingRef.current.clear()
  }, [])

  useEffect(() => {
    setReady(false)
    readyRef.current = false
    setStats(undefined)
    setBootProgress(undefined)
    setIframeStatus('loading')
    failAll(new Error('运行时已重新加载'))
  }, [failAll, targetOrigin])

  useEffect(() => {
    if (!targetOrigin) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) {
        return
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }
      if (!isInstantVmRuntimeToHostMessage(event.data)) {
        return
      }

      const message = event.data
      if (message.type === INSTANT_VM_MESSAGE_TYPE.ready) {
        readyRef.current = true
        setReady(true)
        setIframeStatus((current) => (current === 'error' ? current : 'ready'))
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.progress) {
        setBootProgress(message.message)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.diskWriteFailed) {
        onDiskWriteFailedRef.current?.(message.message)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.guestClipboard) {
        onGuestClipboardRef.current?.(message.text)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.stats) {
        setStats(message)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.error) {
        setStats(undefined)
        const error = new Error(message.message)
        if (message.requestId) {
          const pending = pendingRef.current.get(message.requestId)
          pendingRef.current.delete(message.requestId)
          pending?.reject(error)
          return
        }
        const pendingCount = pendingRef.current.size
        failAll(error)
        if (shouldSurfaceUnsolicitedVmError(message, pendingCount)) {
          onRuntimeErrorRef.current?.(message.message, message.detail)
        }
        return
      }

      if (isUnsolicitedVmStopped(message)) {
        setStats(undefined)
        setBootProgress(undefined)
        onGuestPoweredOffRef.current?.()
        return
      }

      const requestId = 'requestId' in message ? message.requestId : undefined
      if (typeof requestId !== 'string') {
        return
      }
      const pending = pendingRef.current.get(requestId)
      if (!pending) {
        return
      }
      pendingRef.current.delete(requestId)
      if (
        message.type === INSTANT_VM_MESSAGE_TYPE.saveStateResult ||
        message.type === INSTANT_VM_MESSAGE_TYPE.agentResult
      ) {
        pending.resolve(message)
      } else {
        pending.resolve()
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      failAll(new Error('运行时已卸载'))
    }
  }, [failAll, targetOrigin])

  // iframe 的 error 事件在 Chrome 里对网络失败并不可靠（连接被拒时经常既不触发
  // load 也不触发 error，浏览器直接渲染自己的错误页），所以用 ready 消息超时兜底。
  useEffect(() => {
    if (!targetOrigin) {
      return
    }
    const timer = window.setTimeout(() => {
      if (readyRef.current) {
        return
      }
      setIframeStatus('error')
      failAll(new Error('运行时加载超时'))
      onIframeLoadFailedRef.current?.(
        `虚拟机运行时在 ${RUNTIME_READY_TIMEOUT_MS / 1000} 秒内未就绪：${targetOrigin}`,
      )
    }, RUNTIME_READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [failAll, targetOrigin])

  const post = useCallback(
    (message: object, transfer: Transferable[] = []) => {
      const contentWindow = iframeRef.current?.contentWindow
      if (!targetOrigin || !contentWindow) {
        throw new Error('虚拟机运行时未就绪')
      }
      try {
        contentWindow.postMessage(message, targetOrigin, transfer)
      } catch {
        throw new Error(
          `无法联系模拟器：当前页面是 ${window.location.origin}，运行时是 ${targetOrigin}，localhost 与 127.0.0.1 不是同一个源`,
        )
      }
    },
    [targetOrigin],
  )

  const request = useCallback(
    <T = void>(
      message: {
        requestId: string
        type?: string
        mode?: InstantVmDisplayMode | InstantVmPointerMode
        width?: number
        height?: number
        method?: string
        args?: unknown[]
      },
      transfer: Transferable[] = [],
      timeoutMs = REQUEST_TIMEOUT_MS,
      resolver?: (message: unknown) => T,
    ) => {
      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(message.requestId)
          reject(new Error('运行时无响应'))
        }, timeoutMs)
        pendingRef.current.set(message.requestId, {
          resolve: (value) => {
            window.clearTimeout(timer)
            resolve(resolver ? resolver(value) : (undefined as T))
          },
          reject: (error) => {
            window.clearTimeout(timer)
            reject(error)
          },
        })
        try {
          post(message, transfer)
        } catch (error) {
          window.clearTimeout(timer)
          pendingRef.current.delete(message.requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    [post],
  )

  const start = useCallback(
    async (message: InstantVmStartMessage) => {
      setStats(undefined)
      setBootProgress(undefined)
      const timeoutMs = hasRemoteDisk(message) ? REMOTE_DISK_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
      const startAt = performance.now()
      await request(message, collectStartTransfers(message), timeoutMs)
      // start ack（跨源 iframe 冷启动 v86 运行时）是「点了开机没反应」的关键观测点
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'start-ack',
        detail: message.requestId,
        durationMs: Math.round(performance.now() - startAt),
      })
    },
    [request, targetOrigin],
  )

  const stop = useCallback(async () => {
    try {
      await request({ type: INSTANT_VM_MESSAGE_TYPE.stop, requestId: newVmRequestId() })
    } finally {
      setStats(undefined)
      setBootProgress(undefined)
    }
  }, [request])

  const reset = useCallback(async () => {
    await request({ type: INSTANT_VM_MESSAGE_TYPE.reset, requestId: newVmRequestId() })
  }, [request])

  const setDisplayMode = useCallback(
    async (mode: InstantVmDisplayMode) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setDisplayMode,
        requestId: newVmRequestId(),
        mode,
      })
    },
    [request],
  )

  const setPointerMode = useCallback(
    async (mode: InstantVmPointerMode) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setPointerMode,
        requestId: newVmRequestId(),
        mode,
      })
    },
    [request],
  )

  // 分辨率自动对齐的注入点：运行时把值写进 v86 io 表的 read32 闭包。
  // 无状态命令，重发无害；客机代理未安装时运行时静默忽略。
  const setResolution = useCallback(
    async (width: number, height: number) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setResolution,
        requestId: newVmRequestId(),
        width,
        height,
      })
    },
    [request],
  )

  const sendKeyboard = useCallback(
    (message: InstantVmKeyboardMessage) => {
      try {
        post(message)
      } catch {
        // 运行时未就绪时丢弃，避免按键把开机流程打爆
      }
    },
    [post],
  )

  const captureKeyboard = useCallback(() => {
    // 跨域 iframe 的 focus() 会把按键从宿主窗口抢走，却经常送不进 iframe 文档。
    // 键盘由宿主转发，这里只确保 iframe 自己不要占着焦点。
    iframeRef.current?.blur()
  }, [])

  const releaseKeyboard = useCallback(() => {
    iframeRef.current?.blur()
  }, [])

  // 控制面命令转调。snapshot 要序列化整个物理内存，与 saveState 同用长超时；
  // 其余命令在运行时页是同步动作，普通超时足够。
  const agentCommand = useCallback(
    async (method: string, args: readonly unknown[] = []): Promise<unknown> => {
      const result = await request<InstantVmAgentResultMessage>(
        {
          type: INSTANT_VM_MESSAGE_TYPE.agentCommand,
          requestId: newVmRequestId(),
          method,
          args: [...args],
        },
        [],
        method === 'snapshot' ? SNAPSHOT_SAVE_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        (value) => value as InstantVmAgentResultMessage,
      )
      return result.value
    },
    [request],
  )

  // 注意：Chrome 对「连接被拒」也会用内置错误页完成一次文档加载，iframe 的 load
  // 事件照样触发，所以 load 不能作为「运行时可用」的依据；唯一可信信号是 ready 消息。
  const handleIframeLoad = useCallback(() => {
    recordSystemDebugTimeline({ layer: 'vm', op: 'iframe-doc-loaded' })
  }, [])

  // iframe 文档级 error：通常是后端不可达 / 跨域被拒 / 协议不对，
  // Chrome 会渲染原生错误页。让 UI 自己接管提示，并把开机按钮禁掉。
  const handleIframeError = useCallback(() => {
    setIframeStatus('error')
    const detail = origin ? `无法加载虚拟机运行时：${origin}` : '无法加载虚拟机运行时'
    onIframeLoadFailedRef.current?.(detail)
  }, [origin])

  const saveState = useCallback(async (): Promise<ArrayBuffer> => {
    const startAt = performance.now()
    const result = await request<InstantVmSaveStateResultMessage>(
      { type: INSTANT_VM_MESSAGE_TYPE.saveState, requestId: newVmRequestId() },
      [],
      SNAPSHOT_SAVE_TIMEOUT_MS,
      (value) => value as InstantVmSaveStateResultMessage,
    )
    // 整个 VM 状态 ArrayBuffer 经结构化克隆回宿主：保存期间画面停顿
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'save-state',
      detail: `${result.state.byteLength}B`,
      durationMs: Math.round(performance.now() - startAt),
    })
    return result.state
  }, [request])

  return {
    iframeRef,
    ready,
    stats,
    bootProgress,
    iframeStatus,
    handleIframeLoad,
    handleIframeError,
    start,
    stop,
    reset,
    saveState,
    setDisplayMode,
    setPointerMode,
    setResolution,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    agentCommand,
  }
}

/**
 * 管理同一窗口内多个虚拟机运行时实例：
 * - 每个运行中的 machineId 挂载一个 `VmRuntimeSurface`（独立 iframe，见 virtual-machine-runtime-surface.tsx）。
 * - 提供开机/关机/重置/显示比例等命令，命令按 machineId 路由到对应实例。
 */
export type VmRuntimePoolOptions = {
  /** 硬盘回写 30s 超时被强制停机后触发（App 层用它弹窗，替代右上角小字）。 */
  onDiskWriteForceStop?: (id: string) => void
  /** 关机落盘失败（磁盘流释放异常）后触发。 */
  onDiskWriteIncomplete?: (id: string) => void
}

export function useVirtualMachineRuntimePool(
  origin: string | undefined,
  options: VmRuntimePoolOptions = {},
) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [runningIds, setRunningIds] = useState<readonly string[]>([])
  const [startMessages, setStartMessages] = useState<ReadonlyMap<string, InstantVmStartMessage>>(
    new Map(),
  )
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, VmRuntimeSnapshot>>(new Map())
  const [startedIds, setStartedIds] = useState<ReadonlySet<string>>(new Set())
  const [hints, setHints] = useState<ReadonlyMap<string, string>>(new Map())
  const runningIdsRef = useRef(new Set<string>())
  const startMessagesRef = useRef(new Map<string, InstantVmStartMessage>())
  const apiByIdRef = useRef(new Map<string, VmRuntimeApi>())
  const watchdogRef = useRef<{ cancel: (id: string) => void; arm: (id: string) => void } | undefined>(
    undefined,
  )

  const addRunningId = useCallback((id: string) => {
    runningIdsRef.current.add(id)
    setRunningIds([...runningIdsRef.current])
  }, [])

  const removeRunningId = useCallback(async (id: string) => {
    watchdogRef.current?.cancel(id)
    const message = startMessagesRef.current.get(id)
    let releaseError: unknown
    try {
      if (message) {
        await releaseVirtualMachineDiskStreams(message)
      }
    } catch (error) {
      releaseError = error
      console.error('[vm] 释放磁盘流失败', id, error)
    }
    releaseVirtualMachineDiskImageOccupancy(id)
    runningIdsRef.current.delete(id)
    setRunningIds([...runningIdsRef.current])
    const nextMessages = new Map(startMessagesRef.current)
    nextMessages.delete(id)
    startMessagesRef.current = nextMessages
    setStartMessages(nextMessages)
    setSnapshots((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
    setHints((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
    setStartedIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    if (releaseError !== undefined) {
      throw releaseError instanceof Error ? releaseError : new Error(String(releaseError))
    }
  }, [])

  const diskWriteFailedWatchdog = useMemo(
    () =>
      createDiskWriteFailedWatchdog({
        isRunning: (id) => runningIdsRef.current.has(id),
        onForceStop: (id) => {
          recordSystemDebugTimeline({
            layer: 'vm',
            op: 'disk-write-force-stop',
            detail: { id, hint: DISK_WRITE_FAILED_FORCE_STOP_HINT },
          })
          void removeRunningId(id)
            .catch(() => undefined)
            .finally(() => {
              optionsRef.current.onDiskWriteForceStop?.(id)
            })
        },
      }),
    [removeRunningId],
  )
  watchdogRef.current = diskWriteFailedWatchdog

  useEffect(() => {
    return () => diskWriteFailedWatchdog.dispose()
  }, [diskWriteFailedWatchdog])

  const onRegister = useCallback((id: string, api: VmRuntimeApi) => {
    apiByIdRef.current.set(id, api)
  }, [])

  const onUnregister = useCallback((id: string) => {
    apiByIdRef.current.delete(id)
  }, [])

  const onStateChange = useCallback((id: string, snapshot: VmRuntimeSnapshot) => {
    setSnapshots((current) => new Map(current).set(id, snapshot))
  }, [])

  const onStarted = useCallback((id: string) => {
    setStartedIds((current) => new Set(current).add(id))
    setHints((current) => {
      if (!isTransientBootHint(current.get(id))) {
        return current
      }
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  const onGuestPoweredOff = useCallback(
    (id: string) => {
      recordSystemDebugTimeline({ layer: 'vm', op: 'guest-powered-off', detail: id })
      void removeRunningId(id).catch(() => {
        optionsRef.current.onDiskWriteIncomplete?.(id)
      })
    },
    [removeRunningId],
  )

  const onBootError = useCallback((id: string, message: string, detail?: string) => {
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'boot-error',
      detail: detail?.trim()
        ? `${id}: ${detail.trim().slice(0, 4000)}`
        : `${id}: ${message.slice(0, 200)}`,
    })
    void removeRunningId(id)
      .catch(() => undefined)
      .finally(() => {
        setHints((current) => new Map(current).set(id, message))
      })
  }, [removeRunningId])

  const boot = useCallback(
    async (machine: VirtualMachineRecord): Promise<void> => {
      const id = machine.id
      const bootStartAt = performance.now()
      if (runningIdsRef.current.has(id)) {
        return
      }
      addRunningId(id)
      setHints((current) => new Map(current).set(id, READING_DISK_IMAGE_HINT))
      recordSystemDebugTimeline({ layer: 'vm', op: 'boot-start', detail: id })
      let disks:
        | Awaited<ReturnType<typeof loadVirtualMachineDisks>>
        | undefined
      try {
        claimVirtualMachineDiskImageOccupancy(id, machine.devices)
        disks = await withTimeout(
          loadVirtualMachineDisks(machine),
          DISK_LOAD_TIMEOUT_MS,
          '读取镜像',
        )
        recordSystemDebugTimeline({
          layer: 'vm',
          op: 'boot-disks-loaded',
          detail: `${id} ${diskPresence(disks)}`,
          durationMs: Math.round(performance.now() - bootStartAt),
        })
        if (!runningIdsRef.current.has(id)) {
          recordSystemDebugTimeline({
            layer: 'vm',
            op: 'boot-aborted-before-start',
            detail: id,
            durationMs: Math.round(performance.now() - bootStartAt),
          })
          await releaseVirtualMachineDiskStreams(disks)
          releaseVirtualMachineDiskImageOccupancy(id)
          return
        }
        setHints((current) => new Map(current).set(id, STARTING_EMULATOR_HINT))
        const message = buildStartMessage(newVmRequestId(), machine, disks)
        recordSystemDebugTimeline({
          layer: 'vm',
          op: 'boot-message-built',
          detail: `${id} ${message.requestId}`,
          durationMs: Math.round(performance.now() - bootStartAt),
        })
        const nextMessages = new Map(startMessagesRef.current).set(id, message)
        startMessagesRef.current = nextMessages
        setStartMessages(nextMessages)
        if (machine.network !== 'none' && machine.networkBackend === 'off') {
          setHints((current) => new Map(current).set(id, '已挂网卡但未选网络后端，按离线启动'))
        }
      } catch (error) {
        console.error('[vm-boot] failed', id, error)
        recordSystemDebugTimeline({
          layer: 'vm',
          op: 'boot-failed',
          detail: { id, error: error instanceof Error ? error.message : String(error) },
          durationMs: Math.round(performance.now() - bootStartAt),
        })
        if (disks && !startMessagesRef.current.has(id)) {
          try {
            await releaseVirtualMachineDiskStreams(disks)
          } catch (releaseError) {
            console.error('[vm] 启动失败后释放磁盘流失败', id, releaseError)
          }
        }
        try {
          await removeRunningId(id)
        } catch (releaseError) {
          console.error('[vm] 启动失败后清理运行态失败', id, releaseError)
        }
        throw error instanceof Error ? error : new Error(String(error))
      }
    },
    [addRunningId, removeRunningId],
  )

  const shutdown = useCallback(
    async (id: string): Promise<void> => {
      if (!runningIdsRef.current.has(id)) {
        return
      }
      const api = apiByIdRef.current.get(id)
      try {
        if (api) {
          await api.stop()
        }
      } finally {
        try {
          await removeRunningId(id)
        } catch {
          optionsRef.current.onDiskWriteIncomplete?.(id)
        }
      }
    },
    [removeRunningId],
  )

  const resetInstance = useCallback(async (id: string): Promise<void> => {
    const api = apiByIdRef.current.get(id)
    if (!api) {
      return
    }
    await api.reset()
  }, [])

  const saveInstanceState = useCallback(async (id: string): Promise<ArrayBuffer> => {
    const api = apiByIdRef.current.get(id)
    if (!api) {
      throw new Error('虚拟机未在运行')
    }
    return await api.saveState()
  }, [])

  const agentCommand = useCallback(
    async (id: string, method: string, args: readonly unknown[] = []): Promise<unknown> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        throw new Error('虚拟机未在运行')
      }
      return await api.agentCommand(method, args)
    },
    [],
  )

  const setActiveDisplayMode = useCallback(
    async (id: string, mode: InstantVmDisplayMode): Promise<void> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        return
      }
      await api.setDisplayMode(mode)
    },
    [],
  )

  const setActivePointerMode = useCallback(
    async (id: string, mode: InstantVmPointerMode): Promise<void> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        return
      }
      await api.setPointerMode(mode)
    },
    [],
  )

  const setActiveResolution = useCallback(
    async (id: string, width: number, height: number): Promise<void> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        return
      }
      await api.setResolution(width, height)
    },
    [],
  )

  const sendKeyboard = useCallback((id: string, message: InstantVmKeyboardMessage) => {
    apiByIdRef.current.get(id)?.sendKeyboard(message)
  }, [])

  const captureKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.captureKeyboard()
  }, [])

  const releaseKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.releaseKeyboard()
  }, [])

  const armDiskWriteFailedWatchdog = useCallback((id: string) => {
    diskWriteFailedWatchdog.arm(id)
  }, [diskWriteFailedWatchdog])

  return {
    origin,
    runningIds,
    startMessages,
    snapshots,
    startedIds,
    hints,
    boot,
    shutdown,
    resetInstance,
    saveInstanceState,
    agentCommand,
    setActiveDisplayMode,
    setActivePointerMode,
    setActiveResolution,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    onRegister,
    onUnregister,
    onStateChange,
    onStarted,
    onGuestPoweredOff,
    onBootError,
    armDiskWriteFailedWatchdog,
  }
}
