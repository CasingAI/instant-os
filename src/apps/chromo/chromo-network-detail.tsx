import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ImageDocumentPreview } from '../../preview/image-document-preview.tsx'
import type {
  ChromoNetworkBodyReadResult,
  ChromoNetworkEntry,
  ChromoNetworkTiming,
} from './chromo-bridge.ts'
import { diagnoseHotCache } from './chromo-network-cache-help.ts'
import {
  classifyNetworkPreviewKind,
  isNonPreviewableBinaryBody,
  networkBodyToImageBlob,
  networkEntryName,
  previewFileNameFromEntry,
} from './chromo-network-preview.ts'
import { ChromoNetworkTextPreview } from './chromo-network-text-preview.tsx'

export type NetworkDetailTab = 'headers' | 'preview' | 'initiator' | 'timing'

export { isBinaryNetworkBody, isNonPreviewableBinaryBody } from './chromo-network-preview.ts'

const DRAWER_WIDTH_KEY = 'chromo-network-drawer-width'
const DEFAULT_DRAWER_WIDTH = 420
const MIN_DRAWER_WIDTH = 280
/** 悬浮抽屉左侧至少露出的列表像素 */
const DRAWER_LEFT_GUTTER = 32

function readStoredDrawerWidth(): number {
  try {
    const raw = localStorage.getItem(DRAWER_WIDTH_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(parsed) && parsed >= MIN_DRAWER_WIDTH) {
      return parsed
    }
  } catch {
    // ignore
  }
  return DEFAULT_DRAWER_WIDTH
}

function clampDrawerWidth(value: number, containerWidth: number): number {
  if (containerWidth <= 0) {
    return Math.max(MIN_DRAWER_WIDTH, value)
  }
  const maxWidth = Math.max(MIN_DRAWER_WIDTH, containerWidth - DRAWER_LEFT_GUTTER)
  return Math.min(maxWidth, Math.max(MIN_DRAWER_WIDTH, value))
}

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

function binaryBodyPlaceholder(entry: ChromoNetworkEntry, mime?: string): string {
  const label = mime || entry.type || 'binary'
  return `二进制内容（${label}，${formatNetworkBytes(entry.size)}）— 不渲染预览，完整内容保留在 Cache`
}

const DETAIL_TABS: { id: NetworkDetailTab; label: string }[] = [
  { id: 'headers', label: '标头' },
  { id: 'preview', label: '预览' },
  { id: 'initiator', label: '发起者' },
  { id: 'timing', label: '时序' },
]

const STATUS_TEXT: Record<number, string> = {
  200: '成功',
  201: '已创建',
  204: '无内容',
  301: '永久重定向',
  302: '临时重定向',
  304: '未修改',
  307: '临时重定向',
  308: '永久重定向',
  400: '错误请求',
  401: '未授权',
  403: '禁止访问',
  404: '未找到',
  500: '服务器内部错误',
  502: '错误网关',
  503: '服务不可用',
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
    return '进行中'
  }
  if (entry.failed && !entry.status) {
    return entry.errorCode ? `（失败） ${entry.errorCode}` : '（失败）'
  }
  const code = entry.status || 0
  const text = STATUS_TEXT[code]
  return text ? `${code} ${text}` : String(code || '-')
}

