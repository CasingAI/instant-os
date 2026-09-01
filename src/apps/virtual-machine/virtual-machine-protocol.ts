/**
 * Instant OS ↔ Instant-virtual-machine postMessage protocol.
 * Keep this file in sync with Instant-virtual-machine `src/protocol.ts`.
 */

export const INSTANT_VM_MESSAGE_TYPE = {
  ready: 'instant-vm:ready',
  start: 'instant-vm:start',
  stop: 'instant-vm:stop',
  reset: 'instant-vm:reset',
  setDisplayMode: 'instant-vm:set-display-mode',
  setPointerMode: 'instant-vm:set-pointer-mode',
  setAbsoluteMouse: 'instant-vm:set-absolute-mouse',
  setResolution: 'instant-vm:set-resolution',
  setCdrom: 'instant-vm:set-cdrom',
  ejectCdrom: 'instant-vm:eject-cdrom',
  setFloppy: 'instant-vm:set-floppy',
  ejectFloppy: 'instant-vm:eject-floppy',
  saveState: 'instant-vm:save-state',
  saveStateResult: 'instant-vm:save-state-result',
  started: 'instant-vm:started',
  stopped: 'instant-vm:stopped',
  error: 'instant-vm:error',
  progress: 'instant-vm:progress',
  stats: 'instant-vm:stats',
  diskRead: 'instant-vm:disk-read',
  diskReadResult: 'instant-vm:disk-read-result',
  diskWrite: 'instant-vm:disk-write',
  diskWriteResult: 'instant-vm:disk-write-result',
  diskWriteFailed: 'instant-vm:disk-write-failed',
  keyboard: 'instant-vm:keyboard',
  nativeKey: 'instant-vm:native-key',
  pointerHint: 'instant-vm:pointer-hint',
  agentCommand: 'instant-vm:agent-command',
  agentResult: 'instant-vm:agent-result',
  guestClipboard: 'instant-vm:guest-clipboard',
  guestFileOffer: 'instant-vm:guest-file-offer',
  guestFileReq: 'instant-vm:guest-file-req',
  guestFileData: 'instant-vm:guest-file-data',
  guestFileDone: 'instant-vm:guest-file-done',
  webdavRequest: 'instant-vm:webdav-request',
  webdavResult: 'instant-vm:webdav-result',
  setSharedFolder: 'instant-vm:set-shared-folder',
} as const

/** 运行时 fetch 拦截器识别的本地镜像流 URL 前缀（挂在运行时 origin 上）。 */
export const VM_DISK_STREAM_PATH_PREFIX = '/__instant-vm-disk/'

/** WebDAV 共享文件夹使用的保留主机名（fake DNS 任意应答，桥按 Host 头送出）。 */
export const INSTANT_VM_WEBDAV_HOST = 'instant-vm-files.local'

/**
 * WebDAV 请求/响应体的单条消息上限。XP 重定向器默认 50MB 文件上限（注册表可调），
 * 宿主超限时直接回 507；拦截器超限不投递、直接本地合成 507 响应。
 */
export const INSTANT_VM_WEBDAV_BODY_MAX_BYTES = 128 * 1024 * 1024

/** 单次范围读/写上限，避免一次把整份大镜像打过 postMessage。 */
export const INSTANT_VM_DISK_RANGE_MAX_BYTES = 16 * 1024 * 1024

export type InstantVmMessageType =
  (typeof INSTANT_VM_MESSAGE_TYPE)[keyof typeof INSTANT_VM_MESSAGE_TYPE]

/** 画面呈现比例，不影响 Guest 内部分辨率。 */
export const INSTANT_VM_DISPLAY_MODES = ['stretch', 'contain', 'native'] as const

export type InstantVmDisplayMode = (typeof INSTANT_VM_DISPLAY_MODES)[number]

export const INSTANT_VM_BOOT_ORDER_IDS = [
  'auto',
  'cd-floppy-hdd',
  'cd-hdd-floppy',
  'floppy-cd-hdd',
  'floppy-hdd-cd',
  'hdd-cd-floppy',
] as const

export type InstantVmBootOrderId = (typeof INSTANT_VM_BOOT_ORDER_IDS)[number]

/** v86 `BootOrder` numeric values. */
export const INSTANT_VM_BOOT_ORDER_TO_V86: Record<InstantVmBootOrderId, number> = {
  auto: 0,
  'cd-floppy-hdd': 0x213,
  'cd-hdd-floppy': 0x123,
  'floppy-cd-hdd': 0x231,
  'floppy-hdd-cd': 0x321,
  'hdd-cd-floppy': 0x132,
}

/**
 * 网卡形态；缺省按 none（不挂网卡）。
 * Keep in sync with instant-app `VmNetworkId`。
 */
export const INSTANT_VM_NETWORK_IDS = ['none', 'ne2k', 'virtio'] as const

export type InstantVmNetworkId = (typeof INSTANT_VM_NETWORK_IDS)[number]

/**
 * 网络后端；缺省按 off（不接线）。
 * Keep in sync with instant-app `VmNetworkBackendId`。
 */
export const INSTANT_VM_NETWORK_BACKEND_IDS = ['off', 'fetch'] as const

export type InstantVmNetworkBackendId = (typeof INSTANT_VM_NETWORK_BACKEND_IDS)[number]

/**
 * 指针工作方式：`auto` 按客机是否报告绝对坐标在独占与跟随间切换；
 * `follow` 强制跟随（可移出画面）；`lock` 强制独占（点击锁定、Esc 释放）。
 * 绝对坐标接管期间 auto/lock 一律按跟随生效：独占下宿主光标被 Pointer Lock
 * 藏掉、clientX/Y 冻结，客机光标失联（指针「消失」），退出绝对模式后恢复。
 * instant-app 新建虚拟机默认下发 `auto`；协议字段省略时运行时按 `follow`。
 * Keep in sync with instant-app `VmPointerModeId`。
 */
