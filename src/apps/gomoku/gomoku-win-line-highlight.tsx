import { BOARD_SIZE, type WinResult } from './gomoku-logic.ts'

const GRID_SPAN = BOARD_SIZE - 1

type GomokuWinLineHighlightProps = {
  winResult: WinResult
  intense?: boolean
}

export function GomokuWinLineHighlight({ winResult, intense = false }: GomokuWinLineHighlightProps) {
  const first = winResult.cells[0]
  const last = winResult.cells.at(-1)
  if (!first || !last) return undefined

  return (
    <svg
      class={`gomoku-app__win-line${intense ? ' gomoku-app__win-line--intense' : ''}`}
      viewBox={`0 0 ${GRID_SPAN} ${GRID_SPAN}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1={first.col} y1={first.row} x2={last.col} y2={last.row} />
    </svg>
  )
}
