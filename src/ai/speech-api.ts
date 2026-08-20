/**
 * 系统级语音服务：App 只调用本模块入口。
 * - 首选模型：钥匙串按能力（speech-recognition / speech-synthesis）
 * - 默认音色 / 语种：系统设置 → 语音
 * - 供应商协议细节：内部适配器（MiMo / 方舟 Agent Plan）
 */
import { loadAccountSettings } from '../os/account-settings-storage.ts'
import {
  DEFAULT_SPEECH_VOICE,
  loadSpeechSettings,
  type AsrLanguagePreference,
} from '../os/speech-settings-storage.ts'
import {
  modelHasCapability,
  resolvePreferredModelRef,
  type AiModelCapability,
  type AiProviderId,
} from './ai-providers.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import { hasOpenAiApiKey, mergeOpenAiConfig, readDefaultModelFriendlyName } from './openai-config.ts'
import {
  arkRecognizeSpeech,
  arkRecognizeSpeechStream,
  arkSynthesizeSpeech,
  arkSynthesizeSpeechStream,
  ARK_TTS_PCM_SAMPLE_RATE,
  ARK_TTS_VOICES,
} from './speech-ark-adapter.ts'
import {
  mimoRecognizeSpeech,
  mimoRecognizeSpeechStream,
  mimoSynthesizeSpeech,
  mimoSynthesizeSpeechStream,
  MIMO_TTS_PCM_SAMPLE_RATE,
  MIMO_TTS_VOICES,
} from './speech-mimo-adapter.ts'

export type AsrLanguage = AsrLanguagePreference

export type SpeechVoiceOption = {
  id: string
  label: string
}

export type RecognizeSpeechOptions = {
  /** WAV / MP3 的 base64（不含 data: 前缀） */
  audioBase64: string
  mimeType?: 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
  /** 未传则使用系统默认语种 */
  language?: AsrLanguage
  usageContext?: AiUsageContext
}

export type RecognizeSpeechStreamOptions = RecognizeSpeechOptions & {
  signal?: AbortSignal
  /** 转写文本增量（整段音频已上传后的 SSE） */
  onTextChunk?: (delta: string, accumulated: string) => void
}

export type SynthesizeSpeechOptions = {
  text: string
  /** 可选风格指令（由适配器解释） */
  styleInstruction?: string
  /** 未传则使用系统默认音色 */
  voice?: string
  format?: 'wav' | 'mp3' | 'pcm16'
  usageContext?: AiUsageContext
}

export type SynthesizeSpeechResult = {
  audioBase64: string
  format: string
  model: string
}

export type SynthesizeSpeechStreamOptions = {
  text: string
  styleInstruction?: string
  /** 未传则使用系统默认音色 */
  voice?: string
  usageContext?: AiUsageContext
  signal?: AbortSignal
  /** 每收到一段 pcm16 LE mono 分片时回调（采样率见返回值 / MIMO 约定 24kHz） */
  onPcmChunk: (pcm: Uint8Array) => void
}

export type SynthesizeSpeechStreamResult = {
  pcm: Uint8Array
  sampleRate: number
  model: string
}

export type SpeechSystemStatus = {
  asrModelLabel: string
  ttsModelLabel: string
  defaultVoice: string
  defaultAsrLanguage: AsrLanguage
  voices: readonly SpeechVoiceOption[]
}

function requireCapabilityConfig(capability: AiModelCapability) {
  const settings = loadAccountSettings()
  if (!settings) {
    throw new Error('尚未配置 AI 账户，请先在钥匙串添加供应商。')
  }
  const ref = resolvePreferredModelRef(settings, capability)
  if (!ref) {
    const label =
      capability === 'speech-recognition' ? '语音识别' : '语音合成'
    throw new Error(
      `未找到可用的${label}模型。请在钥匙串启用并选用对应模型（如小米 MiMo ASR / TTS，或方舟 Agent Plan 语音模型）。`,
    )
  }
  const entry = settings.providers.find((item) => item.id === ref.providerEntryId)
  const storedCaps = entry?.enabledModels.find(
    (m) => m.modelId === ref.modelId,
  )?.capabilities
  if (
    !entry ||
    !modelHasCapability(entry.providerId, ref.modelId, capability, storedCaps)
  ) {
    throw new Error('当前首选模型不具备所需语音能力，请在钥匙串重新选择。')
  }
  return {
    config: mergeOpenAiConfig(undefined, capability),
    providerId: entry.providerId,
  }
}