export const INSTANT_VM_POINTER_MODES = ['auto', 'follow', 'lock'] as const

export type InstantVmPointerMode = (typeof INSTANT_VM_POINTER_MODES)[number]

/**
 * 硬盘回写时机。省略按 none（不回写镜像）。
 * Keep in sync with instant-app `VmDiskWriteModeId`。
 */
export const INSTANT_VM_DISK_WRITE_MODES = ['none', 'live', 'poweroff'] as const

export type InstantVmDiskWriteMode = (typeof INSTANT_VM_DISK_WRITE_MODES)[number]

export type InstantVmEffectivePointerMode = 'follow' | 'lock'

/** 策略落到实际捕获方式。省略字段时按跟随，以兼容旧宿主。 */
export function resolveEffectivePointerMode(
  policy: InstantVmPointerMode | undefined,
  absoluteMouse: boolean,
): InstantVmEffectivePointerMode {
  if (policy === 'lock') {
    return 'lock'
  }
  if (policy === 'follow') {
    return 'follow'
  }
  if (policy === 'auto') {
    return absoluteMouse ? 'follow' : 'lock'
  }
  return 'follow'
}

export type InstantVmStartConfig = {
  memoryMb: number
  vgaMemoryMb: number
  bootOrder: InstantVmBootOrderId
  acpi: boolean
  fastboot: boolean
  speaker: boolean
  keyboard: boolean
  mouse: boolean
  /** 网卡形态；缺省按 none。 */
  network?: InstantVmNetworkId
  /** 网络后端；缺省按 off。 */
  networkBackend?: InstantVmNetworkBackendId
  /** 启动时应用的显示比例；缺省按 contain。 */
  displayMode?: InstantVmDisplayMode
  /** 指针工作方式；instant-app 显式下发；省略时运行时按 follow。 */
  pointerMode?: InstantVmPointerMode
  /** 硬盘回写时机；省略按 none。 */
  diskWriteMode?: InstantVmDiskWriteMode
  /**
   * 分辨率自动对齐：宿主把目标分辨率经 io 端口递给客机代理（见
   * todo/vm-resolution-auto-align）。省略按 false：不挂 ResizeObserver、
   * 不注册端口，行为与旧协议完全一致。
   */
  resolutionAutoAlign?: boolean
  /**
   * 绝对坐标鼠标：false 时运行时不向 VMware backdoor 喂绝对坐标，
   * 客机驱动停留在相对模式。省略按 true：行为与旧协议完全一致。
   */
  absoluteMouse?: boolean
  /**
   * 共享文件夹（WebDAV over postMessage）：true 时运行时安装 fetch 拦截器，
   * 把客机发往保留主机名 instant-vm-files.local 的 HTTP 请求转交宿主。
   * 省略按 false：行为与旧协议完全一致。
   */
  sharedFolderEnabled?: boolean
}

export type InstantVmReadyMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.ready
}

export type InstantVmDiskStreamRef = {
  id: string
  size: number
}

export type InstantVmStorageSlot =
  | 'hda'
  | 'hdb'
  | 'cdrom'
  | 'fda'
  | 'fdb'
  | 'state'

export type InstantVmStartMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.start
  requestId: string
  config: InstantVmStartConfig
  hda?: ArrayBuffer
  hdb?: ArrayBuffer
  cdrom?: ArrayBuffer
  fda?: ArrayBuffer
  fdb?: ArrayBuffer
  state?: ArrayBuffer
  /** 大文件走 Blob 传递（structured clone 零拷贝），iframe 侧创建 blob URL 给 v86 async 加载。 */
  hdaBlob?: Blob
  hdbBlob?: Blob
  cdromBlob?: Blob
  fdaBlob?: Blob
  fdbBlob?: Blob
  stateBlob?: Blob
  hdaUrl?: string
  hdbUrl?: string
  cdromUrl?: string
  fdaUrl?: string
  fdbUrl?: string
  stateUrl?: string
  /** 大体积本地镜像：运行时经 fetch 拦截按范围向宿主拉取，避免整文件进内存。 */
  hdaStream?: InstantVmDiskStreamRef
  hdbStream?: InstantVmDiskStreamRef
  cdromStream?: InstantVmDiskStreamRef
  fdaStream?: InstantVmDiskStreamRef
  fdbStream?: InstantVmDiskStreamRef
  stateStream?: InstantVmDiskStreamRef
}

export type InstantVmDiskReadMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.diskRead
  requestId: string
  streamId: string
  offset: number
  length: number
}

export type InstantVmDiskReadResultMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.diskReadResult
  requestId: string
  streamId: string
  status: number
  totalSize: number
  bytes?: ArrayBuffer
}

export type InstantVmDiskWriteMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.diskWrite
  requestId: string
  streamId: string
  offset: number
  bytes: ArrayBuffer
}

export type InstantVmDiskWriteResultMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.diskWriteResult
  requestId: string
  streamId: string
  status: number
  totalSize: number
}

/** 客机 WebDAV 请求（宿主共享文件夹），由运行时 fetch 拦截器转发。 */
export type InstantVmWebdavRequestMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.webdavRequest
  requestId: string
  method: string
  url: string
  headers: Record<string, string>
  body?: ArrayBuffer
}

/** 宿主对 WebDAV 请求的应答，运行时据此合成 Response。 */
export type InstantVmWebdavResultMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.webdavResult
  requestId: string
  status: number
  statusText: string
  headers: Record<string, string>
  body?: ArrayBuffer
}

/** 运行中热开关共享文件夹拦截器（不需重启虚拟机）。 */
export type InstantVmSetSharedFolderMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setSharedFolder
  requestId: string
  enabled: boolean
}

export type InstantVmStopMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stop
  requestId: string
}

export type InstantVmResetMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.reset
  requestId: string
}

export type InstantVmSetDisplayModeMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setDisplayMode
  requestId: string
  mode: InstantVmDisplayMode
}

export type InstantVmSetPointerModeMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setPointerMode
  requestId: string
  mode: InstantVmPointerMode
}

/**
 * 宿主 → 运行时：运行中切换「体验增强·绝对坐标鼠标」放行位。
 * 关掉后运行时吞掉喂给客机的绝对坐标包，客机回到相对鼠标；再打开即恢复。
 */
export type InstantVmSetAbsoluteMouseMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setAbsoluteMouse
  requestId: string
  enabled: boolean
}

/**
 * 宿主 → 运行时：注入目标分辨率。运行时收到后更新 v86 io 表上
 * `RESOLUTION_CHANNEL_PORT` read32 的闭包值，客机代理轮询读取后自行切模式。
 * width/height 必须已经过宿主 clamp（v86 上限 2560×1600）。
 */
export type InstantVmSetResolutionMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setResolution
  requestId: string
  width: number
  height: number
}

/** 软驱槽位；光驱只有一个槽所以不需要 slot 字段。 */
export type InstantVmFloppySlot = 'fda' | 'fdb'

/**
 * 宿主 → 运行时：运行中换盘（热插）。镜像一律走流式引用，
 * 宿主负责先注册流、收到回执后再释放旧流。
 */
export type InstantVmSetCdromMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setCdrom
  requestId: string
  stream: InstantVmDiskStreamRef
}

export type InstantVmEjectCdromMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.ejectCdrom
  requestId: string
}

export type InstantVmSetFloppyMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.setFloppy
  requestId: string
  slot: InstantVmFloppySlot
  stream: InstantVmDiskStreamRef
}

export type InstantVmEjectFloppyMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.ejectFloppy
  requestId: string
  slot: InstantVmFloppySlot
}

export type InstantVmSaveStateMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.saveState
  requestId: string
}

export type InstantVmSaveStateResultMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.saveStateResult
  requestId: string
  /** v86 save_state 返回的运行时状态缓冲。用 transfer 转移所有权，避免再次复制。 */
  state: ArrayBuffer
}

export type InstantVmKeyboardPhase = 'down' | 'up'

/** 宿主捕获到的按键。嵌入时焦点留在宿主，运行时必须始终注入，不能因自身有焦点而丢弃。 */
export type InstantVmKeyboardMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.keyboard
  phase: InstantVmKeyboardPhase
  key: string
  code: string
  keyCode: number
  location: number
  repeat: boolean
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * 运行时拦截到的真实按键（isTrusted）。跨域 iframe 偶尔会抢到焦点，真实按键直接
 * 落进 iframe、绕开宿主的按键映射；运行时拦截后原样上报，由宿主过映射再注回来。
 * 字段与 InstantVmKeyboardMessage 一致（不带 type 语义差异，仅方向不同）。
 * Keep in sync with Instant-virtual-machine `src/protocol.ts`.
 */
export type InstantVmNativeKeyMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.nativeKey
  phase: InstantVmKeyboardPhase
  key: string
  code: string
  keyCode: number
  location: number
  repeat: boolean
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * 宿主中继的光标位置（iframe 视口本地坐标）。跨源 iframe 收不到宿主侧栏/
 * 工具栏区域的 mousemove，由宿主转发供「原始」模式视窗贴边平移判定推边方向；
 * 坐标可为负或超出视口。无请求号的高频自发消息。
 * Keep in sync with Instant-virtual-machine `src/protocol.ts`.
 */
export type InstantVmPointerHintMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.pointerHint
  x: number
  y: number
}

/**
 * 宿主下发的控制面命令：method/args 转调运行时页 `window.__vm` 白名单方法
 * （readText/screenshot/exec/click/shutdown 等）。命令失败走既有 error 回执。
 */
export type InstantVmAgentCommandMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.agentCommand
  requestId: string
  method: string
  args?: unknown[]
}

/** 控制面命令成功回执；value 结构化克隆传回宿主（无返回值时省略）。 */
export type InstantVmAgentResultMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.agentResult
  requestId: string
  value?: unknown
}

/**
 * 客机 → 宿主：客机剪贴板文本（ivm-shm 信箱 G2H 读出，XP 桥负责采集）。
 * 无请求号的自发上行；文本上限与信箱 data 区一致（16376 码元）。
 */
export type InstantVmGuestClipboardMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.guestClipboard
  text: string
}

/**
 * 客机 → 宿主：文件通道上行帧（ivm-shm 信箱 G2H，op=1，帧结构见 IVM 仓库
 * ivm-shm.ts 的 IvmFileFrame，本文件与该文件保持同构）。offer = XP 复制的
 * 文件元数据；req = 桥被 Explorer 粘贴触发的拉块请求（宿主→XP 会话）；
 * data = 桥供上的块（XP→宿主会话）；done = 粘贴完成/取消/出错。
 */
export type InstantVmGuestFileOfferMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.guestFileOffer
  files: { path: string; size: number }[]
}

export type InstantVmGuestFileReqMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.guestFileReq
  session: number
  start: boolean
  offset: number
  length: number
  path: string | null
}

export type InstantVmGuestFileDataMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.guestFileData
  session: number
  offset: number
  end: boolean
  bytes: ArrayBuffer
}

export type InstantVmGuestFileDoneMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.guestFileDone
  session: number
  result: 'ok' | 'cancel' | 'error'
}

/** 宿主侧统一文件事件（四种上行消息的判别联合，与 IVM IvmFileFrame 同构）。 */
export type VmGuestFileEvent =
  | { kind: 'offer'; files: { path: string; size: number }[] }
  | { kind: 'req'; session: number; start: boolean; offset: number; length: number; path: string | null }
  | { kind: 'data'; session: number; offset: number; end: boolean; bytes: Uint8Array }
  | { kind: 'done'; session: number; result: 'ok' | 'cancel' | 'error' }

export type InstantVmStartedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.started
  requestId: string
}

