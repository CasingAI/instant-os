export type ChatContentWidth = 'standard' | 'wide' | 'full'

export const CHAT_CONTENT_WIDTH_OPTIONS: ReadonlyArray<{
  id: ChatContentWidth
  label: string
}> = [
  { id: 'standard', label: '标准' },
  { id: 'wide', label: '加宽' },
  { id: 'full', label: '全宽' },
]
