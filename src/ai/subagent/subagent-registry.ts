import {
  listEnabledModelsForCapability,
  resolvePreferredModelRef,
  type PreferredModelRef,
} from '../ai-providers.ts'
import { loadAccountSettings } from '../../os/account-settings-storage.ts'
import { BUILTIN_SUBAGENTS, isBuiltinSubAgentId } from './subagent-builtin.ts'
import type {
  CustomSubAgentDefinition,
  EffectiveSubAgent,
  SubAgentAccess,
  SubAgentBuiltinOverride,
  SubAgentDefinition,
  SubAgentHostConfig,
  SubAgentModelSource,
} from './subagent-types.ts'

export function capSubAgentAccess(
  requested: SubAgentAccess,
  parentAccess: SubAgentAccess,
): SubAgentAccess {
  if (parentAccess === 'readonly') return 'readonly'
  return requested
}

function formatModelRefKey(ref: PreferredModelRef): string {
  return `${ref.providerEntryId}:${ref.modelId}`
}

function parseModelRefKey(key: string): PreferredModelRef | undefined {
  const separator = key.indexOf(':')
  if (separator <= 0) return undefined
  const providerEntryId = key.slice(0, separator)
  const modelId = key.slice(separator + 1)
  if (!providerEntryId || !modelId) return undefined
  return { providerEntryId, modelId }
}

function listTextModels() {
  const settings = loadAccountSettings()
  if (!settings || settings.providers.length === 0) return []
  return listEnabledModelsForCapability(settings.providers, 'text')
}

function preferredCapabilityKey(capability: 'text' | 'text-secondary'): string | undefined {
  const settings = loadAccountSettings()
  if (!settings) return undefined
  const preferred = resolvePreferredModelRef(settings, capability)
  if (!preferred) return undefined
  const models = listTextModels()
  if (
    !models.some(
      (item) =>
        item.providerEntryId === preferred.providerEntryId &&
        item.modelId === preferred.modelId,
    )
  ) {
    return undefined
  }
  return formatModelRefKey(preferred)
}

function resolveValidModelKey(storedKey: string | undefined): string | undefined {
  const models = listTextModels()
  if (models.length === 0) return undefined
  if (storedKey) {
    const ref = parseModelRefKey(storedKey)
    if (
      ref &&
      models.some(
        (item) =>
          item.providerEntryId === ref.providerEntryId && item.modelId === ref.modelId,
      )
    ) {
      return storedKey
    }
  }
  const preferred = preferredCapabilityKey('text')
  if (preferred) return preferred
  const first = models[0]
  if (!first) return undefined
  return formatModelRefKey({
    providerEntryId: first.providerEntryId,
    modelId: first.modelId,
  })
}

/** 按模型来源解析实际 modelKey（副基座 / 基座 / 指定） */
export function resolveModelKeyFromSource(
  source: SubAgentModelSource,
  customKey: string | undefined,
): string | undefined {
  if (source === 'custom') {
    return resolveValidModelKey(customKey)
  }
  if (source === 'text') {
    return preferredCapabilityKey('text') ?? resolveValidModelKey(undefined)
  }
  return (
    preferredCapabilityKey('text-secondary') ??
    preferredCapabilityKey('text') ??
    resolveValidModelKey(undefined)
  )
}

export function resolveSubAgentModelKey(
  def: Pick<SubAgentDefinition, 'defaultModelPolicy'>,
  config: Pick<SubAgentHostConfig, 'parentModelKey'>,
  override?: SubAgentBuiltinOverride | Pick<CustomSubAgentDefinition, 'modelSource' | 'modelKey'>,
): string | undefined {
  if (override?.modelSource) {
    return resolveModelKeyFromSource(override.modelSource, override.modelKey)
  }
  if (def.defaultModelPolicy === 'inherit-parent') {
    return resolveValidModelKey(config.parentModelKey)
  }
  return (
    preferredCapabilityKey('text-secondary') ??
    preferredCapabilityKey('text') ??
    resolveValidModelKey(config.parentModelKey)
  )
}

function isBuiltinEnabled(override: SubAgentBuiltinOverride | undefined): boolean {
  return override?.enabled !== false
}

function isCustomEnabled(agent: CustomSubAgentDefinition): boolean {
  return agent.enabled !== false
}

function toEffective(
  def: SubAgentDefinition,
  config: SubAgentHostConfig,
  override?: SubAgentBuiltinOverride,
): EffectiveSubAgent {
  return {
    id: def.id,
    description: def.description,
    systemPrompt: def.systemPrompt,
    access: capSubAgentAccess(def.access, config.parentAccess),
    modelKey: resolveSubAgentModelKey(def, config, override),
    builtin: def.builtin,
  }
}

/** 列出当前可用（enabled + 权限封顶后）的 Sub Agent */
export function listAvailableSubAgents(config: SubAgentHostConfig): EffectiveSubAgent[] {
  if (!config.enabled) return []

  const result: EffectiveSubAgent[] = []

  for (const id of ['explore', 'general'] as const) {
    const override = config.builtinOverrides[id]
    if (!isBuiltinEnabled(override)) continue
    result.push(toEffective(BUILTIN_SUBAGENTS[id], config, override))
  }

  const seen = new Set(result.map((item) => item.id))
  for (const custom of config.customAgents) {
    const id = custom.id.trim()
    if (!id || isBuiltinSubAgentId(id) || seen.has(id)) continue
    if (!isCustomEnabled(custom)) continue
    seen.add(id)
    const def: SubAgentDefinition = {
      id,
      description: custom.description.trim() || id,
      systemPrompt: custom.prompt,
      access: custom.access,
      defaultModelPolicy: 'inherit-parent',
      builtin: false,
    }
    result.push({
      id,
      description: def.description,
      systemPrompt: def.systemPrompt,
      access: capSubAgentAccess(def.access, config.parentAccess),
      modelKey: resolveSubAgentModelKey(def, config, custom),
      builtin: false,
    })
  }

  return result
}

/** 按 id 解析可用 Sub Agent；未启用或不存在返回 undefined */
export function resolveSubAgent(
  id: string,
  config: SubAgentHostConfig,
): EffectiveSubAgent | undefined {
  const trimmed = id.trim()
  if (!trimmed) return undefined
  return listAvailableSubAgents(config).find((item) => item.id === trimmed)
}

/** 宿主是否应注册委派工具：应用开启且至少有一个可用 Agent */
export function shouldExposeSubAgentDelegation(config: SubAgentHostConfig): boolean {
  return listAvailableSubAgents(config).length > 0
}
