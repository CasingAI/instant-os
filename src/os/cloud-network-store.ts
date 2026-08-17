/**
 * 云服务网络请求计数器：统计当前经代理 / 免费网关发起的活跃请求数，
 * 供菜单栏「云服务」icon 判断是否处于「工作中」状态。
 */

export const CLOUD_NETWORK_EVENT = 'instant-os:cloud-network'

type CloudNetworkState = {
  /** 当前活跃（进行中）的云服务网络请求数 */
  activeRequests: number
}

let activeRequests = 0

function publish(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(
    new CustomEvent<CloudNetworkState>(CLOUD_NETWORK_EVENT, {
      detail: { activeRequests },
    }),
  )
}

/** 标记一次云服务网络请求开始。 */
export function beginCloudNetworkRequest(): void {
  activeRequests += 1
  publish()
}

/** 标记一次云服务网络请求结束。 */
export function endCloudNetworkRequest(): void {
  activeRequests = Math.max(0, activeRequests - 1)
  publish()
}

export function getActiveCloudNetworkRequests(): number {
  return activeRequests
}

/**
 * 好用包装：把 fn（返回 Promise）的执行过程计入活跃请求计数。
 * fn 无论成功 / 失败 / 抛错都会在结束前正确递减计数。
 */
export async function withActiveCloudNetworkRequest<T>(fn: () => Promise<T>): Promise<T> {
  beginCloudNetworkRequest()
  try {
    return await fn()
  } finally {
    endCloudNetworkRequest()
  }
}

export function subscribeCloudNetworkRequests(
  listener: (state: CloudNetworkState) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const handle = (event: Event) => {
    listener((event as CustomEvent<CloudNetworkState>).detail)
  }
  window.addEventListener(CLOUD_NETWORK_EVENT, handle)
  return () => window.removeEventListener(CLOUD_NETWORK_EVENT, handle)
}
