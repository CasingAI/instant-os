import {
  DEVICE_CAPACITY_BYTES,
  getTotalLocalStorageBytes,
} from './device-storage.ts'
import {
  DATA_CAPACITY_BYTES,
  DATA_DB_NAME,
  getTotalDataStorageBytes,
} from './device-data-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'

export type DeviceInfoSpec = {
  label: string
  value: string
}

const UNAVAILABLE = '不可用'

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

type BrandList = { brand: string; version: string }[]

function detectPlatform(ua: string): string {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (platform) {
    return platform
  }

  if (/iPhone/i.test(ua)) {
    return 'iPhone'
  }
  if (/iPad/i.test(ua)) {
    return 'iPad'
  }
  if (/iPod/i.test(ua)) {
    return 'iPod touch'
  }
  if (/Windows/i.test(ua)) {
    return 'Windows'
  }
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/)
    return match ? `Android ${match[1]}` : 'Android'
  }
  if (/CrOS/.test(ua)) {
    return 'ChromeOS'
  }

  let os = 'Linux'
  let arch = ''

  if (/Mac OS X/i.test(ua)) {
    const match = ua.match(/Mac OS X\s([\d_]+)/)
    os = match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS'
  }

  if (/arm64|armv8|armv7|aarch64/i.test(ua)) {
    arch = 'ARM64'
  } else if (/Win64|x64|x86_64|WOW64/i.test(ua)) {
    arch = 'x86_64'
  } else if (/Macintosh/.test(ua)) {
    arch = 'Apple Silicon'
  }

  return [os, arch].filter(Boolean).join('（') + (arch ? '）' : '')
}

function detectBrowser(ua: string): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: BrandList } }).userAgentData?.brands
  if (brands && brands.length > 0) {
    const meaningful = brands.filter((brand) => !/not.?a.?brand/i.test(brand.brand))
    const primary = meaningful[0] ?? brands[0]
    if (primary) {
      return `${primary.brand} ${primary.version}`
    }
  }

  const edge = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/)
  if (edge) {
    return `Edge ${edge[1]}`
  }
  const chrome = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/)
  if (chrome) {
    return `Chrome ${chrome[1]}`
  }
  const firefox = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/)
  if (firefox) {
    return `Firefox ${firefox[1]}`
  }
  const safari = ua.match(/Version\/([\d.]+).*Safari/)
  if (safari) {
    return `Safari ${safari[1]}`
  }
  return UNAVAILABLE
}

async function detectGpuWebGpu(): Promise<string | undefined> {
  try {
    if (!navigator.gpu) {
      return undefined
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      return undefined
    }
    const info = adapter.info
    // WebGPU adapter.info 返回 { vendor, architecture, device, description }
    const parts = [info.vendor, info.architecture, info.description].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )
    return parts.length > 0 ? parts.join(' ') : undefined
  } catch {
    return undefined
  }
}

function detectGpuWebGl(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) {
      return UNAVAILABLE
    }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer')
    const renderer = debugInfo?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    if (typeof renderer === 'string' && renderer.length > 0) {
      return renderer
    }
    const fallback = gl.getParameter(gl.RENDERER)
    if (typeof fallback === 'string' && fallback.length > 0 && fallback !== 'WebKit WebGL') {
      return fallback
    }
    return UNAVAILABLE
  } catch {
    return UNAVAILABLE
  }
}

let gpuCache: string | undefined

async function detectGpu(): Promise<string> {
  if (gpuCache !== undefined) {
    return gpuCache
  }
  const webgpu = await detectGpuWebGpu()
  if (webgpu) {
    gpuCache = webgpu
    return webgpu
  }
  const webgl = detectGpuWebGl()
  gpuCache = webgl
  return webgl
}

function formatDisplay(): string {
  const width = typeof screen !== 'undefined' ? screen.width : undefined
  const height = typeof screen !== 'undefined' ? screen.height : undefined
  if (!width || !height) {
    return UNAVAILABLE
  }
  const dpr = window.devicePixelRatio || 1
  const retinaTag = dpr >= 1.5 ? '（Retina）' : ''
  return `${width} × ${height}${retinaTag}`
}

