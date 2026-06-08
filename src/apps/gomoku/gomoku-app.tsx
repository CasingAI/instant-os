import type { ComponentChild } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { hasOpenAiApiKey } from '../../ai/openai-config.ts'
import { useDefaultAiModelFriendlyName } from '../../ai/use-default-ai-model.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  GOMOKU_HEURISTIC_AI_NAME,
  gomokuAiDegradeBannerMessage,
  gomokuAiDegradeOpponentLabel,
  gomokuAiThinkingStatusText,
  pickAiMove,
  pickHeuristicMove,
  probeGomokuAiServiceReachable,
  type GomokuAiDegradeReason,
  type GomokuAiMoveResult,
  type GomokuAiThinkingLabel,
} from './gomoku-agent.ts'
import { GomokuAiAlertBanner } from './gomoku-ai-alert-banner.tsx'
import {
  applyMove,
  BOARD_SIZE,
  checkWin,
  createEmptyBoard,
  formatCoord,
  getOpponent,
  isBoardFull,
  isValidMove,
  playerLabel,
  sideLabel,
  type Board,
  type MoveRecord,
  type Player,
  type WinResult,
} from './gomoku-logic.ts'
import { GomokuDrawCelebration } from './gomoku-draw-celebration.tsx'
import { GomokuModelName } from './gomoku-model-name.tsx'
import { GomokuMatchIntro } from './gomoku-match-intro.tsx'
import { GomokuWinCelebration } from './gomoku-win-celebration.tsx'
import { GomokuWinLineHighlight } from './gomoku-win-line-highlight.tsx'
import { loadGomokuGameMode, saveGomokuGameMode, type GomokuGameMode } from './gomoku-storage.ts'
import { playInvalidSound, playPlaceSound, playUndoSound, playWinSound } from './gomoku-sounds.ts'
import './gomoku.css'

const STAR_POINTS = new Set(
  [
    [3, 3],
    [3, 11],
    [11, 3],
    [11, 11],
    [7, 7],
  ].map(([row, col]) => `${row},${col}`),
)

type GamePhase = 'playing' | 'won' | 'draw'

type GameState = {
  board: Board
  currentPlayer: Player
  humanPlayer: Player
  moves: MoveRecord[]
  phase: GamePhase
  winResult: WinResult | undefined
}

type SessionPhase = 'idle' | 'intro' | 'active'

function createInitialState(humanPlayer: Player = 1): GameState {
  return {
    board: createEmptyBoard(),
    currentPlayer: 1,
    humanPlayer,
    moves: [],
    phase: 'playing',
    winResult: undefined,
  }
}

function isWinCell(winResult: WinResult | undefined, row: number, col: number): boolean {
  if (!winResult) return false
  return winResult.cells.some((cell) => cell.row === row && cell.col === col)
}

function advanceAfterMove(
  prev: GameState,
  board: Board,
  player: Player,
  move: MoveRecord,
  winResult: WinResult | undefined,
): GameState {
  if (winResult) {
    return {
      ...prev,
      board,
      currentPlayer: player,
      moves: [...prev.moves, move],
      phase: 'won',
      winResult,
    }
  }

  if (isBoardFull(board)) {
    return {
      ...prev,
      board,
      currentPlayer: player,
      moves: [...prev.moves, move],
      phase: 'draw',
      winResult: undefined,
    }
  }

  return {
    ...prev,
    board,
    currentPlayer: getOpponent(player),
    moves: [...prev.moves, move],
    phase: 'playing',
    winResult: undefined,
  }
}

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

const GRID_SPAN = BOARD_SIZE - 1
const AI_MOVE_MIN_MS = 480
const HEURISTIC_MOVE_MIN_MS = 2000
const AI_RECOVERY_PROBE_MS = 12_000
const WIN_LINE_REVEAL_MS = 3000

function countUndoMoves(moves: MoveRecord[], gameMode: GomokuGameMode, humanPlayer: Player): number {
  if (moves.length === 0) return 0
  if (gameMode !== 'pve') return 1

  const last = moves.at(-1)
  if (!last) return 0
  if (last.player !== humanPlayer) return 1
  return moves.length >= 2 ? 2 : 1
}

