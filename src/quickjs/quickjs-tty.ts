import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const TTY_BUNDLE_GLOBAL_KEY = '__instantTtyBundle'

/**
 * 假 `tty`：与 Instant process 的 isTTY 策略对齐。
 * - fd 0 (stdin) → true（避免 get-stdin 挂起）
 * - fd 1/2 (stdout/stderr) → false（避免颜色 / 交互分支）
 * - 其它 → false
 * 不做真实终端读写。
 */
const QUICKJS_TTY_GUEST_SOURCE = `(function () {
  'use strict';

  function isatty(fd) {
    var n = Number(fd);
    if (n === 0) {
      return true;
    }
    return false;
  }

  function ReadStream() {
    this.isTTY = true;
  }
  ReadStream.prototype.on = function on() {
    return this;
  };
  ReadStream.prototype.once = function once() {
    return this;
  };
  ReadStream.prototype.off = function off() {
    return this;
  };
  ReadStream.prototype.setRawMode = function setRawMode() {
    return this;
  };

  function WriteStream() {
    this.isTTY = false;
    this.columns = 80;
    this.rows = 24;
  }
  WriteStream.prototype.on = function on() {
    return this;
  };
  WriteStream.prototype.once = function once() {
    return this;
  };
  WriteStream.prototype.off = function off() {
    return this;
  };
  WriteStream.prototype.write = function write() {
    return true;
  };
  WriteStream.prototype.getWindowSize = function getWindowSize() {
    return [this.columns, this.rows];
  };

  globalThis.${TTY_BUNDLE_GLOBAL_KEY} = {
    isatty: isatty,
    ReadStream: ReadStream,
    WriteStream: WriteStream,
  };
})();
`

export function injectTty(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_TTY_GUEST_SOURCE, 'instant-tty.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'tty guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject tty: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, TTY_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject tty: module object missing')
  }

  context.setProp(context.global, TTY_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const TTY_EXPORT_KEYS = ['isatty', 'ReadStream', 'WriteStream'] as const

export function buildTtyModuleSource(builtinsGlobalKey: string): string {
  const named = TTY_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.tty;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
