import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const EVENTS_BUNDLE_GLOBAL_KEY = '__instantEventsBundle'

/**
 * L1.11 薄 EventEmitter：手写 guest 源（不 vendor npm `events`，不挂全局）。
 * CJS：`require('events') === EventEmitter` 且 `.EventEmitter` 同引用。
 */
const QUICKJS_EVENTS_GUEST_SOURCE = `(function () {
  'use strict';

  function EventEmitter() {
    if (!(this instanceof EventEmitter)) {
      return new EventEmitter();
    }
    this._events = Object.create(null);
    this._maxListeners = undefined;
  }

  EventEmitter.defaultMaxListeners = 10;

  function asListener(fn, label) {
    if (typeof fn !== 'function') {
      throw new TypeError(
        'The "' + label + '" argument must be of type function. Received type ' + typeof fn,
      );
    }
    return fn;
  }

  EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
    if (typeof n !== 'number' || n < 0 || !isFinite(n)) {
      throw new RangeError(
        'The value of "n" is out of range. It must be a non-negative number. Received ' + n,
      );
    }
    this._maxListeners = n;
    return this;
  };

  EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
    if (this._maxListeners === undefined) {
      return EventEmitter.defaultMaxListeners;
    }
    return this._maxListeners;
  };

  EventEmitter.prototype.emit = function emit(type) {
    var handlers = this._events[type];
    if (type === 'error') {
      if (!handlers || handlers.length === 0) {
        var err = arguments.length > 1 ? arguments[1] : undefined;
        if (err instanceof Error) {
          throw err;
        }
        var wrapped = new Error('Unhandled error.' + (err !== undefined ? ' (' + err + ')' : ''));
        wrapped.context = err;
        throw wrapped;
      }
    }
    if (!handlers || handlers.length === 0) {
      return false;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    var list = handlers.slice();
    for (var i = 0; i < list.length; i++) {
      list[i].apply(this, args);
    }
    return true;
  };

  EventEmitter.prototype.addListener = function addListener(type, listener) {
    listener = asListener(listener, 'listener');
    var handlers = this._events[type];
    if (!handlers) {
      this._events[type] = [listener];
    } else {
      handlers.push(listener);
    }
    return this;
  };

  EventEmitter.prototype.on = EventEmitter.prototype.addListener;

  EventEmitter.prototype.once = function once(type, listener) {
    listener = asListener(listener, 'listener');
    var self = this;
    function wrapped() {
      self.removeListener(type, wrapped);
      return listener.apply(this, arguments);
    }
    wrapped.listener = listener;
    this.on(type, wrapped);
    return this;
  };

  EventEmitter.prototype.removeListener = function removeListener(type, listener) {
    listener = asListener(listener, 'listener');
    var handlers = this._events[type];
    if (!handlers) {
      return this;
    }
    for (var i = 0; i < handlers.length; i++) {
      var h = handlers[i];
      if (h === listener || h.listener === listener) {
        handlers.splice(i, 1);
        break;
      }
    }
    if (handlers.length === 0) {
      delete this._events[type];
    }
    return this;
  };

  EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

  EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
    if (arguments.length === 0 || type === undefined) {
      this._events = Object.create(null);
    } else {
      delete this._events[type];
    }
    return this;
  };

  EventEmitter.prototype.listeners = function listeners(type) {
    var handlers = this._events[type];
    if (!handlers) {
      return [];
    }
    var out = [];
    for (var i = 0; i < handlers.length; i++) {
      var h = handlers[i];
      out.push(h.listener ? h.listener : h);
    }
    return out;
  };

  EventEmitter.prototype.listenerCount = function listenerCount(type) {
    var handlers = this._events[type];
    return handlers ? handlers.length : 0;
  };

  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.listenerCount = function listenerCount(emitter, type) {
    return emitter.listenerCount(type);
  };

  globalThis.${EVENTS_BUNDLE_GLOBAL_KEY} = EventEmitter;
})();
`

/**
 * Eval thin EventEmitter into guest；返回模块 handle（即构造函数本身，对齐 Node CJS）。
 * 不挂 globalThis.EventEmitter。
 */
export function injectEvents(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_EVENTS_GUEST_SOURCE, 'instant-events.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'events guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject events: ${message}`)
  }
  evalResult.value.dispose()

  const ctor = context.getProp(context.global, EVENTS_BUNDLE_GLOBAL_KEY)
  if (context.typeof(ctor) !== 'function') {
    ctor.dispose()
    throw new Error('Failed to inject events: EventEmitter constructor missing')
  }

  context.setProp(context.global, EVENTS_BUNDLE_GLOBAL_KEY, context.undefined)
  return ctor
}

export function buildEventsModuleSource(builtinsGlobalKey: string): string {
  return (
    `const __m = globalThis.${builtinsGlobalKey}.events;\n` +
    `export const EventEmitter = __m;\n` +
    `export default __m;\n`
  )
}
