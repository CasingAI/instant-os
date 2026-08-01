import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const STREAM_BUNDLE_GLOBAL_KEY = '__instantStreamBundle'
const STREAM_EE_GLOBAL_KEY = '__instantStreamEE'

/**
 * 极薄 `stream`：Readable / Writable / Duplex / Transform / PassThrough + 最小 `finished` / `pipeline`。
 * 不做背压、fd 流、完整 Node streams 矩阵。
 */
const QUICKJS_STREAM_GUEST_SOURCE = `(function () {
  'use strict';

  var EventEmitter = globalThis.${STREAM_EE_GLOBAL_KEY};

  function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  }

  function Stream() {
    EventEmitter.call(this);
  }
  inherits(Stream, EventEmitter);

  function Readable(options) {
    Stream.call(this);
    this.readable = true;
    this.readableEnded = false;
    this._readableState = { ended: false };
    if (options && typeof options.read === 'function') {
      this._read = options.read;
    }
  }
  inherits(Readable, Stream);

  Readable.prototype.read = function read(n) {
    return null;
  };

  Readable.prototype.push = function push(chunk, encoding) {
    if (chunk === null) {
      this._readableState.ended = true;
      this.readableEnded = true;
      this.emit('end');
      this.emit('readable');
      return false;
    }
    if (chunk !== undefined) {
      this.emit('data', chunk);
      this.emit('readable');
    }
    return true;
  };

  Readable.prototype.pipe = function pipe(dest, options) {
    var self = this;
    function onData(chunk) {
      if (dest && dest.writable && typeof dest.write === 'function') {
        dest.write(chunk);
      }
    }
    function onEnd() {
      if (dest && typeof dest.end === 'function') {
        dest.end();
      }
    }
    self.on('data', onData);
    self.on('end', onEnd);
    if (dest && typeof dest.on === 'function') {
      dest.on('error', function (err) {
        self.emit('error', err);
      });
    }
    return dest;
  };

  Readable.prototype.destroy = function destroy(err) {
    if (err) {
      this.emit('error', err);
    }
    this.emit('close');
    return this;
  };

  function Writable(options) {
    Stream.call(this);
    this.writable = true;
    this.writableEnded = false;
    if (options && typeof options.write === 'function') {
      this._write = options.write;
    }
  }
  inherits(Writable, Stream);

  Writable.prototype.write = function write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
    if (typeof cb === 'function') {
      globalThis.setTimeout(cb, 0);
    }
    return true;
  };

  Writable.prototype.end = function end(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding);
    }
    this.writable = false;
    this.writableEnded = true;
    this.emit('finish');
    this.emit('end');
    if (typeof cb === 'function') {
      globalThis.setTimeout(cb, 0);
    }
    return this;
  };

  Writable.prototype.destroy = function destroy(err) {
    if (err) {
      this.emit('error', err);
    }
    this.emit('close');
    return this;
  };

  function Duplex(options) {
    Readable.call(this, options);
    Writable.call(this, options);
    this.readable = true;
    this.writable = true;
  }
  inherits(Duplex, Readable);
  Duplex.prototype.write = Writable.prototype.write;
  Duplex.prototype.end = Writable.prototype.end;
  Duplex.prototype.destroy = Writable.prototype.destroy;

  function Transform(options) {
    Duplex.call(this, options);
    if (options && typeof options.transform === 'function') {
      this._transform = options.transform;
    }
  }
  inherits(Transform, Duplex);

  function PassThrough(options) {
    Transform.call(this, options);
  }
  inherits(PassThrough, Transform);

  function finished(stream, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    if (typeof cb !== 'function') {
      return;
    }
    if (stream.readableEnded || stream.writableEnded) {
      globalThis.setTimeout(function () {
        cb();
      }, 0);
      return;
    }
    var done = false;
    function finish(err) {
      if (done) {
        return;
      }
      done = true;
      stream.removeListener('end', onEnd);
      stream.removeListener('finish', onEnd);
      stream.removeListener('error', onError);
      cb(err);
    }
    function onEnd() {
      finish();
    }
    function onError(err) {
      finish(err);
    }
    stream.on('end', onEnd);
    stream.on('finish', onEnd);
    stream.on('error', onError);
  }

  function pipeline() {
    var args = Array.prototype.slice.call(arguments);
    var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (cb) {
      globalThis.setTimeout(function () {
        cb();
      }, 0);
      return;
    }
    return Promise.resolve();
  }

  var promises = {
    pipeline: function pipelinePromise() {
      return Promise.resolve();
    },
  };

  Stream.Stream = Stream;
  Readable.Readable = Readable;
  Writable.Writable = Writable;
  Duplex.Duplex = Duplex;
  Transform.Transform = Transform;
  PassThrough.PassThrough = PassThrough;

  globalThis.${STREAM_BUNDLE_GLOBAL_KEY} = {
    Stream: Stream,
    Readable: Readable,
    Writable: Writable,
    Duplex: Duplex,
    Transform: Transform,
    PassThrough: PassThrough,
    finished: finished,
    pipeline: pipeline,
    promises: promises,
  };
})();
`

export function injectStream(context: QuickJSContext, eventsHandle: QuickJSHandle): QuickJSHandle {
  context.setProp(context.global, STREAM_EE_GLOBAL_KEY, eventsHandle)
  const evalResult = context.evalCode(QUICKJS_STREAM_GUEST_SOURCE, 'instant-stream.js')
  context.setProp(context.global, STREAM_EE_GLOBAL_KEY, context.undefined)

  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'stream guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject stream: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, STREAM_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject stream: module object missing')
  }

  context.setProp(context.global, STREAM_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const STREAM_EXPORT_KEYS = [
  'Stream',
  'Readable',
  'Writable',
  'Duplex',
  'Transform',
  'PassThrough',
  'finished',
  'pipeline',
  'promises',
] as const

export function buildStreamModuleSource(builtinsGlobalKey: string): string {
  const named = STREAM_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return `const __m = globalThis.${builtinsGlobalKey}.stream;\n${named}\nexport default __m;\n`
}