function formatServedFrom(entry: ChromoNetworkEntry): string {
  if (entry.pending) {
    return '进行中…'
  }
  const source = entry.source || (entry.fromCache ? 'cache' : entry.bypass ? 'bypass' : '')
  switch (source) {
    case 'cache':
      return '开发者工具内存缓存'
    case 'bypass':
      return '直通（厂商直连）'
    case 'direct':
      return '直接请求（CORS 主机）'
    case 'cdn':
      return '静态 CDN（jsDelivr）'
    case 'native':
      return '原生 / 非 HTTP'
    case 'proxy':
      return entry.sourceHost
        ? `代理网关（${entry.sourceHost}）`
        : '代理网关'
    default:
      if (entry.fromCache) {
        return '开发者工具内存缓存'
      }
      if (entry.bypass) {
        return '直通（厂商直连）'
      }
      return entry.source || '代理网关'
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
    return '（空）'
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
                Cache-Control 不影响此项（仅开发者工具热缓存）
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
      <CollapsibleSection title="常规">
        <div class="chromo-network__detail-grid">
          <DetailRow label="请求 URL" value={entry.url} />
          <DetailRow label="请求方法" value={entry.method || 'GET'} />
          <DetailRow label="状态码">
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
            <DetailRow label="失败原因" value={entry.errorText} />
          ) : null}
          <DetailRow label="来源">
            <ServedFromCell
              entry={entry}
              disableNetworkCache={disableNetworkCache}
              entries={entries}
              probeNetworkHot={probeNetworkHot}
            />
          </DetailRow>
          <DetailRow
            label="Referrer Policy"
            value={entry.referrerPolicy || '（空）'}
            muted={!entry.referrerPolicy}
          />
          <DetailRow
            label="Referrer"
            value={entry.referrer || '（空）'}
            muted={!entry.referrer}
          />
          <DetailRow label="类型" value={entry.type || 'other'} />
          <DetailRow label="大小" value={entry.pending ? '-' : formatNetworkBytes(entry.size)} />
          <DetailRow label="耗时" value={entry.pending ? '进行中' : `${entry.duration} ms`} />
          <DetailRow label="条目 ID" value={entry.id} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="响应标头"
        actions={
          <label class="chromo-network__raw-toggle">
            <input
              type="checkbox"
              checked={responseRaw}
              onChange={(event) =>
                setResponseRaw((event.currentTarget as HTMLInputElement).checked)
              }
            />
            原始
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
        title="请求标头"
        actions={
          <label class="chromo-network__raw-toggle">
            <input
              type="checkbox"
              checked={requestRaw}
              onChange={(event) =>
                setRequestRaw((event.currentTarget as HTMLInputElement).checked)
              }
            />
            原始
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
  active,
  linesMode,
  linesTotal,
  linesLoadedTo,
  linesLoadingMore,
  onLoadMoreLines,
}: {
  entry: ChromoNetworkEntry
  bodyResult: ChromoNetworkBodyReadResult | null
  bodyText: string
  bodyLoading: boolean
  bodyError: string
  active: boolean
  linesMode: boolean
  linesTotal: number
  linesLoadedTo: number
  linesLoadingMore: boolean
  onLoadMoreLines?: () => void
}) {
  const headerMime = bodyResult
    ? headerValue(bodyResult.headers, 'content-type').split(';')[0].trim().toLowerCase()
    : ''
  const kind = classifyNetworkPreviewKind(entry, headerMime || undefined)
  const [imageSrc, setImageSrc] = useState('')

  useEffect(() => {
    if (kind !== 'image' || !bodyResult) {
      setImageSrc('')
      return
    }
    let objectUrl = ''
    try {
      const blob = networkBodyToImageBlob(bodyResult, headerMime || undefined)
      objectUrl = URL.createObjectURL(blob)
      setImageSrc(objectUrl)
    } catch {
      setImageSrc('')
    }
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [kind, bodyResult, headerMime])

  if (kind === 'binary' || isNonPreviewableBinaryBody(entry, headerMime)) {
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
  const linesComplete = !linesMode || linesLoadedTo >= linesTotal
  const linesNote = linesMode && linesTotal > 0 ? (
    <div class="chromo-network__drawer-note">
      已加载 {Math.min(linesLoadedTo, linesTotal)} / {linesTotal} 行
    </div>
  ) : bodyResult.truncated ? (
    <div class="chromo-network__drawer-note">
      仅显示 Cache 中的正文前缀（预览上限约 64KB），完整内容仍保留在 Cache
    </div>
  ) : null

  const loadMoreControl =
    linesMode && !linesComplete ? (
      <div class="chromo-network__preview-more">
        <button
          type="button"
          class="chromo-network__preview-retry"
          disabled={linesLoadingMore}
          onClick={() => onLoadMoreLines?.()}
        >
          {linesLoadingMore ? '加载中…' : '加载更多行'}
        </button>
        {bodyError ? <span class="chromo-network__preview-more-error">{bodyError}</span> : null}
      </div>
    ) : null

  if (kind === 'image') {
    if (!imageSrc) {
      return <div class="chromo-network__drawer-empty">无法解码图片预览</div>
    }
    return (
      <div class="chromo-network__preview-pane chromo-network__preview-pane--image">
        {linesNote}
        <ImageDocumentPreview src={imageSrc} alt={networkEntryName(entry.url)} />
      </div>
    )
  }

  if (kind === 'json' && linesComplete) {
    try {
      const parsed = JSON.parse(bodyText)
      return (
        <div>
          {linesNote}
          <pre class="chromo-network__drawer-pre chromo-network__drawer-pre--json">
            {JSON.stringify(parsed, null, 2)}
          </pre>
          {loadMoreControl}
        </div>
      )
    } catch {
      // fall through to text preview
    }
  }

  // text (incl. HTML / partial JSON) as source
  return (
    <div class="chromo-network__preview-pane chromo-network__preview-pane--text">
      {linesNote}
      <ChromoNetworkTextPreview
        text={bodyText}
        fileName={previewFileNameFromEntry(entry.url, mime)}
        active={active}
      />
      {loadMoreControl}
    </div>
  )
}

function renderInitiatorChain(urls: string[], currentUrl: string): ComponentChildren {
  if (!urls.length) {
    return (
      <li class="chromo-network__initiator-node chromo-network__initiator-node--current">
        <span class="chromo-network__initiator-url" title={currentUrl}>
          {currentUrl || '（未知）'}
        </span>
      </li>
    )
  }

  function nest(index: number): ComponentChildren {
    const url = urls[index]
    const isLast = index === urls.length - 1
    const isCurrent = isLast || url === currentUrl
    return (
      <li
        class={
          isCurrent
            ? 'chromo-network__initiator-node chromo-network__initiator-node--current'
            : 'chromo-network__initiator-node'
        }
      >
        {!isLast ? (
          <span class="chromo-network__initiator-arrow" aria-hidden="true">
            ▼
          </span>
        ) : null}
        <span class="chromo-network__initiator-url" title={url}>
          {url}
        </span>
        {!isLast ? (
          <ul class="chromo-network__initiator-tree">{nest(index + 1)}</ul>
        ) : null}
      </li>
    )
  }

  return nest(0)
}

function InitiatorTab({
  entry,
  pageUrl,
}: {
  entry: ChromoNetworkEntry
  pageUrl?: string
}) {
  const kind = entry.initiatorKind || ''
  const kindLabel =
    kind === 'fetch'
      ? 'fetch'
      : kind === 'xhr'
        ? 'XMLHttpRequest'
        : kind === 'import'
          ? 'dynamic import()'
          : kind === 'parser'
            ? 'Parser'
            : kind || '（未知）'

  const chain =
    entry.initiatorChain && entry.initiatorChain.length
      ? entry.initiatorChain
      : (() => {
          const root =
            pageUrl ||
            (entry.referrer && entry.referrer !== 'about:client' ? entry.referrer : '') ||
            ''
          if (root && root !== entry.url) {
            return [root, entry.url]
          }
          return entry.url ? [entry.url] : []
        })()

  const stack = entry.initiatorStack || []
  const hasStack = stack.length > 0

  return (
    <div class="chromo-network__initiator">
      <div class="chromo-network__detail-grid">
        <DetailRow label="资源类型" value={entry.type || 'other'} />
        <DetailRow label="发起方式" value={kindLabel} muted={!kind} />
        <DetailRow
          label="调用脚本"
          value={entry.initiatorScriptUrl || '（无）'}
          muted={!entry.initiatorScriptUrl}
        />
        <DetailRow
          label="Referrer"
          value={entry.referrer || '（空）'}
          muted={!entry.referrer}
        />
      </div>

      <h3 class="chromo-network__initiator-heading">请求发起链</h3>
      <ul class="chromo-network__initiator-tree">
        {renderInitiatorChain(chain, entry.url)}
      </ul>

      <h3 class="chromo-network__initiator-heading">调用栈</h3>
      {hasStack ? (
        <details class="chromo-network__initiator-stack" open>
          <summary>{stack.length} 帧</summary>
          <pre class="chromo-network__drawer-pre chromo-network__initiator-stack-pre">
            {stack.join('\n')}
          </pre>
        </details>
      ) : (
        <p class="chromo-network__drawer-note">
          {kind === 'parser' || !kind
            ? '无 JS 调用栈（Parser / 静态资源触发）'
            : '无可用调用栈'}
        </p>
      )}

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
        时序数据不可用（请求进行中或旧版本 bridge）
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
          排队于{' '}
          <strong>{relativeFromOrigin(timing.queuedAt, originTs)}</strong>
        </div>
        <div>
          开始于{' '}
          <strong>{relativeFromOrigin(timing.startedAt, originTs)}</strong>
        </div>
      </div>

      <div class="chromo-network__timing-group-label">资源调度</div>
      <TimingBarRow
        label="排队"
        offsetPct={0}
        widthPct={qPct}
        color="queue"
        valueMs={timing.queueing}
      />

      <div class="chromo-network__timing-group-label">请求/响应</div>
      <TimingBarRow
        label="等待（TTFB）"
        offsetPct={qPct}
        widthPct={wPct}
        color="waiting"
        valueMs={timing.waiting}
      />
      <TimingBarRow
        label="内容下载"
        offsetPct={qPct + wPct}
        widthPct={dPct}
        color="download"
        valueMs={timing.download}
      />

      <div class="chromo-network__timing-total">
        <span>总计</span>
        <strong>{formatTimingMs(entry.duration)}</strong>
      </div>

      <div class="chromo-network__timing-group-label">服务器时序</div>
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
  linesMode = false,
  linesTotal = 0,
  linesLoadedTo = 0,
  linesLoadingMore = false,
  onLoadMoreLines,
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
  linesMode?: boolean
  linesTotal?: number
  linesLoadedTo?: number
  linesLoadingMore?: boolean
  onLoadMoreLines?: () => void
  originTs: number
  pageUrl?: string
  disableNetworkCache?: boolean
  entries?: ChromoNetworkEntry[]
  probeNetworkHot?: (method: string, url: string) => Promise<{ exists: boolean }>
  onClose: () => void
}) {
  const [tab, setTab] = useState<NetworkDetailTab>('headers')
  const drawerRef = useRef<HTMLElement>(null)
  const [preferredWidth, setPreferredWidth] = useState(readStoredDrawerWidth)
  const [containerWidth, setContainerWidth] = useState(0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const resizingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const startPointerXRef = useRef(0)
  const startWidthRef = useRef(0)
  const liveWidthRef = useRef<number | null>(null)
  const dragRafRef = useRef(0)
  const containerWidthRef = useRef(0)
  const captureTargetRef = useRef<HTMLElement | null>(null)
  const endDragListenersRef = useRef<(() => void) | null>(null)

  const displayWidth = clampDrawerWidth(dragWidth ?? preferredWidth, containerWidth)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commitWidth = useCallback((width: number) => {
    const next = clampDrawerWidth(width, containerWidthRef.current)
    setPreferredWidth(next)
    try {
      localStorage.setItem(DRAWER_WIDTH_KEY, String(next))
    } catch {
      // ignore
    }
  }, [])

  const stopResize = useCallback(
    (commit = true) => {
      if (!resizingRef.current) {
        return
      }
      endDragListenersRef.current?.()
      endDragListenersRef.current = null
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = 0
      }
      if (captureTargetRef.current && pointerIdRef.current !== null) {
        try {
          captureTargetRef.current.releasePointerCapture(pointerIdRef.current)
        } catch {
          // ignore
        }
      }
      if (commit && liveWidthRef.current !== null) {
        commitWidth(liveWidthRef.current)
      }
      resizingRef.current = false
      liveWidthRef.current = null
      setDragWidth(null)
      captureTargetRef.current = null
      pointerIdRef.current = null
      document.body.style.removeProperty('user-select')
      document.body.style.removeProperty('cursor')
    },
    [commitWidth],
  )

  useEffect(() => {
    return () => {
      stopResize(false)
    }
  }, [stopResize])

  useEffect(() => {
    const drawer = drawerRef.current
    const container = drawer?.parentElement
    if (!container) {
      return
    }

    const sync = () => {
      const width = container.clientWidth
      containerWidthRef.current = width
      setContainerWidth(width)
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const onResizePointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const handle = event.currentTarget as HTMLDivElement
      const pointerId = event.pointerId
      const currentWidth = clampDrawerWidth(preferredWidth, containerWidthRef.current)

      try {
        handle.setPointerCapture(pointerId)
      } catch {
        // ignore
      }
      captureTargetRef.current = handle
      pointerIdRef.current = pointerId
      resizingRef.current = true
      startPointerXRef.current = event.clientX
      startWidthRef.current = currentWidth
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'

      const scheduleWidth = (width: number) => {
        liveWidthRef.current = width
        if (dragRafRef.current) {
          return
        }
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = 0
          if (liveWidthRef.current !== null) {
            setDragWidth(liveWidthRef.current)
          }
        })
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (!resizingRef.current || moveEvent.pointerId !== pointerId) {
          return
        }
        moveEvent.preventDefault()
        const delta = startPointerXRef.current - moveEvent.clientX
        const next = clampDrawerWidth(
          startWidthRef.current + delta,
          containerWidthRef.current,
        )
        scheduleWidth(next)
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return
        }
        stopResize(true)
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return
        }
        stopResize(false)
      }

      endDragListenersRef.current = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onCancel)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onCancel)
    },
    [preferredWidth, stopResize],
  )

  return (
    <aside
      ref={drawerRef}
      class="chromo-network__drawer"
      aria-label="请求详情"
      style={{ width: `${displayWidth}px` }}
    >
      <div
        class="chromo-network__drawer-resize"
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整详情面板宽度"
        title="拖动调整宽度"
      />
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
            active={tab === 'preview'}
            linesMode={linesMode}
            linesTotal={linesTotal}
            linesLoadedTo={linesLoadedTo}
            linesLoadingMore={linesLoadingMore}
            onLoadMoreLines={onLoadMoreLines}
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
