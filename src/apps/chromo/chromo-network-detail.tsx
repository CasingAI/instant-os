import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type {
  ChromoNetworkBodyReadResult,
  ChromoNetworkEntry,
  ChromoNetworkTiming,
} from './chromo-bridge.ts'
import { diagnoseHotCache } from './chromo-network-cache-help.ts'

export type NetworkDetailTab = 'headers' | 'preview' | 'response' | 'initiator' | 'timing'

function formatNetworkBytes(size: number): string {
  if (!size) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const BINARY_DESTINATIONS = new Set(['image', 'video', 'audio', 'font'])

/**
 * Treat as binary for DevTools Preview/Response — never render media, skip body RPC when possible.
 */
export function isBinaryNetworkBody(
  entry: ChromoNetworkEntry,
  contentType?: string,
): boolean {
  const type = (entry.type || '').toLowerCase()
  if (BINARY_DESTINATIONS.has(type)) {
    return true
  }
  const mime = (contentType || '').split(';')[0].trim().toLowerCase()
  if (!mime) {
    return false
  }
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('font/') ||
    mime === 'application/octet-stream' ||
    mime === 'application/wasm' ||
    mime === 'application/pdf' ||
    mime === 'application/zip' ||
    mime === 'application/gzip'
  )
}

function binaryBodyPlaceholder(entry: ChromoNetworkEntry, mime?: string): string {
  const label = mime || entry.type || 'binary'
  return `二进制内容（${label}，${formatNetworkBytes(entry.size)}）— 不渲染预览，完整内容保留在 Cache`
}

const DETAIL_TABS: { id: NetworkDetailTab; label: string }[] = [
  { id: 'headers', label: 'Headers' },
  { id: 'preview', label: 'Preview' },
  { id: 'response', label: 'Response' },
  { id: 'initiator', label: 'Initiator' },
  { id: 'timing', label: 'Timing' },
]

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

function statusClass(status: number, failed: boolean, pending?: boolean): string {
  if (pending) {
    return 'chromo-network__status-dot--pending'
  }
  if (failed || status >= 400) {
    return 'chromo-network__status-dot--error'
  }
  if (status >= 300) {
    return 'chromo-network__status-dot--redirect'
  }
  return 'chromo-network__status-dot--ok'
}

function formatStatusLabel(entry: ChromoNetworkEntry): string {
  if (entry.pending) {
    return 'pending'
  }
  if (entry.failed && !entry.status) {
    return entry.errorCode ? `(failed) ${entry.errorCode}` : '(failed)'
  }
  const code = entry.status || 0
  const text = STATUS_TEXT[code]
  return text ? `${code} ${text}` : String(code || '-')
}

function formatServedFrom(entry: ChromoNetworkEntry): string {
  if (entry.pending) {
    return 'Pending…'
  }
  const source = entry.source || (entry.fromCache ? 'cache' : entry.bypass ? 'bypass' : '')
  switch (source) {
    case 'cache':
      return 'DevTools memory cache'
    case 'bypass':
      return 'Passthrough (vendor direct)'
    case 'direct':
      return 'Direct fetch (CORS host)'
    case 'cdn':
      return 'Static CDN (jsDelivr)'
    case 'native':
      return 'Native / non-HTTP'
    case 'proxy':
      return entry.sourceHost
        ? `Proxy gateway (${entry.sourceHost})`
        : 'Proxy gateway'
    default:
      if (entry.fromCache) {
        return 'DevTools memory cache'
      }
      if (entry.bypass) {
        return 'Passthrough (vendor direct)'
      }
      return entry.source || 'Proxy gateway'
  }
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string {
  if (!headers) {
    return ''
  }
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value
    }
  }
  return ''
}

function formatHeadersRaw(headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) {
    return '(empty)'
  }
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

export type ServerTimingEntry = {
  name: string
  duration?: number
  description?: string
}

