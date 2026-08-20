import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { HyperFormula, DetailedCellError } from 'hyperformula'

/** 单元格原始输入：公式（含 =）或字面量 */
export type SheetCellInput = string | number | boolean | null

export type SheetCellResult = {
  /** 显示用文本 */
  display: string
  /** 是否为公式错误 */
  error: boolean
  /** 规范化后的公式（含 =），字面量为 null */
  formula: string | null
  /** 写入引擎的原始值 */
  input: SheetCellInput
}

export type SheetGrid = SheetCellResult[][]

const HF_OPTIONS = {
  licenseKey: 'gpl-v3',
  useColumnIndex: false,
  useStats: false,
} as const

let tableIdCounter = 0

export function createTableId(): string {
  tableIdCounter += 1
  return `tbl-${Date.now().toString(36)}-${tableIdCounter}`
}

/** 列索引 → A, B, … Z, AA, … */
export function colIndexToLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function cellAddress(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`
}

export function normalizeFormula(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('=')) return trimmed
  return `=${trimmed}`
}

function cellTextFromJSON(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  const children = node.content
  if (!children?.length) return ''
  return children.map((child) => cellTextFromJSON(child)).join('')
}

function cellTextFromPM(node: ProseMirrorNode): string {
  return node.textContent ?? ''
}

function parseLiteral(text: string): SheetCellInput {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

function formatCellValue(value: unknown): { display: string; error: boolean } {
  if (value == null) return { display: '', error: false }
  if (value instanceof DetailedCellError) {
    return { display: value.value || '#ERROR!', error: true }
  }
  if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
    const err = value as { type: string; value: string }
    return { display: err.value || '#ERROR!', error: true }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { display: '#NUM!', error: true }
    return { display: String(value), error: false }
  }
  if (typeof value === 'boolean') return { display: value ? 'TRUE' : 'FALSE', error: false }
  if (value instanceof Date) return { display: value.toISOString(), error: false }
  return { display: String(value), error: false }
}

function readCellInputFromAttrsAndText(
  formulaAttr: unknown,
  text: string,
): { input: SheetCellInput; formula: string | null } {
  const fromAttr = normalizeFormula(typeof formulaAttr === 'string' ? formulaAttr : null)
  if (fromAttr) return { input: fromAttr, formula: fromAttr }

  const trimmed = text.trim()
  if (trimmed.startsWith('=')) {
    const formula = normalizeFormula(trimmed)
    return { input: formula, formula }
  }
  return { input: parseLiteral(text), formula: null }
}

/** 从 TipTap JSON 表节点提取输入矩阵 */
export function tableJSONToInputs(table: JSONContent): SheetCellInput[][] {
  const rows = table.content ?? []
  return rows.map((row) => {
    const cells = row.content ?? []
    return cells.map((cell) => {
      const text = cellTextFromJSON(cell)
      return readCellInputFromAttrsAndText(cell.attrs?.formula, text).input
    })
  })
}

/** 从 ProseMirror table 节点提取输入矩阵（仅认 attrs.formula，避免输入中的 = 被重算覆盖） */
export function tableNodeToInputs(table: ProseMirrorNode): SheetCellInput[][] {
  const inputs: SheetCellInput[][] = []
  table.forEach((row) => {
    if (row.type.name !== 'tableRow') return
    const rowInputs: SheetCellInput[] = []
    row.forEach((cell) => {
      if (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader') return
      const fromAttr = normalizeFormula(
        typeof cell.attrs.formula === 'string' ? cell.attrs.formula : null,
      )
      if (fromAttr) {
        rowInputs.push(fromAttr)
        return
      }
      const text = cellTextFromPM(cell)
      rowInputs.push(parseLiteral(text))
    })
    inputs.push(rowInputs)
  })
  return inputs
}

/** 将单元格正文里以 = 开头的文本提升为 formula attr（失焦时调用） */
export function promoteEqualsTextToFormulas(editor: Editor): boolean {
  if (editor.isDestroyed) return false
  const { state } = editor
  let tr = state.tr
  let changed = false

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return true
    if (typeof node.attrs.formula === 'string' && node.attrs.formula) return true
    const text = cellTextFromPM(node).trim()
    if (!text.startsWith('=')) return true
    const formula = normalizeFormula(text)
    if (!formula) return true
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      formula,
    })
    changed = true
    return true
  })

  if (!changed) return false
  editor.view.dispatch(tr)
  return true
}

/** 用 HyperFormula 重算，返回与输入同尺寸的结果网格 */
export function recalculateSheet(inputs: SheetCellInput[][]): SheetGrid {
  if (inputs.length === 0) return []

  const width = Math.max(0, ...inputs.map((row) => row.length))
  const padded = inputs.map((row) => {
    const next = row.slice()
    while (next.length < width) next.push(null)
    return next
  })

  const hf = HyperFormula.buildFromArray(padded as (string | number | boolean | null)[][], {
    ...HF_OPTIONS,
  })

  try {
    const sheetId = 0
    return padded.map((row, rowIndex) =>
      row.map((input, colIndex) => {
        const formula =
          typeof input === 'string' && input.trim().startsWith('=')
            ? normalizeFormula(input)
            : null
        const raw = hf.getCellValue({ sheet: sheetId, row: rowIndex, col: colIndex })
        const { display, error } = formatCellValue(raw)
        return { display, error, formula, input }
      }),
    )
  } finally {
    hf.destroy()
  }
}

function paragraphJSON(text: string): JSONContent {
  if (!text) return { type: 'paragraph' }
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function cellJSONFromResult(
  type: 'tableCell' | 'tableHeader',
  prev: JSONContent | undefined,
  result: SheetCellResult,
): JSONContent {
  const attrs: Record<string, unknown> = { ...(prev?.attrs ?? {}) }
  if (result.formula) {
    attrs.formula = result.formula
  } else {
    delete attrs.formula
  }
  if (result.error) {
    attrs.formulaError = true
  } else {
    delete attrs.formulaError
  }

  // 公式格：正文为计算结果；字面量格：保留用户输入文本（非数字也保留原样）
  let text: string
  if (result.formula) {
    text = result.display
  } else if (result.input == null) {
    text = ''
  } else if (typeof result.input === 'string') {
    text = result.input
  } else {
    text = String(result.input)
  }

  return {
    type,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    content: [paragraphJSON(text)],
  }
}

/** 将结果写回 JSON 表节点（保留表 attrs / 行结构 / 单元格类型） */
export function applySheetResultsToTableJSON(
  table: JSONContent,
  results: SheetGrid,
): JSONContent {
  const prevRows = table.content ?? []
  const rowCount = Math.max(prevRows.length, results.length)
  const colCount = Math.max(
    ...prevRows.map((r) => r.content?.length ?? 0),
    ...results.map((r) => r.length),
    0,
  )

  const content: JSONContent[] = []
  for (let r = 0; r < rowCount; r++) {
    const prevRow = prevRows[r]
    const resultRow = results[r] ?? []
    const prevCells = prevRow?.content ?? []
    const cells: JSONContent[] = []
    for (let c = 0; c < colCount; c++) {
      const prevCell = prevCells[c]
      const cellType: 'tableCell' | 'tableHeader' =
        prevCell?.type === 'tableHeader' || (!prevCell && r === 0) ? 'tableHeader' : 'tableCell'
      const result =
        resultRow[c] ??
        ({
          display: '',
          error: false,
          formula: null,
          input: null,
        } satisfies SheetCellResult)
      cells.push(cellJSONFromResult(cellType, prevCell, result))
    }
    content.push({
      type: 'tableRow',
      content: cells,
    })
  }

  const attrs = { ...(table.attrs ?? {}) }
  if (!attrs.id || typeof attrs.id !== 'string') {
    attrs.id = createTableId()
  }

  return {
    type: 'table',
    attrs,
    content,
  }
}

/** 从 2D 编辑模型（公式栏提交的字符串）构建输入并重算 */
export function recalculateFromEditGrid(editGrid: string[][]): SheetGrid {
  const inputs: SheetCellInput[][] = editGrid.map((row) =>
    row.map((cell) => {
      const trimmed = cell.trim()
      if (!trimmed) return null
      if (trimmed.startsWith('=')) return normalizeFormula(trimmed)
      return parseLiteral(trimmed)
    }),
  )
  return recalculateSheet(inputs)
}

/** 结果网格 → 编辑用字符串（公式优先，否则显示值） */
export function sheetGridToEditStrings(grid: SheetGrid): string[][] {
  return grid.map((row) =>
    row.map((cell) => {
      if (cell.formula) return cell.formula
      if (cell.input == null) return ''
      return typeof cell.input === 'string' ? cell.input : String(cell.input)
    }),
  )
}

export function findTablePosById(
  editor: Editor,
  tableId: string,
): { pos: number; node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'table' && node.attrs.id === tableId) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

export function ensureTableIdOnNode(table: ProseMirrorNode): string {
  const existing = table.attrs.id
  if (typeof existing === 'string' && existing) return existing
  return createTableId()
}

/** 用新表 JSON 替换文档中指定 pos 的表节点 */
export function replaceTableAtPos(editor: Editor, pos: number, tableJSON: JSONContent): boolean {
  const { state } = editor
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'table') return false
  const parsed = node.type.schema.nodeFromJSON(tableJSON)
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, parsed)
  editor.view.dispatch(tr)
  return true
}

/** 对文档中所有表重算公式并写回（有变更才 dispatch） */
export function recalculateAllTablesInEditor(editor: Editor): boolean {
  if (editor.isDestroyed) return false
  const { state } = editor
  const tables: { pos: number; node: ProseMirrorNode }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      tables.push({ pos, node })
      return false
    }
    return true
  })
  if (tables.length === 0) return false

  // 从后往前替换，避免 pos 偏移
  let tr = state.tr
  let changed = false
  for (let i = tables.length - 1; i >= 0; i--) {
    const { pos } = tables[i]!
    const mappedPos = tr.mapping.map(pos)
    const current = tr.doc.nodeAt(mappedPos)
    if (!current || current.type.name !== 'table') continue

    const inputs = tableNodeToInputs(current)
    const hasFormula = inputs.some((row) =>
      row.some((cell) => typeof cell === 'string' && cell.trim().startsWith('=')),
    )
    // 无公式也确保 id
    const tableJSON = current.toJSON() as JSONContent
    if (!hasFormula) {
      if (!current.attrs.id) {
        const withId = {
          ...tableJSON,
          attrs: { ...(tableJSON.attrs ?? {}), id: createTableId() },
        }
        const parsed = current.type.schema.nodeFromJSON(withId)
        tr = tr.replaceWith(mappedPos, mappedPos + current.nodeSize, parsed)
        changed = true
      }
      continue
    }

    const results = recalculateSheet(inputs)
    const nextJSON = applySheetResultsToTableJSON(tableJSON, results)
    // 比较显示文本与 formula attrs 是否变化
    const prevSerialized = JSON.stringify(tableJSON)
    const nextSerialized = JSON.stringify(nextJSON)
    if (prevSerialized === nextSerialized) continue

    const parsed = current.type.schema.nodeFromJSON(nextJSON)
    tr = tr.replaceWith(mappedPos, mappedPos + current.nodeSize, parsed)
    changed = true
  }

  if (!changed) return false
  editor.view.dispatch(tr)
  return true
}

/** 从编辑字符串网格生成完整 table JSON（保留 header 行偏好） */
export function buildTableJSONFromEditGrid(
  editGrid: string[][],
  prevTable?: JSONContent | null,
): JSONContent {
  const results = recalculateFromEditGrid(editGrid)
  const prevRows = prevTable?.content ?? []
  const synthetic: JSONContent = {
    type: 'table',
    attrs: {
      ...(prevTable?.attrs ?? {}),
      id:
        (typeof prevTable?.attrs?.id === 'string' && prevTable.attrs.id) ||
        createTableId(),
    },
    content: results.map((row, r) => {
      const prevRow = prevRows[r]
      const prevCells = prevRow?.content ?? []
      return {
        type: 'tableRow',
        content: row.map((cell, c) => {
          const prevCell = prevCells[c]
          const cellType: 'tableCell' | 'tableHeader' =
            prevCell?.type === 'tableHeader' || (!prevCell && r === 0)
              ? 'tableHeader'
              : 'tableCell'
          return cellJSONFromResult(cellType, prevCell, cell)
        }),
      }
    }),
  }

  return applySheetResultsToTableJSON(synthetic, results)
}
