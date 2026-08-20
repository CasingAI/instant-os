import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSONContent } from '@tiptap/core'
import {
  buildTableJSONFromEditGrid,
  cellAddress,
  colIndexToLetter,
  recalculateFromEditGrid,
  sheetGridToEditStrings,
  tableJSONToInputs,
  recalculateSheet,
  type SheetGrid,
} from './pages-table-formula.ts'

export type PagesSheetViewProps = {
  table: JSONContent
  editable: boolean
  onBack: () => void
  onTableChange: (table: JSONContent) => void
}

function cloneEditGrid(grid: string[][]): string[][] {
  return grid.map((row) => row.slice())
}

function ensureMinSize(grid: string[][], rows: number, cols: number): string[][] {
  const next = grid.map((row) => {
    const copy = row.slice()
    while (copy.length < cols) copy.push('')
    return copy
  })
  while (next.length < rows) {
    next.push(Array.from({ length: cols }, () => ''))
  }
  return next
}

function gridFromTable(table: JSONContent): { edit: string[][]; results: SheetGrid } {
  const inputs = tableJSONToInputs(table)
  const results = recalculateSheet(inputs)
  const edit = sheetGridToEditStrings(results)
  if (edit.length === 0) {
    return {
      edit: [
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ],
      results: recalculateFromEditGrid([
        ['', '', ''],
        ['', '', ''],
        ['', '', ''],
      ]),
    }
  }
  return { edit, results }
}

