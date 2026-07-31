import { useEffect, useRef, useState } from 'preact/hooks'
import { probeProxyServer, selectProxyServerPreset } from '../../os/proxy-server-api.ts'
import {
  loadProxyServerSettings,
  normalizeProxyBaseUrl,
  PROXY_SERVER_PRESET_OPTIONS,
  PROXY_SERVER_SHARED_ORIGIN,
  resolveProxyBaseUrl,
  subscribeProxyServerSettings,
  type ProxyServerPresetId,
} from '../../os/proxy-server-settings-storage.ts'
import { PROXY_SERVER_URL_PLACEHOLDER } from '../../page-host/page-host-config.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { useSettingsWideLayout } from './settings-layout-breakpoints.ts'
import { SettingsChoicePickerView } from './settings-choice-picker-view.tsx'

type ProxyServerSettingsViewProps = {
  onBack: () => void
}

type ProbePhase = 'running' | 'success' | 'error'

/** 测试弹层最短展示「进行中」的时间，避免请求过快时闪一下 */
const PROBE_MIN_RUNNING_MS = 800

function serverDisplayValue(preset: ProxyServerPresetId, customUrl: string): string {
  if (preset === 'off') {
    return '关闭'
  }
  if (preset === 'shared') {
    return 'Instant 共享'
  }
  const normalized = normalizeProxyBaseUrl(customUrl)
  if (!normalized) {
    return '自定义'
  }
  try {
    return new URL(normalized).host
  } catch {
    return normalized
  }
}

function customUrlRowValue(customUrl: string): string {
  const normalized = normalizeProxyBaseUrl(customUrl)
  if (!normalized) {
    return '未设置'
  }
  return normalized
}

function waitAtLeast(startedAt: number, minMs: number): Promise<void> {
  const remaining = minMs - (Date.now() - startedAt)
  if (remaining <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, remaining)
  })
}

