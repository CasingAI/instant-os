import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

const STREAM_BUNDLE_GLOBAL_KEY = '__instantStreamBundle'
const STREAM_EE_GLOBAL_KEY = '__instantStreamEE'

/**
 * 有限背压 stream：Readable / Writable / Duplex / Transform / PassThrough +
 * 最小 finished / pipeline。pipe 在 write 返回 false 时 pause，drain 后 resume。
 * 不做对象模式完整矩阵、cork、fd 流。
 */
const QUICKJS_STREAM_GUEST_SOURCE = `(function () {
  'use strict';

  var EventEmitter = globalThis.${STREAM_EE_GLOBAL_KEY};
  var DEFAULT_HWM = 16 * 1024;

  function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  }

  function chunkLength(chunk) {
    if (chunk == null) return 0;
    if (typeof chunk === 'string') return chunk.length;
    if (typeof chunk.length === 'number') return chunk.length;
    if (typeof chunk.byteLength === 'number') return chunk.byteLength;
    return 1;
  }

  function Stream() {
    EventEmitter.call(this);
  }
  inherits(Stream, EventEmitter);

  function Readable(options) {
    Stream.call(this);
    options = options || {};
    this.readable = true;
    this.readableEnded = false;
    this.destroyed = false;
    this._readableState = {
      ended: false,
      flowing: null,
      highWaterMark: typeof options.highWaterMark === 'number' ? options.highWaterMark : DEFAULT_HWM,
      buffer: [],
      length: 0,
      reading: false,
      emittedReadable: false,
    };
    if (typeof options.read === 'function') {
      this._read = options.read;
    }
  }
  inherits(Readable, Stream);

  Readable.prototype._read = function _read() {};

  Readable.prototype.push = function push(chunk, encoding) {
    var state = this._readableState;
    if (chunk === null) {
      state.ended = true;
      this.readableEnded = true;
      if (state.flowing) {
        this.emit('end');
      } else {
        this.emit('readable');
      }
      return false;
    }
    if (chunk !== undefined) {
      state.buffer.push(chunk);
      state.length += chunkLength(chunk);
      if (state.flowing) {
        this.emit('data', chunk);
        state.buffer.shift();
        state.length -= chunkLength(chunk);
      } else {
        this.emit('readable');
      }
    }
    return state.length < state.highWaterMark;
  };

  Readable.prototype.read = function read(n) {
    var state = this._readableState;
    if (state.buffer.length === 0) {
      if (!state.ended && !state.reading) {
        state.reading = true;
        try {
          this._read(state.highWaterMark);
        } finally {
          state.reading = false;
        }
      }
      return null;
    }
    var chunk = state.buffer.shift();
    state.length -= chunkLength(chunk);
    if (!state.ended && state.length < state.highWaterMark && !state.reading) {
      state.reading = true;
      try {
        this._read(state.highWaterMark);
      } finally {
        state.reading = false;
      }
    }
    return chunk;
  };

  Readable.prototype.pause = function pause() {
    this._readableState.flowing = false;
    return this;
  };

  Readable.prototype.resume = function resume() {
    var state = this._readableState;
    state.flowing = true;
    while (state.buffer.length > 0 && state.flowing) {
      var chunk = state.buffer.shift();
      state.length -= chunkLength(chunk);
      this.emit('data', chunk);
    }
    if (state.ended && state.buffer.length === 0) {
      this.emit('end');
    } else if (!state.ended && !state.reading) {
      state.reading = true;
      try {
        this._read(state.highWaterMark);
      } finally {
        state.reading = false;
      }
    }
    return this;
  };

  Readable.prototype.isPaused = function isPaused() {
    return this._readableState.flowing === false;
  };

  Readable.prototype.on = function on(type, listener) {
    EventEmitter.prototype.on.call(this, type, listener);
    if (type === 'data' && this._readableState.flowing !== false) {
      this.resume();
    }
    return this;
  };

  Readable.prototype.pipe = function pipe(dest, options) {
    var self = this;
    function onData(chunk) {
      var ok = true;
      if (dest && dest.writable !== false && typeof dest.write === 'function') {
        ok = dest.write(chunk);
      }
      if (ok === false) {
        self.pause();
      }
    }
    function onDrain() {
      self.resume();
    }
    function onEnd() {
      if (dest && typeof dest.end === 'function') {
        dest.end();
      }
      cleanup();
    }
    function onError(err) {
      cleanup();
      if (EventEmitter.listenerCount(self, 'error') === 0) {
        throw err;
      }
    }
    function cleanup() {
      self.removeListener('data', onData);
      self.removeListener('end', onEnd);
      self.removeListener('error', onError);
      if (dest && typeof dest.removeListener === 'function') {
        dest.removeListener('drain', onDrain);
        dest.removeListener('error', onError);
      }
    }
    self.on('data', onData);
    self.on('end', onEnd);
    self.on('error', onError);
    if (dest && typeof dest.on === 'function') {
      dest.on('drain', onDrain);
      dest.on('error', onError);
    }
    self.resume();
    return dest;
  };

  Readable.prototype.destroy = function destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  };

  function Writable(options) {
    Stream.call(this);
    options = options || {};
    this.writable = true;
    this.writableEnded = false;
    this.destroyed = false;
    this._writableState = {
      ended: false,
      highWaterMark: typeof options.highWaterMark === 'number' ? options.highWaterMark : DEFAULT_HWM,
      length: 0,
      writing: false,
      needDrain: false,
      corked: 0,
      queue: [],
      ending: false,
    };
    if (typeof options.write === 'function') {
      this._write = options.write;
    }
  }
  inherits(Writable, Stream);

  Writable.prototype._write = function _write(chunk, encoding, cb) {
    if (typeof cb === 'function') cb();
  };

  Writable.prototype.write = function write(chunk, encoding, cb) {
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
    var state = this._writableState;
    if (state.ended || this.destroyed) {
      var err = new Error('write after end');
      if (typeof cb === 'function') {
        globalThis.setTimeout(function () {
          cb(err);
        }, 0);
      } else {
        this.emit('error', err);
      }
      return false;
    }
    state.length += chunkLength(chunk);
    state.queue.push({ chunk: chunk, encoding: encoding, cb: cb });
    this._writeNext();
    if (state.length >= state.highWaterMark) {
      state.needDrain = true;
      return false;
    }
    return true;
  };

  Writable.prototype._writeNext = function _writeNext() {
    var state = this._writableState;
    if (state.writing || state.queue.length === 0) {
      if (!state.writing && state.ending && state.queue.length === 0) {
        this.emit('__writeIdle');
      }
      return;
    }
    var item = state.queue.shift();
    var self = this;
    state.writing = true;
    this._write(item.chunk, item.encoding, function (err) {
      state.writing = false;
      state.length -= chunkLength(item.chunk);
      if (err) {
        self.emit('error', err);
        if (typeof item.cb === 'function') item.cb(err);
        return;
      }
      if (typeof item.cb === 'function') item.cb();
      if (state.needDrain && state.length < state.highWaterMark) {
        state.needDrain = false;
        self.emit('drain');
      }
      self._writeNext();
    });
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
    var self = this;
    var state = this._writableState;
    state.ending = true;
    function finish() {
      if (state.writing || state.queue.length > 0) {
        self.once('__writeIdle', finish);
        return;
      }
      self.writable = false;
      self.writableEnded = true;
      state.ended = true;
      self.emit('finish');
      self.emit('end');
      if (typeof cb === 'function') cb();
    }
    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding, function (err) {
        if (err) {
          if (typeof cb === 'function') cb(err);
          return;
        }
        finish();
      });
    } else {
      this._writeNext();
      finish();
    }
    return this;
  };

  Writable.prototype.cork = function cork() {
    this._writableState.corked += 1;
    return this;
  };
  Writable.prototype.uncork = function uncork() {
    if (this._writableState.corked > 0) this._writableState.corked -= 1;
    return this;
  };

  Writable.prototype.destroy = function destroy(err) {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;
    if (err) this.emit('error', err);
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
  Duplex.prototype._writeNext = Writable.prototype._writeNext;
  Duplex.prototype.end = Writable.prototype.end;
  Duplex.prototype.cork = Writable.prototype.cork;
  Duplex.prototype.uncork = Writable.prototype.uncork;
  Duplex.prototype.destroy = function destroy(err) {
    Readable.prototype.destroy.call(this, err);
    return this;
  };
  Duplex.prototype._write = Writable.prototype._write;

  function Transform(options) {
    Duplex.call(this, options);
    options = options || {};
    if (typeof options.transform === 'function') {
      this._transform = options.transform;
    }
    if (typeof options.flush === 'function') {
      this._flush = options.flush;
    }
  }
  inherits(Transform, Duplex);

  Transform.prototype._transform = function _transform(chunk, encoding, cb) {
    cb(null, chunk);
  };
  Transform.prototype._flush = function _flush(cb) {
    cb();
  };

  Transform.prototype._write = function _write(chunk, encoding, cb) {
    var self = this;
    this._transform(chunk, encoding, function (err, data) {
      if (err) {
        cb(err);
        return;
      }
      if (data !== undefined && data !== null) {
        self.push(data);
      }
      cb();
    });
  };

  Transform.prototype.end = function end(chunk, encoding, cb) {
    var self = this;
    var state = this._writableState;
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
    state.ending = true;

    function afterFlush(err) {
      if (err) {
        self.emit('error', err);
        if (typeof cb === 'function') cb(err);
        return;
      }
      self.push(null);
      self.writable = false;
      self.writableEnded = true;
      state.ended = true;
      self.emit('finish');
      self.emit('end');
      if (typeof cb === 'function') cb();
    }

    function whenQueueDrained() {
      if (state.writing || state.queue.length > 0) {
        self.once('__writeIdle', whenQueueDrained);
        return;
      }
      self._flush(afterFlush);
    }

    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding, function (err) {
        if (err) {
          if (typeof cb === 'function') cb(err);
          return;
        }
        whenQueueDrained();
      });
    } else {
      this._writeNext();
      whenQueueDrained();
    }
    return this;
  };

  function PassThrough(options) {
    Transform.call(this, options);
  }
  inherits(PassThrough, Transform);

  function finished(stream, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    if (typeof cb !== 'function') return;
    if (stream.readableEnded || stream.writableEnded) {
      globalThis.setTimeout(function () {
        cb();
      }, 0);
      return;
    }
    var done = false;
    function finish(err) {
      if (done) return;
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
    if (args.length >= 2) {
      var src = args[0];
      for (var i = 1; i < args.length; i++) {
        src = src.pipe(args[i]);
      }
    }
    if (cb) {
      finished(args[args.length - 1], cb);
      return args[args.length - 1];
    }
    return Promise.resolve(args[args.length - 1]);
  }

  var promises = {
    pipeline: function pipelinePromise() {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function (resolve, reject) {
        args.push(function (err) {
          if (err) reject(err);
          else resolve();
        });
        pipeline.apply(null, args);
      });
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