function rebuildStateAfterUndo(prev: GameState, moves: MoveRecord[]): GameState {
  const board = createEmptyBoard()
  for (const move of moves) {
    board[move.row][move.col] = move.player
  }
  const last = moves.at(-1)
  return {
    ...prev,
    board,
    currentPlayer: last ? getOpponent(last.player) : 1,
    moves,
    phase: 'playing',
    winResult: undefined,
  }
}

function renderAiThinkingStatus(
  label: GomokuAiThinkingLabel,
  usingRemoteAi: boolean,
  opponentFriendlyName: string,
  modelClass?: string,
): ComponentChild {
  if (!usingRemoteAi) {
    return '本地 AI 思考中…'
  }
  return (
    <>
      <span>{gomokuAiThinkingStatusText(label)}</span>
      <GomokuModelName name={opponentFriendlyName} class={modelClass} />
    </>
  )
}

function renderAivaiThinkingStatus(
  currentPlayer: Player,
  heuristicPlayer: Player,
  label: GomokuAiThinkingLabel,
  usingRemoteModel: boolean,
  opponentFriendlyName: string,
  modelClass?: string,
): ComponentChild {
  if (currentPlayer === heuristicPlayer) {
    return `${GOMOKU_HEURISTIC_AI_NAME} 思考中…`
  }
  if (usingRemoteModel) {
    return renderAiThinkingStatus(label, true, opponentFriendlyName, modelClass)
  }
  return `${GOMOKU_HEURISTIC_AI_NAME} 思考中…`
}

function renderAivaiTurnLabel(
  currentPlayer: Player,
  heuristicPlayer: Player,
  usingRemoteModel: boolean,
  opponentFriendlyName: string,
  aiDegradeReason: GomokuAiDegradeReason | undefined,
): ComponentChild {
  if (currentPlayer === heuristicPlayer) {
    return GOMOKU_HEURISTIC_AI_NAME
  }
  if (usingRemoteModel) {
    return (
      <>
        <span class="gomoku-app__turn-prefix">对手</span>
        <GomokuModelName name={opponentFriendlyName} class="gomoku-app__turn-model" />
      </>
    )
  }
  return aiDegradeReasonLabel(aiDegradeReason)
}

function aiDegradeReasonLabel(reason: GomokuAiDegradeReason | undefined): string {
  if (reason) {
    return gomokuAiDegradeOpponentLabel(reason)
  }
  return GOMOKU_HEURISTIC_AI_NAME
}

function gomokuModeLabel(gameMode: GomokuGameMode): string {
  if (gameMode === 'pvp') return '人人对战'
  if (gameMode === 'aivai') return '双 AI 对战'
  return '人机对战'
}

