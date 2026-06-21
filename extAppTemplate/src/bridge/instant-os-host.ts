import {
  EXT_APP_ENTER_MESSAGE_TYPE,
  EXT_APP_MANIFEST_FORMAT,
  EXT_APP_MANIFEST_SCHEMA_VERSION,
  type ExtAppManifest,
} from './instant-os-protocol.ts'
import appConfig from '../../app.config.json'
import packageJson from '../../package.json'
import { appendDevLog } from '../dev/instant-os-dev-log.ts'
import { postBridgeMessage } from './instant-os-bridge-transport.ts'
import {
  isDevToolsEnabled,
  isRunningInsideInstantOsHost,
  resolveInstantOsRuntimeMode,
} from '../dev/instant-os-runtime.ts'

type AppConfig = {
  id: string
  name: string
  description: string
  themeColor: string
  tags: string[]
}

const config = appConfig as AppConfig

export function buildRuntimeManifest(entryOverride?: string): ExtAppManifest {
  return {
    format: EXT_APP_MANIFEST_FORMAT,
    schemaVersion: EXT_APP_MANIFEST_SCHEMA_VERSION,
    id: config.id,
    name: config.name,
    description: config.description,
    version: packageJson.version,
    entry: entryOverride ?? resolveDefaultEntry(),
    icon: 'icon.svg',
    splash: {
      light: 'splash-light.svg',
      dark: 'splash-dark.svg',
    },
    themeColor: config.themeColor,
    tags: config.tags,
  }
}

function resolveDefaultEntry(): string {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    url.hash = ''
    url.search = ''
    return url.href
  }

  return 'index.html'
}

export { isRunningInsideInstantOsHost, resolveInstantOsRuntimeMode }

export function notifyHostEnterProgram(entryOverride?: string): void {
  const manifest = buildRuntimeManifest(entryOverride)
  const mode = resolveInstantOsRuntimeMode()

  appendDevLog('lifecycle', '启动图结束，准备进入应用', {
    detail: { mode, manifest },
  })

  if (mode === 'standalone') {
    appendDevLog('bridge-out', '未检测到 Instant OS 宿主，enter 消息已跳过', {
      level: 'warn',
      detail: manifest,
    })
    return
  }

  postBridgeMessage({
    type: EXT_APP_ENTER_MESSAGE_TYPE,
    manifest,
  })

  if (mode === 'dev-standalone') {
    appendDevLog('lifecycle', 'enter 消息已发出（开发模式将由模拟宿主确认）', {
      level: 'success',
    })
    return
  }

  appendDevLog('lifecycle', 'enter 消息已发往 Instant OS 宿主', {
    level: 'success',
  })
}

export function readAppDisplayName(): string {
  return config.name
}

export function readAppThemeColor(): string {
  return config.themeColor
}

export function readAppId(): string {
  return config.id
}

export function readAppTags(): string[] {
  return config.tags
}

export function logAppBoot(): void {
  if (!isDevToolsEnabled()) {
    return
  }

  appendDevLog('lifecycle', '应用开始启动', {
    detail: {
      mode: resolveInstantOsRuntimeMode(),
      inHost: isRunningInsideInstantOsHost(),
    },
  })
}
