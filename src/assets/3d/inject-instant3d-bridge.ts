import { INSTANT3D_CATALOG } from './asset-catalog.ts'

function buildInstant3dBridgeScript(): string {
  const catalogJson = JSON.stringify(
    INSTANT3D_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.label,
      url: entry.url,
    })),
  )

  return `<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/three.module.js",
    "three/addons/": "/vendor/three/examples/jsm/"
  }
}
</script>
<script>
window.__INSTANT3D_CATALOG__ = ${catalogJson};
</script>
<script type="module" src="/assets/instant3d/instant3d-bootstrap.js"></script>
<script>
window.Instant3DReady = new Promise(function (resolve) {
  if (window.Instant3D) {
    resolve(window.Instant3D);
    return;
  }
  window.addEventListener('instant3d-ready', function () {
    resolve(window.Instant3D);
  }, { once: true });
});
</script>`
}

export function injectInstant3dBridge(html: string): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildInstant3dBridgeScript()

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
