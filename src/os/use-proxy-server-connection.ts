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
  loadProxyServerSettings,
  subscribeProxyServerSettings,
} from './proxy-server-settings-storage.ts'

export type ProxyServerConnectionState = {
  connected: boolean
  /** 连接的可读标识：shared 预设显示「Instant 共享」，自定义显示 origin 的 host */
  proxyLabel: string | undefined
  throughput: ProxyServerThroughputSnapshot
  recentRequests: ProxyServerRequestRecord[]
}

export function getProxyServerConnectionLabel(): string | undefined {
  if (!isProxyServerConnected()) {
    return undefined
  }
  const settings = loadProxyServerSettings()
  if (settings.preset === 'shared') {
    return 'Instant 共享'
  }
  return getProxyServerHost()
}

function readProxyServerConnectionState(): ProxyServerConnectionState {
  const connected = isProxyServerConnected()
  return {
    connected,
    proxyLabel: connected ? getProxyServerConnectionLabel() : undefined,
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