export type InstantVmStoppedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stopped
  /** 宿主点停止时带请求号；客机自己关完断电时省略。 */
  requestId?: string
}

export type InstantVmErrorMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.error
  requestId?: string
  message: string
  /** record 模式下附带的崩溃原文，供宿主写入诊断日志 */
  detail?: string
}

export type InstantVmProgressMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.progress
  message: string
}

export type InstantVmDiskWriteFailedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.diskWriteFailed
  message: string
}

export const INSTANT_VM_IDE_LABELS = ['none', 'hdd', 'cdrom'] as const

export type InstantVmIdeLabel = (typeof INSTANT_VM_IDE_LABELS)[number]

export const INSTANT_VM_DISK_BUSY_IDS = ['idle', 'read', 'write'] as const

export type InstantVmDiskBusy = (typeof INSTANT_VM_DISK_BUSY_IDS)[number]

export const INSTANT_VM_VGA_MODES = ['text', 'graphical'] as const

export type InstantVmVgaMode = (typeof INSTANT_VM_VGA_MODES)[number]

export type InstantVmDiskStats = {
  present: boolean
  busy: InstantVmDiskBusy
  sectorsRead: number
  bytesRead: number
  sectorsWritten: number
  bytesWritten: number
}

export type InstantVmVgaStats = {
  mode: InstantVmVgaMode
  width: number
  height: number
  bpp: number
}

export type InstantVmStatsSnapshot = {
  runningMs: number
  speedMips: number
  avgSpeedMips: number
  ideLabel: InstantVmIdeLabel
  hda: InstantVmDiskStats
  hdb: InstantVmDiskStats
  cdrom: InstantVmDiskStats
  fda: InstantVmDiskStats
  fdb: InstantVmDiskStats
  vga: InstantVmVgaStats
  mouse: boolean
  absoluteMouse: boolean
}

export type InstantVmStatsMessage = InstantVmStatsSnapshot & {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stats
}

export type InstantVmHostToRuntimeMessage =
  | InstantVmStartMessage
  | InstantVmStopMessage
  | InstantVmResetMessage
  | InstantVmSetDisplayModeMessage
  | InstantVmSetPointerModeMessage
  | InstantVmSetAbsoluteMouseMessage
  | InstantVmSetResolutionMessage
  | InstantVmSetCdromMessage
  | InstantVmEjectCdromMessage
  | InstantVmSetFloppyMessage
  | InstantVmEjectFloppyMessage
  | InstantVmSaveStateMessage
  | InstantVmKeyboardMessage
  | InstantVmPointerHintMessage
  | InstantVmAgentCommandMessage
  | InstantVmSetSharedFolderMessage

export type InstantVmRuntimeToHostMessage =
  | InstantVmReadyMessage
  | InstantVmStartedMessage
  | InstantVmStoppedMessage
  | InstantVmSaveStateResultMessage
  | InstantVmErrorMessage
  | InstantVmProgressMessage
  | InstantVmDiskWriteFailedMessage
  | InstantVmStatsMessage
  | InstantVmDiskReadMessage
  | InstantVmDiskWriteMessage
  | InstantVmAgentResultMessage
  | InstantVmGuestClipboardMessage
  | InstantVmGuestFileOfferMessage
  | InstantVmGuestFileReqMessage
  | InstantVmGuestFileDataMessage
  | InstantVmGuestFileDoneMessage
  | InstantVmNativeKeyMessage
  | InstantVmWebdavRequestMessage

const MEMORY_MB_MIN = 16
const MEMORY_MB_MAX = 2032
const VGA_MEMORY_MB_OPTIONS = [2, 4, 8, 16, 32, 64, 128, 256] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBootOrderId(value: unknown): value is InstantVmBootOrderId {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_BOOT_ORDER_IDS as readonly string[]).includes(value)
  )
}

function isNetworkId(value: unknown): value is InstantVmNetworkId {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_NETWORK_IDS as readonly string[]).includes(value)
  )
}

function isNetworkBackendId(value: unknown): value is InstantVmNetworkBackendId {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_NETWORK_BACKEND_IDS as readonly string[]).includes(value)
  )
}

export function isPointerMode(value: unknown): value is InstantVmPointerMode {
  return (
    typeof value === 'string' && (INSTANT_VM_POINTER_MODES as readonly string[]).includes(value)
  )
}

export function isDiskWriteMode(value: unknown): value is InstantVmDiskWriteMode {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_DISK_WRITE_MODES as readonly string[]).includes(value)
  )
}

function isPositiveIntIn<T extends number>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'number' && Number.isInteger(value) && allowed.includes(value as T)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isInstantVmStartConfig(value: unknown): value is InstantVmStartConfig {
  if (!isRecord(value)) {
    return false
  }
  if (!isIntegerInRange(value.memoryMb, MEMORY_MB_MIN, MEMORY_MB_MAX)) {
    return false
  }
  if (!isPositiveIntIn(value.vgaMemoryMb, VGA_MEMORY_MB_OPTIONS)) {
    return false
  }
  if (!isBootOrderId(value.bootOrder)) {
    return false
  }
  if (typeof value.acpi !== 'boolean' || typeof value.fastboot !== 'boolean') {
    return false
  }
  if (
    typeof value.speaker !== 'boolean' ||
    typeof value.keyboard !== 'boolean' ||
    typeof value.mouse !== 'boolean'
  ) {
    return false
  }
  if (value.displayMode !== undefined && !isDisplayMode(value.displayMode)) {
    return false
  }
  if (value.network !== undefined && !isNetworkId(value.network)) {
    return false
  }
  if (value.networkBackend !== undefined && !isNetworkBackendId(value.networkBackend)) {
    return false
  }
  if (value.pointerMode !== undefined && !isPointerMode(value.pointerMode)) {
    return false
  }
  if (value.diskWriteMode !== undefined && !isDiskWriteMode(value.diskWriteMode)) {
    return false
  }
  if (value.resolutionAutoAlign !== undefined && typeof value.resolutionAutoAlign !== 'boolean') {
    return false
  }
  if (value.sharedFolderEnabled !== undefined && typeof value.sharedFolderEnabled !== 'boolean') {
    return false
  }
  return true
}

