/**
 * iCode / 生成应用预览跑在 iframe 内。应用只应关心 iframe 视口（即 documentElement）尺寸，
 * 但许多生成代码只监听 window resize——而 iframe 元素变高时外层 window 并不会 resize。
 * 此处用 ResizeObserver 监听 iframe 内文档根，并在视口变化时补发 resize，兼容这类旧写法。
 */
function buildLayoutNotifyScript(): string {
  return `<script>
(function () {
  function notifyViewportChange() {
    window.dispatchEvent(new Event('resize'));
  }

  function observeIframeViewport() {
    if (typeof ResizeObserver !== 'function') {
      return;
    }

    var observer = new ResizeObserver(function () {
      notifyViewportChange();
    });

    observer.observe(document.documentElement);
    if (document.body) {
      observer.observe(document.body);
    }
  }

  if (document.body) {
    observeIframeViewport();
  } else {
    document.addEventListener('DOMContentLoaded', observeIframeViewport, { once: true });
  }

  window.addEventListener('load', notifyViewportChange, { once: true });
  if (document.readyState === 'complete') {
    notifyViewportChange();
  }

  requestAnimationFrame(function () {
    notifyViewportChange();
    requestAnimationFrame(notifyViewportChange);
  });
})();
</script>`
}

export function injectIframeLayoutNotify(html: string): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildLayoutNotifyScript()

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