function formatLanguage(): string {
  const langs = navigator.languages?.filter(Boolean)
  if (langs && langs.length > 0) {
    return langs.join('、')
  }
  return navigator.language ?? UNAVAILABLE
}

function formatNetwork(): string {
  const online = navigator.onLine ? '在线' : '离线'
  if (!navigator.onLine) {
    return online
  }

  const connection = (navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string }
  }).connection
  if (!connection) {
    return online
  }

  // connection.type 返回实际网络介质（wifi、cellular、ethernet 等）
  if (connection.type && connection.type !== 'unknown') {
    const typeLabels: Record<string, string> = {
      wifi: 'WiFi',
      cellular: '蜂窝网络',
      ethernet: '以太网',
      bluetooth: '蓝牙',
      wimax: 'WiMAX',
      other: '其他',
    }
    const label = typeLabels[connection.type] ?? connection.type
    return `${online}（${label}）`
  }

  // type 不可用时，仅显示在线状态，不展示 effectiveType（它反映的是带宽估算而非实际介质）
  return online
}

function formatMemory(): string {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof memory !== 'number') {
    return UNAVAILABLE
  }
  // navigator.deviceMemory 返回的是以 GiB 为单位的近似值（2 的幂舍入），直接展示
  return `${memory} GiB`
}

function formatTouch(): string {
  const points = navigator.maxTouchPoints ?? 0
  if (points <= 0) {
    return '无'
  }
  return `支持（${points} 点）`
}

async function detectBattery(): Promise<string> {
  try {
    const battery = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.()
    if (!battery) {
      return UNAVAILABLE
    }
    const pct = `${Math.round(battery.level * 100)}%`
    if (battery.charging) {
      return `正在充电（${pct}）`
    }
    return `${pct}`
  } catch {
    return UNAVAILABLE
  }
}

function formatJsMemory(): string {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    return UNAVAILABLE
  }
  const used = formatStorageSize(mem.usedJSHeapSize)
  const total = formatStorageSize(mem.totalJSHeapSize)
  const limit = formatStorageSize(mem.jsHeapSizeLimit)
  return `已用 ${used} / 已分配 ${total} / 上限 ${limit}`
}

async function detectStorageQuota(): Promise<string> {
  try {
    if (!navigator.storage?.estimate) {
      return UNAVAILABLE
    }
    const estimate = await navigator.storage.estimate()
    if (estimate.usage === undefined || estimate.quota === undefined) {
      return UNAVAILABLE
    }
    const pct = estimate.quota > 0 ? `（${(estimate.usage / estimate.quota * 100).toFixed(1)}%）` : ''
    return `已用 ${formatStorageSize(estimate.usage)} / 总计 ${formatStorageSize(estimate.quota)}${pct}`
  } catch {
    return UNAVAILABLE
  }
}

function detectLocalStorage(): string {
  try {
    const storage = globalThis.localStorage
    if (!storage) return UNAVAILABLE
    const count = storage.length
    if (count === 0) return '空'
    const size = getTotalLocalStorageBytes()
    return `${count} 个键值对，${formatStorageSize(size)} / 上限 ${formatStorageSize(DEVICE_CAPACITY_BYTES)}`
  } catch {
    return UNAVAILABLE
  }
}

function detectSessionStorage(): string {
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return UNAVAILABLE
    const count = storage.length
    if (count === 0) return '空'
    let size = 0
    for (let i = 0; i < count; i++) {
      const key = storage.key(i)
      if (key === null) continue
      const val = storage.getItem(key)
      if (val) size += utf8ByteLength(val)
    }
    return `${count} 个键值对，约 ${formatStorageSize(size)}`
  } catch {
    return UNAVAILABLE
  }
}

