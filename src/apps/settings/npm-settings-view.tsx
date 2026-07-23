import { useEffect, useState } from 'preact/hooks'
import {
  NPM_REGISTRY_PRESETS,
  applyNpmRegistrySettingsToPackageService,
  loadNpmRegistrySettings,
  normalizeRegistryUrl,
  probeNpmRegistry,
  resolveNpmRegistryUrl,
  saveNpmRegistrySettings,
  subscribeNpmRegistrySettings,
  type NpmRegistryPresetId,
} from '../../os/npm-registry-settings-storage.ts'
import { getPackageServiceConfig } from '../../packages/package-public.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from './settings-layout-breakpoints.ts'

type NpmSettingsViewProps = {
  onBack: () => void
}

type StatusKind = 'idle' | 'saving' | 'probing' | 'success' | 'error'

const PRESET_OPTIONS = [
  { id: 'npmjs', label: NPM_REGISTRY_PRESETS.npmjs.label },
  { id: 'npmmirror', label: NPM_REGISTRY_PRESETS.npmmirror.label },
  { id: 'custom', label: '自定义' },
] as const

export function NpmSettingsView({ onBack }: NpmSettingsViewProps) {
  const [preset, setPreset] = useState<NpmRegistryPresetId>(
    () => loadNpmRegistrySettings().preset,
  )
  const [customRegistryUrl, setCustomRegistryUrl] = useState(
    () => loadNpmRegistrySettings().customRegistryUrl,
  )
  const [activeRegistryUrl, setActiveRegistryUrl] = useState(
    () => getPackageServiceConfig().registryUrl,
  )
  const [wideLayout, setWideLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(`(min-width: ${SETTINGS_WIDE_LAYOUT_MIN_WIDTH}px)`).matches,
  )
  const [statusKind, setStatusKind] = useState<StatusKind>('idle')
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SETTINGS_WIDE_LAYOUT_MIN_WIDTH}px)`)
    const sync = () => setWideLayout(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const sync = () => {
      const settings = loadNpmRegistrySettings()
      setPreset(settings.preset)
      setCustomRegistryUrl(settings.customRegistryUrl)
      setActiveRegistryUrl(getPackageServiceConfig().registryUrl)
    }
    sync()
    return subscribeNpmRegistrySettings(sync)
  }, [])

  const draftUrl =
    preset === 'custom'
      ? customRegistryUrl
      : NPM_REGISTRY_PRESETS[preset].registryUrl

  const handleSave = () => {
    if (busy) return
    setBusy(true)
    setStatusKind('saving')
    setStatusMessage('正在保存…')
    try {
      if (preset === 'custom' && !normalizeRegistryUrl(customRegistryUrl)) {
        setStatusKind('error')
        setStatusMessage('请输入有效的 http(s) registry URL')
        return
      }
      const ok = saveNpmRegistrySettings({
        version: 1,
        preset,
        customRegistryUrl,
      })
      if (!ok) {
        setStatusKind('error')
        setStatusMessage('保存失败（URL 无效或存储空间可能已满）')
        return
      }
      setActiveRegistryUrl(getPackageServiceConfig().registryUrl)
      setStatusKind('success')
      setStatusMessage(`已应用 ${getPackageServiceConfig().registryUrl}`)
    } finally {
      setBusy(false)
    }
  }

  const handleProbe = async () => {
    if (busy) return
    const target =
      preset === 'custom'
        ? normalizeRegistryUrl(customRegistryUrl)
        : NPM_REGISTRY_PRESETS[preset].registryUrl
    if (!target) {
      setStatusKind('error')
      setStatusMessage('请先填写有效的 registry URL')
      return
    }
    setBusy(true)
    setStatusKind('probing')
    setStatusMessage('正在测试连通性…')
    try {
      const result = await probeNpmRegistry(target)
      if (result.ok) {
        setStatusKind('success')
        setStatusMessage(`连通正常（${result.durationMs} ms）`)
      } else {
        setStatusKind('error')
        setStatusMessage(`${result.message}（${result.durationMs} ms）`)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleReset = () => {
    if (busy) return
    setPreset('npmjs')
    setCustomRegistryUrl('')
    const ok = saveNpmRegistrySettings({
      version: 1,
      preset: 'npmjs',
      customRegistryUrl: '',
    })
    if (!ok) {
      setStatusKind('error')
      setStatusMessage('无法恢复默认源')
      return
    }
    applyNpmRegistrySettingsToPackageService()
    setActiveRegistryUrl(getPackageServiceConfig().registryUrl)
    setStatusKind('success')
    setStatusMessage('已恢复官方 npm')
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">NPM</h2>
          <p class="settings__section-subtitle">
            选择 Instant 包管理使用的 npm 兼容 registry。换国内镜像通常能加快首次解析与下载。
          </p>

          <div class="settings__list">
            <div class="settings__row settings__row--static">
              <span class="settings__row-name">当前生效</span>
              <span class="settings__row-size" style={{ wordBreak: 'break-all' }}>
                {activeRegistryUrl}
              </span>
            </div>
            <SettingsChoiceField
              label="源"
              value={preset}
              options={PRESET_OPTIONS}
              onChange={(value) => {
                setPreset(value as NpmRegistryPresetId)
                setStatusMessage(undefined)
              }}
              wideLayout={wideLayout}
            />
            {preset === 'custom' && (
              <SettingsInlineInputRow
                label="Registry URL"
                type="url"
                value={customRegistryUrl}
                onChange={(value) => {
                  setCustomRegistryUrl(value)
                  setStatusMessage(undefined)
                }}
                placeholder="https://registry.example.com"
              />
            )}
            {preset !== 'custom' && (
              <div class="settings__row settings__row--static">
                <span class="settings__row-name">地址</span>
                <span class="settings__row-size" style={{ wordBreak: 'break-all' }}>
                  {draftUrl}
                </span>
              </div>
            )}
          </div>

          <div class="settings__actions settings__actions--form">
            <button
              type="button"
              class="settings__btn settings__btn--default"
              disabled={busy}
              onClick={handleSave}
            >
              {busy && statusKind === 'saving' ? '保存中…' : '保存并应用'}
            </button>
            <button
              type="button"
              class="settings__btn settings__btn--plain"
              disabled={busy}
              onClick={() => void handleProbe()}
            >
              {busy && statusKind === 'probing' ? '测试中…' : '测试连通性'}
            </button>
            <button
              type="button"
              class="settings__btn settings__btn--plain"
              disabled={busy}
              onClick={handleReset}
            >
              恢复官方源
            </button>
          </div>

          {statusMessage && (
            <p
              class={
                statusKind === 'error'
                  ? 'settings__section-footnote settings__form-status--error'
                  : statusKind === 'success'
                    ? 'settings__section-footnote settings__form-status--ok'
                    : 'settings__section-footnote'
              }
              role="status"
            >
              {statusMessage}
            </p>
          )}

          <p class="settings__section-footnote">
            仅支持 npm 兼容协议（packument + tarball）。jsDelivr 等 CDN 不能作为安装源。当前解析到的有效 URL：
            {' '}
            {resolveNpmRegistryUrl({ version: 1, preset, customRegistryUrl }) ?? '（无效）'}
          </p>
        </section>
      </div>
    </div>
  )
}
