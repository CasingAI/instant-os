import type { NotificationWeather } from '../../os/notification-center-widget-types.ts'

export type WeatherHourly = {
  time: string
  tempC: number
  emoji: string
}

export type WeatherDaily = {
  day: string
  highC: number
  lowC: number
  condition: string
  emoji: string
}

export type WeatherDetail = NotificationWeather & {
  feelsLikeC: number
  uvIndex: number
  airQuality: string
  visibilityKm: number
  hourly: WeatherHourly[]
  daily: WeatherDaily[]
}

export type WeatherCitySuggestion = {
  name: string
  region: string
  subtitle: string
}

export type WeatherCityEntry = {
  id: string
  name: string
  region: string | undefined
  weather: WeatherDetail | undefined
}

export type WeatherDefaultDisplay = 'my-location' | string

export type WeatherStore = {
  myLocationCityId: string | undefined
  defaultDisplay: WeatherDefaultDisplay
  cities: WeatherCityEntry[]
  activeCityId: string | undefined
}
