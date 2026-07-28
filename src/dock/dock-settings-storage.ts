import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../os/device-storage.ts'

export const DOCK_SETTINGS_CHANGED_EVENT = 'instant-os:dock-settings-changed'

export const DOCK_BASE_ICON_PX = 56

/** 与 dock.css 中 plate-anchor / plate 内边距一致。 */
export const DOCK_PLATE_ANCHOR_BOTTOM_PAD_BASE = 6
export const DOCK_PLATE_PADDING_TOP_BASE = 8
export const DOCK_PLATE_PADDING_BOTTOM_BASE = 10

/** 程序坞实际占用高度（图标 + 内边距），用于工作区与最大化窗口计算。 */
export const DOCK_BASE_RESERVE_PX =
  DOCK_PLATE_ANCHOR_BOTTOM_PAD_BASE +
  DOCK_PLATE_PADDING_TOP_BASE +
  DOCK_BASE_ICON_PX +
  DOCK_PLATE_PADDING_BOTTOM_BASE

export type DockSizeTier = 'mini' | 'small' | 'medium' | 'large' | 'extraLarge'

export const DOCK_SIZE_TIERS: readonly DockSizeTier[] = [
  'mini',
  'small',
  'medium',
  'large',
  'extraLarge',
]

export const DOCK_SIZE_TIER_LABELS: Record<DockSizeTier, string> = {
  mini: '迷你',
  small: '小',
  medium: '中',
  large: '大',
  extraLarge: '超大',
}

/** 「大」对应最初默认尺寸（100%）；「超大」为在此基础上放大。 */
export const DOCK_SIZE_TIER_SCALES: Record<DockSizeTier, number> = {
  mini: 0.5,
  small: 0.75,
  medium: 0.85,
  large: 1,
  extraLarge: 1.4,
}

export type DockSettings = {
  sizeTier: DockSizeTier
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.dockSettings

function isDockSizeTier(value: unknown): value is DockSizeTier {
  return typeof value === 'string' && DOCK_SIZE_TIERS.includes(value as DockSizeTier)
}

export function resolveDefaultDockSizeTier(screenWidth = window.innerWidth): DockSizeTier {
  if (screenWidth < 500) {
    return 'mini'
  }
  if (screenWidth < 700) {
    return 'small'
  }
  if (screenWidth < 1000) {
    return 'medium'
  }
  return 'large'
}

export function createInitialDockSettings(screenWidth = window.innerWidth): DockSettings {
  return {
    sizeTier: resolveDefaultDockSizeTier(screenWidth),
  }
}

function migrateLegacySizeScale(scale: number): DockSizeTier {
  let nearest: DockSizeTier = 'large'
  let minDistance = Number.POSITIVE_INFINITY

  for (const tier of DOCK_SIZE_TIERS) {
    const distance = Math.abs(DOCK_SIZE_TIER_SCALES[tier] - scale)
    if (distance < minDistance) {
      minDistance = distance
      nearest = tier
    }
  }

  return nearest
}

function normalizeDockSettings(raw: unknown): DockSettings {
  if (!raw || typeof raw !== 'object') {
    return createInitialDockSettings()
  }

  const record = raw as Record<string, unknown>
  if (isDockSizeTier(record.sizeTier)) {
    return { sizeTier: record.sizeTier }
  }

  if (typeof record.sizeScale === 'number' && Number.isFinite(record.sizeScale)) {
    return { sizeTier: migrateLegacySizeScale(record.sizeScale) }
  }

  return createInitialDockSettings()
}

export function dockSizeTierStopPercent(index: number, tierCount = DOCK_SIZE_TIERS.length): number {
  if (tierCount <= 1) {
    return 0
  }
  return (index / (tierCount - 1)) * 100
}

export function dockSizeTierToIndex(tier: DockSizeTier): number {
  return DOCK_SIZE_TIERS.indexOf(tier)
}

export function dockSizeTierFromIndex(index: number): DockSizeTier {
  const clamped = Math.min(DOCK_SIZE_TIERS.length - 1, Math.max(0, Math.round(index)))
  return DOCK_SIZE_TIERS[clamped]
}

export function dockSizeTierLabel(tier: DockSizeTier): string {
  return DOCK_SIZE_TIER_LABELS[tier]
}

export function loadDockSettings(): DockSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createInitialDockSettings()
    }
    return normalizeDockSettings(JSON.parse(raw))
  } catch {
    return createInitialDockSettings()
  }
}

export function hasStoredDockSettings(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function saveDockSettings(settings: DockSettings): boolean {
  const payload: DockSettings = {
    sizeTier: isDockSizeTier(settings.sizeTier) ? settings.sizeTier : 'large',
  }
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}

export function patchDockSettings(patch: Partial<DockSettings>): boolean {
  const next = { ...loadDockSettings(), ...patch }
  if (!saveDockSettings(next)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(DOCK_SETTINGS_CHANGED_EVENT))
  return true
}

export function resolveDockSizeTier(settings?: DockSettings): DockSizeTier {
  const tier = (settings ?? loadDockSettings()).sizeTier
  return isDockSizeTier(tier) ? tier : 'large'
}

export function resolveDockSizeScale(settings?: DockSettings): number {
  return DOCK_SIZE_TIER_SCALES[resolveDockSizeTier(settings)]
}

export function resolveDockReservePx(scale = resolveDockSizeScale()): number {
  return Math.round(DOCK_BASE_RESERVE_PX * scale)
}

export function resolveDockIconSizePx(scale = resolveDockSizeScale()): number {
  return Math.round(DOCK_BASE_ICON_PX * scale)
}

export function resolveDockIconCenterYOffsetFromBottom(scale = resolveDockSizeScale()): number {
  const bottomPad = Math.round(DOCK_PLATE_ANCHOR_BOTTOM_PAD_BASE * scale)
  const platePadBottom = Math.round(DOCK_PLATE_PADDING_BOTTOM_BASE * scale)
  const iconHalf = resolveDockIconSizePx(scale) / 2
  return bottomPad + platePadBottom + iconHalf
}