export function parseServerTiming(header: string): ServerTimingEntry[] {
  if (!header.trim()) {
    return []
  }
  const entries: ServerTimingEntry[] = []
  for (const part of header.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) {
      continue
    }
    const tokens = trimmed.split(';').map((t) => t.trim())
    const name = tokens[0]
    if (!name) {
      continue
    }
    let duration: number | undefined
    let description: string | undefined
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]
      const eq = token.indexOf('=')
      if (eq < 0) {
        continue
      }
      const key = token.slice(0, eq).trim().toLowerCase()
      let val = token.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (key === 'dur') {
        const n = Number(val)
        if (!Number.isNaN(n)) {
          duration = n
        }
      } else if (key === 'desc') {
        description = val
      }
    }
    entries.push({ name, duration, description })
  }
  return entries
}

function formatTimingMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) {
    return '-'
  }
  if (ms < 0.1 && ms > 0) {
    return `${(ms * 1000).toFixed(0)} µs`
  }
  if (ms < 10) {
    return `${ms.toFixed(2)} ms`
  }
  return `${Math.round(ms)} ms`
}

function relativeFromOrigin(absoluteMs: number | undefined, originMs: number): string {
  if (absoluteMs === undefined) {
    return '-'
  }
  return formatTimingMs(Math.max(0, absoluteMs - originMs))
}