export function isDisplayMode(value: unknown): value is InstantVmDisplayMode {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_DISPLAY_MODES as readonly string[]).includes(value)
  )
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length < 80
}

function isOptionalBuffer(value: unknown): value is ArrayBuffer | undefined {
  return value === undefined || value instanceof ArrayBuffer
}

function isOptionalBlob(value: unknown): value is Blob | undefined {
  return value === undefined || value instanceof Blob
}

export function isHttpDiskUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function isBlobDiskUrl(value: string): boolean {
  return /^blob:/i.test(value.trim())
}

function isOptionalDiskUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length >= 500) return false
  return isHttpDiskUrl(trimmed) || isBlobDiskUrl(trimmed)
}

function isDiskStreamRef(value: unknown): value is InstantVmDiskStreamRef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length < 80 &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size >= 0
  )
}

function isOptionalDiskStreamRef(value: unknown): value is InstantVmDiskStreamRef | undefined {
  return value === undefined || isDiskStreamRef(value)
}

export function isInstantVmDiskReadMessage(value: unknown): value is InstantVmDiskReadMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.diskRead &&
    isRequestId(value.requestId) &&
    typeof value.streamId === 'string' &&
    value.streamId.length > 0 &&
    value.streamId.length < 80 &&
    typeof value.offset === 'number' &&
    Number.isFinite(value.offset) &&
    value.offset >= 0 &&
    typeof value.length === 'number' &&
    Number.isFinite(value.length) &&
    value.length >= 0
  )
}

export function isInstantVmDiskReadResultMessage(
  value: unknown,
): value is InstantVmDiskReadResultMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.diskReadResult &&
    isRequestId(value.requestId) &&
    typeof value.streamId === 'string' &&
    value.streamId.length > 0 &&
    value.streamId.length < 80 &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    typeof value.totalSize === 'number' &&
    Number.isFinite(value.totalSize) &&
    value.totalSize >= 0 &&
    (value.bytes === undefined || value.bytes instanceof ArrayBuffer)
  )
}

export function isInstantVmDiskWriteMessage(value: unknown): value is InstantVmDiskWriteMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.diskWrite &&
    isRequestId(value.requestId) &&
    typeof value.streamId === 'string' &&
    value.streamId.length > 0 &&
    value.streamId.length < 80 &&
    typeof value.offset === 'number' &&
    Number.isFinite(value.offset) &&
    value.offset >= 0 &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= INSTANT_VM_DISK_RANGE_MAX_BYTES
  )
}

export function isInstantVmDiskWriteResultMessage(
  value: unknown,
): value is InstantVmDiskWriteResultMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.diskWriteResult &&
    isRequestId(value.requestId) &&
    typeof value.streamId === 'string' &&
    value.streamId.length > 0 &&
    value.streamId.length < 80 &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    typeof value.totalSize === 'number' &&
    Number.isFinite(value.totalSize) &&
    value.totalSize >= 0
  )
}

function isWebdavMethod(value: unknown): value is string {
  return typeof value === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,20}$/.test(value)
}

function isWebdavUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 2048 &&
    /^https?:\/\//i.test(value)
  )
}

function isWebdavHeaders(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length > 64) return false
  return keys.every((key) => {
    if (key.length === 0 || key.length > 128) return false
    const item = value[key]
    return typeof item === 'string' && item.length <= 4096
  })
}

export function isInstantVmWebdavRequestMessage(
  value: unknown,
): value is InstantVmWebdavRequestMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.webdavRequest &&
    isRequestId(value.requestId) &&
    isWebdavMethod(value.method) &&
    isWebdavUrl(value.url) &&
    isWebdavHeaders(value.headers) &&
    (value.body === undefined ||
      (value.body instanceof ArrayBuffer && value.body.byteLength <= INSTANT_VM_WEBDAV_BODY_MAX_BYTES))
  )
}

export function isInstantVmWebdavResultMessage(
  value: unknown,
): value is InstantVmWebdavResultMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.webdavResult &&
    isRequestId(value.requestId) &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    typeof value.statusText === 'string' &&
    value.statusText.length <= 128 &&
    isWebdavHeaders(value.headers) &&
    (value.body === undefined ||
      (value.body instanceof ArrayBuffer && value.body.byteLength <= INSTANT_VM_WEBDAV_BODY_MAX_BYTES))
  )
}

export function isInstantVmSetSharedFolderMessage(
  value: unknown,
): value is InstantVmSetSharedFolderMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setSharedFolder &&
    isRequestId(value.requestId) &&
    typeof value.enabled === 'boolean'
  )
}

export function isInstantVmStartMessage(value: unknown): value is InstantVmStartMessage {
  if (!isRecord(value) || value.type !== INSTANT_VM_MESSAGE_TYPE.start) {
    return false
  }
  if (!isRequestId(value.requestId) || !isInstantVmStartConfig(value.config)) {
    return false
  }
  return (
    isOptionalBuffer(value.hda) &&
    isOptionalBuffer(value.hdb) &&
    isOptionalBuffer(value.cdrom) &&
    isOptionalBuffer(value.fda) &&
    isOptionalBuffer(value.fdb) &&
    isOptionalBuffer(value.state) &&
    isOptionalBlob(value.hdaBlob) &&
    isOptionalBlob(value.hdbBlob) &&
    isOptionalBlob(value.cdromBlob) &&
    isOptionalBlob(value.fdaBlob) &&
    isOptionalBlob(value.fdbBlob) &&
    isOptionalBlob(value.stateBlob) &&
    isOptionalDiskUrl(value.hdaUrl) &&
    isOptionalDiskUrl(value.hdbUrl) &&
    isOptionalDiskUrl(value.cdromUrl) &&
    isOptionalDiskUrl(value.fdaUrl) &&
    isOptionalDiskUrl(value.fdbUrl) &&
    isOptionalDiskUrl(value.stateUrl) &&
    isOptionalDiskStreamRef(value.hdaStream) &&
    isOptionalDiskStreamRef(value.hdbStream) &&
    isOptionalDiskStreamRef(value.cdromStream) &&
    isOptionalDiskStreamRef(value.fdaStream) &&
    isOptionalDiskStreamRef(value.fdbStream) &&
    isOptionalDiskStreamRef(value.stateStream)
  )
}

