import {
  filesCreateText,
  filesList,
  filesListVolumes,
  filesMkdir,
  filesReadText,
  filesRemove,
  filesRename,
  filesStat,
  filesWriteText,
} from '../files/files-api.ts'
import {
  GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
  type GeneratedAppFilesRequestMessage,
  type GeneratedAppFilesResponseMessage,
  type GeneratedAppFilesResult,
} from './generated-app-files-types.ts'

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

function reply(source: ReplyTarget, message: GeneratedAppFilesResponseMessage): void {
  source.postMessage(message, '*')
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '文件操作失败'
}

async function dispatch(
  message: GeneratedAppFilesRequestMessage,
): Promise<GeneratedAppFilesResult> {
  switch (message.op) {
    case 'listVolumes':
      return filesListVolumes()
    case 'list': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      return filesList(message.path)
    }
    case 'stat': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      return (await filesStat(message.path)) ?? null
    }
    case 'readText': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      return filesReadText(message.path)
    }
    case 'writeText': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      if (typeof message.text !== 'string') throw new Error('缺少 text')
      return filesWriteText(message.path, message.text)
    }
    case 'mkdir': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      return filesMkdir(message.path)
    }
    case 'createText': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      return filesCreateText(message.path, message.text ?? '')
    }
    case 'rename': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      if (typeof message.nextName !== 'string') throw new Error('缺少 nextName')
      return filesRename(message.path, message.nextName)
    }
    case 'remove': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      await filesRemove(message.path)
      return null
    }
    default: {
      const _exhaustive: never = message.op
      throw new Error(`未知操作：${String(_exhaustive)}`)
    }
  }
}

export async function handleGeneratedAppFilesRequest(
  message: GeneratedAppFilesRequestMessage,
  source: ReplyTarget,
  options?: { allowed?: boolean },
): Promise<void> {
  if (options?.allowed === false) {
    reply(source, {
      type: GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: '应用未获得文件访问能力，请先授予 files 能力',
    })
    return
  }

  try {
    const result = await dispatch(message)
    reply(source, {
      type: GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: true,
      result,
    })
  } catch (error) {
    reply(source, {
      type: GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: formatError(error),
    })
  }
}
