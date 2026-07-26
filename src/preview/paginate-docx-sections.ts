const PT_TO_PX = 96 / 72

function parseCssLengthToPx(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (trimmed.endsWith('pt')) return Number.parseFloat(trimmed) * PT_TO_PX
  if (trimmed.endsWith('px')) return Number.parseFloat(trimmed)
  return 0
}

function getPageHeightPx(section: HTMLElement): number {
  const fromStyle = parseCssLengthToPx(section.style.minHeight)
  if (fromStyle > 0) return fromStyle

  const computed = getComputedStyle(section).minHeight
  return parseCssLengthToPx(computed)
}

function cloneSectionShell(source: HTMLElement): HTMLElement {
  const section = source.cloneNode(false) as HTMLElement

  for (const child of source.children) {
    const el = child as HTMLElement
    if (el.tagName === 'ARTICLE') {
      const article = document.createElement('article')
      article.style.cssText = el.style.cssText
      section.appendChild(article)
      continue
    }

    if (el.tagName === 'HEADER' || el.tagName === 'FOOTER') {
      section.appendChild(el.cloneNode(true))
    }
  }

  if (!section.querySelector('article')) {
    section.appendChild(document.createElement('article'))
  }

  return section
}

function isSectionOverflowing(section: HTMLElement): boolean {
  const pageHeightPx = getPageHeightPx(section)
  if (pageHeightPx <= 0) return false
  return section.scrollHeight > pageHeightPx + 2
}

function splitSectionOnce(section: HTMLElement): boolean {
  const pageHeightPx = getPageHeightPx(section)
  if (pageHeightPx <= 0) return false

  const article = section.querySelector('article')
  if (!article || article.childElementCount === 0) return false

  const newSection = cloneSectionShell(section)
  const newArticle = newSection.querySelector('article')
  if (!newArticle) return false

  while (isSectionOverflowing(section) && article.lastElementChild) {
    newArticle.insertBefore(article.lastElementChild, newArticle.firstChild)
  }

  if (newArticle.childElementCount === 0) return false

  section.after(newSection)
  return true
}

/** 按 Word 页高拆分溢出的 section，补 docx-preview 不会自动分页的问题。 */
export function paginateDocxSections(bodyContainer: HTMLElement): void {
  const wrapper = bodyContainer.querySelector('.docx-wrapper')
  if (!wrapper) return

  for (let guard = 0; guard < 500; guard += 1) {
    const sections = Array.from(wrapper.querySelectorAll(':scope > section.docx')) as HTMLElement[]
    const overflow = sections.find(isSectionOverflowing)
    if (!overflow) return
    if (!splitSectionOnce(overflow)) return
  }
}
