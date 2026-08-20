import {
  AI_MODEL_CAPABILITY_LABELS,
  AI_MODEL_OWNED_CAPABILITIES,
  type AiModelCapability,
} from '../ai/ai-providers.ts'
import './ai-model-capability-tags.css'

type AiModelCapabilityTagsProps = {
  capabilities: readonly AiModelCapability[]
  /** 添加自定义模型时允许切换视觉 */
  visionEditable?: boolean
  onVisionChange?: (supportsVision: boolean) => void
}

export function AiModelCapabilityTags({
  capabilities,
  visionEditable = false,
  onVisionChange,
}: AiModelCapabilityTagsProps) {
  return (
    <div class="ai-model-cap-tags" role="list">
      {AI_MODEL_OWNED_CAPABILITIES.map((cap) => {
        const active = capabilities.includes(cap)
        const label = AI_MODEL_CAPABILITY_LABELS[cap]
        const className = `ai-model-cap-tag${active ? ' ai-model-cap-tag--on' : ''}`

        if (cap === 'vision' && visionEditable && onVisionChange) {
          return (
            <button
              key={cap}
              type="button"
              role="listitem"
              class={className}
              aria-pressed={active}
              aria-label={`${label}${active ? '：已开启' : '：已关闭'}`}
              onClick={(event) => {
                event.stopPropagation()
                onVisionChange(!active)
              }}
            >
              {label}
            </button>
          )
        }

        return (
          <span
            key={cap}
            role="listitem"
            class={className}
            aria-label={`${label}${active ? '：支持' : '：不支持'}`}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}
