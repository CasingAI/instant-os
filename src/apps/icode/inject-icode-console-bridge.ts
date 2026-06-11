import { ICODE_CONSOLE_MESSAGE_TYPE } from './icode-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildConsoleBridgeScript(appId: GeneratedAppId): string {
  const appIdJson = JSON.stringify(appId)
  const messageTypeJson = JSON.stringify(ICODE_CONSOLE_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var MESSAGE_TYPE = ${messageTypeJson};
  var LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
  var NATIVES_KEY = '__instantIcodeConsoleNatives';

  function serializeArg(value) {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (value instanceof Error) {
      return value.stack || value.message || String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      try {
        return String(value);
      } catch (ignored) {
        return '[Unserializable]';
      }
    }
  }

  function formatArgs(args) {
    return Array.prototype.map.call(args, serializeArg).join(' ');
  }

  function emit(level, args) {
    try {
      parent.postMessage({
        type: MESSAGE_TYPE,
        appId: APP_ID,
        level: level,
        text: formatArgs(args),
        timestamp: Date.now()
      }, '*');
    } catch (error) {}
  }

  function captureNativeMethods() {
    var existing = window[NATIVES_KEY];
    if (existing) {
      return existing;
    }

    var nativeMethods = Object.create(null);

    LEVELS.forEach(function (level) {
      var method = console[level];
      if (typeof method === 'function') {
        nativeMethods[level] = Function.prototype.bind.call(method, console);
        return;
      }

      if (typeof console.log === 'function') {
        nativeMethods[level] = Function.prototype.bind.call(console.log, console);
      }
    });

    window[NATIVES_KEY] = nativeMethods;
    return nativeMethods;
  }

  function installConsoleBridge() {
    var nativeMethods = captureNativeMethods();

    LEVELS.forEach(function (level) {
      var native = nativeMethods[level];
      if (!native) {
        return;
      }

      console[level] = function () {
        emit(level, arguments);
        return native.apply(console, arguments);
      };
    });
  }

  installConsoleBridge();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installConsoleBridge, { once: true });
  }

  window.addEventListener('load', installConsoleBridge, { once: true });
})();
</script>`
}

export function injectIcodeConsoleBridge(html: string, appId: GeneratedAppId): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildConsoleBridgeScript(appId)

  let prepared = html

  if (/<head[\s>]/i.test(prepared)) {
    prepared = prepared.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  } else if (/<html[\s>]/i.test(prepared)) {
    prepared = prepared.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  } else {
    prepared = `<head>${bridge}</head>\n${prepared}`
  }

  return prepared
}
