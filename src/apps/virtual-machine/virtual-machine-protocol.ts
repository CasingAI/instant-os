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
  started: 'instant-vm:started',
  stopped: 'instant-vm:stopped',
  error: 'instant-vm:error',
  progress: 'instant-vm:progress',
  stats: 'instant-vm:stats',
  requestPointerLock: 'instant-vm:request-pointer-lock',
  pointerLockChanged: 'instant-vm:pointer-lock-changed',
  pointerEdgeHit: 'instant-vm:pointer-edge-hit',
} as const

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

export type InstantVmStartMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.start
  requestId: string
  config: InstantVmStartConfig
  hda?: ArrayBuffer
  cdrom?: ArrayBuffer
  fda?: ArrayBuffer
  state?: ArrayBuffer
  hdaUrl?: string
  cdromUrl?: string
  fdaUrl?: string
  stateUrl?: string
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

export type InstantVmRequestPointerLockMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.requestPointerLock
  requestId: string
}

export type InstantVmPointerLockChangedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.pointerLockChanged
  locked: boolean
}

export type InstantVmPointerEdgeHitMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.pointerEdgeHit
  edge: 'left' | 'right' | 'top' | 'bottom'
  x: number
  y: number
}

export type InstantVmStartedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.started
  requestId: string
}

export type InstantVmStoppedMessage = {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stopped
  requestId: string
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

export type InstantVmMouseCapabilities = {
  /** 模拟器是否已启用鼠标。 */
  enabled: boolean
  /** 当前是否处于 Pointer Lock 状态。 */
  pointerLocked: boolean
  /** Guest 是否启用了 vmware absolute mouse（绝对坐标）模式。 */
  absoluteMouse: boolean
}

export type InstantVmStatsSnapshot = {
  runningMs: number
  speedMips: number
  avgSpeedMips: number
  ideLabel: InstantVmIdeLabel
  hda: InstantVmDiskStats
  cdrom: InstantVmDiskStats
  fda: InstantVmDiskStats
  vga: InstantVmVgaStats
  mouse: boolean
  mouseCapabilities: InstantVmMouseCapabilities
}

export type InstantVmStatsMessage = InstantVmStatsSnapshot & {
  type: typeof INSTANT_VM_MESSAGE_TYPE.stats
}

export type InstantVmHostToRuntimeMessage =
  | InstantVmStartMessage
  | InstantVmStopMessage
  | InstantVmResetMessage
  | InstantVmSetDisplayModeMessage
  | InstantVmRequestPointerLockMessage

export type InstantVmRuntimeToHostMessage =
  | InstantVmReadyMessage
  | InstantVmStartedMessage
  | InstantVmStoppedMessage
  | InstantVmErrorMessage
  | InstantVmProgressMessage
  | InstantVmStatsMessage
  | InstantVmPointerLockChangedMessage
  | InstantVmPointerEdgeHitMessage

const MEMORY_MB_MIN = 16
const MEMORY_MB_MAX = 4096
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

export function isHttpDiskUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function isOptionalHttpUrl(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && isHttpDiskUrl(value) && value.trim().length < 500)
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
    isOptionalBuffer(value.cdrom) &&
    isOptionalBuffer(value.fda) &&
    isOptionalBuffer(value.state) &&
    isOptionalHttpUrl(value.hdaUrl) &&
    isOptionalHttpUrl(value.cdromUrl) &&
    isOptionalHttpUrl(value.fdaUrl) &&
    isOptionalHttpUrl(value.stateUrl)
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

export function emptyVmMouseCapabilities(): InstantVmMouseCapabilities {
  return {
    enabled: false,
    pointerLocked: false,
    absoluteMouse: false,
  }
}

export function emptyVmStatsSnapshot(): InstantVmStatsSnapshot {
  return {
    runningMs: 0,
    speedMips: 0,
    avgSpeedMips: 0,
    ideLabel: 'none',
    hda: emptyVmDiskStats(),
    cdrom: emptyVmDiskStats(),
    fda: emptyVmDiskStats(),
    vga: { mode: 'text', width: 0, height: 0, bpp: 0 },
    mouse: false,
    mouseCapabilities: emptyVmMouseCapabilities(),
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

function isVmMouseCapabilities(value: unknown): value is InstantVmMouseCapabilities {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    typeof value.pointerLocked === 'boolean' &&
    typeof value.absoluteMouse === 'boolean'
  )
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
    isVmVgaStats(value.vga) &&
    isVmMouseCapabilities(value.mouseCapabilities)
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
    isInstantVmRequestPointerLockMessage(value)
  )
}

export function isInstantVmPointerLockChangedMessage(
  value: unknown,
): value is InstantVmPointerLockChangedMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.pointerLockChanged &&
    typeof value.locked === 'boolean'
  )
}

export function isInstantVmPointerEdgeHitMessage(
  value: unknown,
): value is InstantVmPointerEdgeHitMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.pointerEdgeHit &&
    ['left', 'right', 'top', 'bottom'].includes(value.edge as string) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  )
}

export function isInstantVmRequestPointerLockMessage(
  value: unknown,
): value is InstantVmRequestPointerLockMessage {
  return (
    isRecord(value) &&
    value.type === INSTANT_VM_MESSAGE_TYPE.requestPointerLock &&
    isRequestId(value.requestId)
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
  if (
    value.type === INSTANT_VM_MESSAGE_TYPE.started ||
    value.type === INSTANT_VM_MESSAGE_TYPE.stopped
  ) {
    return isRequestId(value.requestId)
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
  if (value.type === INSTANT_VM_MESSAGE_TYPE.pointerLockChanged) {
    return isInstantVmPointerLockChangedMessage(value)
  }
  if (value.type === INSTANT_VM_MESSAGE_TYPE.pointerEdgeHit) {
    return isInstantVmPointerEdgeHitMessage(value)
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

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin)
}

export function collectStartTransfers(message: InstantVmStartMessage): Transferable[] {
  const transfers: Transferable[] = []
  if (message.hda) {
    transfers.push(message.hda)
  }
  if (message.cdrom) {
    transfers.push(message.cdrom)
  }
  if (message.fda) {
    transfers.push(message.fda)
  }
  if (message.state) {
    transfers.push(message.state)
  }
  return transfers
}

export function startMessageHasDisk(message: InstantVmStartMessage): boolean {
  return Boolean(
    (message.hda && message.hda.byteLength > 0) ||
      (message.cdrom && message.cdrom.byteLength > 0) ||
      (message.fda && message.fda.byteLength > 0) ||
      message.hdaUrl ||
      message.cdromUrl ||
      message.fdaUrl,
  )
}
