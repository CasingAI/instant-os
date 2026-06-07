interface BatteryManager extends EventTarget {
  readonly charging: boolean
  readonly level: number
}

interface Navigator {
  getBattery?: () => Promise<BatteryManager>
}
