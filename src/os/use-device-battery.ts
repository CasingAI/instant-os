import { useEffect, useState } from 'preact/hooks'

export type DeviceBattery = {
  levelPercent: number
  charging: boolean
}

export function useDeviceBattery(): DeviceBattery | undefined {
  const [battery, setBattery] = useState<DeviceBattery | undefined>(undefined)

  useEffect(() => {
    if (typeof navigator.getBattery !== 'function') {
      return
    }

    let manager: BatteryManager | undefined
    let cancelled = false

    const syncBattery = () => {
      if (!manager || cancelled) {
        return
      }
      setBattery({
        levelPercent: Math.round(manager.level * 100),
        charging: manager.charging,
      })
    }

    navigator
      .getBattery()
      .then((batteryManager) => {
        if (cancelled) {
          return
        }
        manager = batteryManager
        syncBattery()
        batteryManager.addEventListener('levelchange', syncBattery)
        batteryManager.addEventListener('chargingchange', syncBattery)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (manager) {
        manager.removeEventListener('levelchange', syncBattery)
        manager.removeEventListener('chargingchange', syncBattery)
      }
    }
  }, [])

  return battery
}
