import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { InstantLogoIcon } from '../icons/app-icons.tsx'
import {
  installExternalBridgeHandler,
  validateBridgeEmbedContext,
  type ExternalBridgeSession,
} from './install-external-bridge-handler.ts'
import { parseBridgeLaunchParams } from './parse-bridge-launch-params.ts'
import './external-bridge-app.css'

function resolveHostSettingsUrl(): string {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.href
}

function WaitingCard({ title, message }: { title: string; message: string }) {
  return (
    <div class="external-bridge__card">
      <div class="external-bridge__brand">
        <InstantLogoIcon size={28} />
        <span class="external-bridge__brand-label">Instant OS</span>
      </div>
      <h1 class="external-bridge__title">{title}</h1>
      <p class="external-bridge__message">{message}</p>
    </div>
  )
}

export function ExternalBridgeApp() {
  const launchParams = useMemo(
    () => parseBridgeLaunchParams(window.location.search),
    [],
  )
  const embedError = launchParams ? validateBridgeEmbedContext(launchParams.appId) : undefined
  const [session, setSession] = useState<ExternalBridgeSession | undefined>(undefined)
  const controlsRef = useRef<ReturnType<typeof installExternalBridgeHandler>['controls'] | undefined>(
    undefined,
  )

  useEffect(() => {
    if (!launchParams || embedError) {
      return
    }

    const bridge = installExternalBridgeHandler({
      launchAppId: launchParams.appId,
      launchAppName: launchParams.appName,
      onSessionChange: setSession,
    })

    controlsRef.current = bridge.controls
    return () => {
      controlsRef.current = undefined
      bridge.dispose()
    }
  }, [embedError, launchParams])

  if (!launchParams) {
    return (
      <div class="external-bridge external-bridge--error">
        <WaitingCard
          title="无法启动桥接"
          message="URL 缺少有效的 appId 参数。第三方应用应通过 /bridge?appId=ext:… 加载此页面。"
        />
      </div>
    )
  }

  if (embedError) {
    return (
      <div class="external-bridge external-bridge--error">
        <WaitingCard title="无法启动桥接" message={embedError} />
      </div>
    )
  }

  const appLabel = session?.appName || launchParams.appName || launchParams.appId

  if (!session) {
    return (
      <div class="external-bridge">
        <WaitingCard
          title="正在连接"
          message="等待第三方应用完成握手。请保持此窗口打开。"
        />
      </div>
    )
  }

  if (session.phase === 'needs-storage-access') {
    return (
      <div class="external-bridge">
        <div class="external-bridge__card">
          <div class="external-bridge__brand">
            <InstantLogoIcon size={28} />
            <span class="external-bridge__brand-label">Instant OS</span>
          </div>
          <h1 class="external-bridge__title">连接主站账户</h1>
          <p class="external-bridge__message">
            您已在 Instant OS 主站配置过 AI 账户，但浏览器隔离了跨站 iframe 的存储。请点击下方按钮，允许此桥接页读取您在主站保存的设置。
          </p>
          <div class="external-bridge__actions">
            <button
              type="button"
              class="external-bridge__button external-bridge__button--primary"
              onClick={() => void controlsRef.current?.connectStorageAccess()}
            >
              连接主站账户
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (session.phase === 'no-api-key') {
    return (
      <div class="external-bridge">
        <div class="external-bridge__card">
          <div class="external-bridge__brand">
            <InstantLogoIcon size={28} />
            <span class="external-bridge__brand-label">Instant OS</span>
          </div>
          <h1 class="external-bridge__title">尚未配置 AI 账户</h1>
          <p class="external-bridge__message">
            请先在 Instant OS 主站配置 API Key，然后刷新此页面或重新发起连接。
          </p>
          <p class="external-bridge__meta">
            打开{' '}
            <a class="external-bridge__hint-link" href={resolveHostSettingsUrl()} target="_blank" rel="noreferrer">
              Instant OS 主站
            </a>
            ，进入「系统设置 → 账户」完成配置。
          </p>
        </div>
      </div>
    )
  }

  if (session.phase === 'awaiting-consent') {
    return (
      <div class="external-bridge">
        <div class="external-bridge__card">
          <div class="external-bridge__brand">
            <InstantLogoIcon size={28} />
            <span class="external-bridge__brand-label">Instant OS</span>
          </div>
          <h1 class="external-bridge__title">允许 AI 代理？</h1>
          <p class="external-bridge__message">
            「{appLabel}」请求通过 Instant OS 代发 AI 请求。您的 API Key 不会暴露给该应用。
          </p>
          <p class="external-bridge__meta">来源：{session.parentOrigin}</p>
          <div class="external-bridge__actions">
            <button
              type="button"
              class="external-bridge__button external-bridge__button--secondary"
              onClick={() => controlsRef.current?.denyConsent()}
            >
              拒绝
            </button>
            <button
              type="button"
              class="external-bridge__button external-bridge__button--primary"
              onClick={() => controlsRef.current?.approveConsent()}
            >
              允许
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (session.phase === 'denied') {
    return (
      <div class="external-bridge">
        <WaitingCard
          title="已拒绝连接"
          message="您已拒绝该应用使用 Instant OS 的 AI 代理。如需重新授权，请从第三方应用再次发起连接。"
        />
      </div>
    )
  }

  if (session.phase === 'error') {
    return (
      <div class="external-bridge external-bridge--error">
        <WaitingCard title="连接失败" message="桥接握手失败，请关闭后重试。" />
      </div>
    )
  }

  return (
    <div class="external-bridge">
      <div class="external-bridge__card">
        <div class="external-bridge__brand">
          <InstantLogoIcon size={28} />
          <span class="external-bridge__brand-label">Instant OS</span>
        </div>
        <h1 class="external-bridge__title">
          <span class="external-bridge__status-dot" aria-hidden="true" />
          已连接
        </h1>
        <p class="external-bridge__message">
          「{appLabel}」正在通过 Instant OS 安全代理 AI 请求。此窗口可最小化，请勿关闭。
        </p>
      </div>
    </div>
  )
}
