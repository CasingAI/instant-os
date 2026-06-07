const configListeners = new Set<() => void>()

export function subscribeOpenAiConfig(listener: () => void): () => void {
  configListeners.add(listener)
  return () => {
    configListeners.delete(listener)
  }
}

export function notifyOpenAiConfigChange(): void {
  for (const listener of configListeners) {
    listener()
  }
}
