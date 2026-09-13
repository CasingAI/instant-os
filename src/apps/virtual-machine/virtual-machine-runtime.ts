import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  buildStartMessage,
  claimVirtualMachineDiskImageOccupancy,
  loadVirtualMachineDisks,
  releaseVirtualMachineDiskImageOccupancy,
  releaseVirtualMachineRemovableMedia,
} from './virtual-machine-disks.ts'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import {
  releaseVirtualMachineDiskStreams,
  requestVirtualMachineDiskStreamAbandon,
  setVirtualMachineDiskStreamMode,
} from './virtual-machine-disk-stream-host.ts'
import { listVmDiskStreamIds } from './virtual-machine-disk-stream-metrics.ts'
import { combineDiskWriteLoss } from './virtual-machine-disk-write-status.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  collectStartTransfers,
  isInstantVmRuntimeToHostMessage,
  type InstantVmAgentResultMessage,
  type InstantVmDisplayMode,
  type InstantVmDiskStreamRef,
  type InstantVmFloppySlot,
  type InstantVmKeyboardMessage,
  type InstantVmNativeKeyMessage,
  type InstantVmPointerMode,
  type InstantVmSaveStateResultMessage,
  type InstantVmStartMessage,
  type InstantVmStatsSnapshot,
  type VmGuestFileEvent,
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

export const DISK_WRITE_FAILED_FORCE_STOP_HINT =
  '硬盘回写失败，已强制标记为已关机；镜像可能不完整'
export const DISK_IMAGE_INCOMPLETE_HINT = '硬盘回写未完成，镜像可能不完整'
// 强制断电后的短提示：在途批次可能没进差量；已经写入差量的部分下次开机仍可合并。
export const FORCED_OFF_UNFLUSHED_HINT = '尚未保存完的硬盘改动可能丢失'
export const READING_DISK_IMAGE_HINT = '正在读取镜像…'
export const STARTING_EMULATOR_HINT = '正在启动模拟器…'

// 断电只给运行时 3 秒 ack 窗口：客机死循环等故障可能让 iframe 事件循环收不了
// 消息，ack 永远不来；到点后由调用方强拆收场（断电＝removeRunningId 卸载
// iframe），不陪 60 秒请求超时。
export const STOP_ACK_DEADLINE_MS = 3_000
// 到点后先观察 iframe 消息活动再强拆：真卡死（事件循环被占满）时任何消息都
// 发不出，持续静默即拆；消息仍在流动说明写回 drain 在推进，多等可把数据刷完。
export const STOP_ACTIVITY_SILENCE_MS = 1_500
const STOP_ACTIVITY_POLL_MS = 500

export type AckDeadlineOutcome = 'acked' | 'command-failed' | 'forced'

/**
 * 运行时命令（断电 stop）的 ack 期限：期限内没回执就返回 'forced'，由调用方
 * 强拆收场。命令失败不外抛（post 失败通常意味着 iframe 已经不在了），只转化为
 * 'command-failed'，同时避免强拆获胜后败者 promise 变成 unhandled rejection。
 * 提供 isRecentlyActive 时，期限到点后进入静默观察：持续活跃（数据在刷）就一直
 * 陪它刷完（没有到点自动丢尾巴的上限——放弃只走屏幕上的按钮）；转静默立即强拆；
 * 不提供则到点即判强拆。
 */
export async function withAckDeadline(options: {
  command: () => Promise<void>
  isRecentlyActive?: () => boolean
  deadlineMs?: number
  schedule?: (callback: () => void, ms: number) => () => void
}): Promise<AckDeadlineOutcome> {
  const deadlineMs = options.deadlineMs ?? STOP_ACK_DEADLINE_MS
  const schedule =
    options.schedule ??
    ((callback, ms) => {
      const timer = globalThis.setTimeout(callback, ms)
      return () => globalThis.clearTimeout(timer)
    })
  const cancels: Array<() => void> = []
  const run = (callback: () => void, ms: number) => {
    cancels.push(schedule(callback, ms))
  }
  const outcome = new Promise<AckDeadlineOutcome>((resolve) => {
    run(() => {
      const isRecentlyActive = options.isRecentlyActive
      if (!isRecentlyActive) {
        resolve('forced')
        return
      }
      const poll = () => {
        if (!isRecentlyActive()) {
          resolve('forced')
          return
        }
        run(poll, STOP_ACTIVITY_POLL_MS)
      }
      poll()
    }, deadlineMs)
  })
  try {
    return await Promise.race([
      options.command().then(
        () => 'acked' as const,
        () => 'command-failed' as const,
      ),
      outcome,
    ])
  } finally {
    for (const cancel of cancels.splice(0)) {
      cancel()
    }
  }
}

