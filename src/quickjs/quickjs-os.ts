import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

/** Temporary globalThis key set by the guest IIFE (cleared after inject). */
const OS_BUNDLE_GLOBAL_KEY = '__instantOsBundle'

/**
 * L2.5.4 薄 os：手写 guest 源，供 CLI 探测环境。
 * 假值对齐 Instant process（linux / x64）；tmpdir/homedir 走 VFS 约定路径。
 */
const QUICKJS_OS_GUEST_SOURCE = `(function () {
  'use strict';

  var EOL = '\\n';
  var platform = 'linux';
  var arch = 'x64';
  var typeName = 'Linux';
  var release = '5.0.0-instant';
  var tmpDir = '/tmp';
  var homeDir = '/user';
  var hostname = 'instant';
  var endianness = 'LE';

  function constantsObject() {
    return {
      UV_UDP_REUSEADDR: 4,
      dlopen: {},
      errno: {},
      signals: {},
      priority: {},
    };
  }

  var os = {
    EOL: EOL,
    platform: function platformFn() {
      return platform;
    },
    arch: function archFn() {
      return arch;
    },
    type: function typeFn() {
      return typeName;
    },
    release: function releaseFn() {
      return release;
    },
    tmpdir: function tmpdirFn() {
      return tmpDir;
    },
    homedir: function homedirFn() {
      return homeDir;
    },
    hostname: function hostnameFn() {
      return hostname;
    },
    endianness: function endiannessFn() {
      return endianness;
    },
    cpus: function cpusFn() {
      return [
        {
          model: 'Instant Virtual CPU',
          speed: 1000,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        },
      ];
    },
    freemem: function freememFn() {
      return 512 * 1024 * 1024;
    },
    totalmem: function totalmemFn() {
      return 1024 * 1024 * 1024;
    },
    uptime: function uptimeFn() {
      return 0;
    },
    loadavg: function loadavgFn() {
      return [0, 0, 0];
    },
    networkInterfaces: function networkInterfacesFn() {
      return {};
    },
    get constants() {
      return constantsObject();
    },
  };

  globalThis.${OS_BUNDLE_GLOBAL_KEY} = os;
})();
`

export function injectOs(context: QuickJSContext): QuickJSHandle {
  const evalResult = context.evalCode(QUICKJS_OS_GUEST_SOURCE, 'instant-os-bundle.js')
  if (evalResult.error) {
    const message = (() => {
      try {
        return String(context.dump(evalResult.error))
      } finally {
        evalResult.error.dispose()
      }
    })()
    throw new Error(`Failed to inject os: ${message}`)
  }
  evalResult.value.dispose()

  const osHandle = context.getProp(context.global, OS_BUNDLE_GLOBAL_KEY)
  if (context.typeof(osHandle) !== 'object') {
    osHandle.dispose()
    throw new Error('Failed to inject os: os object missing')
  }

  context.setProp(context.global, OS_BUNDLE_GLOBAL_KEY, context.undefined)
  return osHandle
}

const OS_EXPORT_KEYS = [
  'EOL',
  'platform',
  'arch',
  'type',
  'release',
  'tmpdir',
  'homedir',
  'hostname',
  'endianness',
  'cpus',
  'freemem',
  'totalmem',
  'uptime',
  'loadavg',
  'networkInterfaces',
  'constants',
] as const

export function buildOsModuleSource(builtinsGlobalKey: string): string {
  const named = OS_EXPORT_KEYS.map((key) => `export const ${key} = __m.${key};`).join('\n')
  return (
    `const __m = globalThis.${builtinsGlobalKey}.os;\n` +
    `${named}\n` +
    `export default __m;\n`
  )
}
