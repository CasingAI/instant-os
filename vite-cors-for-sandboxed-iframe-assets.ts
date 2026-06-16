import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

/** 进程隔离 iframe（opaque origin）加载 /vendor、/assets、/fonts 时须带 CORS。 */
const CORS_ASSET_PREFIXES = ['/vendor/', '/assets/', '/fonts/'] as const

const CORS_HEADER = 'Access-Control-Allow-Origin'
const CORS_VALUE = '*'

function shouldAttachCors(url: string | undefined): boolean {
  if (!url) {
    return false
  }

  const path = url.split('?')[0]?.split('#')[0] ?? ''
  return CORS_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function attachCorsMiddleware(server: Pick<ViteDevServer | PreviewServer, 'middlewares'>): void {
  server.middlewares.use((req, res, next) => {
    if (shouldAttachCors(req.url)) {
      res.setHeader(CORS_HEADER, CORS_VALUE)
    }
    next()
  })
}

/** 本地 dev/preview 补 CORS；生产部署见 public/_headers（Cloudflare Pages 等）。 */
export function corsForSandboxedIframeAssets(): Plugin {
  return {
    name: 'cors-for-sandboxed-iframe-assets',
    configureServer(server) {
      attachCorsMiddleware(server)
    },
    configurePreviewServer(server) {
      attachCorsMiddleware(server)
    },
  }
}
