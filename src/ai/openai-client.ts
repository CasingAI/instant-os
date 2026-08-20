import OpenAI from 'openai'
import {
  isInstantFreeProvider,
  isOpencodeZenProvider,
  type AiModelCapability,
} from './ai-providers.ts'
import { INSTANT_FREE_GATEWAY_ORIGIN } from './instant-free-gateway.ts'
import {
  mergeOpenAiConfig,
  OPCODE_ZEN_PLACEHOLDER_API_KEY,
  type OpenAiConfig,
} from './openai-config.ts'
import {
  isProxyServerConnected,
  PROXY_SERVER_NOT_CONFIGURED_MESSAGE,
  proxiedFetch,
  ProxyServerApiError,
} from '../os/proxy-server-api.ts'
import { PowError, readBodyBytes, solvePowForBody } from '../os/pow-client.ts'
import { withActiveCloudNetworkRequest } from '../os/cloud-network-store.ts'

let cachedClient: OpenAI | undefined
let cachedConfigKey: string | undefined

export function clearOpenAiClientCache(): void {
  cachedClient = undefined
  cachedConfigKey = undefined
}

function configCacheKey(config: OpenAiConfig): string {
  return `${config.apiKey}|${config.baseURL ?? ''}|${config.defaultModel}|${config.providerId}|${config.thinkingEnabled}|${config.useProxy ?? false}`
}

function resolveTargetUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input.url
}

/**
 * 当供应商要求走代理时，返回一个内部调用 proxiedFetch 的 fetch 替身。
 * 代理未连接时仍返回一个函数，让运行时抛出可读错误而非静默直连。
 */
function createProxyFetch(): typeof fetch {
  return (input, init) => {
    if (!isProxyServerConnected()) {
      return Promise.reject(
        new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE),
      )
    }
    return proxiedFetch(input, init)
  }
}

/**
 * 直连免费额度网关的 fetch 替身：POST 请求体先完成一次 PoW。
 * 网关无状态验证（challenge 窗口 + bodyHash + nonce 工作量），
 * 因此必须在客户端发起请求前解决 Proof-of-Work。
 */
function createFreeGatewayFetch(): typeof fetch {
  return (input, init) => {
    const url = resolveTargetUrl(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    return (async () => {
      let headers = new Headers(init?.headers)
      if (method === 'POST') {
        try {
          const bodyBytes = await readBodyBytes(init)
          if (bodyBytes) {
            const powHeaders = await solvePowForBody(
              INSTANT_FREE_GATEWAY_ORIGIN,
              bodyBytes,
              init?.signal ?? undefined,
            )
            for (const [key, value] of Object.entries(powHeaders)) {
              headers.set(key, value)
            }
          }
        } catch (error) {
          if (error instanceof PowError) {
            throw error
          }
          throw new Error(
            error instanceof Error
              ? `PoW 计算失败：${error.message}`
              : 'PoW 计算失败',
          )
        }
      }
      // 把经免费网关发起的实际请求计入「云服务工作中」
      return withActiveCloudNetworkRequest(() => fetch(url, { ...init, headers }))
    })()
  }
}

/**
 * OpenCode Zen 免费模型匿名访问的 fetch 替身：
 * - 未填 key（占位值）时移除 Authorization 头——zen 端点对免费模型匿名放行；
 * - 已填自己的 key 时保留 Authorization 头，解锁全部付费模型；
 * - 始终经代理服务器转发（opencode.ai 需代理访问）。
 */
function createZenFetch(
  config: OpenAiConfig,
): typeof fetch {
  const isAnonymous = config.apiKey === OPCODE_ZEN_PLACEHOLDER_API_KEY
  return (input, init) => {
    if (!isProxyServerConnected()) {
      return Promise.reject(
        new ProxyServerApiError(PROXY_SERVER_NOT_CONFIGURED_MESSAGE),
      )
    }
    if (isAnonymous) {
      const headers = new Headers(init?.headers)
      headers.delete('authorization')
      headers.delete('Authorization')
      return proxiedFetch(input, { ...init, headers })
    }
    return proxiedFetch(input, init)
  }
}

export function createOpenAiClient(
  configOverrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAI {
  const config = mergeOpenAiConfig(configOverrides, capability)
  let fetchImpl: typeof fetch | undefined
  if (isInstantFreeProvider(config.providerId)) {
    fetchImpl = createFreeGatewayFetch()
  } else if (isOpencodeZenProvider(config.providerId)) {
    fetchImpl = createZenFetch(config)
  } else if (config.useProxy) {
    fetchImpl = createProxyFetch()
  }
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

export function getOpenAiClient(
  configOverrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAI {
  const config = mergeOpenAiConfig(configOverrides, capability)
  const key = `${capability}|${configCacheKey(config)}`

  if (cachedClient && cachedConfigKey === key) {
    return cachedClient
  }

  cachedClient = createOpenAiClient(configOverrides, capability)
  cachedConfigKey = key
  return cachedClient
}
