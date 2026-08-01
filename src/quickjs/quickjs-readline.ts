import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const READLINE_BUNDLE_GLOBAL_KEY = '__instantReadlineBundle'
const READLINE_EE_GLOBAL_KEY = '__instantReadlineEE'

/**
 * 占位 `readline`：模块可加载；`createInterface` 返回薄接口，不读真实终端。
 * `question` 异步回调空串；`readline/promises` 的 `question` 返回 resolved ''。
 */
const QUICKJS_READLINE_GUEST_SOURCE = `(function () {
  'use strict';

  var EventEmitter = globalThis.${READLINE_EE_GLOBAL_KEY};

  function createInterface(options) {
    options = options || {};
    var iface = new EventEmitter();
    iface.input = options.input;
    iface.output = options.output;
    iface.terminal = options.terminal === true;
    iface.closed = false;
    iface._prompt = '';

    iface.close = function close() {
      if (iface.closed) {
        return;
      }
      iface.closed = true;
      iface.emit('close');
    };

    iface.pause = function pause() {
      return iface;
    };

    iface.resume = function resume() {
      return iface;
    };

    iface.setPrompt = function setPrompt(prompt) {
      iface._prompt = prompt == null ? '' : String(prompt);
      return iface;
    };

    iface.prompt = function prompt(preserveCursor) {
      return iface;
    };

    iface.write = function write(data, encoding, cb) {
      if (typeof encoding === 'function') {
        cb = encoding;
      }
      if (typeof cb === 'function') {
        globalThis.setTimeout(cb, 0);
      }
      return true;
    };

    iface.question = function question(query, cb) {
      if (typeof cb !== 'function') {
        return iface;
      }
      globalThis.setTimeout(function () {
        cb('');
      }, 0);
      return iface;
    };

    iface[Symbol.asyncIterator] = function asyncIterator() {
      var self = this;
      return {
        next: function () {
          return new Promise(function (resolve) {
            if (self.closed) {
              resolve({ value: undefined, done: true });
              return;
            }
            self.question('', function (answer) {
              resolve({ value: answer, done: false });
            });
          });
        },
      };
    };

    return iface;
  }

  var promises = {
    createInterface: function createInterfacePromises(options) {
      var rl = createInterface(options);
      return {
        question: function question(query) {
          return new Promise(function (resolve) {
            rl.question(query, resolve);
          });
        },
        close: function close() {
          rl.close();
        },
      };
    },
  };

  globalThis.${READLINE_BUNDLE_GLOBAL_KEY} = {
    createInterface: createInterface,
    promises: promises,
  };
})();
`

export function injectReadline(context: QuickJSContext, eventsHandle: QuickJSHandle): QuickJSHandle {
  context.setProp(context.global, READLINE_EE_GLOBAL_KEY, eventsHandle)
  const evalResult = context.evalCode(QUICKJS_READLINE_GUEST_SOURCE, 'instant-readline.js')
  context.setProp(context.global, READLINE_EE_GLOBAL_KEY, context.undefined)

  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'readline guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject readline: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, READLINE_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject readline: module object missing')
  }

  context.setProp(context.global, READLINE_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const READLINE_EXPORT_KEYS = ['createInterface', 'promises'] as const

export function buildReadlineModuleSource(builtinsGlobalKey: string): string {
  const named = READLINE_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.readline;\n${named}\nexport default __m;\n`
}

export function buildReadlinePromisesModuleSource(builtinsGlobalKey: string): string {
  return (
    `const __m = globalThis.${builtinsGlobalKey}.readline.promises;\n` +
    `export default __m;\n`
  )
}
