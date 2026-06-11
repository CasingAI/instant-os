import {
  GENERATED_APP_AI_BASE_URL,
  GENERATED_APP_AI_REQUEST_MESSAGE_TYPE,
  GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE,
  GENERATED_APP_AI_STREAM_MESSAGE_TYPE,
} from './generated-app-ai-types.ts'
import type { GeneratedAppId } from '../../os/types.ts'

type InjectGeneratedAppAiBridgeOptions = {
  debug?: boolean
}

function buildAiBridgeScript(appId: GeneratedAppId, debug: boolean): string {
  const appIdJson = JSON.stringify(appId)
  const baseUrlJson = JSON.stringify(GENERATED_APP_AI_BASE_URL)
  const requestTypeJson = JSON.stringify(GENERATED_APP_AI_REQUEST_MESSAGE_TYPE)
  const responseTypeJson = JSON.stringify(GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE)
  const streamTypeJson = JSON.stringify(GENERATED_APP_AI_STREAM_MESSAGE_TYPE)
  const streamEndTypeJson = JSON.stringify(GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE)
  const debugJson = debug ? 'true' : 'false'

  return `<script>
(function () {
  var APP_ID = ${appIdJson};
  var AI_BASE = ${baseUrlJson};
  var REQUEST_TYPE = ${requestTypeJson};
  var RESPONSE_TYPE = ${responseTypeJson};
  var STREAM_TYPE = ${streamTypeJson};
  var STREAM_END_TYPE = ${streamEndTypeJson};
  var AI_DEBUG = ${debugJson};
  var pending = Object.create(null);
  var requestSeq = 0;
  var LOG_PREFIX = '[instant-ai-bridge]';

  function aiDebugLog() {
    if (!AI_DEBUG) {
      return;
    }
    console.log.apply(console, arguments);
  }

  function aiDebugWarn() {
    if (!AI_DEBUG) {
      return;
    }
    console.warn.apply(console, arguments);
  }

  function isAiUrl(url) {
    try {
      var parsed = new URL(url, AI_BASE);
      return parsed.origin === new URL(AI_BASE).origin && parsed.pathname.indexOf('/v1/') === 0;
    } catch (error) {
      return false;
    }
  }

  function resolvePath(url) {
    return new URL(url, AI_BASE).pathname;
  }

  function settleJson(requestId, status, bodyText) {
    var entry = pending[requestId];
    if (!entry) {
      return;
    }
    delete pending[requestId];

    if (status < 200 || status >= 300) {
      var message = bodyText;
      try {
        var parsed = JSON.parse(bodyText);
        message = parsed && parsed.error && parsed.error.message ? parsed.error.message : bodyText;
      } catch (ignored) {}
      entry.reject(new Error(message || ('HTTP ' + status)));
      return;
    }

    entry.resolve(
      new Response(bodyText, {
        status: status,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }

  function settleStreamEnd(requestId, status, errorMessage) {
    var entry = pending[requestId];
    if (!entry || !entry.controller) {
      return;
    }
    delete pending[requestId];

    if (errorMessage) {
      try {
        entry.controller.error(new Error(errorMessage));
      } catch (ignored) {}
      return;
    }

    if (status < 200 || status >= 300) {
      try {
        entry.controller.error(new Error('HTTP ' + status));
      } catch (ignored) {}
      return;
    }

    try {
      entry.controller.close();
    } catch (ignored) {}
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.appId !== APP_ID) {
      return;
    }

    if (data.type === RESPONSE_TYPE) {
      settleJson(data.requestId, data.status, data.body);
      return;
    }

    if (data.type === STREAM_TYPE) {
      var streamEntry = pending[data.requestId];
      if (!streamEntry || !streamEntry.controller) {
        aiDebugWarn(LOG_PREFIX, 'stream chunk dropped (no pending entry)', data.requestId);
        return;
      }
      try {
        streamEntry.controller.enqueue(new TextEncoder().encode(data.chunk));
        aiDebugLog(LOG_PREFIX, 'stream chunk enqueued', data.requestId, data.chunk.length);
      } catch (error) {
        aiDebugWarn(LOG_PREFIX, 'stream chunk enqueue failed', data.requestId, error);
      }
      return;
    }

    if (data.type === STREAM_END_TYPE) {
      aiDebugLog(LOG_PREFIX, 'stream end', data.requestId, data.status, data.error || '');
      settleStreamEnd(data.requestId, data.status, data.error);
    }
  });

  function sanitizeCompletionBody(value) {
    if (!value || typeof value !== 'object') {
      return value;
    }
    var copy = Object.assign({}, value);
    delete copy.model;
    delete copy.thinking;
    delete copy.stream_options;
    return copy;
  }

  function sanitizeCompletionBodyText(bodyText) {
    if (!bodyText) {
      return bodyText;
    }
    try {
      return JSON.stringify(sanitizeCompletionBody(JSON.parse(bodyText)));
    } catch (ignored) {
      return bodyText;
    }
  }

  function proxyFetch(url, init) {
    return new Promise(function (resolve, reject) {
      var requestId = 'ai-' + String(++requestSeq);
      var method = init && init.method ? String(init.method).toUpperCase() : 'GET';
      var bodyText = init && init.body != null ? sanitizeCompletionBodyText(String(init.body)) : undefined;
      var streaming = false;

      if (bodyText) {
        try {
          streaming = !!JSON.parse(bodyText).stream;
        } catch (ignored) {}
      }

      if (streaming) {
        var stream = new ReadableStream({
          start: function (controller) {
            pending[requestId] = { resolve: resolve, reject: reject, controller: controller };
          }
        });
        resolve(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
          })
        );
      } else {
        pending[requestId] = { resolve: resolve, reject: reject };
      }

      try {
        aiDebugLog(LOG_PREFIX, 'request', requestId, method, resolvePath(url), streaming ? 'stream' : 'json');
        parent.postMessage(
          {
            type: REQUEST_TYPE,
            appId: APP_ID,
            requestId: requestId,
            path: resolvePath(url),
            method: method,
            body: bodyText,
            debug: AI_DEBUG ? true : undefined
          },
          '*'
        );
      } catch (error) {
        delete pending[requestId];
        reject(error);
      }
    });
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    if (isAiUrl(url)) {
      return proxyFetch(url, init);
    }
    return nativeFetch(input, init);
  };

  function OpenAI(options) {
    options = options || {};
    var baseURL = String(options.baseURL || AI_BASE).replace(/\\/$/, '');
    var apiKey = options.apiKey || 'instant';
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.chat = {
      completions: {
        create: function (params) {
          return fetch(baseURL + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + apiKey
            },
            body: JSON.stringify(sanitizeCompletionBody(params || {}))
          }).then(function (response) {
            if (!response.ok) {
              return response.text().then(function (text) {
                var message = text;
                try {
                  var parsed = JSON.parse(text);
                  message =
                    parsed && parsed.error && parsed.error.message ? parsed.error.message : text;
                } catch (ignored) {}
                throw new Error(message || ('HTTP ' + response.status));
              });
            }

            if (params && params.stream) {
              return createChatCompletionStream(response.body);
            }

            return response.json();
          });
        }
      }
    };
  }

  function createChatCompletionStream(body) {
    if (!body || typeof body.getReader !== 'function') {
      throw new Error('流式响应不可用');
    }

    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    return {
      [Symbol.asyncIterator]: function () {
        return {
          next: function () {
            return readChunk();
          }
        };
      }
    };

    function parseSseBlock(block) {
      var lines = block.split('\\n');
      for (var index = 0; index < lines.length; index += 1) {
        var line = lines[index].trim();
        if (!line || line.indexOf('data:') !== 0) {
          continue;
        }
        var payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return { done: true };
        }
        try {
          return { done: false, value: JSON.parse(payload) };
        } catch (ignored) {}
      }
      return undefined;
    }

    function readChunk() {
      return reader.read().then(function (result) {
        if (result.done) {
          return { done: true, value: undefined };
        }

        buffer += decoder.decode(result.value, { stream: true });
        var parts = buffer.split('\\n\\n');
        buffer = parts.pop() || '';

        for (var index = 0; index < parts.length; index += 1) {
          var parsed = parseSseBlock(parts[index]);
          if (!parsed) {
            continue;
          }
          if (parsed.done) {
            return { done: true, value: undefined };
          }
          return { done: false, value: parsed.value };
        }

        return readChunk();
      });
    }
  }

  window.OpenAI = OpenAI;
  window.__INSTANT_AI_BASE_URL__ = AI_BASE;
})();
</script>`
}

export function injectGeneratedAppAiBridge(
  html: string,
  appId: GeneratedAppId,
  options: InjectGeneratedAppAiBridgeOptions = {},
): string {
  if (!html.trim()) {
    return html
  }

  const bridge = buildAiBridgeScript(appId, options.debug === true)

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${bridge}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${bridge}</head>`)
  }

  return `<head>${bridge}</head>\n${html}`
}
