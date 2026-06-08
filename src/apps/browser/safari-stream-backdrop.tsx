import { AiStreamPreview } from '../../ai/ai-stream-preview.tsx'

type SafariStreamBackdropProps = {
  reasoningText?: string
  contentText?: string
}

export function SafariStreamBackdrop({ reasoningText = '', contentText = '' }: SafariStreamBackdropProps) {
  if (!reasoningText && !contentText) {
    return undefined
  }

  return (
    <AiStreamPreview
      reasoningText={reasoningText}
      contentText={contentText}
      variant="safari"
    />
  )
}