export function isInstantVmStopMessage(value: unknown): value is InstantVmStopMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.stop &&
    isRequestId(value.requestId)
  )
}

export function isInstantVmResetMessage(value: unknown): value is InstantVmResetMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.reset &&
    isRequestId(value.requestId)
  )
}

export function isInstantVmSetDisplayModeMessage(
  value: unknown,
): value is InstantVmSetDisplayModeMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setDisplayMode &&
    isRequestId(value.requestId) &&
    isDisplayMode(value.mode)
  )
}

export function isInstantVmSetPointerModeMessage(
  value: unknown,
): value is InstantVmSetPointerModeMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setPointerMode &&
    isRequestId(value.requestId) &&
    isPointerMode(value.mode)
  )
}

export function isInstantVmSetAbsoluteMouseMessage(
  value: unknown,
): value is InstantVmSetAbsoluteMouseMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setAbsoluteMouse &&
    isRequestId(value.requestId) &&
    typeof value.enabled === 'boolean'
  )
}

/** v86 `vga.js` 的硬上限（MAX_XRES/MAX_YRES）；宿主 clamp 与消息校验共用。 */
export const INSTANT_VM_RESOLUTION_MAX_WIDTH = 2560
export const INSTANT_VM_RESOLUTION_MAX_HEIGHT = 1600

function isResolutionAxis(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
  )
}

export function isInstantVmSetResolutionMessage(
  value: unknown,
): value is InstantVmSetResolutionMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setResolution &&
    isRequestId(value.requestId) &&
    isResolutionAxis(value.width, INSTANT_VM_RESOLUTION_MAX_WIDTH) &&
    isResolutionAxis(value.height, INSTANT_VM_RESOLUTION_MAX_HEIGHT)
  )
}

export function isInstantVmSaveStateMessage(value: unknown): value is InstantVmSaveStateMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.saveState &&
    isRequestId(value.requestId)
  )
}

function isFloppySlot(value: unknown): value is InstantVmFloppySlot {
  return value === 'fda' || value === 'fdb'
}

export function isInstantVmSetCdromMessage(value: unknown): value is InstantVmSetCdromMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setCdrom &&
    isRequestId(value.requestId) &&
    isDiskStreamRef(value.stream)
  )
}

export function isInstantVmEjectCdromMessage(value: unknown): value is InstantVmEjectCdromMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.ejectCdrom &&
    isRequestId(value.requestId)
  )
}

export function isInstantVmSetFloppyMessage(value: unknown): value is InstantVmSetFloppyMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.setFloppy &&
    isRequestId(value.requestId) &&
    isFloppySlot(value.slot) &&
    isDiskStreamRef(value.stream)
  )
}

export function isInstantVmEjectFloppyMessage(value: unknown): value is InstantVmEjectFloppyMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.ejectFloppy &&
    isRequestId(value.requestId) &&
    isFloppySlot(value.slot)
  )
}

export function isInstantVmSaveStateResultMessage(
  value: unknown,
): value is InstantVmSaveStateResultMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.saveStateResult &&
    isRequestId(value.requestId) &&
    value.state instanceof ArrayBuffer
  )
}

export function isInstantVmKeyboardMessage(value: unknown): value is InstantVmKeyboardMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.keyboard &&
    (value.phase === 'down' || value.phase === 'up') &&
    typeof value.key === 'string' &&
    typeof value.code === 'string' &&
    typeof value.keyCode === 'number' &&
    Number.isFinite(value.keyCode) &&
    typeof value.location === 'number' &&
    Number.isFinite(value.location) &&
    typeof value.repeat === 'boolean' &&
    typeof value.shiftKey === 'boolean' &&
    typeof value.ctrlKey === 'boolean' &&
    typeof value.altKey === 'boolean' &&
    typeof value.metaKey === 'boolean'
  )
}

export function isInstantVmNativeKeyMessage(value: unknown): value is InstantVmNativeKeyMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.nativeKey &&
    (value.phase === 'down' || value.phase === 'up') &&
    typeof value.key === 'string' &&
    typeof value.code === 'string' &&
    typeof value.keyCode === 'number' &&
    Number.isFinite(value.keyCode) &&
    typeof value.location === 'number' &&
    Number.isFinite(value.location) &&
    typeof value.repeat === 'boolean' &&
    typeof value.shiftKey === 'boolean' &&
    typeof value.ctrlKey === 'boolean' &&
    typeof value.altKey === 'boolean' &&
    typeof value.metaKey === 'boolean'
  )
}

export function isInstantVmPointerHintMessage(
  value: unknown,
): value is InstantVmPointerHintMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.pointerHint &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  )
}

/** 单条控制面命令的参数个数上限（防呆，不承载安全语义）。 */
const VM_AGENT_ARGS_MAX = 8

export function isInstantVmAgentCommandMessage(
  value: unknown,
): value is InstantVmAgentCommandMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.agentCommand &&
    isRequestId(value.requestId) &&
    typeof value.method === 'string' &&
    value.method.trim().length > 0 &&
    (value.args === undefined ||
      (Array.isArray(value.args) && value.args.length <= VM_AGENT_ARGS_MAX))
  )
}