function isMimoProvider(providerId: AiProviderId): boolean {
  return providerId === 'mimo' || providerId === 'mimo-token-plan'
}

function isArkSpeechProvider(providerId: AiProviderId): boolean {
  return providerId === 'ark-agent-plan'
}

/** 当前可用音色列表（随合成首选供应商变化） */
export function listSpeechVoices(): readonly SpeechVoiceOption[] {
  const settings = loadAccountSettings()
  if (settings) {
    const ref = resolvePreferredModelRef(settings, 'speech-synthesis')
    const entry = ref
      ? settings.providers.find((item) => item.id === ref.providerEntryId)
      : undefined
    if (entry) {
      if (isArkSpeechProvider(entry.providerId)) {
        return ARK_TTS_VOICES
      }
      if (!isMimoProvider(entry.providerId)) {
        return []
      }
    }
  }
  return MIMO_TTS_VOICES
}

export function resolveDefaultSpeechVoice(): string {
  const prefs = loadSpeechSettings()
  const voices = listSpeechVoices()
  if (voices.some((item) => item.id === prefs.defaultVoice)) {
    return prefs.defaultVoice
  }
  return voices[0]?.id ?? DEFAULT_SPEECH_VOICE
}

export function resolveDefaultAsrLanguage(): AsrLanguage {
  return loadSpeechSettings().defaultAsrLanguage
}

/** 供设置页 / 实验室展示的系统语音状态摘要 */
export function readSpeechSystemStatus(): SpeechSystemStatus {
  const configured = hasOpenAiApiKey()
  return {
    asrModelLabel: configured
      ? readDefaultModelFriendlyName('speech-recognition')
      : '未配置',
    ttsModelLabel: configured
      ? readDefaultModelFriendlyName('speech-synthesis')
      : '未配置',
    defaultVoice: resolveDefaultSpeechVoice(),
    defaultAsrLanguage: resolveDefaultAsrLanguage(),
    voices: listSpeechVoices(),
  }
}

/** 调用系统「语音识别」首选模型进行转写 */
export async function recognizeSpeech(
  options: RecognizeSpeechOptions,
): Promise<string> {
  const { config, providerId } = requireCapabilityConfig('speech-recognition')
  const mimeType = options.mimeType ?? 'audio/wav'
  const language = options.language ?? resolveDefaultAsrLanguage()

  if (isMimoProvider(providerId)) {
    return mimoRecognizeSpeech({
      config,
      audioBase64: options.audioBase64,
      mimeType,
      language,
      usageContext: options.usageContext,
    })
  }

  if (isArkSpeechProvider(providerId)) {
    return arkRecognizeSpeech({
      config,
      audioBase64: options.audioBase64,
      mimeType,
      language,
      usageContext: options.usageContext,
    })
  }

  throw new Error(
    '当前语音识别供应商尚未接入系统语音服务（目前支持小米 MiMo 与火山方舟 Agent Plan）。',
  )
}

/**
 * 流式语音识别。
 * MiMo：整段上传 + SSE 文本增量；方舟：HTTP 极速识别（完成后一次性回调）。
 */
