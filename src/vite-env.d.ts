/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_BASE_URL?: string
  readonly VITE_OPENAI_MODEL?: string
  readonly VITE_VM_RUNTIME_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
