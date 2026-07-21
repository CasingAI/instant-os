import { useEffect, useState } from 'preact/hooks'
import { getProxyServerHost } from './proxy-server-api.ts'
import {
  formatProxyServerBytesPerSec,
  getProxyServerThroughputSnapshot,
  listRecentProxyServerRequests,
  subscribeProxyServerMetrics,
  type ProxyServerRequestRecord,
  type ProxyServerThroughputSnapshot,
} from './proxy-server-metrics.ts'
import {
  isProxyServerConnected,
  subscribeProxyServerSettings,
} from './proxy-server-settings-storage.ts'

export type ProxyServerConnectionState = {
  connected: boolean
  proxyHost: string | undefined
  throughput: ProxyServerThroughputSnapshot
  recentRequests: ProxyServerRequestRecord[]
}

function readProxyServerConnectionState(): ProxyServerConnectionState {
  const connected = isProxyServerConnected()
  return {
    connected,
    proxyHost: connected ? getProxyServerHost() : undefined,
    throughput: getProxyServerThroughputSnapshot(),
    recentRequests: listRecentProxyServerRequests(5),
  }
}

/** 订阅代理服务器连接与流量计量，供菜单栏状态使用。 */
export function useProxyServerConnection(): ProxyServerConnectionState {
  const [state, setState] = useState<ProxyServerConnectionState>(() =>
    readProxyServerConnectionState(),
  )

  useEffect(() => {
    const sync = () => setState(readProxyServerConnectionState())
    sync()
    const unsubSettings = subscribeProxyServerSettings(sync)
    const unsubMetrics = subscribeProxyServerMetrics(sync)
    const timer = window.setInterval(sync, 1000)
    return () => {
      unsubSettings()
      unsubMetrics()
      window.clearInterval(timer)
    }
  }, [])

  return state
}

export function formatProxyServerMenuSpeed(throughput: ProxyServerThroughputSnapshot): string {
  const down = formatProxyServerBytesPerSec(throughput.downloadBytesPerSec)
  const up = formatProxyServerBytesPerSec(throughput.uploadBytesPerSec)
  return `↓ ${down} · ↑ ${up}`
}
