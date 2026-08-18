import {
  GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE,
  GENERATED_APP_STORAGE_MESSAGE_TYPE,
} from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import { APP_REGISTRY_QUOTA_BYTES } from '../../os/app-registry.ts'
import type { GeneratedAppId } from '../../os/types.ts'

export type GeneratedAppStorageQuota = {
  /** 该应用当前已用字节（宿主注入时的内存快照字节） */
  usedBytes: number
  /** 单应用上限（默认 5 MB） */
  limitBytes: number
}

function buildStorageBridgeScript(
  appId: GeneratedAppId,
  initialData: GeneratedAppDataStore,
  quota: GeneratedAppStorageQuota,
): string {
  const appIdJson = JSON.stringify(appId)
  const initialJson = JSON.stringify(initialData)
  const messageTypeJson = JSON.stringify(GENERATED_APP_STORAGE_MESSAGE_TYPE)
  const errorMessageTypeJson = JSON.stringify(GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var MESSAGE_TYPE = ${messageTypeJson};
  var ERROR_MESSAGE_TYPE = ${errorMessageTypeJson};
  var store = Object.create(null);
  var initial = ${initialJson};
  var QUOTA_LIMIT = ${quota.limitBytes};

  Object.keys(initial).forEach(function (key) {
    store[key] = initial[key];
  });

  var flushTimer = 0;

  function byteLen(value) {
    var length = 0;
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code < 0x80) {
        length += 1;
      } else if (code < 0x800) {
        length += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        var next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          length += 4;
          index += 1;
        } else {
          length += 3;
        }
      } else {
        length += 3;
      }
    }
    return length;
  }

  function storeBytes() {
    var total = 0;
    Object.keys(store).forEach(function (key) {
      total += byteLen(key) + byteLen(store[key]);
    });
    return total;
  }

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

  function restoreFailedKeys(payload) {
    var failed = payload.failedKeys || [];
    var previous = payload.previousSnapshot || {};
    var restored = false;
    for (var index = 0; index < failed.length; index += 1) {
      var key = failed[index];
      if (!Object.prototype.hasOwnProperty.call(previous, key)) {
        continue;
      }
      var value = previous[key];
      if (value === null || value === undefined) {
        delete store[key];
      } else {
        store[key] = value;
      }
      restored = true;
    }
    if (restored) {
      scheduleFlush();
    }
  }

  window.addEventListener('message', function (event) {
    var payload = event && event.data;
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (payload.type !== ERROR_MESSAGE_TYPE || payload.appId !== APP_ID) {
      return;
    }
    restoreFailedKeys(payload);
    var isQuota = payload.error === 'quota-exceeded';
    setTimeout(function () {
      throw new Error(
        '存储写入失败：' + (isQuota ? '应用数据超出 5 MB 配额' : '注册表写入失败')
      );
    }, 0);
  });

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
      key = String(key);
      value = String(value);
      var nextBytes = storeBytes() - byteLen(store[key] || '') + byteLen(value);
      if (nextBytes > QUOTA_LIMIT) {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      store[key] = value;
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
  quota: GeneratedAppStorageQuota = { usedBytes: 0, limitBytes: APP_REGISTRY_QUOTA_BYTES },
): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildStorageBridgeScript(appId, initialData, quota)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
