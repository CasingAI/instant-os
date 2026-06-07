import { seedInitialThreads } from './mail-agent.ts'
import { markStoreInitialized, readMailStore } from './mail-storage.ts'
import type { MailStore } from './types.ts'

let initPromise: Promise<MailStore> | undefined

export function ensureMailStoreInitialized(): Promise<MailStore> {
  const current = readMailStore()
  if (current.initialized) {
    return Promise.resolve(current)
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const seeds = seedInitialThreads()
    markStoreInitialized(seeds)
    return readMailStore()
  })().finally(() => {
    initPromise = undefined
  })

  return initPromise
}
