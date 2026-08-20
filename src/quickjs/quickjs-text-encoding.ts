import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const TMP_AB_KEY = '__instantTmpArrayBuffer'
const ENCODE_FN_KEY = '__instantTextEncode'
const DECODE_FN_KEY = '__instantTextDecode'

function copyHostBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function readGuestBytes(context: QuickJSContext, handle: QuickJSHandle): Uint8Array {
  try {
    const lifetime = context.getArrayBuffer(handle)
    try {
      return new Uint8Array(lifetime.value)
    } finally {
      lifetime.dispose()
    }
  } catch {
    // TypedArray / DataView：取底层 buffer + offset/length
  }

  let bufferHandle: QuickJSHandle | undefined
  let offsetHandle: QuickJSHandle | undefined
  let lengthHandle: QuickJSHandle | undefined
  try {
    bufferHandle = context.getProp(handle, 'buffer')
    if (context.typeof(bufferHandle) === 'undefined') {
      throw new TypeError('The "input" argument must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer')
    }
    offsetHandle = context.getProp(handle, 'byteOffset')
    lengthHandle = context.getProp(handle, 'byteLength')
    const offset = context.typeof(offsetHandle) === 'number' ? context.getNumber(offsetHandle) : 0
    const length =
      context.typeof(lengthHandle) === 'number' ? context.getNumber(lengthHandle) : undefined
    const lifetime = context.getArrayBuffer(bufferHandle)
    try {
      const view = lifetime.value
      if (length === undefined) {
        return new Uint8Array(view.subarray(offset))
      }
      return new Uint8Array(view.subarray(offset, offset + length))
    } finally {
      lifetime.dispose()
    }
  } finally {
    lengthHandle?.dispose()
    offsetHandle?.dispose()
    bufferHandle?.dispose()
  }
}

function hostBytesToGuestUint8Array(context: QuickJSContext, bytes: Uint8Array): QuickJSHandle {
  const abHandle = context.newArrayBuffer(copyHostBytes(bytes))
  context.setProp(context.global, TMP_AB_KEY, abHandle)
  abHandle.dispose()
  try {
    return context.unwrapResult(
      context.evalCode(`new Uint8Array(globalThis.${TMP_AB_KEY})`, 'instant-text-encode-wrap.js'),
    )
  } finally {
    context.setProp(context.global, TMP_AB_KEY, context.undefined)
  }
}

/**
 * 用宿主原生 TextEncoder/TextDecoder 桥接注入 guest 全局（仅 UTF-8）。
 */
export function injectTextEncoding(context: QuickJSContext): void {
  const encodeFn = context.newFunction(ENCODE_FN_KEY, (inputHandle) => {
    let text = ''
    try {
      const dumped = context.dump(inputHandle)
      text = dumped === undefined || dumped === null ? '' : String(dumped)
    } catch {
      text = context.getString(inputHandle)
    }
    const bytes = new TextEncoder().encode(text)
    return hostBytesToGuestUint8Array(context, bytes)
  })
  context.setProp(context.global, ENCODE_FN_KEY, encodeFn)
  encodeFn.dispose()

  const decodeFn = context.newFunction(DECODE_FN_KEY, (inputHandle) => {
    if (context.typeof(inputHandle) === 'undefined') {
      return context.newString('')
    }
    // null
    try {
      if (context.dump(inputHandle) === null) {
        return context.newString('')
      }
    } catch {
      // continue
    }
    const bytes = readGuestBytes(context, inputHandle)
    return context.newString(new TextDecoder('utf-8').decode(bytes))
  })
  context.setProp(context.global, DECODE_FN_KEY, decodeFn)
  decodeFn.dispose()

  const boot = context.evalCode(
    `
(function () {
  function assertUtf8(label) {
    if (label === undefined || label === null || label === '') return;
    var n = String(label).trim().toLowerCase().replace(/[_ ]/g, '-');
    if (n === 'utf-8' || n === 'utf8') return;
    throw new RangeError(
      "The encoding label provided ('" + label + "') is invalid or unsupported. Instant TextEncoder/TextDecoder only support utf-8."
    );
  }

  function TextEncoder(label) {
    assertUtf8(label);
    this.encoding = 'utf-8';
  }
  TextEncoder.prototype.encode = function (input) {
    return globalThis.${ENCODE_FN_KEY}(input == null ? '' : String(input));
  };

  function TextDecoder(label, options) {
    assertUtf8(label);
    this.encoding = 'utf-8';
    this.fatal = !!(options && options.fatal);
    this.ignoreBOM = !!(options && options.ignoreBOM);
  }
  TextDecoder.prototype.decode = function (input) {
    if (input == null) return '';
    return globalThis.${DECODE_FN_KEY}(input);
  };

  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
})();
`,
    'instant-text-encoding.js',
  )
  if (boot.error) {
    const message = (() => {
      try {
        return String(context.dump(boot.error))
      } catch {
        return 'text encoding boot failed'
      } finally {
        boot.error.dispose()
      }
    })()
    throw new Error(`Failed to inject TextEncoder/TextDecoder: ${message}`)
  }
  boot.value.dispose()
}
