import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { InstantLogoIcon } from '../icons/app-icons.tsx'
import type { ExternalBridgeSession } from './install-external-bridge-handler.ts'
import { createExternalBridgeHost, type ExternalBridgeHost } from './external-bridge-host.ts'
import './external-bridge-app.css'

const bridgeHost = createExternalBridgeHost(
  typeof window !== 'undefined' ? window.location.search : '',
)

function resolveHostSettingsUrl(): string {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.href
}

const EXTERNAL_BRIDGE_SECURITY_BANNER =
  'Instant OS 不会在任何非 casing-ai.com 域名的网站上要求您输入 AI API Key 或密码'

function ExternalBridgeSecurityBanner() {
  return (
    <div class="external-bridge__security-banner" role="note">
      <p class="external-bridge__security-banner-copy">{EXTERNAL_BRIDGE_SECURITY_BANNER}</p>
    </div>
  )
}

function ExternalBridgeShell({
  error,
  children,
}: {
  error?: boolean
  children: ComponentChildren
}) {
  return (
    <div class={`external-bridge${error ? ' external-bridge--error' : ''}`}>
      <ExternalBridgeSecurityBanner />
      {children}
    </div>
  )
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

export function ExternalBridgeApp({ host = bridgeHost }: { host?: ExternalBridgeHost }) {
  const launchParams = host.launchParams
  const embedError = host.embedError
  const [session, setSession] = useState<ExternalBridgeSession | undefined>(() => host.getSession())
  const controlsRef = useRef(host.controls)

  useEffect(() => {
    controlsRef.current = host.controls
    return host.subscribe(setSession)
  }, [host])

  if (!launchParams) {
    return (
      <ExternalBridgeShell error>
        <WaitingCard
          title="无法启动桥接"
          message="URL 缺少有效的 appId 参数。第三方应用应通过 /bridge?appId=ext:… 加载此页面。"
        />
      </ExternalBridgeShell>
    )
  }

  if (embedError) {
    return (
      <ExternalBridgeShell error>
        <WaitingCard title="无法启动桥接" message={embedError} />
      </ExternalBridgeShell>
    )
  }

  const appLabel = session?.appName || launchParams.appName || launchParams.appId

  if (!session) {
    return (
      <ExternalBridgeShell>
        <WaitingCard
          title="正在连接"
          message="等待第三方应用完成握手。请保持此窗口打开。"
        />
      </ExternalBridgeShell>
    )
  }

  if (session.phase === 'needs-storage-access') {
    return (
      <ExternalBridgeShell>
        <div class="external-bridge__card">
          <div class="external-bridge__brand">
            <InstantLogoIcon size={28} />
            <span class="external-bridge__brand-label">Instant OS</span>
          </div>
          <h1 class="external-bridge__title">同步主站 AI 账户</h1>
          <p class="external-bridge__message">
            点击下方按钮，使用您在 Instant OS 主站已配置的 AI 账户。
          </p>
          {session.hint ? (
            <p class="external-bridge__meta external-bridge__meta--hint">{session.hint}</p>
          ) : undefined}
          <div class="external-bridge__actions">
            <button
              type="button"
              class="external-bridge__button external-bridge__button--primary"
              onClick={() => void controlsRef.current?.connectStorageAccess()}
            >
              同步主站设置
            </button>
          </div>
        </div>
      </ExternalBridgeShell>
    )
  }

  if (session.phase === 'no-api-key') {
    return (
      <ExternalBridgeShell>
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
      </ExternalBridgeShell>
    )
  }

  if (session.phase === 'awaiting-consent') {
    return (
      <ExternalBridgeShell>
        <div class="external-bridge__card">
          <div class="external-bridge__brand">
            <InstantLogoIcon size={28} />
            <span class="external-bridge__brand-label">Instant OS</span>
          </div>
          <h1 class="external-bridge__title">允许 AI 代理？</h1>
          <p class="external-bridge__message">
            「{appLabel}」请求通过 Instant OS 借用 AI 代理服务。您的 API Key 不会暴露给该应用。
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
      </ExternalBridgeShell>
    )
  }

  if (session.phase === 'denied') {
    return (
      <ExternalBridgeShell>
        <WaitingCard
          title="已拒绝连接"
          message="您已拒绝该应用使用 Instant OS 的 AI 代理。如需重新授权，请从第三方应用再次发起连接。"
        />
      </ExternalBridgeShell>
    )
  }

  if (session.phase === 'error') {
    return (
      <ExternalBridgeShell error>
        <WaitingCard title="连接失败" message="桥接握手失败，请关闭后重试。" />
      </ExternalBridgeShell>
    )
  }

  return (
    <ExternalBridgeShell>
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
    </ExternalBridgeShell>
  )
}