export function isInstantVmAgentResultMessage(
  value: unknown,
): value is InstantVmAgentResultMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.agentResult &&
    isRequestId(value.requestId)
  )
}

/** 与 Instant-virtual-machine `ivm-shm.ts` 的 IVM_SHM_MAX_TEXT_CHARS 一致。 */
const GUEST_CLIPBOARD_MAX_CHARS = 16376

export function isInstantVmGuestClipboardMessage(
  value: unknown,
): value is InstantVmGuestClipboardMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.guestClipboard &&
    typeof value.text === 'string' &&
    value.text.length <= GUEST_CLIPBOARD_MAX_CHARS
  )
}

/** 与 IVM 仓库 ivm-shm.ts 的 IVM_FILE_MAX_CHUNK 一致（32724）。 */
const GUEST_FILE_MAX_CHUNK = 32724
/** 宿主→XP 一次复制操作允许的条目上限（文件+目录）。桥按 32724 字节/帧分包。 */
const GUEST_FILE_MAX_ENTRIES = 4096

/**
 * 文件清单条目校验。
 * 目录条目语义：path 以 / 结尾且 size 为 0；文件条目：path 不以 / 结尾，size ≥ 0。
 * 路径可含 / 表示嵌套（如 "docs/sub/a.txt"），保证父目录出现在子项之前。
 */
export function isFileEntryList(value: unknown): value is { path: string; size: number }[] {
  return (
    Array.isArray(value) &&
    value.length <= GUEST_FILE_MAX_ENTRIES &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === 'string' &&
        item.path.length > 0 &&
        typeof item.size === 'number' &&
        Number.isInteger(item.size) &&
        item.size >= 0 &&
        // 目录条目的唯一合法形态：path 以 / 结尾且 size 为 0
        (!item.path.endsWith('/') || item.size === 0),
    )
  )
}

export function isInstantVmGuestFileOfferMessage(
  value: unknown,
): value is InstantVmGuestFileOfferMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.guestFileOffer &&
    isFileEntryList(value.files)
  )
}

export function isInstantVmGuestFileReqMessage(
  value: unknown,
): value is InstantVmGuestFileReqMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.guestFileReq &&
    typeof value.session === 'number' &&
    Number.isInteger(value.session) &&
    value.session >= 1 &&
    value.session <= 0xffffffff &&
    typeof value.start === 'boolean' &&
    typeof value.offset === 'number' &&
    Number.isInteger(value.offset) &&
    value.offset >= 0 &&
    typeof value.length === 'number' &&
    Number.isInteger(value.length) &&
    value.length >= 1 &&
    value.length <= GUEST_FILE_MAX_CHUNK &&
    (value.path === null || (typeof value.path === 'string' && value.path.length > 0))
  )
}

export function isInstantVmGuestFileDataMessage(
  value: unknown,
): value is InstantVmGuestFileDataMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.guestFileData &&
    typeof value.session === 'number' &&
    Number.isInteger(value.session) &&
    value.session >= 1 &&
    value.session <= 0xffffffff &&
    typeof value.offset === 'number' &&
    Number.isInteger(value.offset) &&
    value.offset >= 0 &&
    typeof value.end === 'boolean' &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= GUEST_FILE_MAX_CHUNK
  )
}

export function isInstantVmGuestFileDoneMessage(
  value: unknown,
): value is InstantVmGuestFileDoneMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.guestFileDone &&
    typeof value.session === 'number' &&
    Number.isInteger(value.session) &&
    value.session >= 1 &&
    value.session <= 0xffffffff &&
    (value.result === 'ok' || value.result === 'cancel' || value.result === 'error')
  )
}

export function emptyVmDiskStats(present = false): InstantVmDiskStats {
  return {
    present,
    busy: 'idle',
    sectorsRead: 0,
    bytesRead: 0,
    sectorsWritten: 0,
    bytesWritten: 0,
  }
}

export function emptyVmStatsSnapshot(): InstantVmStatsSnapshot {
  return {
    runningMs: 0,
    speedMips: 0,
    avgSpeedMips: 0,
    ideLabel: 'none',
    hda: emptyVmDiskStats(),
    hdb: emptyVmDiskStats(),
    cdrom: emptyVmDiskStats(),
    fda: emptyVmDiskStats(),
    fdb: emptyVmDiskStats(),
    vga: { mode: 'text', width: 0, height: 0, bpp: 0 },
    mouse: false,
    absoluteMouse: false,
  }
}

function isNonNegFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isVmDiskBusy(value: unknown): value is InstantVmDiskBusy {
  return (
    typeof value === 'string' &&
    (INSTANT_VM_DISK_BUSY_IDS as readonly string[]).includes(value)
  )
}

function isVmIdeLabel(value: unknown): value is InstantVmIdeLabel {
  return typeof value === 'string' && (INSTANT_VM_IDE_LABELS as readonly string[]).includes(value)
}

function isVmVgaMode(value: unknown): value is InstantVmVgaMode {
  return typeof value === 'string' && (INSTANT_VM_VGA_MODES as readonly string[]).includes(value)
}

function isVmDiskStats(value: unknown): value is InstantVmDiskStats {
  if (!isRecord(value) || typeof value.present !== 'boolean' || !isVmDiskBusy(value.busy)) {
    return false
  }
  return (
    isNonNegFinite(value.sectorsRead) &&
    isNonNegFinite(value.bytesRead) &&
    isNonNegFinite(value.sectorsWritten) &&
    isNonNegFinite(value.bytesWritten)
  )
}

function isVmVgaStats(value: unknown): value is InstantVmVgaStats {
  if (!isRecord(value) || !isVmVgaMode(value.mode)) {
    return false
  }
  return isNonNegFinite(value.width) && isNonNegFinite(value.height) && isNonNegFinite(value.bpp)
}

