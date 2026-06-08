import { useEffect, useState } from 'preact/hooks'
import { readDefaultModelFriendlyName, subscribeOpenAiConfig } from './openai-config.ts'

export function useDefaultAiModelFriendlyName(): string {
  const [friendlyName, setFriendlyName] = useState(readDefaultModelFriendlyName)

  useEffect(() => {
    return subscribeOpenAiConfig(() => {
      setFriendlyName(readDefaultModelFriendlyName())
    })
  }, [])

  return friendlyName
}
