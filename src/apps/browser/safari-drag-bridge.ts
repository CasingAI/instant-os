export type SafariDragPayload = {
  kind: 'url' | 'bookmark'
  url: string
  title?: string
}

let activeDrag: SafariDragPayload | undefined

export function beginSafariDrag(payload: SafariDragPayload): void {
  activeDrag = payload
}

export function endSafariDrag(): void {
  activeDrag = undefined
}

export function getActiveSafariDrag(): SafariDragPayload | undefined {
  return activeDrag
}

export function isSafariDragActive(): boolean {
  return activeDrag !== undefined
}
