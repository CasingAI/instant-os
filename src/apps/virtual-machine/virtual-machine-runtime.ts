import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildStartMessage, loadVirtualMachineDisks } from './virtual-machine-disks.ts'
import { releaseVirtualMachineDiskStreams } from './virtual-machine-disk-stream-host.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isHttpDiskUrl,
  isInstantVmRuntimeToHostMessage,
  type InstantVmDisplayMode,
  type InstantVmStartMessage,
  type InstantVmStatsSnapshot,
} from './virtual-machine-protocol.ts'
import type { VirtualMachineRecord } from './virtual-machine-types.ts'

const REQUEST_TIMEOUT_MS = 60_000
const REMOTE_DISK_REQUEST_TIMEOUT_MS = 180_000

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
      const hasRemoteDisk =
        message.hdaUrl || message.cdromUrl || message.fdaUrl || message.stateUrl ||
        message.hdaBlob || message.cdromBlob || message.fdaBlob || message.stateBlob ||
        message.hdaStream || message.cdromStream || message.fdaStream || message.stateStream
      const timeoutMs = hasRemoteDisk ? REMOTE_DISK_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
      await request(message, collectStartTransfers(message), timeoutMs)
    },
    [request],
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

  return {
    iframeRef,
    ready,
    stats,
    bootProgress,
    start,
    stop,
    reset,
    setDisplayMode,
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
        return
      }
      const hasRemoteDisk = [
        machine.hdaPath,
        machine.cdromPath,
        machine.fdaPath,
        machine.statePath,
      ].some(isHttpDiskUrl)
      addRunningId(id)
      setHints((current) =>
        new Map(current).set(id, hasRemoteDisk ? '正在启动模拟器…' : '正在读取镜像…'),
      )
      try {
        const disks = await loadVirtualMachineDisks(machine)
        if (!runningIdsRef.current.has(id)) {
          return
        }
        setHints((current) => new Map(current).set(id, '正在启动模拟器…'))
        const message = buildStartMessage(newVmRequestId(), machine, disks)
        setStartMessages((current) => new Map(current).set(id, message))
        if (machine.network !== 'none' && machine.networkBackend === 'off') {
          setHints((current) => new Map(current).set(id, '已挂网卡但未选网络后端，按离线启动'))
        }
      } catch (error) {
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
    onRegister,
    onUnregister,
    onStateChange,
    onStarted,
    onBootError,
  }
}
