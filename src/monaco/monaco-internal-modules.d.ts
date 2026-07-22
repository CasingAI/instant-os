declare module 'monaco-editor/esm/vs/base/common/event.js' {
  export const Event: {
    readonly None: { dispose(): void }
  }
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: {
    initialize(services: Record<string, unknown>): void
  }
}
