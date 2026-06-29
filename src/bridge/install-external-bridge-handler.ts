import { hasOpenAiApiKey, readDefaultModelFriendlyName } from '../ai/openai-config.ts'
import { handleGeneratedAppAiRequest } from '../apps/generated/handle-generated-app-ai-request.ts'
import { isGeneratedAppAiRequestMessage } from '../apps/generated/generated-app-ai-types.ts'
import {
  hasBridgeStorageAccess,
  requestBridgeStorageAccess,
  shouldPromptBridgeStorageAccess,
} from './bridge-storage-access.ts'
import {
  grantExternalBridgeConsent,
  hasExternalBridgeConsent,
  revokeExternalBridgeConsent,
} from './external-bridge-consent-storage.ts'
import {
  buildExternalBridgeReady,
  buildExternalBridgeStatus,
  isExternalBridgeHandshakeMessage,
  isValidExternalBridgeAppId,
  type ExternalBridgePhase,
} from './instant-os-bridge-protocol.ts'

export type ExternalBridgeSession = {
  appId: string
  appName?: string
  parentOrigin: string
  phase: ExternalBridgePhase
}

type InstallExternalBridgeHandlerOptions = {
  launchAppId: string
  launchAppName?: string
  onSessionChange: (session: ExternalBridgeSession | undefined) => void
}

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

const LOG_PREFIX = '[external-bridge]'

function postToParent(message: unknown, targetOrigin: string): void {
  if (window.parent === window) {
    return
  }

  window.parent.postMessage(message, targetOrigin)
}

function buildStatus(
  session: Pick<ExternalBridgeSession, 'appId' | 'appName' | 'phase'>,
  extras?: { modelName?: string; error?: string },
) {
  return buildExternalBridgeStatus({
    appId: session.appId,
    phase: session.phase,
    appName: session.appName,
    modelName: extras?.modelName,
    error: extras?.error,
  })
}

function resolveModelName(): string | undefined {
  if (!hasOpenAiApiKey()) {
    return undefined
  }

  try {
    return readDefaultModelFriendlyName()
  } catch {
    return undefined
  }
}

export function validateBridgeEmbedContext(launchAppId: string): string | undefined {
  if (window.parent === window) {
    return '此页面需要在第三方应用的 iframe 中打开。'
  }

  if (!isValidExternalBridgeAppId(launchAppId)) {
    return '缺少有效的 appId 参数（须以 ext: 开头）。'
  }

  return undefined
}

export type ExternalBridgeControls = {
  approveConsent: () => void
  denyConsent: () => void
  connectStorageAccess: () => Promise<void>
}

export function installExternalBridgeHandler(
  options: InstallExternalBridgeHandlerOptions,
): { dispose: () => void; controls: ExternalBridgeControls } {
  let session: ExternalBridgeSession | undefined
  let announcedReady = false

  const notifySession = (next: ExternalBridgeSession | undefined) => {
    session = next
    options.onSessionChange(next)
  }

  const announceReady = () => {
    if (announcedReady || window.parent === window) {
      return
    }

    announcedReady = true
    postToParent(buildExternalBridgeReady(options.launchAppId), '*')
  }

  const emitStatus = (
    nextSession: ExternalBridgeSession,
    extras?: { modelName?: string; error?: string },
  ) => {
    notifySession(nextSession)
    postToParent(buildStatus(nextSession, extras), nextSession.parentOrigin)
  }

  const resolvePhaseAfterHandshake = async (
    appId: string,
    appName: string | undefined,
    parentOrigin: string,
  ): Promise<ExternalBridgeSession> => {
    if (!hasOpenAiApiKey() && shouldPromptBridgeStorageAccess()) {
      return { appId, appName, parentOrigin, phase: 'needs-storage-access' }
    }

    if (!hasOpenAiApiKey()) {
      return { appId, appName, parentOrigin, phase: 'no-api-key' }
    }

    if (hasExternalBridgeConsent(appId, parentOrigin)) {
      return { appId, appName, parentOrigin, phase: 'authorized' }
    }

    return { appId, appName, parentOrigin, phase: 'awaiting-consent' }
  }

  const refreshSessionAfterStorageAccess = async () => {
    if (!session) {
      return
    }

    const hasAccess = await hasBridgeStorageAccess()
    if (!hasAccess) {
      return
    }

    const nextSession = await resolvePhaseAfterHandshake(
      session.appId,
      session.appName,
      session.parentOrigin,
    )
    emitStatus(nextSession, {
      modelName: nextSession.phase === 'authorized' ? resolveModelName() : undefined,
    })
  }

  const handleHandshake = (event: MessageEvent) => {
    if (!isExternalBridgeHandshakeMessage(event.data)) {
      return
    }

    if (event.source !== window.parent) {
      console.warn(`${LOG_PREFIX} ignored handshake from non-parent source`)
      return
    }

    if (event.data.appId !== options.launchAppId) {
      postToParent(
        buildExternalBridgeStatus({
          appId: options.launchAppId,
          phase: 'error',
          appName: options.launchAppName,
          error: 'appId 与 bridge 启动参数不一致',
        }),
        event.origin,
      )
      return
    }

    const appName = event.data.appName?.trim() || options.launchAppName
    void resolvePhaseAfterHandshake(event.data.appId, appName, event.origin).then((nextSession) => {
      emitStatus(nextSession, {
        modelName: nextSession.phase === 'authorized' ? resolveModelName() : undefined,
      })
    })
  }

  const handleAiRequest = (event: MessageEvent) => {
    if (!isGeneratedAppAiRequestMessage(event.data)) {
      return
    }

    if (event.source !== window.parent || !session) {
      return
    }

    if (event.origin !== session.parentOrigin) {
      console.warn(`${LOG_PREFIX} ignored AI request from unexpected origin`, event.origin)
      return
    }

    if (event.data.appId !== session.appId) {
      return
    }

    if (session.phase !== 'authorized') {
      return
    }

    void handleGeneratedAppAiRequest(
      event.data,
      event.source as ReplyTarget,
      session.appName,
    )
  }

  const onMessage = (event: MessageEvent) => {
    handleHandshake(event)
    handleAiRequest(event)
  }

  window.addEventListener('message', onMessage)
  announceReady()

  const controls: ExternalBridgeControls = {
    approveConsent: () => {
      if (!session || session.phase !== 'awaiting-consent') {
        return
      }

      grantExternalBridgeConsent(session.appId, session.parentOrigin, session.appName)
      emitStatus(
        { ...session, phase: 'authorized' },
        { modelName: resolveModelName() },
      )
    },
    denyConsent: () => {
      if (!session || session.phase !== 'awaiting-consent') {
        return
      }

      revokeExternalBridgeConsent(session.appId, session.parentOrigin)
      emitStatus({ ...session, phase: 'denied' })
    },
    connectStorageAccess: async () => {
      if (!session || session.phase !== 'needs-storage-access') {
        return
      }

      await requestBridgeStorageAccess()
      await refreshSessionAfterStorageAccess()
    },
  }

  return {
    dispose: () => {
      window.removeEventListener('message', onMessage)
      notifySession(undefined)
    },
    controls,
  }
}