export function ProxyServerSettingsView({ onBack }: ProxyServerSettingsViewProps) {
  const { hostRef, wideLayout } = useSettingsWideLayout()
  const [picker, setPicker] = useState(false)
  const [urlEditorOpen, setUrlEditorOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  const [preset, setPreset] = useState<ProxyServerPresetId>(
    () => loadProxyServerSettings().preset,
  )
  const [customProxyBaseUrl, setCustomProxyBaseUrl] = useState(
    () => loadProxyServerSettings().customProxyBaseUrl,
  )
  const [activeOrigin, setActiveOrigin] = useState(() => resolveProxyBaseUrl())

  const [busy, setBusy] = useState(false)
  const [probeOpen, setProbeOpen] = useState(false)
  const [probePhase, setProbePhase] = useState<ProbePhase>('running')
  const [probeMessage, setProbeMessage] = useState('正在测试连通性…')
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')

  const editingCustomRef = useRef(false)
  const probeAbortRef = useRef<AbortController | undefined>(undefined)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const sync = () => {
      const settings = loadProxyServerSettings()
      setPreset(settings.preset)
      setActiveOrigin(resolveProxyBaseUrl(settings))
      if (!editingCustomRef.current) {
        setCustomProxyBaseUrl(settings.customProxyBaseUrl)
      }
    }
    sync()
    return subscribeProxyServerSettings(sync)
  }, [])

  useEffect(() => {
    return () => {
      probeAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!urlEditorOpen) return
    const timer = window.setTimeout(() => urlInputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [urlEditorOpen])

  const showAlert = (message: string) => {
    setAlertMessage(message)
    setAlertOpen(true)
  }

  const applyPreset = async (nextPreset: ProxyServerPresetId, customUrl = customProxyBaseUrl) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await selectProxyServerPreset(nextPreset, customUrl)
      editingCustomRef.current = false
      setPreset(result.settings.preset)
      setCustomProxyBaseUrl(result.settings.customProxyBaseUrl)
      setActiveOrigin(resolveProxyBaseUrl(result.settings))
      if (!result.ok && result.message !== '已取消') {
        showAlert(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const handlePresetChange = (value: string) => {
    void applyPreset(value as ProxyServerPresetId)
  }

  const commitCustomUrl = (raw: string) => {
    if (busy) return false
    const normalized = normalizeProxyBaseUrl(raw)
    const saved = loadProxyServerSettings()
    if (saved.preset === 'custom' && saved.customProxyBaseUrl === normalized && normalized) {
      editingCustomRef.current = false
      return true
    }
    if (!normalized) {
      showAlert('请填写有效的 http(s) Worker 根 URL')
      return false
    }
    void applyPreset('custom', normalized)
    return true
  }

  const openUrlEditor = () => {
    setUrlDraft(customProxyBaseUrl)
    setUrlEditorOpen(true)
  }

  const closeUrlEditor = () => {
    if (busy) return
    setUrlEditorOpen(false)
  }

  const saveUrlEditor = () => {
    if (!commitCustomUrl(urlDraft)) return
    setUrlEditorOpen(false)
  }

  const closeProbeModal = () => {
    probeAbortRef.current?.abort()
    probeAbortRef.current = undefined
    setProbeOpen(false)
  }

  const handleProbe = () => {
    if (busy || probeOpen) return
    const target =
      preset === 'custom' ? normalizeProxyBaseUrl(customProxyBaseUrl) : activeOrigin
    if (!target) {
      showAlert('请先选择服务器或填写自定义地址')
      return
    }

    const controller = new AbortController()
    probeAbortRef.current = controller
    const startedAt = Date.now()
    setProbePhase('running')
    setProbeMessage('正在测试连通性…')
    setProbeOpen(true)

    void (async () => {
      const result = await probeProxyServer(target, { signal: controller.signal })
      if (controller.signal.aborted) {
        return
      }
      await waitAtLeast(startedAt, PROBE_MIN_RUNNING_MS)
      if (controller.signal.aborted) {
        return
      }
      probeAbortRef.current = undefined
      if (result.ok) {
        setProbePhase('success')
        setProbeMessage(`连通正常（${result.durationMs} ms）\n${target}`)
      } else {
        setProbePhase('error')
        setProbeMessage(
          result.message === '已取消' ? '已取消' : `${result.message}\n${target}`,
        )
      }
    })()
  }

  if (picker) {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        <SettingsChoicePickerView
          title="服务器"
          backLabel="代理服务器"
          options={PROXY_SERVER_PRESET_OPTIONS}
          value={preset}
          onChange={handlePresetChange}
          onBack={() => setPicker(false)}
          closeOnSelect={false}
          footnote="Instant 共享为官方 virtual-chromo Worker；自定义需自行部署支持 /viewer 与宿主 CORS relay 的 Worker。点选后不会自动返回，请用左上角返回。"
        />
      </div>
    )
  }

  return (
    <div class="settings" ref={hostRef}>
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">代理服务器</h2>
          <p class="settings__section-subtitle">
            Chromo / WebView 与 AI、GitHub 等共用同一 virtual-chromo Worker。选择服务器后立即生效。
          </p>

          <div class="settings__list">
            <SettingsChoiceField
              label="服务器"
              value={preset}
              displayValue={serverDisplayValue(preset, customProxyBaseUrl)}
              options={PROXY_SERVER_PRESET_OPTIONS}
              onChange={handlePresetChange}
              wideLayout={wideLayout}
              onNavigate={() => setPicker(true)}
              disabled={busy}
            />
            {preset === 'custom' &&
              (wideLayout ? (
                <SettingsInlineInputRow
                  label="Worker URL"
                  type="url"
                  value={customProxyBaseUrl}
                  disabled={busy}
                  onChange={(value) => {
                    editingCustomRef.current = true
                    setCustomProxyBaseUrl(value)
                  }}
                  onBlur={() => commitCustomUrl(customProxyBaseUrl)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitCustomUrl(customProxyBaseUrl)
                    }
                  }}
                  placeholder={PROXY_SERVER_URL_PLACEHOLDER}
                />
              ) : (
                <SettingsNavRow
                  label="Worker URL"
                  value={customUrlRowValue(customProxyBaseUrl)}
                  disabled={busy}
                  onClick={openUrlEditor}
                />
              ))}
            {preset === 'shared' && (
              <div class="settings__row settings__row--static">
                <span class="settings__row-name">地址</span>
                <span class="settings__row-size" style={{ wordBreak: 'break-all' }}>
                  {PROXY_SERVER_SHARED_ORIGIN}
                </span>
              </div>
            )}
          </div>

          {preset !== 'off' && (
            <div class="settings__actions settings__actions--form settings__actions--stack">
              <button
                type="button"
                class="settings__btn settings__btn--default settings__btn--block"
                disabled={
                  busy ||
                  !(preset === 'custom'
                    ? normalizeProxyBaseUrl(customProxyBaseUrl)
                    : activeOrigin)
                }
                onClick={handleProbe}
              >
                测试连通性
              </button>
            </div>
          )}

          <p class="settings__section-footnote">
            关闭后浏览与宿主出网均不可用。本地调试请选自定义并填写 wrangler 地址（如
            http://localhost:8787）。
          </p>
        </section>
      </div>

      <WindowModal
        open={urlEditorOpen}
        title="Worker URL"
        onClose={closeUrlEditor}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            disabled: busy,
            onClick: closeUrlEditor,
          },
          {
            key: 'save',
            label: '保存',
            tone: 'primary',
            disabled: busy || !normalizeProxyBaseUrl(urlDraft),
            onClick: saveUrlEditor,
          },
        ]}
      >
        <p class="window-modal__message">填写 virtual-chromo Worker 根地址后保存。</p>
        <div class="window-modal__field">
          <label for="proxy-worker-url-input">Worker URL</label>
          <input
            ref={urlInputRef}
            id="proxy-worker-url-input"
            type="url"
            value={urlDraft}
            placeholder={PROXY_SERVER_URL_PLACEHOLDER}
            autoComplete="off"
            spellcheck={false}
            disabled={busy}
            onInput={(event) =>
              setUrlDraft((event.currentTarget as HTMLInputElement).value)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && normalizeProxyBaseUrl(urlDraft)) {
                event.preventDefault()
                saveUrlEditor()
              }
            }}
          />
        </div>
      </WindowModal>

      <WindowModal
        open={probeOpen}
        title="测试连通性"
        panelClass="proxy-probe-modal"
        onClose={probePhase === 'running' ? undefined : closeProbeModal}
        actions={[
          {
            key: 'dismiss',
            label: probePhase === 'running' ? '取消' : '完成',
            tone: 'secondary',
            onClick: closeProbeModal,
          },
        ]}
      >
        <div class="proxy-probe-modal__body">
          <div class="proxy-probe-modal__status" aria-hidden="true">
            {probePhase === 'running' ? (
              <span class="settings__loading-spinner" />
            ) : (
              <span
                class={`proxy-probe-modal__glyph proxy-probe-modal__glyph--${probePhase}`}
              >
                {probePhase === 'success' ? '✓' : '!'}
              </span>
            )}
          </div>
          <p
            class={`proxy-probe-modal__message${
              probePhase === 'error' ? ' proxy-probe-modal__message--error' : ''
            }${probePhase === 'success' ? ' proxy-probe-modal__message--ok' : ''}`}
            role="status"
          >
            {probeMessage}
          </p>
        </div>
      </WindowModal>

      <WindowModal
        open={alertOpen}
        title="提示"
        onClose={() => setAlertOpen(false)}
        actions={[
          {
            key: 'ok',
            label: '好',
            tone: 'primary',
            onClick: () => setAlertOpen(false),
          },
        ]}
      >
        <p class="window-modal__message">{alertMessage}</p>
      </WindowModal>
    </div>
  )
}
