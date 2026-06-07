import type { MailAddress } from './types.ts'

export function parseMailAddressInput(input: string): MailAddress | undefined {
  const trimmed = input.trim()
  if (!trimmed) {
    return undefined
  }

  const bracketMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/)
  if (bracketMatch) {
    const name = bracketMatch[1].trim().replace(/^["']|["']$/g, '')
    const email = bracketMatch[2].trim().toLowerCase()
    if (!email.includes('@')) {
      return undefined
    }
    return { name: name || email.split('@')[0], email }
  }

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase()
    return { name: email.split('@')[0], email }
  }

  return undefined
}

export function formatMailAddress(address: MailAddress): string {
  if (!address.name || address.name === address.email) {
    return address.email
  }
  return `${address.name} <${address.email}>`
}
