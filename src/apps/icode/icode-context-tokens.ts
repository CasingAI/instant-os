import type { AppGenerationContext } from '../appstore/build-app-generation-prompt.ts'
import { measureAppGenerationContextPayload } from '../appstore/generate-app-stream.ts'
import type { StoreListing } from '../appstore/types.ts'
import {
  measureIcodeEditContextPayload,
  type IcodeContextPayloadStats,
} from './icode-edit-stream.ts'
import type { ICodeChatMessage } from './icode-types.ts'

export function measureIcodeContextPayload(
  listing: StoreListing,
  html: string,
  instruction: string,
  priorChat: ICodeChatMessage[] = [],
): IcodeContextPayloadStats {
  const trimmedHtml = html.trim()
  if (trimmedHtml) {
    return measureIcodeEditContextPayload(listing, trimmedHtml, instruction, priorChat)
  }

  const context: AppGenerationContext = {
    detail: {
      tagline: 'iCode 内部开发项目',
      longDescription: instruction,
      developer: 'iCode',
      compatibility: 'Instant OS',
      language: '中文',
    },
  }

  return measureAppGenerationContextPayload(listing, context)
}

export function estimateIcodeContextTokens(
  listing: StoreListing,
  html: string,
  instruction: string,
  priorChat: ICodeChatMessage[] = [],
): number {
  return measureIcodeContextPayload(listing, html, instruction, priorChat).tokens
}
