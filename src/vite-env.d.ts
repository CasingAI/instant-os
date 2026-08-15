/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_BASE_URL?: string
  readonly VITE_OPENAI_MODEL?: string
  readonly VITE_DEBUG_OPENAI_API_KEY?: string
  readonly VITE_DEBUG_OPENAI_BASE_URL?: string
  readonly VITE_DEBUG_OPENAI_MODEL?: string
  readonly VITE_DEBUG_OPENAI_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
