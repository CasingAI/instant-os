import OpenAI from 'openai'
import type { AiModelCapability } from './ai-providers.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from './openai-config.ts'
import {
  isProxyServerConnected,
  PROXY_SERVER_NOT_CONFIGURED_MESSAGE,
  proxiedFetch,
  ProxyServerApiError,
} from '../os/proxy-server-api.ts'

let cachedClient: OpenAI | undefined
let cachedConfigKey: string | undefined

export function clearOpenAiClientCache(): void {
  cachedClient = undefined
  cachedConfigKey = undefined
}

function configCacheKey(config: OpenAiConfig): string {
  return `${config.apiKey}|${config.baseURL ?? ''}|${config.defaultModel}|${config.providerId}|${config.thinkingEnabled}|${config.useProxy ?? false}`
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

export function createOpenAiClient(
  configOverrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAI {
  const config = mergeOpenAiConfig(configOverrides, capability)
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true,
    ...(config.useProxy ? { fetch: createProxyFetch() } : {}),
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
