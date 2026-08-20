import { createRegistryStore } from '../../os/registry-store.ts'

export type GomokuGameMode = 'pvp' | 'pve' | 'aivai'

export function normalizeGameMode(value: unknown): GomokuGameMode {
  if (value === 'pve') return 'pve'
  if (value === 'aivai') return 'aivai'
  return 'pvp'
}

const registryStore = createRegistryStore<{ gameMode: GomokuGameMode }>({
  appId: 'gomoku',
  defaultValue: () => ({ gameMode: 'pve' }),
  legacyKey: 'store',
  fields: [
    {
      key: 'gameMode',
      read: (store) => store.gameMode,
      write: (value, draft) => ({ ...draft, gameMode: value }),
      serialize: (value) => value,
      deserialize: (raw) => {
        if (!raw) {
          return 'pve'
        }
        return normalizeGameMode(raw)
      },
    },
  ],
})

export function subscribeGomokuGameMode(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function loadGomokuGameMode(): Promise<GomokuGameMode> {
  const prefs = await registryStore.read()
  return prefs.gameMode
}

export async function saveGomokuGameMode(gameMode: GomokuGameMode): Promise<void> {
  await registryStore.read()
  await registryStore.write({ gameMode })
}
