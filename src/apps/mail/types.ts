export type MailAddress = {
  name: string
  email: string
}

export type MailMessage = {
  id: string
  from: MailAddress
  to: MailAddress[]
  body: string
  sentAt: number
}

export type MailThread = {
  id: string
  subject: string
  messages: MailMessage[]
  lastMessageAt: number
  unread: boolean
}

export type MailMailbox = 'inbox' | 'sent'

export type MailStore = {
  initialized: boolean
  userAddress: MailAddress
  threads: MailThread[]
}

export type InitialMailDraft = {
  subject: string
  fromName: string
  fromEmail: string
  body: string
  sentAtOffsetHours: number
}

export type MailReplyDraft = {
  body: string
}
