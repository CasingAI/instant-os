import { CHROMO_WORKER_ORIGIN } from './chromo-config.ts'

/** Locked to the vendored file in virtual-chromo/public/vendor/vconsole.min.js */
export const VCONSOLE_VERSION = '3.15.1'

export type VConsoleEvalResult = {
  ok: boolean
  already?: boolean
  error?: string
}

function workerOrigin(origin?: string): string {
  return (origin ?? CHROMO_WORKER_ORIGIN).replace(/\/$/, '')
}

/**
 * Sub-page IIFE: load Worker-hosted vConsole and construct an instance.
 * Returns a Promise (VC_EVAL awaits thenables).
 */
export function buildVConsoleInjectEval(origin?: string): string {
  const src = `${workerOrigin(origin)}/vendor/vconsole.min.js?b=${VCONSOLE_VERSION}`
  // Absolute Worker URL — same pattern as conf.js inject_html (avoid <base href=target>).
  return `(function () {
  var SRC = ${JSON.stringify(src)};
  if (window.__vcVConsoleInstance) {
    return Promise.resolve({ ok: true, already: true });
  }
  function ensureScript() {
    if (typeof window.VConsole === 'function') {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-vc-vconsole="1"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () {
          reject(new Error('vConsole script failed to load'));
        });
        return;
      }
      var s = document.createElement('script');
      s.setAttribute('data-vc-vconsole', '1');
      s.src = SRC;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('vConsole script failed to load: ' + SRC)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  return ensureScript().then(function () {
    if (typeof window.VConsole !== 'function') {
      return { ok: false, error: 'VConsole global missing after script load' };
    }
    if (window.__vcVConsoleInstance) {
      return { ok: true, already: true };
    }
    window.__vcVConsoleInstance = new window.VConsole();
    return { ok: true };
  }).catch(function (err) {
    return {
      ok: false,
      error: err && err.message ? String(err.message) : String(err),
    };
  });
})()`
}

/** Sub-page IIFE: destroy vConsole instance and remove UI. */
export function buildVConsoleDestroyEval(): string {
  return `(function () {
  try {
    var inst = window.__vcVConsoleInstance;
    if (inst && typeof inst.destroy === 'function') {
      inst.destroy();
    }
  } catch (e) {}
  window.__vcVConsoleInstance = null;
  try {
    var el = document.getElementById('__vconsole');
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  } catch (e2) {}
  return { ok: true };
})()`
}

function parseResult(value: unknown): VConsoleEvalResult {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'unexpected eval result' }
  }
  const record = value as Record<string, unknown>
  if (record.ok === true) {
    return { ok: true, already: record.already === true }
  }
  return {
    ok: false,
    error: typeof record.error === 'string' ? record.error : 'vConsole inject failed',
  }
}

export async function injectVConsole(
  evalInPage: (code: string) => Promise<unknown>,
  origin?: string,
): Promise<VConsoleEvalResult> {
  try {
    const value = await evalInPage(buildVConsoleInjectEval(origin))
    return parseResult(value)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function destroyVConsole(
  evalInPage: (code: string) => Promise<unknown>,
): Promise<VConsoleEvalResult> {
  try {
    const value = await evalInPage(buildVConsoleDestroyEval())
    return parseResult(value)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