export function isInstantVmStatsMessage(value: unknown): value is InstantVmStatsMessage {
  if (!isRecord(value) || value.type !== INSTANT_VM_MESSAGE_TYPE.stats) {
    return false
  }
  if (!isNonNegFinite(value.runningMs) || !isNonNegFinite(value.speedMips) || !isNonNegFinite(value.avgSpeedMips)) {
    return false
  }
  if (!isVmIdeLabel(value.ideLabel) || typeof value.mouse !== 'boolean' || typeof value.absoluteMouse !== 'boolean') {
    return false
  }
  return (
    isVmDiskStats(value.hda) &&
    isVmDiskStats(value.cdrom) &&
    isVmDiskStats(value.fda) &&
    isVmVgaStats(value.vga)
  )
}

export function isInstantVmHostToRuntimeMessage(
  value: unknown,
): value is InstantVmHostToRuntimeMessage {
  return (
    isInstantVmStartMessage(value) ||
    isInstantVmStopMessage(value) ||
    isInstantVmResetMessage(value) ||
    isInstantVmSetDisplayModeMessage(value) ||
    isInstantVmSetPointerModeMessage(value) ||
    isInstantVmSetAbsoluteMouseMessage(value) ||
    isInstantVmSetResolutionMessage(value) ||
    isInstantVmSetCdromMessage(value) ||
    isInstantVmEjectCdromMessage(value) ||
    isInstantVmSetFloppyMessage(value) ||
    isInstantVmEjectFloppyMessage(value) ||
    isInstantVmSaveStateMessage(value) ||
    isInstantVmKeyboardMessage(value) ||
    isInstantVmPointerHintMessage(value) ||
    isInstantVmAgentCommandMessage(value) ||
    isInstantVmSetSharedFolderMessage(value)
  )
}

export function isInstantVmRuntimeToHostMessage(
  value: unknown,
): value is InstantVmRuntimeToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.ready) {
    return true
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.started) {
    return isRequestId(value.requestId)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.stopped) {
    return value.requestId === undefined || isRequestId(value.requestId)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.saveStateResult) {
    return isInstantVmSaveStateResultMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.error) {
    if (typeof value.message !== 'string' || !value.message.trim()) {
      return false
    }
    if (value.detail !== undefined && typeof value.detail !== 'string') {
      return false
    }
    return value.requestId === undefined || isRequestId(value.requestId)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.progress) {
    return typeof value.message === 'string' && value.message.trim().length > 0
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.diskWriteFailed) {
    return typeof value.message === 'string' && value.message.trim().length > 0
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.stats) {
    return isInstantVmStatsMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.diskRead) {
    return isInstantVmDiskReadMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.diskWrite) {
    return isInstantVmDiskWriteMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.webdavRequest) {
    return isInstantVmWebdavRequestMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.agentResult) {
    return isInstantVmAgentResultMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.guestClipboard) {
    return isInstantVmGuestClipboardMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.guestFileOffer) {
    return isInstantVmGuestFileOfferMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.guestFileReq) {
    return isInstantVmGuestFileReqMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.guestFileData) {
    return isInstantVmGuestFileDataMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.guestFileDone) {
    return isInstantVmGuestFileDoneMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.nativeKey) {
    return isInstantVmNativeKeyMessage(value)
  }
  return false
}

export function parseAllowedOrigins(raw: string | undefined, fallback: readonly string[]): string[] {
  const fromEnv = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const list = fromEnv.length > 0 ? fromEnv : [...fallback]
  return [...new Set(list)]
}

function hostnameMatchesPattern(hostname: string, patternHost: string): boolean {
  const host = hostname.toLowerCase()
  const suffix = patternHost.toLowerCase()
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** `*.example.com` 或 CSP 风格 `https://*.example.com`（可带端口）。 */
function originMatchesPattern(origin: URL, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    return hostnameMatchesPattern(origin.hostname, pattern.slice(2))
  }
  const wildcard = /^(https?):\/\/\*\.([^/]+)$/i.exec(pattern)
  if (!wildcard) {
    return false
  }
  const scheme = wildcard[1].toLowerCase()
  let hostPart = wildcard[2]
  let expectedPort = ''
  const colon = hostPart.lastIndexOf(':')
  if (colon !== -1 && /^\d+$/.test(hostPart.slice(colon + 1))) {
    expectedPort = hostPart.slice(colon + 1)
    hostPart = hostPart.slice(0, colon)
  }
  if (origin.protocol !== `${scheme}:` || origin.port !== expectedPort) {
    return false
  }
  return hostnameMatchesPattern(origin.hostname, hostPart)
}

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  if (allowed.includes(origin)) {
    return true
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  return allowed.some((item) => originMatchesPattern(parsed, item))
}

export function collectStartTransfers(message: InstantVmStartMessage): Transferable[] {
  const transfers: Transferable[] = []
  for (const slot of ['hda', 'hdb', 'cdrom', 'fda', 'fdb', 'state'] as const) {
    const buffer = message[slot]
    if (buffer) {
      transfers.push(buffer)
    }
  }
  return transfers
}

export function startMessageHasDisk(message: InstantVmStartMessage): boolean {
  return Boolean(
    (message.hda && message.hda.byteLength > 0) ||
      (message.hdb && message.hdb.byteLength > 0) ||
      (message.cdrom && message.cdrom.byteLength > 0) ||
      (message.fda && message.fda.byteLength > 0) ||
      (message.fdb && message.fdb.byteLength > 0) ||
      message.state ||
      message.stateBlob ||
      message.stateUrl ||
      message.hdaBlob ||
      message.hdbBlob ||
      message.cdromBlob ||
      message.fdaBlob ||
      message.fdbBlob ||
      message.hdaUrl ||
      message.hdbUrl ||
      message.cdromUrl ||
      message.fdaUrl ||
      message.fdbUrl ||
      message.hdaStream ||
      message.hdbStream ||
      message.cdromStream ||
      message.fdaStream ||
      message.fdbStream ||
      message.stateStream,
  )
}