export function GomokuApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const opponentFriendlyName = useDefaultAiModelFriendlyName()
  const [gameMode, setGameMode] = useState<GomokuGameMode>(() => loadGomokuGameMode())
  const [game, setGame] = useState<GameState>(createInitialState)
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('idle')
  const [aiThinking, setAiThinking] = useState(false)
  const [aiThinkingLabel, setAiThinkingLabel] = useState<GomokuAiThinkingLabel>('default')
  const [aiDegradeReason, setAiDegradeReason] = useState<GomokuAiDegradeReason | undefined>(undefined)
  const [winCelebrationReady, setWinCelebrationReady] = useState(false)
  const [winCelebrationDismissed, setWinCelebrationDismissed] = useState(false)
  const [drawCelebrationDismissed, setDrawCelebrationDismissed] = useState(false)
  const aiTurnRef = useRef(0)

  const lastMove = game.moves.at(-1)
  const aiConfigured = hasOpenAiApiKey()
  const usingRemoteAi = aiConfigured && aiDegradeReason === undefined
  const boardPlayable = sessionPhase === 'active' && !aiThinking
  const matchIntroActive = sessionPhase === 'intro'
  const heuristicPlayer = game.humanPlayer
  const modelPlayer = getOpponent(heuristicPlayer)
  const aiPlayer = modelPlayer
  const isHumanTurn = gameMode === 'pvp' || (gameMode === 'pve' && game.currentPlayer === game.humanPlayer)
  const usingRemoteModel = aiConfigured && aiDegradeReason === undefined

  const resetEndgamePresentation = useCallback(() => {
    setWinCelebrationReady(false)
    setWinCelebrationDismissed(false)
    setDrawCelebrationDismissed(false)
  }, [])

  const selectGameMode = useCallback((mode: GomokuGameMode) => {
    if (mode === gameMode) return
    saveGomokuGameMode(mode)
    setGameMode(mode)
    setAiThinking(false)
    setAiThinkingLabel('default')
    setAiDegradeReason(undefined)
    resetEndgamePresentation()
    setSessionPhase('idle')
    setGame(createInitialState())
  }, [gameMode, resetEndgamePresentation])

  const startNewGame = useCallback(() => {
    setAiThinking(false)
    setAiThinkingLabel('default')
    setAiDegradeReason(undefined)
    resetEndgamePresentation()
    setSessionPhase('intro')
  }, [resetEndgamePresentation])

  const handleIntroComplete = useCallback((humanPlayer: Player) => {
    resetEndgamePresentation()
    setAiDegradeReason(undefined)
    setGame(createInitialState(humanPlayer))
    setSessionPhase('active')
  }, [resetEndgamePresentation])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'gomoku' && !window.minimized)

    return [
      {
        label: '五子棋',
        items: [
          ...aboutAppMenuPrefix('关于五子棋', () => showBuiltinAbout('gomoku')),
          {
            type: 'action',
            label: sessionPhase === 'idle' ? '开始新对局' : '新局',
            shortcut: '⌘N',
            onClick: startNewGame,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '隐藏五子棋',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出五子棋',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('gomoku'),
          },
        ],
      },
      {
        label: '对手类型',
        items: [
          {
            type: 'action',
            label: `${menuCheckPrefix(gameMode === 'pvp')}人类对战人类`,
            onClick: () => selectGameMode('pvp'),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(gameMode === 'pve')}人类对战 AI`,
            onClick: () => selectGameMode('pve'),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(gameMode === 'aivai')}AI 对战 AI`,
            onClick: () => selectGameMode('aivai'),
          },
        ],
      },
      {
        label: '调试',
        items: [
          {
            type: 'action',
            label: '撤销一步',
            shortcut: '⌘Z',
            onClick: () => {
              setGame((prev) => {
                if (prev.moves.length === 0) return prev
                playUndoSound()
                aiTurnRef.current += 1
                setAiThinking(false)
                setAiThinkingLabel('default')
                const removeCount = countUndoMoves(prev.moves, gameMode, prev.humanPlayer)
                const moves = prev.moves.slice(0, -removeCount)
                return rebuildStateAfterUndo(prev, moves)
              })
            },
          },
          {
            type: 'action',
            label: '重置棋盘',
            onClick: startNewGame,
          },
        ],
      },
    ]
  }, [closeWindowsForApp, gameMode, minimizeWindow, selectGameMode, sessionPhase, showBuiltinAbout, startNewGame, windows])

  useAppMenuBar('gomoku', menuBar)

  const applyMoveAt = useCallback((row: number, col: number, player: Player) => {
    setGame((prev) => {
      if (!isValidMove(prev.board, row, col)) return prev
      const board = applyMove(prev.board, row, col, player)
      const winResult = checkWin(board, row, col, player)
      const move: MoveRecord = { row, col, player }
      playPlaceSound(player)
      if (winResult) {
        playWinSound()
      }
      return advanceAfterMove(prev, board, player, move, winResult)
    })
  }, [])

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!boardPlayable || game.phase !== 'playing') return
      if (gameMode === 'aivai') return
      if (gameMode === 'pve' && game.currentPlayer !== game.humanPlayer) return
      if (!isValidMove(game.board, row, col)) {
        playInvalidSound()
        return
      }
      applyMoveAt(row, col, game.currentPlayer)
    },
    [applyMoveAt, boardPlayable, game.board, game.currentPlayer, game.humanPlayer, game.phase, gameMode],
  )

  useEffect(() => {
    if (game.phase !== 'won' || !game.winResult || sessionPhase !== 'active') {
      setWinCelebrationReady(false)
      return
    }

    setWinCelebrationReady(false)
    setWinCelebrationDismissed(false)
    const timer = setTimeout(() => setWinCelebrationReady(true), WIN_LINE_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [game.phase, game.winResult, game.moves.length, sessionPhase])

  useEffect(() => {
    if (game.phase !== 'draw' || sessionPhase !== 'active') return
    setDrawCelebrationDismissed(false)
  }, [game.moves.length, game.phase, sessionPhase])

  useEffect(() => {
    if (gameMode !== 'pve' || sessionPhase !== 'active' || game.phase !== 'playing') return
    if (game.currentPlayer !== aiPlayer) return

    const turnId = aiTurnRef.current + 1
    aiTurnRef.current = turnId
    let cancelled = false
    setAiThinkingLabel('default')
    setAiThinking(true)

    const minDelay = new Promise<void>((resolve) => {
      setTimeout(resolve, AI_MOVE_MIN_MS)
    })

    void Promise.all([
      pickAiMove(game.board, aiPlayer, {
        lastMove: game.moves.at(-1),
        onThinkingLabel: (label) => {
          if (!cancelled && turnId === aiTurnRef.current) {
            setAiThinkingLabel(label)
          }
        },
      }),
      minDelay,
    ])
      .then(([result]) => {
        if (cancelled || turnId !== aiTurnRef.current) return
        setAiDegradeReason(result.degradeReason)
        applyMoveAt(result.row, result.col, aiPlayer)
      })
      .finally(() => {
        if (!cancelled && turnId === aiTurnRef.current) {
          setAiThinking(false)
          setAiThinkingLabel('default')
        }
      })

    return () => {
      cancelled = true
    }
  }, [aiPlayer, applyMoveAt, game.board, game.currentPlayer, game.phase, game.moves.length, gameMode, sessionPhase])

  useEffect(() => {
    if (gameMode !== 'aivai' || sessionPhase !== 'active' || game.phase !== 'playing') return

    const currentPlayer = game.currentPlayer
    const isHeuristicTurn = currentPlayer === heuristicPlayer
    const turnId = aiTurnRef.current + 1
    aiTurnRef.current = turnId
    let cancelled = false
    setAiThinkingLabel(isHeuristicTurn ? 'default' : 'retry-thinking')
    setAiThinking(true)

    const minDelay = new Promise<void>((resolve) => {
      setTimeout(resolve, isHeuristicTurn ? HEURISTIC_MOVE_MIN_MS : AI_MOVE_MIN_MS)
    })

    const movePromise: Promise<GomokuAiMoveResult> = isHeuristicTurn
      ? Promise.resolve(pickHeuristicMove(game.board, heuristicPlayer))
      : pickAiMove(game.board, modelPlayer, {
          lastMove: game.moves.at(-1),
          thinkingMode: true,
          onThinkingLabel: (label) => {
            if (!cancelled && turnId === aiTurnRef.current) {
              setAiThinkingLabel(label)
            }
          },
        })

    void Promise.all([movePromise, minDelay])
      .then(([result]) => {
        if (cancelled || turnId !== aiTurnRef.current) return
        if (!isHeuristicTurn) {
          setAiDegradeReason(result.degradeReason)
        }
        applyMoveAt(result.row, result.col, currentPlayer)
      })
      .finally(() => {
        if (!cancelled && turnId === aiTurnRef.current) {
          setAiThinking(false)
          setAiThinkingLabel('default')
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    applyMoveAt,
    game.board,
    game.currentPlayer,
    game.moves.length,
    game.phase,
    gameMode,
    heuristicPlayer,
    modelPlayer,
    sessionPhase,
  ])

  useEffect(() => {
    if (aiDegradeReason !== 'offline' || !aiConfigured || (gameMode !== 'pve' && gameMode !== 'aivai') || sessionPhase !== 'active') {
      return
    }

    let cancelled = false
    const probe = () => {
      void probeGomokuAiServiceReachable().then((available) => {
        if (!cancelled && available) {
          setAiDegradeReason(undefined)
        }
      })
    }

    const interval = window.setInterval(probe, AI_RECOVERY_PROBE_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [aiConfigured, aiDegradeReason, gameMode, sessionPhase])

  const handleUndo = useCallback(() => {
    if (!boardPlayable || game.moves.length === 0) return
    playUndoSound()
    aiTurnRef.current += 1
    setAiThinking(false)
    setAiThinkingLabel('default')
    const removeCount = countUndoMoves(game.moves, gameMode, game.humanPlayer)
    const moves = game.moves.slice(0, -removeCount)
    setGame((prev) => rebuildStateAfterUndo(prev, moves))
  }, [boardPlayable, game.humanPlayer, game.moves, gameMode])

  const modeLabel = gomokuModeLabel(gameMode)
  const showWinLine =
    game.phase === 'won' && game.winResult !== undefined && sessionPhase === 'active'
  const winLineRevealActive = showWinLine && !winCelebrationReady
  const showWinCelebration =
    showWinLine && winCelebrationReady && !winCelebrationDismissed
  const showDrawCelebration =
    game.phase === 'draw' && sessionPhase === 'active' && !drawCelebrationDismissed

  const statusContent = useMemo((): ComponentChild => {
    if (sessionPhase === 'idle') {
      return '点击「开始新对局」'
    }
    if (sessionPhase === 'intro') {
      return '抽签决定先手…'
    }
    if (aiThinking) {
      if (gameMode === 'aivai') {
        return renderAivaiThinkingStatus(
          game.currentPlayer,
          heuristicPlayer,
          aiThinkingLabel,
          usingRemoteModel,
          opponentFriendlyName,
        )
      }
      if (gameMode === 'pve') {
        return renderAiThinkingStatus(aiThinkingLabel, usingRemoteAi, opponentFriendlyName)
      }
      return '思考中…'
    }
    if (game.phase === 'won' && game.winResult) {
      if (gameMode === 'aivai') {
        if (game.winResult.player === heuristicPlayer) {
          return `${GOMOKU_HEURISTIC_AI_NAME} 五连获胜！`
        }
        if (usingRemoteModel) {
          return (
            <>
              <GomokuModelName name={opponentFriendlyName} />
              <span>五连获胜！</span>
            </>
          )
        }
        return `${aiDegradeReasonLabel(aiDegradeReason)} 五连获胜！`
      }
      if (gameMode === 'pve' && game.winResult.player !== game.humanPlayer && usingRemoteAi) {
        return (
          <>
            <GomokuModelName name={opponentFriendlyName} />
            <span>五连获胜！</span>
          </>
        )
      }
      const winnerLabel =
        gameMode === 'pve'
          ? game.winResult.player === game.humanPlayer
            ? '你'
            : '本地 AI'
          : playerLabel(game.winResult.player)
      return `${winnerLabel}五连获胜！`
    }
    if (game.phase === 'draw') {
      return '棋盘已满，平局。'
    }
    if (gameMode === 'pve') {
      if (!usingRemoteAi) {
        return isHumanTurn ? '轮到你落子' : '本地 AI 思考中…'
      }
      if (isHumanTurn) {
        return '轮到你落子'
      }
      return (
        <>
          <span>轮到</span>
          <GomokuModelName name={opponentFriendlyName} />
        </>
      )
    }
    if (gameMode === 'aivai') {
      if (game.currentPlayer === heuristicPlayer) {
        return `轮到 ${GOMOKU_HEURISTIC_AI_NAME}`
      }
      if (usingRemoteModel) {
        return (
          <>
            <span>轮到</span>
            <GomokuModelName name={opponentFriendlyName} />
          </>
        )
      }
      return `轮到 ${aiDegradeReasonLabel(aiDegradeReason)}`
    }
    return `轮到${playerLabel(game.currentPlayer)}落子`
  }, [
    aiDegradeReason,
    aiThinking,
    aiThinkingLabel,
    game.currentPlayer,
    game.humanPlayer,
    game.phase,
    game.winResult,
    gameMode,
    heuristicPlayer,
    isHumanTurn,
    opponentFriendlyName,
    sessionPhase,
    usingRemoteAi,
    usingRemoteModel,
  ])

  const showAiDegradedBanner = aiDegradeReason !== undefined && aiConfigured && (gameMode === 'pve' || gameMode === 'aivai')
  const aiDegradedBannerMessage = aiDegradeReason ? gomokuAiDegradeBannerMessage(aiDegradeReason) : ''

  return (
    <div class="gomoku-app">
      <GomokuAiAlertBanner show={showAiDegradedBanner} message={aiDegradedBannerMessage} />
      {matchIntroActive && (
        <GomokuMatchIntro
          opponentFriendlyName={opponentFriendlyName}
          gameMode={gameMode}
          onComplete={handleIntroComplete}
        />
      )}

      {showWinCelebration && game.winResult && (
        <GomokuWinCelebration
          gameMode={gameMode}
          humanPlayer={game.humanPlayer}
          opponentFriendlyName={opponentFriendlyName}
          winResult={game.winResult}
          onDismiss={() => setWinCelebrationDismissed(true)}
        />
      )}

      {showDrawCelebration && (
        <GomokuDrawCelebration onDismiss={() => setDrawCelebrationDismissed(true)} />
      )}

      <div class="gomoku-app__body">
        <div class="gomoku-app__board-wrap">
          <div
            class={`gomoku-app__board-frame${sessionPhase === 'idle' ? ' gomoku-app__board-frame--idle' : ''}${aiThinking ? ' gomoku-app__board-frame--thinking' : ''}`}
          >
            <div
              class={`gomoku-app__board${winLineRevealActive ? ' gomoku-app__board--win-reveal' : ''}${showWinLine && !winLineRevealActive ? ' gomoku-app__board--win-settled' : ''}`}
              role="grid"
              aria-label="五子棋棋盘"
            >
              <svg class="gomoku-app__grid" viewBox={`0 0 ${GRID_SPAN} ${GRID_SPAN}`} preserveAspectRatio="none" aria-hidden="true">
                {Array.from({ length: BOARD_SIZE }, (_, index) => (
                  <g key={index}>
                    <line x1={index} y1={0} x2={index} y2={GRID_SPAN} />
                    <line x1={0} y1={index} x2={GRID_SPAN} y2={index} />
                  </g>
                ))}
              </svg>

              {Array.from(STAR_POINTS, (key) => {
                const [row, col] = key.split(',').map(Number)
                if (game.board[row][col] !== 0) {
                  return undefined
                }
                return (
                  <span
                    key={key}
                    class="gomoku-app__star"
                    style={{ '--row': row, '--col': col }}
                    aria-hidden="true"
                  />
                )
              })}

              {Array.from({ length: BOARD_SIZE }, (_, row) =>
                Array.from({ length: BOARD_SIZE }, (_, col) => {
                  const stone = game.board[row][col]
                  const isLast = lastMove?.row === row && lastMove?.col === col
                  const isWin = isWinCell(game.winResult, row, col)
                  const canPlay =
                    boardPlayable && game.phase === 'playing' && stone === 0 && isHumanTurn

                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      class={`gomoku-app__cell${isWin ? ' gomoku-app__cell--win' : ''}`}
                      style={{ '--row': row, '--col': col }}
                      role="gridcell"
                      aria-label={stone === 0 ? `空位 ${formatCoord(row, col)}` : `${playerLabel(stone as Player)} ${formatCoord(row, col)}`}
                      disabled={!canPlay}
                      onClick={() => handleCellClick(row, col)}
                    >
                      {canPlay && (
                        <span
                          class={`gomoku-app__hover-hint gomoku-app__hover-hint--${game.currentPlayer === 1 ? 'black' : 'white'}`}
                        />
                      )}
                      {stone !== 0 && (
                        <span
                          class={`gomoku-app__stone gomoku-app__stone--${stone === 1 ? 'black' : 'white'}${isLast && game.phase === 'playing' ? ' gomoku-app__stone--last' : ''}${isWin ? ' gomoku-app__stone--win' : ''}`}
                        />
                      )}
                    </button>
                  )
                }),
              )}

              {showWinLine && game.winResult && (
                <GomokuWinLineHighlight winResult={game.winResult} intense={winLineRevealActive} />
              )}

              {aiThinking && (gameMode === 'pve' || gameMode === 'aivai') && (
                <div class="gomoku-app__thinking-overlay" role="status" aria-live="polite">
                  <div class="gomoku-app__thinking-card">
                    <span class="gomoku-app__thinking-spinner" aria-hidden="true" />
                    <span class="gomoku-app__thinking-label">
                      {gameMode === 'aivai'
                        ? renderAivaiThinkingStatus(
                            game.currentPlayer,
                            heuristicPlayer,
                            aiThinkingLabel,
                            usingRemoteModel,
                            opponentFriendlyName,
                            'gomoku-app__thinking-model',
                          )
                        : renderAiThinkingStatus(
                            aiThinkingLabel,
                            usingRemoteAi,
                            opponentFriendlyName,
                            'gomoku-app__thinking-model',
                          )}
                    </span>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        <aside class="gomoku-app__sidebar">
          <section class="gomoku-app__panel gomoku-app__sidebar-head">
            <h1 class="gomoku-app__title">五子棋</h1>
            <div class="gomoku-app__subtitle">
              <span class="gomoku-app__subtitle-mode">{modeLabel}</span>
              {gameMode === 'pve' && (
                <GomokuModelName
                  name={usingRemoteAi ? opponentFriendlyName : '本地 AI'}
                  class="gomoku-app__subtitle-model"
                />
              )}
              {gameMode === 'aivai' && (
                <>
                  <span class="gomoku-app__subtitle-heuristic">{GOMOKU_HEURISTIC_AI_NAME}</span>
                  <span class="gomoku-app__subtitle-vs">VS</span>
                  <GomokuModelName name={opponentFriendlyName} class="gomoku-app__subtitle-model" />
                </>
              )}
            </div>
            <div class="gomoku-app__toolbar">
              <button type="button" class="gomoku-app__btn gomoku-app__btn--primary" onClick={startNewGame} disabled={matchIntroActive}>
                {sessionPhase === 'idle' ? '开始新对局' : '新局'}
              </button>
              <button type="button" class="gomoku-app__btn" onClick={handleUndo} disabled={!boardPlayable || game.moves.length === 0}>
                撤销
              </button>
            </div>
          </section>

          <section class="gomoku-app__panel">
            <h2 class="gomoku-app__panel-title">对局</h2>
            {sessionPhase === 'idle' ? (
              <div class="gomoku-app__turn">
                <span class="gomoku-app__turn-label">未开局</span>
              </div>
            ) : sessionPhase === 'intro' ? (
              <div class="gomoku-app__turn">
                <span class="gomoku-app__turn-label">抽签中</span>
              </div>
            ) : game.phase === 'playing' ? (
              <div class="gomoku-app__turn">
                <span class={`gomoku-app__turn-stone gomoku-app__turn-stone--${game.currentPlayer === 1 ? 'black' : 'white'}`} />
                <span class="gomoku-app__turn-label">
                  {gameMode === 'pve' ? (
                    isHumanTurn ? (
                      '你'
                    ) : usingRemoteAi ? (
                      <>
                        <span class="gomoku-app__turn-prefix">对手</span>
                        <GomokuModelName name={opponentFriendlyName} class="gomoku-app__turn-model" />
                      </>
                    ) : (
                      '本地 AI'
                    )
                  ) : gameMode === 'aivai' ? (
                    renderAivaiTurnLabel(
                      game.currentPlayer,
                      heuristicPlayer,
                      usingRemoteModel,
                      opponentFriendlyName,
                      aiDegradeReason,
                    )
                  ) : (
                    playerLabel(game.currentPlayer)
                  )}
                </span>
              </div>
            ) : (
              <div class="gomoku-app__turn">
                <span class="gomoku-app__turn-label">{game.phase === 'won' ? '对局结束' : '平局'}</span>
              </div>
            )}
            <div
              class={`gomoku-app__status${game.phase === 'won' ? ' gomoku-app__status--win' : ''}${game.phase === 'draw' ? ' gomoku-app__status--draw' : ''}`}
            >
              {statusContent}
            </div>
          </section>

          <section class="gomoku-app__panel">
            <h2 class="gomoku-app__panel-title">对局信息</h2>
            <ul class="gomoku-app__debug-list">
              <li>
                <span>模式</span>
                <strong>{modeLabel}</strong>
              </li>
              {gameMode === 'pve' && (
                <li>
                  <span>我方</span>
                  <strong>
                    {sessionPhase === 'active'
                      ? sideLabel(game.humanPlayer, 1)
                      : '—'}
                  </strong>
                </li>
              )}
              {gameMode === 'pve' && (
                <li class="gomoku-app__debug-list-item--model">
                  <span>对手</span>
                  <strong>
                    {usingRemoteAi ? (
                      <GomokuModelName name={opponentFriendlyName} class="gomoku-app__debug-model" />
                    ) : aiDegradeReason ? (
                      gomokuAiDegradeOpponentLabel(aiDegradeReason)
                    ) : (
                      GOMOKU_HEURISTIC_AI_NAME
                    )}
                  </strong>
                </li>
              )}
              {gameMode === 'pve' && sessionPhase === 'active' && (
                <li>
                  <span>对手棋子</span>
                  <strong>{sideLabel(aiPlayer, 1)}</strong>
                </li>
              )}
              {gameMode === 'aivai' && sessionPhase === 'active' && (
                <>
                  <li>
                    <span>{GOMOKU_HEURISTIC_AI_NAME}</span>
                    <strong>{sideLabel(heuristicPlayer, 1)}</strong>
                  </li>
                  <li class="gomoku-app__debug-list-item--model">
                    <span>模型 AI</span>
                    <strong>
                      {usingRemoteModel ? (
                        <GomokuModelName name={opponentFriendlyName} class="gomoku-app__debug-model" />
                      ) : aiDegradeReason ? (
                        gomokuAiDegradeOpponentLabel(aiDegradeReason)
                      ) : (
                        GOMOKU_HEURISTIC_AI_NAME
                      )}
                    </strong>
                  </li>
                  <li>
                    <span>模型棋子</span>
                    <strong>{sideLabel(modelPlayer, 1)}</strong>
                  </li>
                </>
              )}
              <li>
                <span>步数</span>
                <strong>{game.moves.length}</strong>
              </li>
              <li>
                <span>末手</span>
                <strong>{lastMove ? `${playerLabel(lastMove.player)} ${formatCoord(lastMove.row, lastMove.col)}` : '—'}</strong>
              </li>
              <li>
                <span>胜负</span>
                <strong>
                  {sessionPhase === 'idle'
                    ? '未开始'
                    : sessionPhase === 'intro'
                      ? '准备中'
                      : game.phase === 'won'
                        ? '已判定'
                        : game.phase === 'draw'
                          ? '平局'
                          : '进行中'}
                </strong>
              </li>
              {game.winResult && (
                <>
                  <li>
                    <span>方向</span>
                    <strong>{directionLabel(game.winResult.direction)}</strong>
                  </li>
                  <li>
                    <span>连子</span>
                    <strong>{game.winResult.cells.length}</strong>
                  </li>
                  <li>
                    <span>胜线</span>
                    <strong>{game.winResult.cells.map((c) => formatCoord(c.row, c.col)).join(' ')}</strong>
                  </li>
                </>
              )}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function directionLabel(direction: WinResult['direction']): string {
  switch (direction) {
    case 'horizontal':
      return '横'
    case 'vertical':
      return '竖'
    case 'diagonal-main':
      return '斜 ╲'
    case 'diagonal-anti':
      return '斜 ╱'
  }
}
