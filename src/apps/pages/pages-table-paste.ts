import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { normalizeFormula, replaceTableAtPos } from './pages-table-formula.ts'

export type PasteCell = {
  text: string
  formula: string | null
}

export type PasteGrid = PasteCell[][]

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

function cellTextFromJSON(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  const children = node.content
  if (!children?.length) return ''
  return children.map((child) => cellTextFromJSON(child)).join('')
}

function pasteCellFromJSON(cell: JSONContent): PasteCell {
  const text = cellTextFromJSON(cell)
  const formulaAttr =
    typeof cell.attrs?.formula === 'string' ? normalizeFormula(cell.attrs.formula) : null
  if (formulaAttr) return { text, formula: formulaAttr }
  const trimmed = text.trim()
  if (trimmed.startsWith('=')) {
    return { text, formula: normalizeFormula(trimmed) }
  }
  return { text, formula: null }
}

/** 从 TipTap 剪贴板 doc JSON 提取第一张表的网格；无表返回 null。 */
export function extractGridFromClipboardDoc(doc: JSONContent): PasteGrid | null {
  const walk = (node: JSONContent): PasteGrid | null => {
    if (node.type === 'table') {
      const rows = node.content ?? []
      if (rows.length === 0) return null
      return rows.map((row) => (row.content ?? []).map((cell) => pasteCellFromJSON(cell)))
    }
    for (const child of node.content ?? []) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(doc)
}

/** 从 HTML 中提取第一张表的网格。 */
export function extractGridFromHtml(html: string): PasteGrid | null {
  if (!/<table\b/i.test(html)) return null
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return null
  const grid: PasteGrid = rows.map((tr) => {
    const cells = Array.from(tr.children).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH',
    )
    return cells.map((cell) => {
      const text = (cell.textContent ?? '').replace(/\u00a0/g, ' ')
      const formulaAttr = cell.getAttribute('data-formula')
      const formula = formulaAttr ? normalizeFormula(formulaAttr) : null
      if (formula) return { text, formula }
      const trimmed = text.trim()
      if (trimmed.startsWith('=')) return { text, formula: normalizeFormula(trimmed) }
      return { text, formula: null }
    })
  })
  return grid.some((row) => row.length > 0) ? grid : null
}

/** 从 TSV 文本提取网格。 */
export function extractGridFromTsv(text: string): PasteGrid | null {
  if (!clipboardLooksLikeTsvTable(text)) return null
  const lines = normalizeLines(text)
  return lines.map((line) =>
    line.split('\t').map((cell) => {
      const trimmed = cell.trim()
      if (trimmed.startsWith('=')) {
        return { text: cell, formula: normalizeFormula(trimmed) }
      }
      return { text: cell, formula: null }
    }),
  )
}

function paragraphJSON(text: string): JSONContent {
  if (!text) return { type: 'paragraph' }
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function emptyCellJSON(type: 'tableCell' | 'tableHeader'): JSONContent {
  return { type, content: [paragraphJSON('')] }
}

/**
 * 将网格合并进目标表 JSON：从 (startRow, startCol) 起覆盖，不足则扩行列。
 * 保留原表 attrs / 既有单元格类型；新扩出的行首行以外用 tableCell，首行延续 header 偏好。
 */
export function mergeGridIntoTableJSON(
  table: JSONContent,
  startRow: number,
  startCol: number,
  grid: PasteGrid,
): JSONContent {
  const srcRows = grid.length
  const srcCols = Math.max(0, ...grid.map((r) => r.length), 0)
  if (srcRows === 0 || srcCols === 0) return table

  const prevRows = [...(table.content ?? [])]
  const prevColCount = Math.max(0, ...prevRows.map((r) => r.content?.length ?? 0))
  const needRows = Math.max(prevRows.length, startRow + srcRows)
  const needCols = Math.max(prevColCount, startCol + srcCols)

  const firstRowIsHeader =
    prevRows[0]?.content?.some((c) => c.type === 'tableHeader') ||
    (!prevRows.length && startRow === 0)

  while (prevRows.length < needRows) {
    const r = prevRows.length
    const cellType: 'tableCell' | 'tableHeader' =
      r === 0 && firstRowIsHeader ? 'tableHeader' : 'tableCell'
    prevRows.push({
      type: 'tableRow',
      content: Array.from({ length: needCols }, () => emptyCellJSON(cellType)),
    })
  }

  const nextRows = prevRows.map((row, r) => {
    const cells = [...(row.content ?? [])]
    while (cells.length < needCols) {
      const cellType: 'tableCell' | 'tableHeader' =
        cells[0]?.type === 'tableHeader' || (r === 0 && firstRowIsHeader)
          ? 'tableHeader'
          : 'tableCell'
      cells.push(emptyCellJSON(cellType))
    }

    for (let c = 0; c < needCols; c++) {
      const gr = r - startRow
      const gc = c - startCol
      if (gr < 0 || gc < 0 || gr >= grid.length || gc >= (grid[gr]?.length ?? 0)) continue
      const paste = grid[gr]![gc]!
      const prev = cells[c]
      const cellType: 'tableCell' | 'tableHeader' =
        prev?.type === 'tableHeader' ? 'tableHeader' : 'tableCell'
      const attrs: Record<string, unknown> = { ...(prev?.attrs ?? {}) }
      if (paste.formula) {
        attrs.formula = paste.formula
        delete attrs.formulaError
      } else {
        delete attrs.formula
        delete attrs.formulaError
      }
      const display = paste.formula ? paste.text : paste.text
      cells[c] = {
        type: cellType,
        attrs: Object.keys(attrs).length ? attrs : undefined,
        content: [paragraphJSON(display)],
      }
    }

    return { type: 'tableRow' as const, content: cells }
  })

  return {
    type: 'table',
    attrs: table.attrs ? { ...table.attrs } : undefined,
    content: nextRows,
  }
}

/** 当前选区是否在表内，以及锚点单元格行列、表节点位置。 */
export function findTablePasteAnchor(
  editor: Editor,
): { tablePos: number; tableNode: ProseMirrorNode; row: number; col: number } | null {
  const { state } = editor
  const { selection } = state

  let cellPos = -1
  if (selection instanceof CellSelection) {
    cellPos = selection.$anchorCell.pos
  } else {
    const $from = selection.$from
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name
      if (name === 'tableCell' || name === 'tableHeader') {
        cellPos = $from.before(d)
        break
      }
    }
  }
  if (cellPos < 0) return null

  const $cell = state.doc.resolve(cellPos)
  let tableDepth = -1
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === 'table') {
      tableDepth = d
      break
    }
  }
  if (tableDepth < 0) return null

  const tablePos = $cell.before(tableDepth)
  const tableNode = $cell.node(tableDepth)
  const map = TableMap.get(tableNode)
  const rect = map.findCell(cellPos - tablePos - 1)
  return { tablePos, tableNode, row: rect.top, col: rect.left }
}

/**
 * 若光标在表内且 grid 非空，合并进当前表并替换节点。
 * @returns 是否已处理
 */
export function tryMergePasteGridIntoSelection(editor: Editor, grid: PasteGrid | null): boolean {
  if (!grid || grid.length === 0) return false
  if (grid.every((row) => row.length === 0)) return false
  const anchor = findTablePasteAnchor(editor)
  if (!anchor) return false
  const tableJSON = anchor.tableNode.toJSON() as JSONContent
  const merged = mergeGridIntoTableJSON(tableJSON, anchor.row, anchor.col, grid)
  return replaceTableAtPos(editor, anchor.tablePos, merged)
}
