const DEFAULT_DEV_ORIGIN = 'http://localhost:6175'

function readViteEnv(): { DEV?: boolean; VITE_VM_RUNTIME_ORIGIN?: string } | undefined {
  try {
    return (import.meta as ImportMeta & { env?: { DEV?: boolean; VITE_VM_RUNTIME_ORIGIN?: string } })
      .env
  } catch {
    return undefined
  }
}

/** Cross-origin V86 runtime. Dev defaults to the Instant-virtual-machine Vite port. */
export function getVmRuntimeOrigin(): string | undefined {
  const env = readViteEnv()
  const configured = env?.VITE_VM_RUNTIME_ORIGIN?.trim().replace(/\/+$/, '')
  if (configured) {
    return configured
  }
  if (env?.DEV) {
    return DEFAULT_DEV_ORIGIN
  }
  return undefined
}

export function isVmRuntimeConfigured(): boolean {
  return getVmRuntimeOrigin() !== undefined
}
