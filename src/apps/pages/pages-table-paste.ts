/** 外部粘贴（Excel / 飞书等）常把首行写成 td；升格为 th 以保留表头语义。 */
export function promotePastedTableHeaderHtml(html: string): string {
  if (!/<table\b/i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = doc.querySelectorAll('table')
  if (tables.length === 0) return html

  let changed = false
  for (const table of Array.from(tables)) {
    const firstRow = table.querySelector('tr')
    if (!firstRow) continue
    const cells = Array.from(firstRow.children).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH',
    )
    if (cells.length === 0) continue
    if (cells.some((el) => el.tagName === 'TH')) continue

    for (const td of cells) {
      if (!(td instanceof HTMLTableCellElement) || td.tagName !== 'TD') continue
      const th = doc.createElement('th')
      for (const attr of Array.from(td.attributes)) {
        th.setAttribute(attr.name, attr.value)
      }
      th.innerHTML = td.innerHTML
      td.replaceWith(th)
      changed = true
    }
  }

  return changed ? doc.body.innerHTML : html
}

/** 多行且每行含制表符时，视为可转成表格的 TSV。 */
export function clipboardLooksLikeTsvTable(text: string): boolean {
  const lines = normalizeLines(text)
  if (lines.length < 2) return false
  return lines.every((line) => line.includes('\t'))
}

/** 将 TSV 转成带表头行的 HTML 表格；非 TSV 返回 null。 */
export function tsvToTableHtml(text: string): string | null {
  if (!clipboardLooksLikeTsvTable(text)) return null
  const lines = normalizeLines(text)
  const rows = lines.map((line) => line.split('\t').map(escapeHtml))
  const colCount = Math.max(...rows.map((r) => r.length))
  if (colCount < 1) return null

  const pad = (row: string[]) => {
    while (row.length < colCount) row.push('')
    return row
  }

  const [header, ...body] = rows
  const headerCells = pad(header).map((cell) => `<th><p>${cell}</p></th>`).join('')
  const bodyHtml = body
    .map((row) => `<tr>${pad(row).map((cell) => `<td><p>${cell}</p></td>`).join('')}</tr>`)
    .join('')

  return `<table><tbody><tr>${headerCells}</tr>${bodyHtml}</tbody></table>`
}

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
