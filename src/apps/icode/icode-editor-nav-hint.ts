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

export type IcodeClosePrompt = {
  title: string
  message: string
}

export function buildIcodeClosePrompt(input: {
  codeDirty: boolean
  internalSaveDirty: boolean
  chatDirty: boolean
}): IcodeClosePrompt {
  if (input.codeDirty) {
    return {
      title: '有未保存的更改',
      message:
        '源码已修改但尚未保存。关闭前请先保存，或选择放弃这些更改（将恢复为上次保存的内容）。',
    }
  }

  if (input.chatDirty && !input.internalSaveDirty) {
    return {
      title: '有未保存的更改',
      message:
        '对话记录尚未保存。关闭前请先保存，或选择放弃这些更改（将恢复为上次保存的对话）。',
    }
  }

  return {
    title: '有未保存的更改',
    message:
      '编辑区还有尚未写入草稿的内容。关闭前请先保存，或选择放弃这些更改（将恢复为上次保存的内容）。',
  }
}