async function detectIndexedDB(): Promise<string> {
  try {
    if (!globalThis.indexedDB?.databases) {
      return UNAVAILABLE
    }
    const databases = await globalThis.indexedDB.databases()
    if (databases.length === 0) return '无'
    const names = databases
      .map((db) => db.name)
      .filter((name): name is string => typeof name === 'string')
    if (names.length === 0) return '无'

    const dataBytes = names.includes(DATA_DB_NAME)
      ? await getTotalDataStorageBytes()
      : 0
    const sizeLabel =
      dataBytes > 0 || names.includes(DATA_DB_NAME)
        ? `，${formatStorageSize(dataBytes)} / 上限 ${formatStorageSize(DATA_CAPACITY_BYTES)}`
        : ''
    return `${names.length} 个数据库：${names.join('、')}${sizeLabel}`
  } catch {
    return UNAVAILABLE
  }
}

function detectCookies(): string {
  try {
    const raw = globalThis.document?.cookie
    if (raw === undefined || raw === null) return UNAVAILABLE
    if (raw.length === 0) return '无'
    const pairs = raw.split(';').filter(Boolean)
    return `${pairs.length} 个，约 ${formatStorageSize(utf8ByteLength(raw))}`
  } catch {
    return UNAVAILABLE
  }
}

function detectCpuArchitecture(ua: string): string {
  const uach = (navigator as Navigator & { userAgentData?: { architecture?: string } }).userAgentData?.architecture
  if (uach) {
    return uach
  }
  if (/arm64|aarch64/i.test(ua)) return 'arm64'
  if (/armv7|armv8/i.test(ua)) return 'arm'
  if (/x86_64|Win64|x64|WOW64/i.test(ua)) return 'x86_64'
  if (/Macintosh/.test(ua)) return 'arm64（Apple Silicon）'
  if (/i\d86/.test(ua)) return 'x86'
  return UNAVAILABLE
}

async function detectCacheSize(): Promise<string> {
  try {
    if (typeof caches === 'undefined') {
      return UNAVAILABLE
    }
    const keys = await caches.keys()
    if (keys.length === 0) {
      return '无缓存'
    }
    let total = 0
    for (const name of keys) {
      const cache = await caches.open(name)
      const requests = await cache.keys()
      for (const request of requests) {
        const response = await cache.match(request)
        if (response) {
          const blob = await response.blob()
          total += blob.size
        }
      }
    }
    return `${formatStorageSize(total)}（${keys.length} 个缓存仓库）`
  } catch {
    return UNAVAILABLE
  }
}

export async function collectDeviceInfo(): Promise<DeviceInfoSpec[]> {
  const ua = navigator.userAgent ?? ''
  const [gpu, battery, quota, idb, cache] = await Promise.all([
    detectGpu(),
    detectBattery(),
    detectStorageQuota(),
    detectIndexedDB(),
    detectCacheSize(),
  ])
  return [
    { label: '操作系统', value: detectPlatform(ua) },
    { label: '浏览器', value: detectBrowser(ua) },
    {
      label: '处理器',
      value: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} 核心` : UNAVAILABLE,
    },
    { label: 'CPU 架构', value: detectCpuArchitecture(ua) },
    { label: '内存', value: formatMemory() },
    { label: '显卡', value: gpu },
    { label: '显示器', value: formatDisplay() },
    {
      label: '色深',
      value: typeof screen !== 'undefined' && screen.colorDepth ? `${screen.colorDepth} 位色深` : UNAVAILABLE,
    },
    { label: '电池', value: battery },
    { label: 'JS 内存', value: formatJsMemory() },
    { label: '总体配额', value: quota },
    { label: 'LocalStorage', value: detectLocalStorage() },
    { label: 'SessionStorage', value: detectSessionStorage() },
    { label: 'IndexedDB', value: idb },
    { label: 'Cookie', value: detectCookies() },
    { label: 'Cache Storage', value: cache },
    { label: '语言', value: formatLanguage() },
    {
      label: '时区',
      value: Intl.DateTimeFormat().resolvedOptions().timeZone ?? UNAVAILABLE,
    },
    { label: '连接状态', value: formatNetwork() },
    { label: '触控', value: formatTouch() },
  ]
}
