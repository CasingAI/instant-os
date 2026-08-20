import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const URL_BUNDLE_GLOBAL_KEY = '__instantUrlBundle'

/**
 * 薄 `url`：优先 re-export 引擎内建 URL / URLSearchParams；
 * 另提供 fileURLToPath / pathToFileURL / parse / format 常用子集。
 */
const QUICKJS_URL_GUEST_SOURCE = `(function () {
  'use strict';

  var hasUrl = typeof URL === 'function';
  var hasSearchParams = typeof URLSearchParams === 'function';

  function fileURLToPath(pathOrUrl) {
    var href;
    if (typeof pathOrUrl === 'string') {
      href = pathOrUrl;
    } else if (pathOrUrl && typeof pathOrUrl.href === 'string') {
      href = pathOrUrl.href;
    } else {
      throw new TypeError('The "path" argument must be of type string or an instance of URL');
    }
    if (href.indexOf('file:') !== 0) {
      throw new TypeError('The URL must be of scheme file');
    }
    // file:///path or file://host/path — Instant is POSIX-only
    var rest = href.slice(5);
    if (rest.indexOf('//') === 0) {
      rest = rest.slice(2);
      var slash = rest.indexOf('/');
      if (slash < 0) {
        return '/';
      }
      // drop authority (empty host or localhost)
      rest = rest.slice(slash);
    }
    try {
      return decodeURIComponent(rest);
    } catch (e) {
      return rest;
    }
  }

  function pathToFileURL(path) {
    if (typeof path !== 'string') {
      throw new TypeError('The "path" argument must be of type string');
    }
    var resolved = path;
    var builtins = globalThis.__instantNodeBuiltins;
    if (builtins && builtins.path && typeof builtins.path.resolve === 'function') {
      resolved = builtins.path.isAbsolute(path) ? builtins.path.normalize(path) : builtins.path.resolve(path);
    }
    if (resolved.charAt(0) !== '/') {
      resolved = '/' + resolved;
    }
    var encoded = resolved
      .split('/')
      .map(function (seg) {
        return encodeURIComponent(seg).replace(/[!'()*]/g, function (c) {
          return '%' + c.charCodeAt(0).toString(16).toUpperCase();
        });
      })
      .join('/');
    var href = 'file://' + encoded;
    if (hasUrl) {
      return new URL(href);
    }
    return { href: href, protocol: 'file:', pathname: encoded };
  }

  function parse(urlStr, parseQueryString, slashesDenoteHost) {
    void slashesDenoteHost;
    var input = String(urlStr == null ? '' : urlStr);
    var result = {
      href: input,
      protocol: null,
      slashes: null,
      host: null,
      auth: null,
      hostname: null,
      port: null,
      pathname: null,
      search: null,
      path: null,
      query: null,
      hash: null,
    };
    if (hasUrl) {
      try {
        var base = input.indexOf('://') >= 0 || input.indexOf('//') === 0 ? undefined : 'http://instant.local/';
        var u = base ? new URL(input, base) : new URL(input);
        result.href = u.href;
        result.protocol = u.protocol;
        result.slashes = true;
        result.host = u.host || null;
        result.hostname = u.hostname || null;
        result.port = u.port || null;
        result.pathname = u.pathname || null;
        result.search = u.search || null;
        result.hash = u.hash || null;
        result.path = (u.pathname || '') + (u.search || '') || null;
        if (parseQueryString) {
          var qs = globalThis.__instantNodeBuiltins && globalThis.__instantNodeBuiltins.querystring;
          result.query = qs ? qs.parse(u.search ? u.search.slice(1) : '') : (function () {
            var o = {};
            if (u.searchParams) {
              u.searchParams.forEach(function (v, k) {
                o[k] = v;
              });
            }
            return o;
          })();
        } else {
          result.query = u.search ? u.search.slice(1) : null;
        }
        return result;
      } catch (e) {
        // fall through to string parse
      }
    }
    var hashIdx = input.indexOf('#');
    if (hashIdx >= 0) {
      result.hash = input.slice(hashIdx);
      input = input.slice(0, hashIdx);
    }
    var searchIdx = input.indexOf('?');
    if (searchIdx >= 0) {
      result.search = input.slice(searchIdx);
      result.query = parseQueryString
        ? (globalThis.__instantNodeBuiltins && globalThis.__instantNodeBuiltins.querystring
            ? globalThis.__instantNodeBuiltins.querystring.parse(input.slice(searchIdx + 1))
            : input.slice(searchIdx + 1))
        : input.slice(searchIdx + 1);
      input = input.slice(0, searchIdx);
    }
    var protoIdx = input.indexOf(':');
    if (protoIdx > 0) {
      result.protocol = input.slice(0, protoIdx + 1);
      input = input.slice(protoIdx + 1);
      if (input.indexOf('//') === 0) {
        result.slashes = true;
        input = input.slice(2);
        var pathSlash = input.indexOf('/');
        if (pathSlash < 0) {
          result.host = input;
          result.hostname = input;
          input = '';
        } else {
          result.host = input.slice(0, pathSlash);
          result.hostname = result.host;
          input = input.slice(pathSlash);
        }
      }
    }
    result.pathname = input || null;
    result.path = ((result.pathname || '') + (result.search || '')) || null;
    return result;
  }

  function format(urlObject) {
    if (typeof urlObject === 'string') {
      return urlObject;
    }
    if (!urlObject || typeof urlObject !== 'object') {
      throw new TypeError('The "urlObject" argument must be of type object');
    }
    if (hasUrl && typeof urlObject.href === 'string' && urlObject.protocol) {
      try {
        return new URL(urlObject.href).href;
      } catch (e) {
        // fall through
      }
    }
    var protocol = urlObject.protocol || '';
    var host = urlObject.host || urlObject.hostname || '';
    if (urlObject.port && host.indexOf(':') < 0) {
      host = host + ':' + urlObject.port;
    }
    var pathname = urlObject.pathname || '';
    var search = urlObject.search || '';
    if (!search && urlObject.query != null) {
      if (typeof urlObject.query === 'string') {
        search = urlObject.query ? '?' + urlObject.query : '';
      } else {
        var qs = globalThis.__instantNodeBuiltins && globalThis.__instantNodeBuiltins.querystring;
        search = qs ? '?' + qs.stringify(urlObject.query) : '';
      }
    } else if (search && search.charAt(0) !== '?') {
      search = '?' + search;
    }
    var hash = urlObject.hash || '';
    if (hash && hash.charAt(0) !== '#') {
      hash = '#' + hash;
    }
    var slashes = protocol && urlObject.slashes !== false ? '//' : '';
    return protocol + slashes + host + pathname + search + hash;
  }

  var urlMod = {
    parse: parse,
    format: format,
    fileURLToPath: fileURLToPath,
    pathToFileURL: pathToFileURL,
    Url: function Url() {},
  };

  if (hasUrl) {
    urlMod.URL = URL;
  }
  if (hasSearchParams) {
    urlMod.URLSearchParams = URLSearchParams;
  }

  globalThis.${URL_BUNDLE_GLOBAL_KEY} = urlMod;
})();
`

export function injectUrl(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_URL_GUEST_SOURCE, 'instant-url.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } catch {
        return 'url guest eval failed'
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject url: ${message}`)
  }
  evalResult.value.dispose()

  const handle = context.getProp(context.global, URL_BUNDLE_GLOBAL_KEY)
  if (context.typeof(handle) !== 'object') {
    handle.dispose()
    throw new Error('Failed to inject url: module object missing')
  }

  context.setProp(context.global, URL_BUNDLE_GLOBAL_KEY, context.undefined)
  return handle
}

const URL_EXPORT_KEYS = [
  'parse',
  'format',
  'fileURLToPath',
  'pathToFileURL',
  'URL',
  'URLSearchParams',
  'Url',
] as const

export function buildUrlModuleSource(builtinsGlobalKey: string): string {
  const named = URL_EXPORT_KEYS.map(
    (key) =>
      `export const ${key} = __m.${key};`,
  ).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.url;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
