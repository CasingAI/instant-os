/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INSTANT_OS_DEV_TOOLS?: string
  readonly VITE_DEV_AI_API_BASE?: string
  readonly VITE_DEV_AI_API_KEY?: string
  readonly VITE_DEV_AI_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.json' {
  const value: Record<string, unknown>
  export default value
}
