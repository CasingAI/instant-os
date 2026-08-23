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
  saveState: 'instant-vm:save-state',
  saveStateResult: 'instant-vm:save-state-result',
  started: 'instant-vm:started',
  stopped: 'instant-vm:stopped',
  error: 'instant-vm:error',
  progress: 'instant-vm:progress',
  stats: 'instant-vm:stats',
  diskRead: 'instant-vm:disk-read',
  diskReadResult: 'instant-vm:disk-read-result',
  keyboard: 'instant-vm:keyboard',
} as const

/** 运行时 fetch 拦截器识别的本地镜像流 URL 前缀（挂在运行时 origin 上）。 */
export const VM_DISK_STREAM_PATH_PREFIX = '/__instant-vm-disk/'

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
 * 指针工作方式：`follow` 跟随（默认、绝对坐标）；`lock` 独占（点击锁定、Esc 释放）。
 * Keep in sync with instant-app `VmPointerModeId`。
 */
export const INSTANT_VM_POINTER_MODES = ['follow', 'lock'] as const

export type InstantVmPointerMode = (typeof INSTANT_VM_POINTER_MODES)[number]

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
  /** 指针工作方式；缺省按 follow。 */
  pointerMode?: InstantVmPointerMode
  /** copy.sh Android profile sends Enter after 3s to skip isolinux. */
  sendEnterAfterMs?: number
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
}

export type InstantVmProgressMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.progress
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
}

export type InstantVmStatsMessage = InstantVmStatsSnapshot & {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stats
}

export type InstantVmHostToRuntimeMessage =
  | InstantVmStartMessage
  | InstantVmStopMessage
  | InstantVmResetMessage
  | InstantVmSetDisplayModeMessage
  | InstantVmSaveStateMessage
  | InstantVmKeyboardMessage

export type InstantVmRuntimeToHostMessage =
  | InstantVmReadyMessage
  | InstantVmStartedMessage
  | InstantVmStoppedMessage
  | InstantVmSaveStateResultMessage
  | InstantVmErrorMessage
  | InstantVmProgressMessage
  | InstantVmStatsMessage
  | InstantVmDiskReadMessage

const MEMORY_MB_MIN = 16
const MEMORY_MB_MAX = 2032
const VGA_MEMORY_MB_OPTIONS = [2, 4, 8, 16] as const

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

function isPointerMode(value: unknown): value is InstantVmPointerMode {
  return (
    typeof value === 'string' && (INSTANT_VM_POINTER_MODES as readonly string[]).includes(value)
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
  if (value.sendEnterAfterMs !== undefined) {
    if (
      typeof value.sendEnterAfterMs !== 'number' ||
      !Number.isFinite(value.sendEnterAfterMs) ||
      value.sendEnterAfterMs < 0
    ) {
      return false
    }
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

export function isInstantVmSaveStateMessage(value: unknown): value is InstantVmSaveStateMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.saveState &&
    isRequestId(value.requestId)
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
  if (!isVmIdeLabel(value.ideLabel) || typeof value.mouse !== 'boolean') {
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
    isInstantVmSaveStateMessage(value) ||
    isInstantVmKeyboardMessage(value)
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
    return value.requestId === undefined || isRequestId(value.requestId)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.progress) {
    return typeof value.message === 'string' && value.message.trim().length > 0
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.stats) {
    return isInstantVmStatsMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.diskRead) {
    return isInstantVmDiskReadMessage(value)
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
