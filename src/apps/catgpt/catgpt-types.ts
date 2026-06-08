export type CatGptRole = 'user' | 'assistant'

export type CatGptMessage = {
  id: string
  role: CatGptRole
  content: string
  createdAt: number
}

export type CatGptSession = {
  id: string
  title: string
  emoji: string
  messages: CatGptMessage[]
  createdAt: number
  updatedAt: number
}

export type CatGptStore = {
  sessions: CatGptSession[]
  activeSessionId?: string
}
