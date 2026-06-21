import { useEffect, useState } from 'preact/hooks'
import appConfig from '../../app.config.json'
import packageJson from '../../package.json'
import { buildRuntimeManifest } from '../bridge/instant-os-host.ts'
import {
  clearDevSettings,
  loadDevSettings,
  maskSecret,
  saveDevSettings,
  subscribeDevSettings,
} from './instant-os-dev-settings.ts'
import { appendDevLog } from './instant-os-dev-log.ts'
import {
  hasDevAiCredentials,
  isRunningInsideInstantOsHost,
  resolveInstantOsRuntimeMode,
} from './instant-os-runtime.ts'

type AppConfig = {
  id: string
  name: string
  description: string
  themeColor: string
  tags: string[]
}

const config = appConfig as AppConfig

export function DevConsoleSettingsTab() {
  const [draft, setDraft] = useState(() => loadDevSettings())
  const [showApiKey, setShowApiKey] = useState(false)
  const [savedHint, setSavedHint] = useState<string | undefined>(undefined)

  useEffect(() => subscribeDevSettings(() => setDraft(loadDevSettings())), [])

  const handleSave = () => {
    const next = saveDevSettings(draft)
    setDraft(next)
    setSavedHint('已保存到本机，立即生效')
    appendDevLog('system', '开发配置已更新', {
      level: 'success',
      detail: {
        aiApiBase: next.aiApiBase,
        aiModel: next.aiModel,
        aiApiKey: maskSecret(next.aiApiKey),
      },
    })
    window.setTimeout(() => setSavedHint(undefined), 2000)
  }

  const handleReset = () => {
    clearDevSettings()
    setDraft(loadDevSettings())
    setSavedHint('已恢复默认（含 .env 初始值）')
    appendDevLog('system', '开发配置已重置', { level: 'warn' })
    window.setTimeout(() => setSavedHint(undefined), 2000)
  }

  return (
    <div class="dev-console__section">
      <p class="dev-console__section-lead">
        在此配置开发环境 AI。未填写时自动使用 Mock；填写后走真实 OpenAI 兼容 API。配置保存在本机
        localStorage，无需改文件。
      </p>

      <label class="dev-console__field">
        <span>API Base URL</span>
        <input
          class="dev-console__input"
          type="url"
          placeholder="https://api.openai.com/v1"
          value={draft.aiApiBase}
          onInput={(event) =>
            setDraft((current) => ({
              ...current,
              aiApiBase: (event.currentTarget as HTMLInputElement).value,
            }))
          }
        />
      </label>

      <label class="dev-console__field">
        <span>API Key</span>
        <div class="dev-console__input-row">
          <input
            class="dev-console__input"
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            value={draft.aiApiKey}
            onInput={(event) =>
              setDraft((current) => ({
                ...current,
                aiApiKey: (event.currentTarget as HTMLInputElement).value,
              }))
            }
          />
          <button
            type="button"
            class="dev-console__action"
            onClick={() => setShowApiKey((value) => !value)}
          >
            {showApiKey ? '隐藏' : '显示'}
          </button>
        </div>
      </label>

      <label class="dev-console__field">
        <span>模型</span>
        <input
          class="dev-console__input"
          type="text"
          placeholder="gpt-4o-mini"
          value={draft.aiModel}
          onInput={(event) =>
            setDraft((current) => ({
              ...current,
              aiModel: (event.currentTarget as HTMLInputElement).value,
            }))
          }
        />
      </label>

      <div class="dev-console__settings-status">
        <span>当前 AI 模式：{hasDevAiCredentials() ? '真实 API' : 'Mock'}</span>
        {savedHint ? <span class="dev-console__settings-hint">{savedHint}</span> : undefined}
      </div>

      <div class="dev-console__settings-actions">
        <button type="button" class="dev-console__action dev-console__action--primary" onClick={handleSave}>
          保存配置
        </button>
        <button type="button" class="dev-console__action" onClick={handleReset}>
          重置
        </button>
      </div>
    </div>
  )
}

export function DevConsoleInfoTab() {
  const manifest = buildRuntimeManifest()

  const rows = [
    ['运行模式', resolveInstantOsRuntimeMode()],
    ['Instant OS 宿主', isRunningInsideInstantOsHost() ? '是' : '否'],
    ['应用 ID', manifest.id],
    ['应用名称', manifest.name],
    ['版本号', packageJson.version],
    ['主题色', config.themeColor],
    ['能力标签', config.tags.join(', ') || '无'],
    ['入口', manifest.entry],
    ['AI 模式', hasDevAiCredentials() ? '真实 API' : 'Mock'],
    ['API Base', loadDevSettings().aiApiBase || '未配置'],
    ['API Key', maskSecret(loadDevSettings().aiApiKey)],
    ['模型', loadDevSettings().aiModel],
  ] as const

  return (
    <div class="dev-console__section">
      <p class="dev-console__section-lead">
        在 Instant OS 中调试：打开「系统设置 → 开发者选项 → 外链应用调试」，填入本页地址（如
        http://localhost:6175/）并添加到桌面。在宿主内打开后将走真实 AI，而非本页 Mock。
      </p>
      <dl class="dev-console__info-list">
        {rows.map(([label, value]) => (
          <div class="dev-console__info-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
