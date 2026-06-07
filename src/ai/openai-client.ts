import OpenAI from 'openai'
import { mergeOpenAiConfig, type OpenAiConfig } from './openai-config.ts'

let cachedClient: OpenAI | undefined
let cachedConfigKey: string | undefined

export function clearOpenAiClientCache(): void {
  cachedClient = undefined
  cachedConfigKey = undefined
}

function configCacheKey(config: OpenAiConfig): string {
  return `${config.apiKey}|${config.baseURL ?? ''}|${config.defaultModel}`
}

export function createOpenAiClient(configOverrides?: Partial<OpenAiConfig>): OpenAI {
  const config = mergeOpenAiConfig(configOverrides)
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    dangerouslyAllowBrowser: true,
  })
}

export function getOpenAiClient(configOverrides?: Partial<OpenAiConfig>): OpenAI {
  const config = mergeOpenAiConfig(configOverrides)
  const key = configCacheKey(config)

  if (cachedClient && cachedConfigKey === key) {
    return cachedClient
  }

  cachedClient = createOpenAiClient(config)
  cachedConfigKey = key
  return cachedClient
}
