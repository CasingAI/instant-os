import { resolveHostAssetUrl } from './resolve-host-asset-url.ts'

export type InjectScene3dBridgeOptions = {
  /** 进程隔离（Blob URL）下须用绝对 URL，否则 import map 解析为 null。 */
  absoluteAssetUrls?: boolean
}

function resolveScene3dAssetUrl(path: string, absoluteAssetUrls: boolean): string {
  return absoluteAssetUrls ? resolveHostAssetUrl(path) : path
}

function buildScene3dBridgeScript(absoluteAssetUrls: boolean): string {
  return `<script type="importmap">
{
  "imports": {
    "three": "${resolveScene3dAssetUrl('/vendor/three/three.module.js', absoluteAssetUrls)}",
    "three/addons/": "${resolveScene3dAssetUrl('/vendor/three/examples/jsm/', absoluteAssetUrls)}",
    "@dimforge/rapier3d-compat": "${resolveScene3dAssetUrl('/vendor/rapier/rapier.mjs', absoluteAssetUrls)}"
  }
}
</script>`
}

/** 阻止触控板横向滑动触发浏览器前进/后退（Chrome/macOS 等）。 */
function buildScene3dGestureBlock(): string {
  return `<style id="instant-scene3d-gesture-block">
html, body, canvas { overscroll-behavior: none; touch-action: none; }
</style>
<script>
(function () {
  function blockNavigationGesture(event) {
    if (event.type === 'wheel' && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      return;
    }
    if (event.type === 'gesturestart' || event.type === 'gesturechange') {
      event.preventDefault();
    }
  }
  document.addEventListener('wheel', blockNavigationGesture, { passive: false });
  document.addEventListener('gesturestart', blockNavigationGesture, { passive: false });
  document.addEventListener('gesturechange', blockNavigationGesture, { passive: false });
})();
</script>`
}

function buildScene3dBridgeHead(absoluteAssetUrls: boolean): string {
  return `${buildScene3dBridgeScript(absoluteAssetUrls)}\n${buildScene3dGestureBlock()}`
}

export function injectScene3dBridge(html: string, options: InjectScene3dBridgeOptions = {}): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildScene3dBridgeHead(options.absoluteAssetUrls === true)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
