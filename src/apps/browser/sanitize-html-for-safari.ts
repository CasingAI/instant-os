/** 清理 AI HTML，避免 target/_blank、onclick 等绕过 Safari 内部导航 */
export function sanitizeHtmlForSafari(html: string): string {
  let result = html.replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
  result = result.replace(/\s+target\s*=\s*["'][^"']*["']/gi, '')
  result = result.replace(/\s+onclick\s*=\s*["'][^"']*["']/gi, '')
  result = result.replace(/\s+onsubmit\s*=\s*["'][^"']*["']/gi, '')
  return result
}

function escapeBaseHref(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function injectPageBaseHref(html: string, pageUrl: string): string {
  if (!html.trim() || !pageUrl) {
    return html
  }

  const baseTag = `<base href="${escapeBaseHref(pageUrl)}">`
  const withoutBase = html.replace(/<base[\s>][^>]*>/gi, '')

  if (/<head[\s>]/i.test(withoutBase)) {
    return withoutBase.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${baseTag}`)
  }

  if (/<html[\s>]/i.test(withoutBase)) {
    return withoutBase.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${baseTag}</head>`)
  }

  return `<head>${baseTag}</head>\n${withoutBase}`
}

function buildNavigationBridge(pageUrl: string): string {
  const baseJson = JSON.stringify(pageUrl)

  return `<script>
(function () {
  var PAGE_BASE = ${baseJson};

  function send(url) {
    if (!url || url === '#' || url.indexOf('javascript:') === 0) return;
    parent.postMessage({ type: 'instant-os-navigate', url: url }, '*');
  }

  function resolve(href) {
    try {
      return new URL(href, PAGE_BASE).href;
    } catch (e) {
      return undefined;
    }
  }

  document.addEventListener('click', function (event) {
    var el = event.target;
    if (!el || !el.closest) return;

    var link = el.closest('a[href]');
    if (link) {
      var href = link.getAttribute('href');
      if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      var url = resolve(href);
      if (url) send(url);
      return;
    }

    var button = el.closest('button[data-navigate-url]');
    if (button) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var nav = button.getAttribute('data-navigate-url');
      if (nav) {
        var target = resolve(nav);
        if (target) send(target);
      }
    }
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') {
      if (event.target && event.target.closest) {
        form = event.target.closest('form');
      }
    }
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      var action = form.getAttribute('action') || PAGE_BASE;
      var target = new URL(action, PAGE_BASE);
      var data = new FormData(form);
      data.forEach(function (value, key) {
        target.searchParams.set(key, String(value));
      });
      send(target.href);
    } catch (e) {}
  }, true);
})();
</script>`
}

export function injectSafariNavigationBridge(html: string, pageUrl: string): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildNavigationBridge(pageUrl)

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}\n</body>`)
  }

  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${bridge}\n</html>`)
  }

  return `${html}\n${bridge}`
}
