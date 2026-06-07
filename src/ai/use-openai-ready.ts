import { useEffect, useState } from 'preact/hooks'
import { hasOpenAiApiKey, subscribeOpenAiConfig } from './openai-config.ts'

export function useOpenAiReady(): boolean {
  const [ready, setReady] = useState(hasOpenAiApiKey)

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setReady(hasOpenAiApiKey())
    })
  }, [])

  return ready
}
