import type { DeviceInfoSpec } from './collect-device-info.ts'

const UNAVAILABLE = '不可用'
const LOADING = '获取中...'

const TRACE_ENDPOINTS = [
  '/cdn-cgi/trace',
  'https://cloudflare.com/cdn-cgi/trace',
  'https://www.cloudflare.com/cdn-cgi/trace',
]

const IPIFY_URL = 'https://api.ipify.org?format=json'

export type CloudflareTrace = Record<string, string>

export type CfNetworkFetchState =
  | { status: 'loading' }
  | { status: 'ok'; data: CloudflareTrace; source: string }
  | { status: 'ipify'; ip: string }
  | { status: 'failed'; error: string }

export const CF_NETWORK_FIELD_DEFS: { key: string; label: string }[] = [
  { key: 'ip', label: 'IP 地址' },
  { key: 'colo', label: '边缘节点' },
  { key: 'loc', label: '国家/地区' },
]

function parseTraceBody(text: string): CloudflareTrace {
  const lines = text.trim().split('\n')
  const result: CloudflareTrace = {}
  for (const line of lines) {
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    const value = line.slice(eqIndex + 1).trim()
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

/** 必须包含 trace 特征字段，避免把 SPA 回退的 index.html 误判为成功 */
function isValidTrace(data: CloudflareTrace): boolean {
  return typeof data.ip === 'string' || typeof data.colo === 'string' || typeof data.fl === 'string'
}

function formatTraceValue(rawValue: string | undefined): string {
  if (rawValue === undefined || rawValue === '') {
    return UNAVAILABLE
  }
  return rawValue
}

export function buildCfNetworkSpecs(state: CfNetworkFetchState): DeviceInfoSpec[] {
  if (state.status === 'loading') {
    return CF_NETWORK_FIELD_DEFS.map((field) => ({
      label: field.label,
      value: LOADING,
    }))
  }

  if (state.status === 'failed') {
    return [
      ...CF_NETWORK_FIELD_DEFS.map((field) => ({
        label: field.label,
        value: UNAVAILABLE,
      })),
      { label: '诊断', value: `获取失败（${state.error}）` },
    ]
  }

  if (state.status === 'ipify') {
    return [
      { label: 'IP 地址', value: state.ip },
      ...CF_NETWORK_FIELD_DEFS.filter((field) => field.key !== 'ip').map((field) => ({
        label: field.label,
        value: UNAVAILABLE,
      })),
    ]
  }

  const data = state.data
  return CF_NETWORK_FIELD_DEFS.map((field) => ({
    label: field.label,
    value: formatTraceValue(data[field.key]),
  }))
}

type TraceResult =
  | { ok: true; data: CloudflareTrace; source: string }
  | { ok: false }

async function tryFetchTrace(url: string): Promise<TraceResult> {
  try {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) {
      return { ok: false }
    }
    const text = await response.text()
    const data = parseTraceBody(text)
    if (!isValidTrace(data)) {
      return { ok: false }
    }
    return { ok: true, data, source: url }
  } catch {
    return { ok: false }
  }
}

async function tryFetchIpify(): Promise<{ ok: true; ip: string } | { ok: false }> {
  try {
    const response = await fetch(IPIFY_URL, { cache: 'no-cache' })
    if (!response.ok) return { ok: false }
    const body = (await response.json()) as { ip?: string }
    const { ip } = body
    if (typeof ip !== 'string' || !ip) return { ok: false }
    return { ok: true, ip }
  } catch {
    return { ok: false }
  }
}

export async function fetchCfNetworkState(): Promise<CfNetworkFetchState> {
  for (const url of TRACE_ENDPOINTS) {
    const result = await tryFetchTrace(url)
    if (result.ok) {
      return { status: 'ok', data: result.data, source: url }
    }
  }

  const ipify = await tryFetchIpify()
  if (ipify.ok) {
    return { status: 'ipify', ip: ipify.ip }
  }

  return { status: 'failed', error: '所有网络诊断端点均不可达' }
}
