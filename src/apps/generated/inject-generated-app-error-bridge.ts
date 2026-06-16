import { GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE } from './generated-app-runtime-error-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildErrorBridgeScript(appId: GeneratedAppId): string {
  const appIdJson = JSON.stringify(appId)
  const messageTypeJson = JSON.stringify(GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var MESSAGE_TYPE = ${messageTypeJson};
  var MAX_REPORTS = 500;
  var reportCount = 0;
  var DEDUPE_MS = 120;
  var lastReportKey = '';
  var lastReportAt = 0;

  function isBenignErrorMessage(message) {
    if (!message || typeof message !== 'string') {
      return false;
    }
    return /ResizeObserver loop/i.test(message);
  }

  function formatErrorEvent(event) {
    var parts = [];
    if (event && event.message) {
      parts.push(String(event.message));
    }
    if (event && event.filename) {
      parts.push('at ' + event.filename + ':' + event.lineno + ':' + event.colno);
    }
    if (event && event.error && event.error.stack) {
      parts.push(String(event.error.stack));
    } else if (event && event.error && event.error.message) {
      parts.push(String(event.error.message));
    }
    return parts.join('\\n') || '未知脚本错误';
  }

  function isScriptLoadErrorEvent(event) {
    var target = event && event.target;
    if (!target || target === window || target === document) {
      return false;
    }
    return (target.tagName || '') === 'SCRIPT';
  }

  function formatScriptLoadErrorEvent(event) {
    var target = event.target;
    var url = target.src || target.getAttribute('src') || '';
    var parts = ['脚本加载失败'];
    if (url) {
      parts.push(url);
      return parts.join('\\n');
    }
    if (event && event.filename) {
      parts.push('at ' + event.filename + ':' + event.lineno + ':' + event.colno);
      return parts.join('\\n');
    }
    return parts.join('\\n');
  }

  function formatRejectionEvent(event) {
    var reason = event ? event.reason : undefined;
    if (reason instanceof Error) {
      return reason.stack || reason.message || String(reason);
    }
    if (typeof reason === 'string') {
      return reason;
    }
    try {
      return JSON.stringify(reason);
    } catch (error) {
      return String(reason);
    }
  }

  function shouldReport(kind, text) {
    if (reportCount >= MAX_REPORTS) {
      return false;
    }

    if (kind === 'error' && isBenignErrorMessage(text)) {
      return false;
    }

    var now = Date.now();
    var key = kind + ':' + text;
    if (key === lastReportKey && now - lastReportAt < DEDUPE_MS) {
      return false;
    }

    lastReportKey = key;
    lastReportAt = now;
    return true;
  }

  function emit(kind, text) {
    if (!shouldReport(kind, text)) {
      return;
    }

    reportCount += 1;

    try {
      parent.postMessage({
        type: MESSAGE_TYPE,
        appId: APP_ID,
        kind: kind,
        text: text,
        timestamp: Date.now()
      }, '*');
    } catch (error) {}

    try {
      console.error(text);
    } catch (error) {}
  }

  window.addEventListener('error', function (event) {
    if (isScriptLoadErrorEvent(event)) {
      emit('error', formatScriptLoadErrorEvent(event));
      return;
    }
    emit('error', formatErrorEvent(event));
  });

  window.addEventListener('unhandledrejection', function (event) {
    emit('unhandledrejection', formatRejectionEvent(event));
  });
})();
</script>`
}

export function injectGeneratedAppErrorBridge(html: string, appId: GeneratedAppId): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildErrorBridgeScript(appId)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
