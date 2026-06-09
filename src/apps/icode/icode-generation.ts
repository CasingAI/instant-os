import {
  generateAppHtmlStreaming,
  type AppGenerationPhase,
  type AppGenerationUpdate,
} from '../appstore/generate-app-stream.ts'
import type { StoreListing } from '../appstore/types.ts'
import { nextAppVersion } from '../appstore/app-version.ts'
import type { ICodeInternalProject } from './icode-types.ts'

export type ICodeGenerationUpdate = AppGenerationUpdate & {
  reasoningText?: string
  contentText?: string
}

export type ICodeGenerationResult = {
  html: string
  assistantSummary: string
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

function phaseSummary(phase: AppGenerationPhase | undefined, progress: number): string {
  if (phase === 'waiting') {
    return '连接 AI…'
  }
  if (phase === 'thinking') {
    return `思考中 ${Math.round(progress)}%`
  }
  if (phase === 'generating') {
    return `生成中 ${Math.round(progress)}%`
  }
  return '处理中…'
}

export async function generateInternalAppHtml(
  project: ICodeInternalProject,
  instruction: string,
  onUpdate?: (update: ICodeGenerationUpdate) => void,
): Promise<ICodeGenerationResult> {
  const listing = listingFromInternal(project)
  const hasExisting = project.html.trim().length > 0

  const html = await generateAppHtmlStreaming(
    listing,
    (update) => {
      onUpdate?.({
        ...update,
        contentText: phaseSummary(update.phase, update.progress),
      })
    },
    hasExisting
      ? {
          update: {
            existingHtml: project.html,
            currentVersion: '1.0.0',
            targetVersion: nextAppVersion('1.0.0'),
            userFeedback: [
              {
                id: `icode-${Date.now()}`,
                author: '开发者',
                rating: 5,
                body: instruction,
                version: '1.0.0',
                isUser: true,
                createdAt: Date.now(),
              },
            ],
          },
        }
      : {
          detail: {
            tagline: 'iCode 内部开发项目',
            longDescription: instruction,
            developer: 'iCode',
            compatibility: 'Instant OS',
            language: '中文',
          },
        },
  )

  return {
    html,
    assistantSummary: hasExisting
      ? '已根据你的修改意见更新应用源码。'
      : '已根据描述生成新的应用源码，可在左侧预览效果。',
  }
}

