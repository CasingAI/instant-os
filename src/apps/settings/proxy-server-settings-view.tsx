import { useEffect, useState } from 'preact/hooks'
import {
  connectProxyServer,
  disconnectProxyServer,
  probeProxyServer,
} from '../../os/proxy-server-api.ts'
import {
  loadProxyServerSettings,
  subscribeProxyServerSettings,
} from '../../os/proxy-server-settings-storage.ts'
import { PROXY_SERVER_URL_PLACEHOLDER } from '../../page-host/page-host-config.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsInlineInputRow } from '../../ui/settings-inline-input-row.tsx'

type ProxyServerSettingsViewProps = {
  onBack: () => void
}

type StatusKind = 'idle' | 'connecting' | 'probing' | 'success' | 'error'

function connectionStatusLabel(connected: boolean, hasUrl: boolean): string {
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
  const [connected, setConnected] = useState(() => loadProxyServerSettings().connected)
  const [statusKind, setStatusKind] = useState<StatusKind>('idle')
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      const settings = loadProxyServerSettings()
      setProxyBaseUrl(settings.proxyBaseUrl)
      setConnected(settings.connected)
    }
    sync()
    return subscribeProxyServerSettings(sync)
  }, [])

  const hasUrl = proxyBaseUrl.trim().length > 0

  const handleConnect = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    setStatusKind('connecting')
    setStatusMessage('正在探测 WebView 后端 Worker…')
    try {
      const result = await connectProxyServer(proxyBaseUrl)
      if (result.ok) {
        setConnected(true)
        setProxyBaseUrl(result.settings.proxyBaseUrl)
        setStatusKind('success')
        setStatusMessage(`已连接（探测 ${result.durationMs} ms）`)
      } else {
        setConnected(false)
        setProxyBaseUrl(result.settings.proxyBaseUrl)
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
    if (!disconnectProxyServer()) {
      setStatusKind('error')
      setStatusMessage('无法保存断开状态（存储空间可能已满）')
      return
    }
    setConnected(false)
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
                {connectionStatusLabel(connected, hasUrl)}
              </span>
            </div>
            <SettingsInlineInputRow
              label="服务器地址"
              type="url"
              value={proxyBaseUrl}
              onChange={setProxyBaseUrl}
              placeholder={PROXY_SERVER_URL_PLACEHOLDER}
            />
          </div>

          <div class="settings__actions settings__actions--form">
            {connected ? (
              <button
                type="button"
                class="settings__btn settings__btn--danger"
                disabled={busy}
                onClick={handleDisconnect}
              >
                断开
              </button>
            ) : (
              <button
                type="button"
                class="settings__btn settings__btn--default"
                disabled={busy || !hasUrl}
                onClick={() => void handleConnect()}
              >
                {busy && statusKind === 'connecting' ? '连接中…' : '连接'}
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
            http://localhost:8787）。
          </p>
        </section>
      </div>
    </div>
  )
}
