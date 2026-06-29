import { isValidExternalBridgeAppId } from './instant-os-bridge-protocol.ts'

export type BridgeLaunchParams = {
  appId: string
  appName?: string
}

export function parseBridgeLaunchParams(search: string): BridgeLaunchParams | undefined {
  const params = new URLSearchParams(search)
  const appId = params.get('appId')?.trim()
  if (!appId || !isValidExternalBridgeAppId(appId)) {
    return undefined
  }

  const appName = params.get('appName')?.trim()
  return {
    appId,
    appName: appName || undefined,
  }
}
