/**
 * Guest-side npm builtins to pre-bundle for QuickJS eval injection.
 * Hand-written builtins (e.g. path) are not listed here.
 *
 * @typedef {object} QuickJsGuestBuiltinEntry
 * @property {string} id Short id (for logs)
 * @property {string} resolveSpec Node require.resolve argument
 * @property {string} globalKey Temporary globalThis key after IIFE eval
 * @property {string} primaryExport Key that must be a function on the bundle (constructor check)
 * @property {readonly string[]} exportKeys Keys copied onto the guest module object / IIFE payload
 * @property {string} outRelPath Repo-relative path of generated TS source module
 * @property {string} exportConstName Exported const name in the generated TS file
 * @property {string} [bannerLabel] Optional label in the IIFE banner comment
 */

/** @type {readonly QuickJsGuestBuiltinEntry[]} */
export const QUICKJS_GUEST_BUILTINS = [
  {
    id: 'buffer',
    resolveSpec: 'buffer/',
    globalKey: '__instantBufferBundle',
    primaryExport: 'Buffer',
    exportKeys: ['Buffer', 'SlowBuffer', 'INSPECT_MAX_BYTES', 'kMaxLength'],
    outRelPath: 'src/quickjs/quickjs-buffer-bundle-source.ts',
    exportConstName: 'QUICKJS_BUFFER_BUNDLE_SOURCE',
    bannerLabel: 'buffer',
  },
]