/** 临时开机进度文案：模拟器回报已启动后就该清掉；警告类 hint 不算，开机后仍有用。 */
export function isTransientBootHint(hint: string | undefined): boolean {
  return hint === READING_DISK_IMAGE_HINT || hint === STARTING_EMULATOR_HINT
}

export type VmRuntimeApi = {
  start(message: InstantVmStartMessage): Promise<void>
  stop(options?: { timeoutMs?: number | null }): Promise<void>
  saveState(): Promise<ArrayBuffer>
  /** 宿主最近收到该 iframe 一条消息的时刻（Date.now() 基准）；用于断电强拆前的活动判定。 */
  lastMessageAt(): number
  /**
   * 宿主最近收到的 stats 快照，**同步**可读（消息一进 handler 就更新，不等 React 渲染）。
   *
   * 收口需要读 drain 之后、`dispose()` 之前补发的那一份最终快照里的丢弃计数，
   * 而那条 stats 与随后的 stopped 是背靠背到达的：走 state + effect 会输给 stopped
   * 处理里的同步读取，只能从这条不经渲染的通道拿。
   */
  latestStats(): InstantVmStatsSnapshot | undefined
  setDisplayMode(mode: InstantVmDisplayMode): Promise<void>
  setPointerMode(mode: InstantVmPointerMode): Promise<void>
  /** 运行中切换「体验增强·绝对坐标鼠标」放行位。 */
  setAbsoluteMouse(enabled: boolean): Promise<void>
  /** 运行中热开关共享文件夹拦截器；未运行时静默（下次 start 按配置生效）。 */
  setSharedFolder(enabled: boolean): Promise<void>
  setResolution(width: number, height: number): Promise<void>
  /** 运行中换盘（热插）。stream 必须已由宿主注册；回执前镜像不会被 guest 读到。 */
  setCdrom(stream: InstantVmDiskStreamRef): Promise<void>
  ejectCdrom(): Promise<void>
  setFloppy(slot: InstantVmFloppySlot, stream: InstantVmDiskStreamRef): Promise<void>
  ejectFloppy(slot: InstantVmFloppySlot): Promise<void>
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
  onGuestFileEvent?: (event: VmGuestFileEvent) => void,
  onNativeKey?: (message: InstantVmNativeKeyMessage) => void,
  /**
   * 客机自行切电、差量合并即将开始。宿主据此立即进入「正在写入」状态。
   */
  onGuestPoweroffDraining?: () => void,
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
  const onGuestFileEventRef = useRef(onGuestFileEvent)
  onGuestFileEventRef.current = onGuestFileEvent
  const onNativeKeyRef = useRef(onNativeKey)
  onNativeKeyRef.current = onNativeKey
  const onGuestPoweroffDrainingRef = useRef(onGuestPoweroffDraining)
  onGuestPoweroffDrainingRef.current = onGuestPoweroffDraining
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  // 运行时最近一条消息（含 stats/diskWrite）的宿主收到时间：断电强拆前用它区分
  // 「事件循环真卡死（完全静默）」和「ack 慢但数据还在刷（活跃，值得多等）」。
  const lastMessageAtRef = useRef(0)
  // stats 的同步副本：state 要等渲染+effect 才可见，而收口读最终丢弃计数时等不了。
  const latestStatsRef = useRef<InstantVmStatsSnapshot | undefined>(undefined)
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
    latestStatsRef.current = undefined
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

      lastMessageAtRef.current = Date.now()
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

      if (message.type === INSTANT_VM_MESSAGE_TYPE.guestPoweroffDraining) {
        onGuestPoweroffDrainingRef.current?.()
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.nativeKey) {
        onNativeKeyRef.current?.(message)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.guestClipboard) {
        console.info(
          `[vm-clipboard] 宿主: 收到 iframe 转发的客机文本(${message.text.length}字符) ${JSON.stringify(message.text.slice(0, 60))}`,
        )
        onGuestClipboardRef.current?.(message.text)
        return
      }

      if (
        message.type === INSTANT_VM_MESSAGE_TYPE.guestFileOffer ||
        message.type === INSTANT_VM_MESSAGE_TYPE.guestFileReq ||
        message.type === INSTANT_VM_MESSAGE_TYPE.guestFileData ||
        message.type === INSTANT_VM_MESSAGE_TYPE.guestFileDone
      ) {
        const event: VmGuestFileEvent =
          message.type === INSTANT_VM_MESSAGE_TYPE.guestFileOffer
            ? { kind: 'offer', files: message.files }
            : message.type === INSTANT_VM_MESSAGE_TYPE.guestFileReq
              ? {
                  kind: 'req',
                  session: message.session,
                  start: message.start,
                  offset: message.offset,
                  length: message.length,
                  path: message.path,
                }
              : message.type === INSTANT_VM_MESSAGE_TYPE.guestFileData
                ? {
                    kind: 'data',
                    session: message.session,
                    offset: message.offset,
                    end: message.end,
                    bytes: new Uint8Array(message.bytes),
                  }
                : { kind: 'done', session: message.session, result: message.result }
        onGuestFileEventRef.current?.(event)
        return
      }

      if (message.type === INSTANT_VM_MESSAGE_TYPE.stats) {
        // 同步落一份：收口时要在 stopped 处理的同一个任务里读到 drain 后的最终丢弃计数。
        latestStatsRef.current = message
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

  // 「原始」模式视窗平移：跨源 iframe 收不到宿主区域（侧栏/工具栏）的 mousemove，
  // 把光标位置换算成 iframe 本地坐标中继给运行时；rAF 节流。仅当光标位于该
  // 画面外扩 48px 范围内才发送，多画面时天然只命中光标附近的那一块。
  useEffect(() => {
    if (!targetOrigin) {
      return
    }
    const HINT_BAND_PX = 48
    let rafId = 0
    let clientX = 0
    let clientY = 0
    let pending = false
    const flush = () => {
      rafId = 0
      if (!pending) {
        return
      }
      pending = false
      const frame = iframeRef.current
      if (!frame) {
        return
      }
      const rect = frame.getBoundingClientRect()
      if (
        clientX < rect.left - HINT_BAND_PX ||
        clientX > rect.right + HINT_BAND_PX ||
        clientY < rect.top - HINT_BAND_PX ||
        clientY > rect.bottom + HINT_BAND_PX
      ) {
        return
      }
      try {
        post({
          type: INSTANT_VM_MESSAGE_TYPE.pointerHint,
          x: clientX - rect.left,
          y: clientY - rect.top,
        })
      } catch {
        // 运行时未就绪/不可达时丢弃；指针提示是高频可再生的，下一次移动会再试。
      }
    }
    const onMove = (event: MouseEvent) => {
      clientX = event.clientX
      clientY = event.clientY
      pending = true
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(flush)
      }
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [post, targetOrigin])

  const request = useCallback(
    <T = void>(
      message: {
        requestId: string
        type?: string
        mode?: InstantVmDisplayMode | InstantVmPointerMode
        enabled?: boolean
        width?: number
        height?: number
        slot?: InstantVmFloppySlot
        stream?: InstantVmDiskStreamRef
        method?: string
        args?: unknown[]
      },
      transfer: Transferable[] = [],
      /** null = 不设超时（整盘回写可能远超 60s，超时会假报失败）。 */
      timeoutMs: number | null = REQUEST_TIMEOUT_MS,
      resolver?: (message: unknown) => T,
    ) => {
      return new Promise<T>((resolve, reject) => {
        const timer =
          timeoutMs === null
            ? undefined
            : window.setTimeout(() => {
                pendingRef.current.delete(message.requestId)
                reject(new Error('运行时无响应'))
              }, timeoutMs)
        const clearTimer = () => {
          if (timer !== undefined) {
            window.clearTimeout(timer)
          }
        }
        pendingRef.current.set(message.requestId, {
          resolve: (value) => {
            clearTimer()
            resolve(resolver ? resolver(value) : (undefined as T))
          },
          reject: (error) => {
            clearTimer()
            reject(error)
          },
        })
        try {
          post(message, transfer)
        } catch (error) {
          clearTimer()
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

  const stop = useCallback(
    async (stopOptions?: { timeoutMs?: number | null }) => {
      try {
        await request(
          { type: INSTANT_VM_MESSAGE_TYPE.stop, requestId: newVmRequestId() },
          [],
          stopOptions?.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : stopOptions.timeoutMs,
        )
      } finally {
        setStats(undefined)
        setBootProgress(undefined)
      }
    },
    [request],
  )

  const lastMessageAt = useCallback(() => lastMessageAtRef.current, [])
  const latestStats = useCallback(() => latestStatsRef.current, [])

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

  // 运行中切换绝对坐标鼠标放行位：无状态命令，重发无害。
  const setAbsoluteMouse = useCallback(
    async (enabled: boolean) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setAbsoluteMouse,
        requestId: newVmRequestId(),
        enabled,
      })
    },
    [request],
  )

  // 运行中热开关共享文件夹拦截器：无状态命令，重发无害。
  const setSharedFolder = useCallback(
    async (enabled: boolean) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setSharedFolder,
        requestId: newVmRequestId(),
        enabled,
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

  // 运行中热插光盘/软盘：镜像走流式引用，宿主先注册流再发命令；
  // eject 与换盘会让客机收到 ATAPI UNIT_ATTENTION / 软盘换盘中断。
  const setCdrom = useCallback(
    async (stream: InstantVmDiskStreamRef) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setCdrom,
        requestId: newVmRequestId(),
        stream,
      })
    },
    [request],
  )

  const ejectCdrom = useCallback(async () => {
    await request({ type: INSTANT_VM_MESSAGE_TYPE.ejectCdrom, requestId: newVmRequestId() })
  }, [request])

  const setFloppy = useCallback(
    async (slot: InstantVmFloppySlot, stream: InstantVmDiskStreamRef) => {
      await request({
        type: INSTANT_VM_MESSAGE_TYPE.setFloppy,
        requestId: newVmRequestId(),
        slot,
        stream,
      })
    },
    [request],
  )

  const ejectFloppy = useCallback(async (slot: InstantVmFloppySlot) => {
    await request({
      type: INSTANT_VM_MESSAGE_TYPE.ejectFloppy,
      requestId: newVmRequestId(),
      slot,
    })
  }, [request])

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
    // iframe 文档重载（origin 不变时旧的 stats 副本会滞留到新会话第一条 stats）：
    // 这里清一次，避免新会话还没发过 stats 就收口时读到上一会话的最终计数。
    latestStatsRef.current = undefined
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
    lastMessageAt,
    latestStats,
    saveState,
    setDisplayMode,
    setPointerMode,
    setAbsoluteMouse,
    setResolution,
    setCdrom,
    ejectCdrom,
    setFloppy,
    ejectFloppy,
    sendKeyboard,
    captureKeyboard,
    releaseKeyboard,
    agentCommand,
    setSharedFolder,
  }
}

/**
 * 管理同一窗口内多个虚拟机运行时实例：
 * - 每个运行中的 machineId 挂载一个 `VmRuntimeSurface`（独立 iframe，见 virtual-machine-runtime-surface.tsx）。
 * - 提供开机/关机/重置/显示比例等命令，命令按 machineId 路由到对应实例。
 */
export type VmDiskCacheDecision = 'discard' | 'merge'

export type VmRuntimePoolOptions = {
  /** 关机落盘失败（磁盘流释放异常）后触发。 */
  onDiskWriteIncomplete?: (id: string) => void
  /** 关机收尾丢弃了已接收的客机写（宽限期后仍到达），镜像可能缺已 ack 的数据。 */
  onDiskWriteDirty?: (id: string, detail: { discardedWrites: number }) => void
  /**
   * 本次会话存在没能写进镜像的写入（iframe 侧丢弃 + 宿主侧闸门丢弃合计）。
   *
   * 与上面两个「当场弹一次」的回调不同，这个用于**持久化**：iframe 一销毁计数就没了，
   * 只有写进机器记录，「镜像可能不完整」才能活到用户下次开机。
   */
  onDiskWriteLoss?: (id: string, detail: { droppedWrites: number; droppedBytes: number }) => void
  /**
   * 不保存档收尾询问：断电后缓存落稳（全部流排干）才调用。返回 'discard' = 删缓存，
   * 'merge' = 合并进可见文件。没接这个回调时按合并收尾（不丢用户数据）。
   */
  onDiskCacheDecision?: (id: string) => Promise<VmDiskCacheDecision>
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
  /** 正在收尾落盘（drain→close）的机器：UI 据此显示「正在写入」硬控画面。 */
  const [flushingIds, setFlushingIds] = useState<readonly string[]>([])
  /** 用户已确认放弃剩余写入的机器。 */
  const forcedStopIdsRef = useRef<Set<string>>(new Set())
  /** 同一台机器正在收口中的 promise（去重，避免重复释放磁盘流）。 */
  const removeInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const runningIdsRef = useRef(new Set<string>())
  const startMessagesRef = useRef(new Map<string, InstantVmStartMessage>())
  const apiByIdRef = useRef(new Map<string, VmRuntimeApi>())

  const addRunningId = useCallback((id: string) => {
    runningIdsRef.current.add(id)
    setRunningIds([...runningIdsRef.current])
  }, [])

  const removeRunningIdNow = useCallback(async (id: string) => {
    setFlushingIds((current) => (current.includes(id) ? current : [...current, id]))
    try {
      const message = startMessagesRef.current.get(id)
      let releaseError: unknown
      // iframe 侧的丢弃计数只存在于它的 stats 里，收口后就再也读不到了——先取出来，
      // 与宿主释放闸门丢掉的写入合并成一条会持久化的记录（见 onDiskWriteLoss）。
      // 必须走 api.latestStats()：最终那份快照是 drain 结束后补发的，与 stopped 背靠背
      // 到达，而 React state 要等渲染+effect 才更新，会输给这里的同步读取。
      const runtimeLoss = apiByIdRef.current.get(id)?.latestStats()?.diskWrite
      let hostDiscardedWrites = 0
      try {
        if (message) {
          // 顺序不变量：磁盘流排干→（不保存档问完）→关会话全部完成后，才释放占用声明
          // 并卸载 iframe——最后一字节落盘永远先于「这块镜像可以被别人打开」。
          const { discardedWrites } = await releaseVirtualMachineDiskStreams(message, {
            decideCache: optionsRef.current.onDiskCacheDecision
              ? async () => {
                  const decision = await optionsRef.current.onDiskCacheDecision!(id)
                  return decision
                }
              : undefined,
          })
          hostDiscardedWrites = discardedWrites
          if (discardedWrites > 0) {
            recordSystemDebugTimeline({
              layer: 'vm',
              op: 'disk-writes-discarded',
              detail: { id, discardedWrites },
            })
            optionsRef.current.onDiskWriteDirty?.(id, { discardedWrites })
          }
        }
      } catch (error) {
        releaseError = error
        console.error('[vm] 释放磁盘流失败', id, error)
      }
      const loss = combineDiskWriteLoss(runtimeLoss, hostDiscardedWrites)
      if (loss) {
        optionsRef.current.onDiskWriteLoss?.(id, loss)
      }
      // 运行期间热插上的光盘/软盘流不在 start 消息里，随停机一并释放。
      await releaseVirtualMachineRemovableMedia(id).catch((error: unknown) => {
        console.error('[vm] 释放热插媒体流失败', id, error)
      })
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
    } finally {
      setFlushingIds((current) => current.filter((value) => value !== id))
    }
  }, [])

  /**
   * 收口一台机器：去重 + 已收口直接返回。多个入口会同时想收口（客机 stopped、用户强拆、
   * shutdown 的 finally），重复跑会二次释放已关的磁盘流、还会误报「落盘未完成」。
   */
  const removeRunningId = useCallback(
    (id: string): Promise<void> => {
      const existing = removeInFlightRef.current.get(id)
      if (existing) {
        return existing
      }
      if (!runningIdsRef.current.has(id) && !startMessagesRef.current.has(id)) {
        return Promise.resolve()
      }
      const run = removeRunningIdNow(id).finally(() => {
        removeInFlightRef.current.delete(id)
      })
      removeInFlightRef.current.set(id, run)
      return run
    },
    [removeRunningIdNow],
  )

  /**
   * 强制结束一台机器：置 forcedStop 标记并卸载 iframe，收口按档位进行
   * （poweroff 后台合并、none 弹「写入硬盘文件？」给反悔机会）——不打 abandon。
   * 正常关窗（点 X / close handler 答 finish）的卸载 cleanup 也走这里，
   * 不能把正常关窗当成强制结束静默丢掉 none 档缓存。
   */
  const forceStop = useCallback(
    (id: string): Promise<void> => {
      if (!runningIdsRef.current.has(id)) {
        return Promise.resolve()
      }
      forcedStopIdsRef.current.add(id)
      recordSystemDebugTimeline({ layer: 'vm', op: 'force-stop', detail: id })
      return removeRunningId(id).catch(() => undefined)
    },
    [removeRunningId],
  )

  /**
   * 硬控画面「放弃」与窗口强制结束：先给全部磁盘流打 abandon 标记（收口不再
   * 按档位写完/合并、不保存档也不再问「写入硬盘文件？」），再按 forceStop 收口
   * 卸 iframe。abandon 标记幂等，与 forceStop 不冲突。
   */
  const abandonWrites = useCallback(
    (id: string): Promise<void> => {
      if (!runningIdsRef.current.has(id)) {
        return Promise.resolve()
      }
      const message = startMessagesRef.current.get(id)
      if (message) {
        requestVirtualMachineDiskStreamAbandon(listVmDiskStreamIds(message))
      }
      return forceStop(id)
    },
    [forceStop],
  )

  const onRegister = useCallback((id: string, api: VmRuntimeApi) => {
    apiByIdRef.current.set(id, api)
  }, [])

  const onUnregister = useCallback((id: string) => {
    apiByIdRef.current.delete(id)
  }, [])

  const onStateChange = useCallback((id: string, snapshot: VmRuntimeSnapshot) => {
    // 收口要读的最终丢弃计数走 api.latestStats()：那条 stats 与 stopped 背靠背到达，
    // 等不到这里的 effect 刷新。
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

  /**
   * 客机自行切电、差量合并即将开始。置 flushingIds 让 UI 立刻进入「正在写入」。
   */
  const onGuestPoweroffDraining = useCallback((id: string) => {
    recordSystemDebugTimeline({ layer: 'vm', op: 'guest-poweroff-draining', detail: id })
    setFlushingIds((current) => (current.includes(id) ? current : [...current, id]))
  }, [])

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
        // 上次运行可能异常退出，残留的热插媒体流在这里兜底清理。
        await releaseVirtualMachineRemovableMedia(id)
        await claimVirtualMachineDiskImageOccupancy(id, machine.devices)
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

  // 断电：给运行时 3 秒 ack 窗口，到点后看 iframe 消息活动——真卡死（静默）立即
  // 强拆，在途写入转发还在推进就一直陪它刷完（没有到点丢尾巴的上限）。finally 里
  // removeRunningId 把改动写完才卸 iframe。期间 flushingIds 置位，UI 显示「正在写入」。
  const shutdown = useCallback(
    async (id: string): Promise<boolean> => {
      if (!runningIdsRef.current.has(id)) {
        return false
      }
      const api = apiByIdRef.current.get(id)
      setFlushingIds((current) => (current.includes(id) ? current : [...current, id]))
      let forced = false
      try {
        if (api) {
          const outcome = await withAckDeadline({
            command: () => api.stop(),
            isRecentlyActive: () => Date.now() - api.lastMessageAt() < STOP_ACTIVITY_SILENCE_MS,
          })
          forced = outcome === 'forced'
          if (forcedStopIdsRef.current.delete(id)) {
            forced = true
            recordSystemDebugTimeline({ layer: 'vm', op: 'stop-forced-by-user', detail: id })
          } else if (forced) {
            recordSystemDebugTimeline({ layer: 'vm', op: 'stop-ack-deadline', detail: id })
          }
        }
      } finally {
        try {
          await removeRunningId(id)
        } catch {
          optionsRef.current.onDiskWriteIncomplete?.(id)
        }
      }
      return forced
    },
    [removeRunningId],
  )

  /**
   * 运行中切硬盘写入档位：只允许 none ⇄ poweroff（live 开机后锁死）。
   * 只改「最终合不合并」，缓存不删；UI 层负责在保存设置时同步机器记录。
   */
  const setDiskWriteMode = useCallback(
    (id: string, mode: 'poweroff' | 'none'): Promise<void> => {
      const message = startMessagesRef.current.get(id)
      if (!message) {
        return Promise.resolve()
      }
      const streamIds = listVmDiskStreamIds(message)
      return Promise.all(
        streamIds.map((streamId) => setVirtualMachineDiskStreamMode(streamId, mode)),
      ).then(() => {
        const nextMessages = new Map(startMessagesRef.current)
        const next: InstantVmStartMessage = {
          ...message,
          config: { ...message.config, diskWriteMode: mode },
        }
        nextMessages.set(id, next)
        startMessagesRef.current = nextMessages
        setStartMessages(nextMessages)
      })
    },
    [],
  )

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

  const setActiveAbsoluteMouse = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        return
      }
      await api.setAbsoluteMouse(enabled)
    },
    [],
  )

  const setSharedFolder = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        return
      }
      await api.setSharedFolder(enabled)
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

  // 运行中热插光盘/软盘。runningIds 在开机读盘阶段就会置位，iframe 控制面可能还没挂上；
  // 没有 api 时必须抛错，不能静默当成功，否则调用方会落盘、客机托盘却是空的。
  const setActiveCdrom = useCallback(async (id: string, stream: InstantVmDiskStreamRef) => {
    const api = apiByIdRef.current.get(id)
    if (!api) {
      throw new Error('虚拟机尚未就绪')
    }
    await api.setCdrom(stream)
  }, [])

  const ejectActiveCdrom = useCallback(async (id: string) => {
    const api = apiByIdRef.current.get(id)
    if (!api) {
      throw new Error('虚拟机尚未就绪')
    }
    await api.ejectCdrom()
  }, [])

  const setActiveFloppy = useCallback(
    async (id: string, slot: InstantVmFloppySlot, stream: InstantVmDiskStreamRef) => {
      const api = apiByIdRef.current.get(id)
      if (!api) {
        throw new Error('虚拟机尚未就绪')
      }
      await api.setFloppy(slot, stream)
    },
    [],
  )

  const ejectActiveFloppy = useCallback(async (id: string, slot: InstantVmFloppySlot) => {
    const api = apiByIdRef.current.get(id)
    if (!api) {
      throw new Error('虚拟机尚未就绪')
    }
    await api.ejectFloppy(slot)
  }, [])

  const sendKeyboard = useCallback((id: string, message: InstantVmKeyboardMessage) => {
    apiByIdRef.current.get(id)?.sendKeyboard(message)
  }, [])

  // 同步读 ref 里的最新 stats：轮询闭包走 React state（snapshots）会拿到陈旧快照。
  const latestStats = useCallback(
    (id: string) => apiByIdRef.current.get(id)?.latestStats(),
    [],
  )

  const captureKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.captureKeyboard()
  }, [])

  const releaseKeyboard = useCallback((id: string) => {
    apiByIdRef.current.get(id)?.releaseKeyboard()
  }, [])

  return {
    origin,
    runningIds,
    flushingIds,
    startMessages,
    snapshots,
    startedIds,
    hints,
    boot,
    shutdown,
    setDiskWriteMode,
    agentCommand,
    setActiveDisplayMode,
    setActivePointerMode,
    setActiveAbsoluteMouse,
    setSharedFolder,
    setActiveResolution,
    setActiveCdrom,
    ejectActiveCdrom,
    setActiveFloppy,
    ejectActiveFloppy,
    sendKeyboard,
    latestStats,
    captureKeyboard,
    releaseKeyboard,
    onRegister,
    onUnregister,
    onStateChange,
    onStarted,
    onGuestPoweredOff,
    onGuestPoweroffDraining,
    forceStop,
    abandonWrites,
    onBootError,
  }
}
