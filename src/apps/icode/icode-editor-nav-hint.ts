import {
  describePublishDiff,
  describePublishDiffMessage,
  type ICodeDraftComparable,
  type ICodePublishedSnapshot,
} from './icode-draft.ts'

export type IcodeEditorNavHintTone = 'idle' | 'generating' | 'draft' | 'publish'

export type IcodeEditorNavHint = {
  tone: IcodeEditorNavHintTone
  message: string
}

type BuildIcodeEditorNavHintInput = {
  generating: boolean
  codeEditing: boolean
  generationStatus: string
  codeDirty: boolean
  publishDirty: boolean
  internalSaveDirty: boolean
  chatDirty: boolean
  currentDraft: ICodeDraftComparable | undefined
  publishedSnapshot: ICodePublishedSnapshot | undefined
  htmlLength: number
}

export function buildIcodeEditorNavHint(input: BuildIcodeEditorNavHintInput): IcodeEditorNavHint {
  if (input.codeEditing) {
    return {
      tone: 'generating',
      message: input.generationStatus || '生成中…',
    }
  }

  if (input.generating) {
    return {
      tone: 'idle',
      message: 'AI 回复中…',
    }
  }

  if (input.codeDirty) {
    return {
      tone: 'draft',
      message: '源码已修改，与左侧预览不一致。点击「运行」同步预览。',
    }
  }

  if (input.publishDirty && input.currentDraft && input.publishedSnapshot) {
    return {
      tone: 'publish',
      message: describePublishDiffMessage(
        describePublishDiff(input.currentDraft, input.publishedSnapshot),
      ),
    }
  }

  if (input.internalSaveDirty) {
    return {
      tone: 'draft',
      message: '编辑区有未保存的更改。点击「保存」写入 iCode 草稿。',
    }
  }

  if (input.chatDirty) {
    return {
      tone: 'draft',
      message: '对话记录未保存。点击「保存」保留聊天记录。',
    }
  }

  return {
    tone: 'idle',
    message: `${input.htmlLength.toLocaleString('zh-CN')} 字符 · 与桌面正式版一致`,
  }
}

export function buildIcodeClosePromptHint(input: {
  codeDirty: boolean
  publishDirty: boolean
  internalSaveDirty: boolean
  chatDirty: boolean
  currentDraft: ICodeDraftComparable | undefined
  publishedSnapshot: ICodePublishedSnapshot | undefined
}): string {
  if (input.codeDirty) {
    return '源码、预览或运行数据可能尚未保存。你可以发布到桌面、仅保存 iCode 草稿，或放弃所有未保存更改。'
  }

  if (input.publishDirty && input.currentDraft && input.publishedSnapshot) {
    const diff = describePublishDiff(input.currentDraft, input.publishedSnapshot)
    if (diff.appData && !diff.html && !diff.meta) {
      return '编辑区运行数据与桌面正式版不同。你可以发布到桌面、仅保存 iCode 草稿，或放弃更改并恢复为桌面版本。'
    }

    return `${describePublishDiffMessage(diff)} 你可以发布到桌面、仅保存 iCode 草稿，或放弃所有未保存更改。`
  }

  if (input.internalSaveDirty || input.chatDirty) {
    return '编辑区有未保存的草稿或对话。你可以保存 iCode 草稿，或放弃所有未保存更改。'
  }

  return '当前编辑尚未同步到桌面应用。你可以发布到桌面、仅保存 iCode 草稿，或放弃所有未保存更改。'
}
