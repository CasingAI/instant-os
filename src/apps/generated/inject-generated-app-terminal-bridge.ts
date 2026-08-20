import {
  GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE,
  GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
} from './generated-app-terminal-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildTerminalBridgeScript(appId: GeneratedAppId): string {
  const appIdJson = JSON.stringify(appId)
  const requestTypeJson = JSON.stringify(GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE)
  const responseTypeJson = JSON.stringify(GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE)
  const eventTypeJson = JSON.stringify(GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var REQUEST_TYPE = ${requestTypeJson};
  var RESPONSE_TYPE = ${responseTypeJson};
  var EVENT_TYPE = ${eventTypeJson};
  var pending = Object.create(null);
  var requestSeq = 0;
  var listeners = Object.create(null);

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.appId !== APP_ID) {
      return;
    }
    if (data.type === EVENT_TYPE) {
      var list = listeners[data.sessionId];
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        try { list[i](data.event); } catch (err) {}
      }
      return;
    }
    if (data.type !== RESPONSE_TYPE) {
      return;
    }
    var entry = pending[data.requestId];
    if (!entry) {
      return;
    }
    delete pending[data.requestId];
    if (data.ok) {
      entry.resolve(data.result);
      return;
    }
    entry.reject(new Error(data.error || '终端操作失败'));
  });

  function call(op, fields) {
    return new Promise(function (resolve, reject) {
      requestSeq += 1;
      var requestId = 'terminal-' + requestSeq;
      pending[requestId] = { resolve: resolve, reject: reject };
      var message = {
        type: REQUEST_TYPE,
        appId: APP_ID,
        requestId: requestId,
        op: op
      };
      if (fields) {
        if (fields.sessionId !== undefined) message.sessionId = fields.sessionId;
        if (fields.line !== undefined) message.line = fields.line;
        if (fields.text !== undefined) message.text = fields.text;
        if (fields.path !== undefined) message.path = fields.path;
        if (fields.initialCwd !== undefined) message.initialCwd = fields.initialCwd;
        if (fields.thinkingEnabled !== undefined) message.thinkingEnabled = fields.thinkingEnabled;
      }
      try {
        parent.postMessage(message, '*');
      } catch (error) {
        delete pending[requestId];
        reject(error);
      }
    });
  }

  var terminal = {
    createSession: function (options) {
      options = options || {};
      return call('createSession', {
        initialCwd: options.initialCwd,
        thinkingEnabled: options.thinkingEnabled
      }).then(function (result) {
        return result && result.sessionId;
      });
    },
    destroySession: function (sessionId) {
      return call('destroySession', { sessionId: sessionId });
    },
    exec: function (sessionId, line) {
      return call('exec', { sessionId: sessionId, line: line });
    },
    write: function (sessionId, text) {
      return call('write', { sessionId: sessionId, text: text });
    },
    abort: function (sessionId) {
      return call('abort', { sessionId: sessionId });
    },
    clear: function (sessionId) {
      return call('clear', { sessionId: sessionId });
    },
    getCwd: function (sessionId) {
      return call('getCwd', { sessionId: sessionId }).then(function (result) {
        return result && result.cwd;
      });
    },
    cd: function (sessionId, path) {
      return call('cd', { sessionId: sessionId, path: path }).then(function (result) {
        return result && result.cwd;
      });
    },
    subscribe: function (sessionId, listener) {
      if (typeof listener !== 'function') {
        throw new Error('listener 必须是函数');
      }
      if (!listeners[sessionId]) listeners[sessionId] = [];
      listeners[sessionId].push(listener);
      return function () {
        var list = listeners[sessionId];
        if (!list) return;
        var next = [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] !== listener) next.push(list[i]);
        }
        if (next.length) listeners[sessionId] = next;
        else delete listeners[sessionId];
      };
    }
  };

  var root = window.InstantOS;
  if (!root || typeof root !== 'object') {
    root = {};
    try {
      Object.defineProperty(window, 'InstantOS', {
        value: root,
        configurable: true,
        enumerable: true,
        writable: true
      });
    } catch (error) {
      window.InstantOS = root;
    }
  }
  root.terminal = terminal;
  window.__INSTANT_TERMINAL__ = terminal;
})();
</script>`
}

export function injectGeneratedAppTerminalBridge(html: string, appId: GeneratedAppId): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildTerminalBridgeScript(appId)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  return `${bridge}\n${html}`
}
