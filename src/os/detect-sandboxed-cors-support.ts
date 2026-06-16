/** 进程隔离 iframe 内用于探测静态资源 CORS 是否可用的空文件（见 public/vendor/cors-probe.txt）。 */
export const SANDBOXED_CORS_PROBE_PATH = '/vendor/cors-probe.txt'

const PROBE_MESSAGE_TYPE = 'instant-os:sandboxed-cors-probe'
/** 父级兜底：探测 iframe 在此时间内未 postMessage，视为 CORS 不可用。 */
const PROBE_TIMEOUT_MS = 10000

export const SANDBOXED_CORS_PROBE_COMPLETED_EVENT = 'instant-os:sandboxed-cors-probe-completed'

let cachedSandboxedCorsSupport: boolean | undefined
let probePromise: Promise<boolean> | undefined

function buildProbeHtml(probeUrl: string): string {
  return `<!DOCTYPE html><script>
fetch(${JSON.stringify(probeUrl)}, { mode: 'cors', cache: 'no-store' })
  .then(function (response) {
    parent.postMessage({ type: ${JSON.stringify(PROBE_MESSAGE_TYPE)}, ok: response.ok }, '*');
  })
  .catch(function () {
    parent.postMessage({ type: ${JSON.stringify(PROBE_MESSAGE_TYPE)}, ok: false }, '*');
  });
</script>`
}

function runSandboxedCorsProbe(): Promise<boolean> {
  return new Promise((resolve) => {
    const probeUrl = `${window.location.origin}${SANDBOXED_CORS_PROBE_PATH}`
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.hidden = true
    iframe.tabIndex = -1
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none'

    let settled = false
    const finish = (supported: boolean) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', onMessage)
      iframe.remove()
      URL.revokeObjectURL(blobUrl)
      resolve(supported)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) {
        return
      }

      const data = event.data as { type?: string; ok?: boolean } | undefined
      if (!data || data.type !== PROBE_MESSAGE_TYPE) {
        return
      }

      finish(data.ok === true)
    }

    const timeoutId = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS)
    window.addEventListener('message', onMessage)

    const blobUrl = URL.createObjectURL(
      new Blob([buildProbeHtml(probeUrl)], { type: 'text/html' }),
    )
    document.body.appendChild(iframe)
    iframe.src = blobUrl
  })
}

/** 在 sandbox + Blob URL（opaque origin）下能否 CORS 拉取宿主静态资源。 */
export function detectSandboxedCorsSupport(): Promise<boolean> {
  if (cachedSandboxedCorsSupport !== undefined) {
    return Promise.resolve(cachedSandboxedCorsSupport)
  }

  probePromise ??= runSandboxedCorsProbe()
    .then((supported) => {
      cachedSandboxedCorsSupport = supported
      window.dispatchEvent(new CustomEvent(SANDBOXED_CORS_PROBE_COMPLETED_EVENT))
      return supported
    })
    .finally(() => {
      probePromise = undefined
    })

  return probePromise
}

export function readSandboxedCorsSupport(): boolean | undefined {
  return cachedSandboxedCorsSupport
}
