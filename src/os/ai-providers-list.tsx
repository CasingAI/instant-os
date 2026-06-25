import { findAiProviderPreset, type AiProviderEntry } from '../ai/ai-providers.ts'

type AiProvidersListProps = {
  providers: readonly AiProviderEntry[]
  preferredIndex: number
  onEdit: (index: number) => void
  onDelete: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onSetPreferred: (index: number) => void
  onAdd: () => void
}

function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) {
    return '未设置'
  }
  if (trimmed.length <= 8) {
    return '***'
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

function getProviderDisplayName(entry: AiProviderEntry): string {
  if (entry.name?.trim()) {
    return entry.name.trim()
  }
  return findAiProviderPreset(entry.providerId)?.name ?? entry.providerId
}

export function AiProvidersList({
  providers,
  preferredIndex,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSetPreferred,
  onAdd,
}: AiProvidersListProps) {
  if (providers.length === 0) {
    return (
      <div class="ai-providers-empty">
        <p class="ai-providers-empty-text">尚未添加 AI 供应商</p>
        <button
          type="button"
          class="settings__btn settings__btn--default"
          onClick={onAdd}
        >
          添加供应商
        </button>
      </div>
    )
  }

  return (
    <div class="settings__list settings__list--account">
      {providers.map((entry, index) => {
        const isPreferred = index === preferredIndex
        const displayName = getProviderDisplayName(entry)
        const modelName =
          entry.enabledModels.find((m) => m.modelId === entry.defaultModel)?.name ??
          entry.defaultModel

        return (
          <div
            key={entry.id}
            class={`ai-provider-list-item${isPreferred ? ' ai-provider-list-item--preferred' : ''}`}
          >
            <div class="ai-provider-list-item-main">
              <div class="ai-provider-list-item-header">
                <span class="ai-provider-list-item-name">{displayName}</span>
                {isPreferred && (
                  <span class="ai-provider-list-item-badge">首选</span>
                )}
              </div>
              <div class="ai-provider-list-item-meta">
                <span class="ai-provider-list-item-model">{modelName}</span>
                <span class="ai-provider-list-item-separator">·</span>
                <span class="ai-provider-list-item-key">{maskApiKey(entry.apiKey)}</span>
              </div>
            </div>

            <div class="ai-provider-list-item-actions">
              {!isPreferred && (
                <button
                  type="button"
                  class="ai-provider-list-item-btn"
                  title="设为首选"
                  onClick={() => onSetPreferred(index)}
                >
                  首选
                </button>
              )}
              <button
                type="button"
                class="ai-provider-list-item-btn"
                title="编辑"
                onClick={() => onEdit(index)}
              >
                编辑
              </button>
              <button
                type="button"
                class="ai-provider-list-item-btn ai-provider-list-item-btn--danger"
                title="删除"
                onClick={() => onDelete(index)}
              >
                删除
              </button>
              <div class="ai-provider-list-item-order">
                <button
                  type="button"
                  class="ai-provider-list-item-arrow"
                  disabled={index === 0}
                  title="上移"
                  onClick={() => onMoveUp(index)}
                >
                  &#9650;
                </button>
                <button
                  type="button"
                  class="ai-provider-list-item-arrow"
                  disabled={index === providers.length - 1}
                  title="下移"
                  onClick={() => onMoveDown(index)}
                >
                  &#9660;
                </button>
              </div>
            </div>
          </div>
        )
      })}

      <div class="ai-providers-add-section">
        <button
          type="button"
          class="settings__btn settings__btn--default"
          onClick={onAdd}
        >
          添加供应商
        </button>
      </div>
    </div>
  )
}
