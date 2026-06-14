type SafariDragGhostOptions = {
  glyph: string
  label: string
  color: string
}

export function setSafariBookmarkDragImage(event: DragEvent, options: SafariDragGhostOptions): void {
  const transfer = event.dataTransfer
  if (!transfer) {
    return
  }

  const ghost = document.createElement('div')
  ghost.className = 'safari-drag-ghost'
  ghost.setAttribute('aria-hidden', 'true')

  const icon = document.createElement('span')
  icon.className = 'safari-drag-ghost__icon'
  icon.style.background = options.color
  icon.textContent = options.glyph

  const label = document.createElement('span')
  label.className = 'safari-drag-ghost__label'
  label.textContent = options.label

  ghost.append(icon, label)
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.pointerEvents = 'none'
  document.body.appendChild(ghost)

  transfer.setDragImage(ghost, 18, 16)

  requestAnimationFrame(() => {
    ghost.remove()
  })
}
