import OpenAI from 'openai'
import type { AiModelCapability } from './ai-providers.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from './openai-config.ts'

let cachedClient: OpenAI | undefined
let cachedConfigKey: string | undefined

export function clearOpenAiClientCache(): void {
  cachedClient = undefined
  cachedConfigKey = undefined
}

function configCacheKey(config: OpenAiConfig): string {
  return `${config.apiKey}|${config.baseURL ?? ''}|${config.defaultModel}|${config.providerId}|${config.thinkingEnabled}`
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
