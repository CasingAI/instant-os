import { seedInitialThreads } from './mail-agent.ts'
import { markStoreInitialized, readMailStore } from './mail-storage.ts'
import type { MailStore } from './types.ts'

let initPromise: Promise<MailStore> | undefined

export async function ensureMailStoreInitialized(): Promise<MailStore> {
  if (initPromise) {
    return initPromise
  }

  const current = await readMailStore()
  if (current.initialized) {
    return current
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const seeds = seedInitialThreads()
    return markStoreInitialized(seeds)
  })().finally(() => {
    initPromise = undefined
  })

  return initPromise
}