export async function recognizeSpeechStream(
  options: RecognizeSpeechStreamOptions,
): Promise<string> {
  const { config, providerId } = requireCapabilityConfig('speech-recognition')
  const mimeType = options.mimeType ?? 'audio/wav'
  const language = options.language ?? resolveDefaultAsrLanguage()

  if (isMimoProvider(providerId)) {
    return mimoRecognizeSpeechStream({
      config,
      audioBase64: options.audioBase64,
      mimeType,
      language,
      usageContext: options.usageContext,
      signal: options.signal,
      onTextChunk: options.onTextChunk,
    })
  }

  if (isArkSpeechProvider(providerId)) {
    return arkRecognizeSpeechStream({
      config,
      audioBase64: options.audioBase64,
      mimeType,
      language,
      usageContext: options.usageContext,
      signal: options.signal,
      onTextChunk: options.onTextChunk,
    })
  }

  throw new Error(
    '当前语音识别供应商尚未接入系统语音服务（目前支持小米 MiMo 与火山方舟 Agent Plan）。',
  )
}

/** 调用系统「语音合成」首选模型生成音频 */
export async function synthesizeSpeech(
  options: SynthesizeSpeechOptions,
): Promise<SynthesizeSpeechResult> {
  const { config, providerId } = requireCapabilityConfig('speech-synthesis')
  const format = options.format ?? 'wav'
  const voice = options.voice?.trim() || resolveDefaultSpeechVoice()

  if (isMimoProvider(providerId)) {
    return mimoSynthesizeSpeech({
      config,
      text: options.text,
      styleInstruction: options.styleInstruction,
      voice,
      format,
      usageContext: options.usageContext,
    })
  }

  if (isArkSpeechProvider(providerId)) {
    return arkSynthesizeSpeech({
      config,
      text: options.text,
      styleInstruction: options.styleInstruction,
      voice,
      format,
      usageContext: options.usageContext,
    })
  }

  throw new Error(
    '当前语音合成供应商尚未接入系统语音服务（目前支持小米 MiMo 与火山方舟 Agent Plan）。',
  )
}

/**
 * 流式语音合成（pcm16）。
 * 首包到达后即可边收边播；完整 PCM 在 Promise resolve 时返回。
 */
export async function synthesizeSpeechStream(
  options: SynthesizeSpeechStreamOptions,
): Promise<SynthesizeSpeechStreamResult> {
  const { config, providerId } = requireCapabilityConfig('speech-synthesis')
  const voice = options.voice?.trim() || resolveDefaultSpeechVoice()

  if (isMimoProvider(providerId)) {
    return mimoSynthesizeSpeechStream({
      config,
      text: options.text,
      styleInstruction: options.styleInstruction,
      voice,
      usageContext: options.usageContext,
      signal: options.signal,
      onPcmChunk: options.onPcmChunk,
    })
  }

  if (isArkSpeechProvider(providerId)) {
    return arkSynthesizeSpeechStream({
      config,
      text: options.text,
      styleInstruction: options.styleInstruction,
      voice,
      usageContext: options.usageContext,
      signal: options.signal,
      onPcmChunk: options.onPcmChunk,
    })
  }

  throw new Error(
    '当前语音合成供应商尚未接入系统语音服务（目前支持小米 MiMo 与火山方舟 Agent Plan）。',
  )
}

/** @deprecated 请使用 listSpeechVoices；保留别名以免旧引用断裂 */
export {
  ARK_TTS_PCM_SAMPLE_RATE,
  MIMO_TTS_PCM_SAMPLE_RATE,
  MIMO_TTS_VOICES,
}

/** 当前合成首选对应的 PCM 采样率（方舟 / MiMo 均为 24kHz） */
export function resolveSpeechPcmSampleRate(): number {
  const settings = loadAccountSettings()
  if (settings) {
    const ref = resolvePreferredModelRef(settings, 'speech-synthesis')
    const entry = ref
      ? settings.providers.find((item) => item.id === ref.providerEntryId)
      : undefined
    if (entry && isArkSpeechProvider(entry.providerId)) {
      return ARK_TTS_PCM_SAMPLE_RATE
    }
  }
  return MIMO_TTS_PCM_SAMPLE_RATE
}
