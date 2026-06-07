import { GENERATED_APP_STORAGE_MESSAGE_TYPE } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildStorageBridgeScript(appId: GeneratedAppId, initialData: GeneratedAppDataStore): string {
  const appIdJson = JSON.stringify(appId)
  const initialJson = JSON.stringify(initialData)
  const messageTypeJson = JSON.stringify(GENERATED_APP_STORAGE_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var MESSAGE_TYPE = ${messageTypeJson};
  var store = Object.create(null);
  var initial = ${initialJson};

  Object.keys(initial).forEach(function (key) {
    store[key] = initial[key];
  });

  var flushTimer = 0;

  function snapshot() {
    var copy = Object.create(null);
    Object.keys(store).forEach(function (key) {
      copy[key] = store[key];
    });
    return copy;
  }

  function flush() {
    flushTimer = 0;
    try {
      parent.postMessage({
        type: MESSAGE_TYPE,
        appId: APP_ID,
        data: snapshot()
      }, '*');
    } catch (error) {}
  }

  function scheduleFlush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flush, 200);
  }

  var shim = {
    get length() {
      return Object.keys(store).length;
    },
    key: function (index) {
      var keys = Object.keys(store);
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    getItem: function (key) {
      key = String(key);
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem: function (key, value) {
      store[String(key)] = String(value);
      scheduleFlush();
    },
    removeItem: function (key) {
      delete store[String(key)];
      scheduleFlush();
    },
    clear: function () {
      store = Object.create(null);
      scheduleFlush();
    }
  };

  try {
    Object.defineProperty(window, 'localStorage', {
      value: shim,
      configurable: false,
      enumerable: true,
      writable: false
    });
  } catch (error) {
    window.localStorage = shim;
  }

  window.addEventListener('beforeunload', flush);
})();
</script>`
}

export function injectGeneratedAppStorageBridge(
  html: string,
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildStorageBridgeScript(appId, initialData)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
