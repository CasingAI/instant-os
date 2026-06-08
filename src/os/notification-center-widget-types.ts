export type NotificationWeather = {
  city: string
  condition: string
  temperatureC: number
  highC: number
  lowC: number
  humidity: number
  wind: string
  emoji: string
  summary: string
}

export type NotificationStockItem = {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}

export type NotificationStockSnapshot = {
  marketName: string
  headline: string
  items: NotificationStockItem[]
}

export type WidgetLoadState = 'idle' | 'loading' | 'error'
