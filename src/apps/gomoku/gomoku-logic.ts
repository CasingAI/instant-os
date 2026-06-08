export const BOARD_SIZE = 15
export const WIN_COUNT = 5

export type Stone = 0 | 1 | 2
export type Player = 1 | 2

export type Board = Stone[][]

export type WinResult = {
  player: Player
  cells: Array<{ row: number; col: number }>
  direction: 'horizontal' | 'vertical' | 'diagonal-main' | 'diagonal-anti'
}

export type MoveRecord = {
  row: number
  col: number
  player: Player
}

const DIRECTIONS: ReadonlyArray<{
  dr: number
  dc: number
  direction: WinResult['direction']
}> = [
  { dr: 0, dc: 1, direction: 'horizontal' },
  { dr: 1, dc: 0, direction: 'vertical' },
  { dr: 1, dc: 1, direction: 'diagonal-main' },
  { dr: 1, dc: -1, direction: 'diagonal-anti' },
]

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Stone>(BOARD_SIZE).fill(0))
}

export function getOpponent(player: Player): Player {
  return player === 1 ? 2 : 1
}

export function isValidMove(board: Board, row: number, col: number): boolean {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false
  return board[row][col] === 0
}

function collectLine(
  board: Board,
  row: number,
  col: number,
  dr: number,
  dc: number,
  player: Player,
): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [{ row, col }]

  let r = row + dr
  let c = col + dc
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    cells.push({ row: r, col: c })
    r += dr
    c += dc
  }

  r = row - dr
  c = col - dc
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    cells.unshift({ row: r, col: c })
    r -= dr
    c -= dc
  }

  return cells
}

export function checkWin(board: Board, row: number, col: number, player: Player): WinResult | undefined {
  for (const { dr, dc, direction } of DIRECTIONS) {
    const cells = collectLine(board, row, col, dr, dc, player)
    if (cells.length >= WIN_COUNT) {
      return { player, cells, direction }
    }
  }
  return undefined
}

export function applyMove(board: Board, row: number, col: number, player: Player): Board {
  const next = board.map((line) => [...line]) as Board
  next[row][col] = player
  return next
}

export function isBoardFull(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell !== 0))
}

export function formatCoord(row: number, col: number): string {
  const colLabel = String.fromCharCode(65 + col)
  return `${colLabel}${row + 1}`
}

export function playerLabel(player: Player): string {
  return player === 1 ? '黑棋' : '白棋'
}

export function sideLabel(player: Player, firstPlayer: Player): string {
  return player === firstPlayer ? `${playerLabel(player)} · 先手` : `${playerLabel(player)} · 后手`
}

export function parseCoord(text: string): { row: number; col: number } | undefined {
  const match = text.trim().match(/\b([A-O])(1[0-5]|[1-9])\b/i)
  if (!match) return undefined
  const col = match[1].toUpperCase().charCodeAt(0) - 65
  const row = Number(match[2]) - 1
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return undefined
  return { row, col }
}

export function listValidMoves(board: Board): Array<{ row: number; col: number }> {
  const moves: Array<{ row: number; col: number }> = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (isValidMove(board, row, col)) {
        moves.push({ row, col })
      }
    }
  }
  return moves
}

export function boardToAscii(board: Board): string {
  const header = `    ${Array.from({ length: BOARD_SIZE }, (_, index) => String.fromCharCode(65 + index)).join(' ')}`
  const rows = board.map((line, row) => {
    const cells = line.map((cell) => (cell === 0 ? '.' : cell === 1 ? 'X' : 'O')).join(' ')
    const rowNum = String(row + 1).padStart(2, ' ')
    return `${rowNum}  ${cells}`
  })
  return [header, ...rows].join('\n')
}

function lineScore(board: Board, row: number, col: number, dr: number, dc: number, player: Player): number {
  let count = 0
  let openEnds = 0

  let r = row + dr
  let c = col + dc
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count += 1
    r += dr
    c += dc
  }
  if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === 0) {
    openEnds += 1
  }

  r = row - dr
  c = col - dc
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
    count += 1
    r -= dr
    c -= dc
  }
  if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === 0) {
    openEnds += 1
  }

  if (count >= WIN_COUNT - 1) return 100_000
  if (count === WIN_COUNT - 2 && openEnds >= 1) return 10_000
  if (count === 3 && openEnds >= 1) return 1_000
  if (count === 2 && openEnds >= 1) return 100
  if (count === 1 && openEnds >= 1) return 10
  return 0
}

function evaluateMove(board: Board, row: number, col: number, player: Player): number {
  const opponent = getOpponent(player)
  const next = applyMove(board, row, col, player)
  if (checkWin(next, row, col, player)) {
    return 1_000_000
  }

  const blockBoard = applyMove(board, row, col, opponent)
  if (checkWin(blockBoard, row, col, opponent)) {
    return 900_000
  }

  let attack = 0
  for (const { dr, dc } of DIRECTIONS) {
    attack += lineScore(next, row, col, dr, dc, player)
  }

  let threat = 0
  for (const { dr, dc } of DIRECTIONS) {
    threat += lineScore(blockBoard, row, col, dr, dc, opponent)
  }

  const center = (BOARD_SIZE - 1) / 2
  const centerBonus = Math.max(0, 14 - (Math.abs(row - center) + Math.abs(col - center))) * 2
  const occupiedNeighbors = board
    .flatMap((line, boardRow) => line.map((cell, boardCol) => ({ cell, boardRow, boardCol })))
    .filter(
      ({ cell, boardRow, boardCol }) =>
        cell !== 0 && Math.abs(boardRow - row) <= 2 && Math.abs(boardCol - col) <= 2,
    ).length

  return attack * 2 + threat + centerBonus + occupiedNeighbors * 3
}

export function pickFallbackMove(board: Board, aiPlayer: Player = 2): { row: number; col: number } {
  const moves = listValidMoves(board)
  if (moves.length === 0) {
    throw new Error('棋盘已无空位')
  }

  const ranked = [...moves].sort((left, right) => {
    return evaluateMove(board, right.row, right.col, aiPlayer) - evaluateMove(board, left.row, left.col, aiPlayer)
  })

  const bestScore = evaluateMove(board, ranked[0].row, ranked[0].col, aiPlayer)
  const candidates = ranked.filter(
    (move) => evaluateMove(board, move.row, move.col, aiPlayer) === bestScore,
  )
  return candidates[Math.floor(Math.random() * candidates.length)]
}
