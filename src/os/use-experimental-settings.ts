import { useEffect, useState } from 'preact/hooks'
import {
  loadExperimentalSettings,
  subscribeExperimentalSettings,
  type ExperimentalSettings,
} from './experimental-settings-storage.ts'

export function useExperimentalSettings(): ExperimentalSettings {
  const [settings, setSettings] = useState(loadExperimentalSettings)

  useEffect(() => subscribeExperimentalSettings(() => setSettings(loadExperimentalSettings())), [])

  return settings
}
