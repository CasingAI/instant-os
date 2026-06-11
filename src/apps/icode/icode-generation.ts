import { isStreamAbortError } from '../../ai/stream-abort.ts'
import {
  generateAppHtmlStreaming,
  type AppGenerationUpdate,
} from '../appstore/generate-app-stream.ts'
import type { StoreListing } from '../appstore/types.ts'
import type { ICodeChatEditBlock, ICodeInternalProject } from './icode-types.ts'
import { IcodeGenerationAbortedError } from './icode-generation-abort.ts'
import {
  generateIcodeHtmlEditsStreaming,
  type ICodeEditGenerationUpdate,
  type ICodeEditStreamOptions,
} from './icode-edit-stream.ts'
import { stripAiderEditBlocksFromContent } from './icode-apply-edits.ts'

export type ICodeGenerationUpdate = AppGenerationUpdate & {
  partialHtml?: string
  appliedEdits?: number
  visibleReply?: string
}

export type ICodeGenerationResult = {
  html: string
  assistantSummary: string
  appliedEdits?: number
  reasoningText?: string
  outputText?: string
  fullReply?: string
  edits?: ICodeChatEditBlock[]
}

function listingFromInternal(project: ICodeInternalProject): StoreListing {
  return {
    slug: project.id,
    name: project.name,
    description: project.description,
    category: project.category,
    iconEmoji: project.iconEmoji,
    themeColor: project.themeColor,
    tags: project.tags,
  }
}

function mapEditUpdate(update: ICodeEditGenerationUpdate): ICodeGenerationUpdate {
  return {
    phase: update.phase,
    progress: update.progress,
    textLength: update.textLength,
    reasoningText: update.reasoningText,
    contentText: update.contentText,
    partialHtml: update.partialHtml,
    appliedEdits: update.appliedEdits,
    visibleReply: update.visibleReply,
  }
}

export type ICodeGenerationOptions = ICodeEditStreamOptions

export async function generateInternalAppHtml(
  project: ICodeInternalProject,
  instruction: string,
  onUpdate?: (update: ICodeGenerationUpdate) => void,
  priorChat: ICodeInternalProject['chat'] = [],
  options: ICodeGenerationOptions = {},
): Promise<ICodeGenerationResult> {
  const listing = listingFromInternal(project)
  const hasExisting = project.html.trim().length > 0

  if (hasExisting) {
    const result = await generateIcodeHtmlEditsStreaming(
      listing,
      project.html,
      instruction,
      onUpdate ? (update) => onUpdate(mapEditUpdate(update)) : undefined,
      priorChat,
      options,
    )

    return {
      html: result.html,
      assistantSummary: result.assistantSummary,
      appliedEdits: result.appliedEdits,
      reasoningText: result.reasoningText || undefined,
      outputText: result.outputText || undefined,
      edits: result.edits.length > 0 ? result.edits : undefined,
      fullReply: stripAiderEditBlocksFromContent(result.outputText) || undefined,
    }
  }

  let reasoningText = ''
  let outputText = ''

  try {
    const html = await generateAppHtmlStreaming(
      listing,
      (update) => {
        reasoningText = update.reasoningText
        outputText = update.contentText
        onUpdate?.(update)
      },
      {
        detail: {
          tagline: 'iCode 内部开发项目',
          longDescription: instruction,
          developer: 'iCode',
          compatibility: 'Instant OS',
          language: '中文',
        },
      },
      options,
    )

    return {
      html,
      assistantSummary: '已根据描述生成新的应用源码，可在左侧预览效果。',
      reasoningText: reasoningText || undefined,
      outputText: outputText || undefined,
    }
  } catch (error) {
    if (isStreamAbortError(error, options.signal)) {
      throw new IcodeGenerationAbortedError()
    }
    throw error
  }
}
