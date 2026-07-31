import { useEffect, useRef, useState } from 'preact/hooks'
import {
  connectProxyServer,
  disconnectProxyServer,
  probeProxyServer,
} from '../../os/proxy-server-api.ts'
import {
  loadProxyServerSettings,
  normalizeProxyBaseUrl,
  saveProxyServerSettings,
  subscribeProxyServerSettings,
} from '../../os/proxy-server-settings-storage.ts'
import { PROXY_SERVER_URL_PLACEHOLDER } from '../../page-host/page-host-config.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'

type ProxyServerSettingsViewProps = {
  onBack: () => void
}

type StatusKind = 'idle' | 'connecting' | 'probing' | 'success' | 'error'

function connectionStatusLabel(
  connected: boolean,
  hasUrl: boolean,
  urlDirty: boolean,
): string {
  if (connected && urlDirty) {
    return '已连接（地址已改，未生效）'
  }
  if (connected) {
    return '已连接'
  }
  if (hasUrl) {
    return '已配置，未连接'
  }
  return '未配置'
}

export function ProxyServerSettingsView({ onBack }: ProxyServerSettingsViewProps) {
  const [proxyBaseUrl, setProxyBaseUrl] = useState(
    () => loadProxyServerSettings().proxyBaseUrl,
  )
  const [savedProxyBaseUrl, setSavedProxyBaseUrl] = useState(
    () => loadProxyServerSettings().proxyBaseUrl,
  )
  const [connected, setConnected] = useState(() => loadProxyServerSettings().connected)
  const [statusKind, setStatusKind] = useState<StatusKind>('idle')
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /** 用户正在编辑输入框时，忽略来自 storage 的回写，避免改地址被旧值盖掉 */
  const editingRef = useRef(false)

  useEffect(() => {
    const sync = () => {
      const settings = loadProxyServerSettings()
      setSavedProxyBaseUrl(settings.proxyBaseUrl)
      setConnected(settings.connected)
      if (!editingRef.current) {
        setProxyBaseUrl(settings.proxyBaseUrl)
      }
    }
    sync()
    return subscribeProxyServerSettings(sync)
  }, [])

  const normalizedInput = normalizeProxyBaseUrl(proxyBaseUrl)
  const hasUrl = proxyBaseUrl.trim().length > 0
  const urlDirty = normalizedInput !== savedProxyBaseUrl
  const showReconnect = connected && urlDirty
  const showConnect = !connected || urlDirty

  const handleConnect = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setStatusKind('connecting')
    setStatusMessage('正在探测 WebView 后端 Worker…')
    try {
      const result = await connectProxyServer(proxyBaseUrl)
      editingRef.current = false
      if (result.ok) {
        setConnected(true)
        setProxyBaseUrl(result.settings.proxyBaseUrl)
        setSavedProxyBaseUrl(result.settings.proxyBaseUrl)
        setStatusKind('success')
        setStatusMessage(`已连接（探测 ${result.durationMs} ms）`)
      } else {
        setConnected(false)
        setProxyBaseUrl(result.settings.proxyBaseUrl)
        setSavedProxyBaseUrl(result.settings.proxyBaseUrl)
        setStatusKind('error')
        setStatusMessage(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = () => {
    if (busy) {
      return
    }
    // 若已改地址但未点连接：断开时一并写入新地址，供浏览立刻切到新 Worker
    const nextUrl = urlDirty ? normalizedInput : savedProxyBaseUrl
    const ok = urlDirty
      ? nextUrl
        ? saveProxyServerSettings({ version: 1, proxyBaseUrl: nextUrl, connected: false })
        : saveProxyServerSettings({ version: 1, proxyBaseUrl: '', connected: false })
      : disconnectProxyServer()
    if (!ok) {
      setStatusKind('error')
      setStatusMessage('无法保存断开状态（存储空间可能已满）')
      return
    }
    editingRef.current = false
    setConnected(false)
    setProxyBaseUrl(nextUrl)
    setSavedProxyBaseUrl(nextUrl)
    setStatusKind('idle')
    setStatusMessage('已断开连接（已保存的地址仍可用于 Chromo / WebView 浏览）')
  }

  const handleProbe = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setStatusKind('probing')
    setStatusMessage('正在测试连通性…')
    try {
      const result = await probeProxyServer(proxyBaseUrl)
      if (result.ok) {
        setStatusKind('success')
        setStatusMessage(`连通正常（${result.durationMs} ms）`)
      } else {
        setStatusKind('error')
        setStatusMessage(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">代理服务器</h2>
          <p class="settings__section-subtitle">
            配置 Chromo / WebView 所用的 Cloudflare Worker（virtual-chromo）。未配置时浏览与宿主
            代理出网均不可用。连接成功后，AI、GitHub 等亦可经同一地址绕过 CORS；菜单栏将显示代理服务器图标。
          </p>

          <div class="settings__box">
            <div class="settings__row settings__row--static">
              <span class="settings__row-name">状态</span>
              <span class="settings__row-size">
                {connectionStatusLabel(connected, hasUrl, urlDirty)}
              </span>
            </div>
            <SettingsInlineInputRow
              label="服务器地址"
              type="url"
              value={proxyBaseUrl}
              onChange={(value) => {
                editingRef.current = true
                setProxyBaseUrl(value)
              }}
              placeholder={PROXY_SERVER_URL_PLACEHOLDER}
            />
          </div>

          <div class="settings__actions settings__actions--form">
            {showConnect && (
              <button
                type="button"
                class="settings__btn settings__btn--default"
                disabled={busy || !hasUrl || !normalizedInput}
                onClick={() => void handleConnect()}
              >
                {busy && statusKind === 'connecting'
                  ? '连接中…'
                  : showReconnect
                    ? '重新连接'
                    : '连接'}
              </button>
            )}
            {connected && (
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={busy}
                onClick={handleDisconnect}
              >
                断开
              </button>
            )}
            <button
              type="button"
              class="settings__btn settings__btn--plain"
              disabled={busy || !hasUrl}
              onClick={() => void handleProbe()}
            >
              {busy && statusKind === 'probing' ? '测试中…' : '测试连通性'}
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
            宿主出网路径：{'{Worker 根地址}'}/-----{'{目标绝对 URL}'}（需部署支持宿主 CORS
            relay 的 virtual-chromo）。无内置默认地址；本地调试请自行填写 wrangler 地址（如
            http://localhost:8787）。改地址后需点「连接」或「重新连接」才会切换 Chromo /
            WebView 与宿主出网所用的 Worker。
          </p>
        </section>
      </div>
    </div>
  )
}