export function PagesSheetView({ table, editable, onBack, onTableChange }: PagesSheetViewProps) {
  const initial = useMemo(() => gridFromTable(table), [])
  const [editGrid, setEditGrid] = useState<string[][]>(() => initial.edit)
  const [results, setResults] = useState<SheetGrid>(() => initial.results)
  const [selected, setSelected] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const formulaInputRef = useRef<HTMLInputElement>(null)
  const cellInputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef(table)
  tableRef.current = table

  const rowCount = editGrid.length
  const colCount = editGrid[0]?.length ?? 0

  const selectedAddress = cellAddress(selected.row, selected.col)
  const selectedEdit = editGrid[selected.row]?.[selected.col] ?? ''
  const selectedResult = results[selected.row]?.[selected.col]

  const commitGrid = useCallback(
    (nextEdit: string[][]) => {
      const normalized = ensureMinSize(nextEdit, 1, 1)
      const nextResults = recalculateFromEditGrid(normalized)
      setEditGrid(sheetGridToEditStrings(nextResults))
      setResults(nextResults)
      const nextTable = buildTableJSONFromEditGrid(
        sheetGridToEditStrings(nextResults),
        tableRef.current,
      )
      onTableChange(nextTable)
    },
    [onTableChange],
  )

  const beginEdit = useCallback(
    (row: number, col: number, initialText?: string) => {
      if (!editable) return
      setSelected({ row, col })
      setEditing(true)
      setDraft(initialText ?? editGrid[row]?.[col] ?? '')
      requestAnimationFrame(() => {
        cellInputRef.current?.focus()
        cellInputRef.current?.select()
      })
    },
    [editable, editGrid],
  )

  const commitEdit = useCallback(() => {
    if (!editing) return
    const next = cloneEditGrid(editGrid)
    if (!next[selected.row]) return
    next[selected.row]![selected.col] = draft
    setEditing(false)
    commitGrid(next)
  }, [commitGrid, draft, editGrid, editing, selected.col, selected.row])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft(selectedEdit)
  }, [selectedEdit])

  const onFormulaBarCommit = useCallback(() => {
    if (!editable) return
    const next = cloneEditGrid(editGrid)
    if (!next[selected.row]) return
    next[selected.row]![selected.col] = draft
    setEditing(false)
    commitGrid(next)
  }, [commitGrid, draft, editGrid, editable, selected.col, selected.row])

  useEffect(() => {
    if (!editing) setDraft(selectedEdit)
  }, [editing, selectedEdit, selected.row, selected.col])

  const addRow = () => {
    if (!editable) return
    const next = cloneEditGrid(editGrid)
    next.push(Array.from({ length: colCount }, () => ''))
    commitGrid(next)
  }

  const addCol = () => {
    if (!editable) return
    const next = editGrid.map((row) => [...row, ''])
    commitGrid(next)
  }

  const deleteRow = () => {
    if (!editable || rowCount <= 1) return
    const next = cloneEditGrid(editGrid)
    next.splice(selected.row, 1)
    const nextRow = Math.min(selected.row, next.length - 1)
    setSelected({ row: Math.max(0, nextRow), col: selected.col })
    commitGrid(next)
  }

  const deleteCol = () => {
    if (!editable || colCount <= 1) return
    const next = editGrid.map((row) => {
      const copy = row.slice()
      copy.splice(selected.col, 1)
      return copy
    })
    const nextCol = Math.min(selected.col, (next[0]?.length ?? 1) - 1)
    setSelected({ row: selected.row, col: Math.max(0, nextCol) })
    commitGrid(next)
  }

  return (
    <div class="pages-sheet">
      <div class="pages-sheet__toolbar">
        <button type="button" class="pages-sheet__back" onClick={onBack}>
          ← 返回文稿
        </button>
        <div class="pages-sheet__formula-bar">
          <span class="pages-sheet__address" title="单元格">
            {selectedAddress}
          </span>
          <input
            ref={formulaInputRef}
            class="pages-sheet__formula-input"
            value={editing || draft !== selectedEdit ? draft : selectedEdit}
            readOnly={!editable}
            spellcheck={false}
            aria-label="公式栏"
            placeholder="输入值或 =公式"
            onFocus={() => {
              if (!editable) return
              setEditing(true)
              setDraft(selectedEdit)
            }}
            onInput={(event) => {
              setDraft((event.target as HTMLInputElement).value)
              setEditing(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onFormulaBarCommit()
                formulaInputRef.current?.blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelEdit()
                formulaInputRef.current?.blur()
              }
            }}
            onBlur={() => {
              if (editing) onFormulaBarCommit()
            }}
          />
        </div>
        <div class="pages-sheet__actions">
          <button type="button" disabled={!editable} onClick={addRow}>
            加行
          </button>
          <button type="button" disabled={!editable} onClick={addCol}>
            加列
          </button>
          <button type="button" disabled={!editable || rowCount <= 1} onClick={deleteRow}>
            删行
          </button>
          <button type="button" disabled={!editable || colCount <= 1} onClick={deleteCol}>
            删列
          </button>
        </div>
      </div>

      <div class="pages-sheet__grid-wrap">
        <table class="pages-sheet__grid">
          <thead>
            <tr>
              <th class="pages-sheet__corner" />
              {Array.from({ length: colCount }, (_, col) => (
                <th key={col} class="pages-sheet__col-header">
                  {colIndexToLetter(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editGrid.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th class="pages-sheet__row-header">{rowIndex + 1}</th>
                {row.map((cell, colIndex) => {
                  const isSelected = selected.row === rowIndex && selected.col === colIndex
                  const isEditing = isSelected && editing
                  const result = results[rowIndex]?.[colIndex]
                  const display = result?.formula ? result.display : cell
                  const isError = !!result?.error
                  return (
                    <td
                      key={colIndex}
                      class={`pages-sheet__cell${isSelected ? ' pages-sheet__cell--selected' : ''}${
                        isError ? ' pages-sheet__cell--error' : ''
                      }${result?.formula ? ' pages-sheet__cell--formula' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        if (editing && !isSelected) commitEdit()
                        setSelected({ row: rowIndex, col: colIndex })
                        setEditing(false)
                        setDraft(editGrid[rowIndex]?.[colIndex] ?? '')
                      }}
                      onDblClick={() => beginEdit(rowIndex, colIndex)}
                    >
                      {isEditing ? (
                        <input
                          ref={cellInputRef}
                          class="pages-sheet__cell-input"
                          value={draft}
                          spellcheck={false}
                          onInput={(event) => {
                            setDraft((event.target as HTMLInputElement).value)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitEdit()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelEdit()
                            } else if (event.key === 'Tab') {
                              event.preventDefault()
                              commitEdit()
                              const nextCol = Math.min(colIndex + 1, colCount - 1)
                              setSelected({ row: rowIndex, col: nextCol })
                            }
                          }}
                          onBlur={() => commitEdit()}
                        />
                      ) : (
                        <span class="pages-sheet__cell-text" title={result?.formula ?? undefined}>
                          {display}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedResult?.formula ? (
        <div class="pages-sheet__hint">
          {selectedAddress} = {selectedResult.display}
          {selectedResult.error ? '（错误）' : ''}
        </div>
      ) : null}
    </div>
  )
}
