/**
 * Guest 侧薄 CJS require：cache / 循环依赖 / 包装执行。
 * 取源码走宿主 asyncified `__instantCjsFetch`（回合制，挂起结束后再 eval）。
 */

/** Bridge + eval-parent keys on globalThis (set by host inject). */
export const CJS_FETCH_GLOBAL_KEY = '__instantCjsFetch'
export const CJS_RESOLVE_GLOBAL_KEY = '__instantCjsResolve'
export const CJS_EVAL_PARENT_GLOBAL_KEY = '__instantCjsEvalParent'
/** Private factory for `module.createRequire` (same cache as global require). */
export const CJS_MAKE_REQUIRE_GLOBAL_KEY = '__instantCjsMakeRequire'

const QUICKJS_CJS_GUEST_REQUIRE_SOURCE = `(function () {
  'use strict';

  var fetchMod = globalThis.${CJS_FETCH_GLOBAL_KEY};
  var resolveMod = globalThis.${CJS_RESOLVE_GLOBAL_KEY};
  var evalParent = globalThis.${CJS_EVAL_PARENT_GLOBAL_KEY};
  if (typeof fetchMod !== 'function' || typeof resolveMod !== 'function' || typeof evalParent !== 'function') {
    throw new Error('Instant CJS require bridges are not installed');
  }

  var moduleCache = Object.create(null);
  var resolveMemo = Object.create(null);

  function memoKey(parentFilename, id) {
    return String(parentFilename) + '\\0' + String(id);
  }

  function makeRequire(parentFilename) {
    function req(id) {
      var requested = id;
      if (typeof requested !== 'string') {
        requested = String(requested);
      }
      var key = memoKey(parentFilename, requested);
      var cachedFilename = resolveMemo[key];
      if (cachedFilename !== undefined) {
        var hit = moduleCache[cachedFilename];
        if (hit !== undefined) {
          return hit.exports;
        }
      }

      var payload = fetchMod(requested, parentFilename);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Instant CJS fetch returned invalid payload');
      }

      if (payload.kind === 'builtin') {
        return payload.exports;
      }

      var filename = payload.filename;
      if (typeof filename !== 'string' || filename === '') {
        throw new Error('Instant CJS fetch missing filename');
      }
      resolveMemo[key] = filename;

      var existing = moduleCache[filename];
      if (existing !== undefined) {
        return existing.exports;
      }

      var module = {
        id: filename,
        filename: filename,
        exports: {},
        loaded: false,
      };
      moduleCache[filename] = module;

      if (payload.kind === 'json') {
        try {
          module.exports = JSON.parse(payload.source);
        } catch (error) {
          delete moduleCache[filename];
          delete resolveMemo[key];
          throw error;
        }
        module.loaded = true;
        return module.exports;
      }

      if (payload.kind !== 'js') {
        delete moduleCache[filename];
        throw new Error('Instant CJS fetch unknown kind: ' + String(payload.kind));
      }

      var dirname = payload.dirname;
      if (typeof dirname !== 'string') {
        dirname = '';
      }
      var nestedRequire = makeRequire(filename);
      var source = payload.source;
      if (typeof source !== 'string') {
        delete moduleCache[filename];
        throw new Error('Instant CJS fetch missing source for ' + filename);
      }

      try {
        var wrapper = eval(
          '(function (exports, require, module, __filename, __dirname) {\\n' +
            source +
            '\\n})',
        );
        wrapper(module.exports, nestedRequire, module, filename, dirname);
      } catch (error) {
        delete moduleCache[filename];
        delete resolveMemo[key];
        throw error;
      }

      module.loaded = true;
      return module.exports;
    }

    req.resolve = function resolve(id) {
      return resolveMod(id, parentFilename);
    };
    req.cache = moduleCache;
    return req;
  }

  function topRequire(id) {
    return makeRequire(evalParent())(id);
  }
  topRequire.resolve = function resolve(id) {
    return resolveMod(id, evalParent());
  };
  topRequire.cache = moduleCache;

  globalThis.require = topRequire;
  globalThis.${CJS_MAKE_REQUIRE_GLOBAL_KEY} = makeRequire;
})();`

/**
 * Guest IIFE that installs `globalThis.require` (expects fetch/resolve/evalParent bridges).
 */
export function buildCjsGuestRequireSource(): string {
  return QUICKJS_CJS_GUEST_REQUIRE_SOURCE
}
