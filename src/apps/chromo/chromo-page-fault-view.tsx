import type { ChromoPageFault } from './chromo-page-fault.ts'

type ChromoPageFaultViewProps = {
  fault: ChromoPageFault
  variant?: 'viewport' | 'panel'
  /** load: retry navigation; fatal: typically reload the whole app */
  onRetry?: () => void
}

function buildMetaLines(fault: ChromoPageFault): string[] {
  const lines: string[] = []
  if (fault.code) {
    lines.push(`code: ${fault.code}`)
  }
  if (fault.bridgeBuild) {
    lines.push(`bridge: ${fault.bridgeBuild}`)
  }
  if (fault.swBuild) {
    lines.push(`SW: ${fault.swBuild}`)
  }
  if (fault.url && fault.severity === 'fatal') {
    lines.push(`url: ${fault.url}`)
  }
  return lines
}

export function ChromoPageFaultView({
  fault,
  variant = 'viewport',
  onRetry,
}: ChromoPageFaultViewProps) {
  const isFatal = fault.severity === 'fatal'
  const title = isFatal ? '此页面已停止运行' : '无法加载此页'
  const primaryLabel = isFatal ? '重新加载' : '重试'
  const metaLines = buildMetaLines(fault)

  const handlePrimary = () => {
    if (isFatal) {
      window.location.reload()
      return
    }
    onRetry?.()
  }

  return (
    <div
      class={[
        'chromo__page-fault',
        isFatal ? 'chromo__page-fault--fatal' : 'chromo__page-fault--load',
        variant === 'panel' ? 'chromo__page-fault--panel' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="alertdialog"
      aria-labelledby="chromo-page-fault-title"
      aria-describedby="chromo-page-fault-message"
    >
      <div class="chromo__page-fault-card">
        <h1 id="chromo-page-fault-title" class="chromo__page-fault-title">
          {title}
        </h1>
        <p id="chromo-page-fault-message" class="chromo__page-fault-message">
          {fault.message}
        </p>
        {!isFatal && fault.url ? (
          <p class="chromo__page-fault-url" title={fault.url}>
            {fault.url}
          </p>
        ) : null}
        {metaLines.length > 0 ? (
          <pre class="chromo__page-fault-meta">{metaLines.join('\n')}</pre>
        ) : null}
        {(isFatal || onRetry) && (
          <button type="button" class="chromo__page-fault-action" onClick={handlePrimary}>
            {primaryLabel}
          </button>
        )}
        {!isFatal ? (
          <p class="chromo__page-fault-hint">也可在地址栏输入新地址后回车继续浏览。</p>
        ) : null}
      </div>
    </div>
  )
}