function DetailRow({
  label,
  value,
  muted,
  children,
}: {
  label: string
  value?: string
  muted?: boolean
  children?: ComponentChildren
}) {
  return (
    <div class="chromo-network__detail-row">
      <div class="chromo-network__detail-label">{label}</div>
      <div
        class={[
          'chromo-network__detail-value',
          muted ? 'chromo-network__detail-value--muted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children ?? value}
      </div>
    </div>
  )
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string
  defaultOpen?: boolean
  actions?: ComponentChildren
  children: ComponentChildren
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section class="chromo-network__section">
      <header class="chromo-network__section-head">
        <button
          type="button"
          class="chromo-network__section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span class="chromo-network__section-arrow" aria-hidden="true">
            {open ? '▼' : '▶'}
          </span>
          <span class="chromo-network__section-title">{title}</span>
        </button>
        {actions ? <div class="chromo-network__section-actions">{actions}</div> : null}
      </header>
      {open ? <div class="chromo-network__section-body">{children}</div> : null}
    </section>
  )
}

function ServedFromCell({
  entry,
  disableNetworkCache,
  entries,
  probeNetworkHot,
}: {
  entry: ChromoNetworkEntry
  disableNetworkCache?: boolean
  entries?: ChromoNetworkEntry[]
  probeNetworkHot?: (method: string, url: string) => Promise<{ exists: boolean }>
}) {
  const [open, setOpen] = useState(false)
  const [swHasEntry, setSwHasEntry] = useState<boolean | null | undefined>(undefined)

  useEffect(() => {
    if (!open || !probeNetworkHot || !entry.url) {
      return
    }
    let cancelled = false
    setSwHasEntry(undefined)
    probeNetworkHot(entry.method || 'GET', entry.url)
      .then((result) => {
        if (!cancelled) {
          setSwHasEntry(Boolean(result?.exists))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSwHasEntry(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, probeNetworkHot, entry.method, entry.url])

  const help = useMemo(
    () =>
      diagnoseHotCache(entry, {
        disableNetworkCache,
        entries,
        ...(probeNetworkHot ? { swHasEntry } : {}),
      }),
    [entry, disableNetworkCache, entries, probeNetworkHot, swHasEntry],
  )

  const statusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return '✓'
      case 'fail':
        return '✗'
      case 'pending':
        return '…'
      default:
        return '—'
    }
  }

  return (
    <div class="chromo-network__served-from">
      <span class="chromo-network__served-from-value">{formatServedFrom(entry)}</span>
      {!help.hit ? (
        <span class="chromo-network__served-from-help">
          <button
            type="button"
            class="chromo-network__help-btn"
            aria-label="热缓存条件"
            aria-expanded={open}
            title="热缓存条件"
            onClick={() => setOpen((v) => !v)}
          >
            ?
          </button>
          {open ? (
            <div class="chromo-network__help-popover" role="dialog" aria-label="热缓存条件">
              <div class="chromo-network__help-popover-title">热缓存条件</div>
              <div class="chromo-network__help-table" role="table">
                {help.conditions.map((cond) => (
                  <div
                    key={cond.id}
                    class={[
                      'chromo-network__help-row',
                      help.blockingIds.includes(cond.id) ? 'chromo-network__help-row--fail' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="row"
                  >
                    <span
                      class={[
                        'chromo-network__help-status',
                        `chromo-network__help-status--${cond.status}`,
                      ].join(' ')}
                      aria-label={cond.status}
                    >
                      {statusIcon(cond.status)}
                    </span>
                    <span class="chromo-network__help-label">{cond.label}</span>
                    <span class="chromo-network__help-value">{cond.value ?? ''}</span>
                  </div>
                ))}
              </div>
              <p class="chromo-network__help-footnote">
                Cache-Control 不影响此项（仅 DevTools 热缓存）
              </p>
              <button
                type="button"
                class="chromo-network__help-close"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

function HeadersTable({ headers }: { headers: Record<string, string> | undefined }) {
  if (!headers || Object.keys(headers).length === 0) {
    return <div class="chromo-network__drawer-empty">无</div>
  }
  return (
    <div class="chromo-network__detail-grid">
      {Object.entries(headers).map(([key, value]) => (
        <DetailRow key={key} label={key} value={value} />
      ))}
    </div>
  )
}

function HeadersTab({
  entry,
  bodyResult,
  bodyLoading,
  bodyError,
  disableNetworkCache,
  entries,
  probeNetworkHot,
}: {
  entry: ChromoNetworkEntry
  bodyResult: ChromoNetworkBodyReadResult | null
  bodyLoading: boolean
  bodyError: string
  disableNetworkCache?: boolean
  entries?: ChromoNetworkEntry[]
  probeNetworkHot?: (method: string, url: string) => Promise<{ exists: boolean }>
}) {
  const [responseRaw, setResponseRaw] = useState(false)
  const [requestRaw, setRequestRaw] = useState(false)
  const responseHeaders = bodyResult?.headers

  return (
    <div class="chromo-network__headers">
      <CollapsibleSection title="General">
        <div class="chromo-network__detail-grid">
          <DetailRow label="Request URL" value={entry.url} />
          <DetailRow label="Request Method" value={entry.method || 'GET'} />
          <DetailRow label="Status Code">
            <span class="chromo-network__status-line">
              <span
                class={[
                  'chromo-network__status-dot',
                  statusClass(entry.status, entry.failed, entry.pending),
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              />
              {formatStatusLabel(entry)}
            </span>
          </DetailRow>
          {entry.failed && entry.errorText ? (
            <DetailRow label="Failure reason" value={entry.errorText} />
          ) : null}
          <DetailRow label="Served from">
            <ServedFromCell
              entry={entry}
              disableNetworkCache={disableNetworkCache}
              entries={entries}
              probeNetworkHot={probeNetworkHot}
            />
          </DetailRow>
          <DetailRow
            label="Referrer Policy"
            value={entry.referrerPolicy || '(empty)'}
            muted={!entry.referrerPolicy}
          />
          <DetailRow
            label="Referrer"
            value={entry.referrer || '(empty)'}
            muted={!entry.referrer}
          />
          <DetailRow label="Type" value={entry.type || 'other'} />
          <DetailRow label="Size" value={entry.pending ? '-' : formatNetworkBytes(entry.size)} />
          <DetailRow label="Time" value={entry.pending ? 'pending' : `${entry.duration} ms`} />
          <DetailRow label="Entry ID" value={entry.id} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Response Headers"
        actions={
          <label class="chromo-network__raw-toggle">
            <input
              type="checkbox"
              checked={responseRaw}
              onChange={(event) =>
                setResponseRaw((event.currentTarget as HTMLInputElement).checked)
              }
            />
            Raw
          </label>
        }
      >
        {bodyLoading ? (
          <div class="chromo-network__drawer-empty">加载中…</div>
        ) : bodyResult ? (
          responseRaw ? (
            <pre class="chromo-network__drawer-pre">{formatHeadersRaw(responseHeaders)}</pre>
          ) : (
            <HeadersTable headers={responseHeaders} />
          )
        ) : (
          <div class="chromo-network__drawer-empty">
            {bodyError || (entry.hasBody ? '无响应头' : '未缓存响应（无 body 快照）')}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Request Headers"
        actions={
          <label class="chromo-network__raw-toggle">
            <input
              type="checkbox"
              checked={requestRaw}
              onChange={(event) =>
                setRequestRaw((event.currentTarget as HTMLInputElement).checked)
              }
            />
            Raw
          </label>
        }
      >
        {entry.requestHeadersTruncated ? (
          <div class="chromo-network__drawer-note">请求头已截断（超过 32KB 软上限）</div>
        ) : null}
        {requestRaw ? (
          <pre class="chromo-network__drawer-pre">{formatHeadersRaw(entry.requestHeaders)}</pre>
        ) : (
          <HeadersTable headers={entry.requestHeaders} />
        )}
      </CollapsibleSection>
    </div>
  )
}

function PreviewTab({
  entry,
  bodyResult,
  bodyText,
  bodyLoading,
  bodyError,
}: {
  entry: ChromoNetworkEntry
  bodyResult: ChromoNetworkBodyReadResult | null
  bodyText: string
  bodyLoading: boolean
  bodyError: string
}) {
  const headerMime = bodyResult
    ? headerValue(bodyResult.headers, 'content-type').split(';')[0].trim().toLowerCase()
    : ''
  if (isBinaryNetworkBody(entry, headerMime)) {
    return (
      <div class="chromo-network__drawer-empty">
        {binaryBodyPlaceholder(entry, headerMime || undefined)}
      </div>
    )
  }

  if (bodyLoading) {
    return <div class="chromo-network__drawer-empty">加载响应中…</div>
  }
  if (!entry.hasBody) {
    return (
      <div class="chromo-network__drawer-empty">
        {entry.pending ? '请求进行中…' : bodyError || '未缓存响应正文，无法预览'}
      </div>
    )
  }
  if (bodyError && !bodyResult) {
    return <div class="chromo-network__drawer-empty">{bodyError}</div>
  }
  if (!bodyResult) {
    return <div class="chromo-network__drawer-empty">无响应数据</div>
  }

  const contentType = headerValue(bodyResult.headers, 'content-type')
  const mime = contentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream'

  if (mime.includes('json') || mime === 'application/ld+json') {
    try {
      const parsed = JSON.parse(bodyText)
      return (
        <pre class="chromo-network__drawer-pre chromo-network__drawer-pre--json">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )
    } catch {
      return <pre class="chromo-network__drawer-pre">{bodyText || '(empty)'}</pre>
    }
  }

  if (
    mime.startsWith('text/') ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime === 'application/xhtml+xml'
  ) {
    return <pre class="chromo-network__drawer-pre">{bodyText || '(empty)'}</pre>
  }

  return <pre class="chromo-network__drawer-pre">{bodyText || '(empty)'}</pre>
}

function ResponseTab({
  entry,
  bodyText,
  bodyLoading,
  bodyError,
  truncated,
  bodyResult,
}: {
  entry: ChromoNetworkEntry
  bodyText: string
  bodyLoading: boolean
  bodyError: string
  truncated?: boolean
  bodyResult?: ChromoNetworkBodyReadResult | null
}) {
  const headerMime = bodyResult
    ? headerValue(bodyResult.headers, 'content-type').split(';')[0].trim().toLowerCase()
    : ''
  if (isBinaryNetworkBody(entry, headerMime)) {
    return (
      <div class="chromo-network__drawer-empty">
        {binaryBodyPlaceholder(entry, headerMime || undefined)}
      </div>
    )
  }

  if (bodyLoading) {
    return <div class="chromo-network__drawer-empty">加载响应中…</div>
  }
  if (bodyError && !bodyText) {
    return <div class="chromo-network__drawer-empty">{bodyError}</div>
  }
  if (!entry.hasBody && !bodyText) {
    return (
      <div class="chromo-network__drawer-empty">
        {entry.pending ? '请求进行中…' : '未缓存响应正文'}
      </div>
    )
  }
  return (
    <div>
      {truncated ? (
        <div class="chromo-network__drawer-note">
          仅显示 Cache 中的正文前缀（预览上限约 64KB），完整内容仍保留在 Cache
        </div>
      ) : null}
      <pre class="chromo-network__drawer-pre">{bodyText || '(empty)'}</pre>
    </div>
  )
}

function InitiatorTab({
  entry,
  pageUrl,
}: {
  entry: ChromoNetworkEntry
  pageUrl?: string
}) {
  const rootUrl =
    pageUrl ||
    (entry.referrer && entry.referrer !== 'about:client' ? entry.referrer : '') ||
    ''

  return (
    <div class="chromo-network__initiator">
      <div class="chromo-network__detail-grid">
        <DetailRow label="Resource type" value={entry.type || 'other'} />
        <DetailRow
          label="Referrer"
          value={entry.referrer || '(empty)'}
          muted={!entry.referrer}
        />
      </div>

      <h3 class="chromo-network__initiator-heading">Request initiator chain</h3>
      <ul class="chromo-network__initiator-tree">
        {rootUrl && rootUrl !== entry.url ? (
          <li class="chromo-network__initiator-node">
            <span class="chromo-network__initiator-arrow" aria-hidden="true">
              ▼
            </span>
            <span class="chromo-network__initiator-url" title={rootUrl}>
              {rootUrl}
            </span>
            <ul class="chromo-network__initiator-tree">
              <li class="chromo-network__initiator-node chromo-network__initiator-node--current">
                <span class="chromo-network__initiator-url" title={entry.url}>
                  {entry.url}
                </span>
              </li>
            </ul>
          </li>
        ) : (
          <li class="chromo-network__initiator-node chromo-network__initiator-node--current">
            <span class="chromo-network__initiator-url" title={entry.url}>
              {entry.url}
            </span>
          </li>
        )}
      </ul>
      <p class="chromo-network__drawer-note">
        完整 script import 调用链需要页面侧埋点（v2），当前仅展示 referrer / 页面 URL → 资源。
      </p>
    </div>
  )
}

function TimingBarRow({
  label,
  offsetPct,
  widthPct,
  color,
  valueMs,
}: {
  label: string
  offsetPct: number
  widthPct: number
  color: string
  valueMs: number | undefined
}) {
  return (
    <div class="chromo-network__timing-row">
      <div class="chromo-network__timing-label">{label}</div>
      <div class="chromo-network__timing-track">
        {valueMs !== undefined && valueMs >= 0 ? (
          <span
            class={`chromo-network__timing-bar chromo-network__timing-bar--${color}`}
            style={{
              left: `${offsetPct}%`,
              width: `${Math.max(widthPct, valueMs > 0 ? 0.8 : 0)}%`,
            }}
          />
        ) : null}
      </div>
      <div class="chromo-network__timing-value">{formatTimingMs(valueMs)}</div>
    </div>
  )
}

function TimingTab({
  entry,
  originTs,
  responseHeaders,
}: {
  entry: ChromoNetworkEntry
  originTs: number
  responseHeaders?: Record<string, string>
}) {
  const timing: ChromoNetworkTiming | undefined = entry.timing
  const serverTiming = useMemo(
    () => parseServerTiming(headerValue(responseHeaders, 'server-timing')),
    [responseHeaders],
  )

  if (!timing || typeof timing.queuedAt !== 'number') {
    return (
      <div class="chromo-network__drawer-empty">
        Timing 数据不可用（请求进行中或旧版本 bridge）
      </div>
    )
  }

  const queueing = timing.queueing ?? 0
  const waiting = timing.waiting ?? 0
  const download = timing.download ?? 0
  const total = Math.max(entry.duration, queueing + waiting + download, 1)
  const qPct = (queueing / total) * 100
  const wPct = (waiting / total) * 100
  const dPct = (download / total) * 100

  return (
    <div class="chromo-network__timing">
      <div class="chromo-network__timing-meta">
        <div>
          Queued at{' '}
          <strong>{relativeFromOrigin(timing.queuedAt, originTs)}</strong>
        </div>
        <div>
          Started at{' '}
          <strong>{relativeFromOrigin(timing.startedAt, originTs)}</strong>
        </div>
      </div>

      <div class="chromo-network__timing-group-label">Resource Scheduling</div>
      <TimingBarRow
        label="Queueing"
        offsetPct={0}
        widthPct={qPct}
        color="queue"
        valueMs={timing.queueing}
      />

      <div class="chromo-network__timing-group-label">Request/Response</div>
      <TimingBarRow
        label="Waiting (TTFB)"
        offsetPct={qPct}
        widthPct={wPct}
        color="waiting"
        valueMs={timing.waiting}
      />
      <TimingBarRow
        label="Content Download"
        offsetPct={qPct + wPct}
        widthPct={dPct}
        color="download"
        valueMs={timing.download}
      />

      <div class="chromo-network__timing-total">
        <span>Total</span>
        <strong>{formatTimingMs(entry.duration)}</strong>
      </div>

      <div class="chromo-network__timing-group-label">Server Timing</div>
      {serverTiming.length === 0 ? (
        <p class="chromo-network__drawer-note">
          开发时可使用 Server-Timing 响应头提供服务端耗时洞察。
        </p>
      ) : (
        <div class="chromo-network__detail-grid">
          {serverTiming.map((item) => (
            <DetailRow
              key={item.name}
              label={item.name}
              value={
                item.duration !== undefined
                  ? `${formatTimingMs(item.duration)}${item.description ? ` (${item.description})` : ''}`
                  : item.description || '-'
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function NetworkDetailDrawer({
  entry,
  bodyResult,
  bodyText,
  bodyLoading,
  bodyError,
  originTs,
  pageUrl,
  disableNetworkCache,
  entries,
  probeNetworkHot,
  onClose,
}: {
  entry: ChromoNetworkEntry
  bodyResult: ChromoNetworkBodyReadResult | null
  bodyText: string
  bodyLoading: boolean
  bodyError: string
  originTs: number
  pageUrl?: string
  disableNetworkCache?: boolean
  entries?: ChromoNetworkEntry[]
  probeNetworkHot?: (method: string, url: string) => Promise<{ exists: boolean }>
  onClose: () => void
}) {
  const [tab, setTab] = useState<NetworkDetailTab>('headers')

  useEffect(() => {
    setTab('headers')
  }, [entry.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside class="chromo-network__drawer" aria-label="请求详情">
      <header class="chromo-network__drawer-head chromo-network__drawer-head--tabs">
        <button
          type="button"
          class="chromo-network__drawer-close"
          onClick={onClose}
          aria-label="关闭详情"
        >
          ×
        </button>
        <div class="chromo-network__drawer-tabs" role="tablist" aria-label="详情标签">
          {DETAIL_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              class={[
                'chromo-network__drawer-tab',
                tab === item.id ? 'chromo-network__drawer-tab--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div class="chromo-network__drawer-subtitle" title={entry.url}>
        <span class="chromo-network__drawer-method">{entry.method || 'GET'}</span>
        <span class="chromo-network__drawer-url">{entry.url}</span>
      </div>

      <div class="chromo-network__drawer-body" role="tabpanel">
        {tab === 'headers' ? (
          <HeadersTab
            entry={entry}
            bodyResult={bodyResult}
            bodyLoading={bodyLoading}
            bodyError={bodyError}
            disableNetworkCache={disableNetworkCache}
            entries={entries}
            probeNetworkHot={probeNetworkHot}
          />
        ) : null}
        {tab === 'preview' ? (
          <PreviewTab
            entry={entry}
            bodyResult={bodyResult}
            bodyText={bodyText}
            bodyLoading={bodyLoading}
            bodyError={bodyError}
          />
        ) : null}
        {tab === 'response' ? (
          <ResponseTab
            entry={entry}
            bodyText={bodyText}
            bodyLoading={bodyLoading}
            bodyError={bodyError}
            truncated={bodyResult?.truncated}
            bodyResult={bodyResult}
          />
        ) : null}
        {tab === 'initiator' ? <InitiatorTab entry={entry} pageUrl={pageUrl} /> : null}
        {tab === 'timing' ? (
          <TimingTab
            entry={entry}
            originTs={originTs}
            responseHeaders={bodyResult?.headers}
          />
        ) : null}
      </div>
    </aside>
  )
}
