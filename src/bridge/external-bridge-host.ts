import {
  installExternalBridgeHandler,
  validateBridgeEmbedContext,
  type ExternalBridgeControls,
  type ExternalBridgeSession,
} from './install-external-bridge-handler.ts'
import { parseBridgeLaunchParams } from './parse-bridge-launch-params.ts'

export type ExternalBridgeHost = {
  launchParams: ReturnType<typeof parseBridgeLaunchParams>
  embedError: string | undefined
  getSession: () => ExternalBridgeSession | undefined
  subscribe: (listener: (session: ExternalBridgeSession | undefined) => void) => () => void
  controls: ExternalBridgeControls | undefined
}

export function createExternalBridgeHost(search: string): ExternalBridgeHost {
  const launchParams = parseBridgeLaunchParams(search)
  const embedError = launchParams
    ? validateBridgeEmbedContext(launchParams.appId)
    : undefined

  let session: ExternalBridgeSession | undefined
  const listeners = new Set<(session: ExternalBridgeSession | undefined) => void>()
  let controls: ExternalBridgeControls | undefined

  const notify = (next: ExternalBridgeSession | undefined) => {
    session = next
    for (const listener of listeners) {
      listener(next)
    }
  }

  if (launchParams && !embedError) {
    const bridge = installExternalBridgeHandler({
      launchAppId: launchParams.appId,
      launchAppName: launchParams.appName,
      onSessionChange: notify,
    })
    controls = bridge.controls
  }

  return {
    launchParams,
    embedError,
    getSession: () => session,
    subscribe: (listener) => {
      listener(session)
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    controls,
  }
}
