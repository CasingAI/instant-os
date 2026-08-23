import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildStartMessage, loadVirtualMachineDisks } from './virtual-machine-disks.ts'
import { releaseVirtualMachineDiskStreams } from './virtual-machine-disk-stream-host.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isHttpDiskUrl,
  isInstantVmRuntimeToHostMessage,
  type InstantVmDisplayMode,
  type InstantVmKeyboardMessage,
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
const DISK_LOAD_TIMEOUT_MS = 120_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    }),
  ])
}

type Pending = {
  resolve: () => void
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

export type VmRuntimeApi = {
  start(message: InstantVmStartMessage): Promise<void>
  stop(): Promise<void>
  reset(): Promise<void>
  setDisplayMode(mode: InstantVmDisplayMode): Promise<void>
  sendKeyboard(message: InstantVmKeyboardMessage): void
  captureKeyboard(): void
  releaseKeyboard(): void
}

export type VmRuntimeSnapshot = {
  ready: boolean
  stats: InstantVmStatsSnapshot | undefined
  bootProgress: string | undefined
}

/**
 * 单个虚拟机运行时实例。每个实例有独立的 iframe 与状态，消息按 iframe 来源隔离，
 * 因此可同时存在多个互不干扰的实例。
 */
export function useVirtualMachineRuntime(origin: string | undefined) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingRef = useRef(new Map<string, Pending>())
  const [ready, setReady] = useState(false)
  const [stats, setStats] = useState<InstantVmStatsSnapshot | undefined>(undefined)
  const [bootProgress, setBootProgress] = useState<string | undefined>(undefined)

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
    setStats(undefined)
    setBootProgress(undefined)
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
        setReady(true)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.progress) {
        setBootProgress(message.message)
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
        failAll(error)
        return
      }

      const pending = pendingRef.current.get(message.requestId)
      if (!pending) {
        return
      }
      pendingRef.current.delete(message.requestId)
      pending.resolve()
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      failAll(new Error('运行时已卸载'))
    }
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
    (
      message: { requestId: string; type?: string; mode?: InstantVmDisplayMode },
      transfer: Transferable[] = [],
      timeoutMs = REQUEST_TIMEOUT_MS,
    ) => {
      return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(message.requestId)
          reject(new Error('运行时无响应'))
        }, timeoutMs)
        pendingRef.current.set(message.requestId, {
          resolve: () => {
            window.clearTimeout(timer)
            resolve()
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
      console.log('[vm-boot] posting start', message.requestId, targetOrigin)
      await request(message, collectStartTransfers(message), timeoutMs)
      console.log('[vm-boot] start acknowledged', message.requestId)
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

  return {
    iframeRef,
    ready,
    stats,
    bootProgress,
    start,
    stop,
    reset,
    setDisplayMode,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
  }
}

/**
 * 管理同一窗口内多个虚拟机运行时实例：
 * - 每个运行中的 machineId 挂载一个 `VmRuntimeSurface`（独立 iframe，见 virtual-machine-runtime-surface.tsx）。
 * - 提供开机/关机/重置/显示比例等命令，命令按 machineId 路由到对应实例。
 */
export function useVirtualMachineRuntimePool(origin: string | undefined) {
  const [runningIds, setRunningIds] = useState<readonly string[]>([])
  const [startMessages, setStartMessages] = useState<ReadonlyMap<string, InstantVmStartMessage>>(
    new Map(),
  )
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, VmRuntimeSnapshot>>(new Map())
  const [startedIds, setStartedIds] = useState<ReadonlySet<string>>(new Set())
  const [hints, setHints] = useState<ReadonlyMap<string, string>>(new Map())
  const runningIdsRef = useRef(new Set<string>())
  const apiByIdRef = useRef(new Map<string, VmRuntimeApi>())

  const addRunningId = useCallback((id: string) => {
    runningIdsRef.current.add(id)
    setRunningIds([...runningIdsRef.current])
  }, [])

  const removeRunningId = useCallback((id: string) => {
    runningIdsRef.current.delete(id)
    setRunningIds([...runningIdsRef.current])
    setStartMessages((current) => {
      const next = new Map(current)
      const message = next.get(id)
      if (message) {
        releaseVirtualMachineDiskStreams(message)
      }
      next.delete(id)
      return next
    })
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
  }, [])

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
  }, [])

  const onBootError = useCallback((id: string, message: string) => {
    removeRunningId(id)
    setHints((current) => new Map(current).set(id, message))
  }, [removeRunningId])

  const boot = useCallback(
    async (machine: VirtualMachineRecord): Promise<void> => {
      const id = machine.id
      if (runningIdsRef.current.has(id)) {
        console.log('[vm-boot] already running', id)
        return
      }
      const hasRemoteDisk = machine.devices.some(
        (device) => device.path.trim() && isHttpDiskUrl(device.path),
      )
      addRunningId(id)
      setHints((current) =>
        new Map(current).set(id, hasRemoteDisk ? '正在启动模拟器…' : '正在读取镜像…'),
      )
      console.log('[vm-boot] loading disks', id, { hasRemoteDisk })
      try {
        const disks = await withTimeout(
          loadVirtualMachineDisks(machine),
          DISK_LOAD_TIMEOUT_MS,
          '读取镜像',
        )
        console.log('[vm-boot] disks loaded', id, diskPresence(disks))
        if (!runningIdsRef.current.has(id)) {
          console.log('[vm-boot] machine stopped before start message built', id)
          return
        }
        setHints((current) => new Map(current).set(id, '正在启动模拟器…'))
        const message = buildStartMessage(newVmRequestId(), machine, disks)
        console.log('[vm-boot] built start message', id, message.requestId)
        setStartMessages((current) => new Map(current).set(id, message))
        if (machine.network !== 'none' && machine.networkBackend === 'off') {
          setHints((current) => new Map(current).set(id, '已挂网卡但未选网络后端，按离线启动'))
        }
      } catch (error) {
        console.error('[vm-boot] failed', id, error)
        removeRunningId(id)
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
        removeRunningId(id)
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

  const sendKeyboard = useCallback((id: string, message: InstantVmKeyboardMessage) => {
    apiByIdRef.current.get(id)?.sendKeyboard(message)
  }, [])

  const captureKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.captureKeyboard()
  }, [])

  const releaseKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.releaseKeyboard()
  }, [])

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
    setActiveDisplayMode,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    onRegister,
    onUnregister,
    onStateChange,
    onStarted,
    onBootError,
  }
}
