import type { PackageServiceEvent } from './package-types.ts'

type Listener = (event: PackageServiceEvent) => void

const listeners = new Set<Listener>()

export function emitPackageEvent(event: PackageServiceEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribePackageEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function serializeTaskForEvent<T extends { abortController: AbortController }>(
  task: T,
): Omit<T, 'abortController'> {
  const { abortController: _ac, ...rest } = task
  return rest
}
