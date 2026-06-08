function buildScene3dBridgeScript(): string {
  return `<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/three.module.js",
    "three/addons/": "/vendor/three/examples/jsm/",
    "@dimforge/rapier3d-compat": "/vendor/rapier/rapier.mjs"
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

function buildScene3dBridgeHead(): string {
  return `${buildScene3dBridgeScript()}\n${buildScene3dGestureBlock()}`
}

export function injectScene3dBridge(html: string): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildScene3dBridgeHead()

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
