import { GENERATED_APP_HEARTBEAT_INTERVAL_MS, GENERATED_APP_HEARTBEAT_MESSAGE_TYPE } from './generated-app-heartbeat-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildHeartbeatBridgeScript(appId: GeneratedAppId, windowId: string): string {
  const appIdJson = JSON.stringify(appId)
  const windowIdJson = JSON.stringify(windowId)
  const messageTypeJson = JSON.stringify(GENERATED_APP_HEARTBEAT_MESSAGE_TYPE)
  const intervalMs = GENERATED_APP_HEARTBEAT_INTERVAL_MS

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var WINDOW_ID = ${windowIdJson};
  var MESSAGE_TYPE = ${messageTypeJson};
  var INTERVAL_MS = ${intervalMs};

  function readHeapMemory() {
    try {
      var mem = performance.memory;
      if (!mem || typeof mem.usedJSHeapSize !== 'number') {
        return undefined;
      }
      return {
        usedBytes: mem.usedJSHeapSize,
        totalBytes: mem.totalJSHeapSize,
        limitBytes: mem.jsHeapSizeLimit
      };
    } catch (error) {
      return undefined;
    }
  }

  function sendHeartbeat() {
    try {
      var payload = {
        type: MESSAGE_TYPE,
        appId: APP_ID,
        windowId: WINDOW_ID,
        timestamp: Date.now()
      };
      var memory = readHeapMemory();
      if (memory) {
        payload.memory = memory;
      }
      parent.postMessage(payload, '*');
    } catch (error) {}
  }

  sendHeartbeat();
  setInterval(sendHeartbeat, INTERVAL_MS);
})();
</script>`
}

export function injectGeneratedAppHeartbeatBridge(
  html: string,
  appId: GeneratedAppId,
  windowId: string,
): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildHeartbeatBridgeScript(appId, windowId)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
