import {
  GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
} from './generated-app-files-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

function buildFilesBridgeScript(appId: GeneratedAppId): string {
  const appIdJson = JSON.stringify(appId)
  const requestTypeJson = JSON.stringify(GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE)
  const responseTypeJson = JSON.stringify(GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE)

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var REQUEST_TYPE = ${requestTypeJson};
  var RESPONSE_TYPE = ${responseTypeJson};
  var pending = Object.create(null);
  var requestSeq = 0;

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.appId !== APP_ID || data.type !== RESPONSE_TYPE) {
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
    entry.reject(new Error(data.error || '文件操作失败'));
  });

  function call(op, fields) {
    return new Promise(function (resolve, reject) {
      requestSeq += 1;
      var requestId = 'files-' + requestSeq;
      pending[requestId] = { resolve: resolve, reject: reject };
      var message = {
        type: REQUEST_TYPE,
        appId: APP_ID,
        requestId: requestId,
        op: op
      };
      if (fields) {
        if (fields.path !== undefined) message.path = fields.path;
        if (fields.text !== undefined) message.text = fields.text;
        if (fields.nextName !== undefined) message.nextName = fields.nextName;
      }
      try {
        parent.postMessage(message, '*');
      } catch (error) {
        delete pending[requestId];
        reject(error);
      }
    });
  }

  var files = {
    listVolumes: function () {
      return call('listVolumes');
    },
    list: function (path) {
      return call('list', { path: path });
    },
    stat: function (path) {
      return call('stat', { path: path });
    },
    readText: function (path) {
      return call('readText', { path: path });
    },
    writeText: function (path, text) {
      return call('writeText', { path: path, text: text });
    },
    mkdir: function (path) {
      return call('mkdir', { path: path });
    },
    createText: function (path, text) {
      return call('createText', { path: path, text: text == null ? '' : text });
    },
    rename: function (path, nextName) {
      return call('rename', { path: path, nextName: nextName });
    },
    remove: function (path) {
      return call('remove', { path: path });
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
  root.files = files;
  window.__INSTANT_FILES__ = files;
})();
</script>`
}

export function injectGeneratedAppFilesBridge(html: string, appId: GeneratedAppId): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildFilesBridgeScript(appId)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
