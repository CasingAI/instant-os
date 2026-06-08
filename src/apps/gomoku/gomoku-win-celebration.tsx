import { playerLabel, type Player, type WinResult } from './gomoku-logic.ts'
import { GOMOKU_HEURISTIC_AI_NAME } from './gomoku-agent.ts'
import { GomokuModelName } from './gomoku-model-name.tsx'
import type { GomokuGameMode } from './gomoku-storage.ts'

const SPARKLE_POSITIONS = [
  { left: '8%', top: '12%', delay: '0s' },
  { left: '88%', top: '18%', delay: '0.2s' },
  { left: '42%', top: '6%', delay: '0.4s' },
  { left: '18%', top: '78%', delay: '0.15s' },
  { left: '82%', top: '72%', delay: '0.35s' },
  { left: '52%', top: '90%', delay: '0.5s' },
  { left: '6%', top: '44%', delay: '0.25s' },
  { left: '94%', top: '40%', delay: '0.45s' },
  { left: '28%', top: '28%', delay: '0.1s' },
  { left: '72%', top: '58%', delay: '0.3s' },
]

type GomokuWinCelebrationProps = {
  gameMode: GomokuGameMode
  humanPlayer: Player
  opponentFriendlyName: string
  winResult: WinResult
  onDismiss: () => void
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

export function GomokuWinCelebration({
  gameMode,
  humanPlayer,
  opponentFriendlyName,
  winResult,
  onDismiss,
}: GomokuWinCelebrationProps) {
  const winnerStone = winResult.player === 1 ? 'black' : 'white'
  const aiWon = gameMode === 'pve' && winResult.player !== humanPlayer
  const heuristicWon = gameMode === 'aivai' && winResult.player === humanPlayer
  const modelWon = gameMode === 'aivai' && winResult.player !== humanPlayer

  return (
    <div class="gomoku-app__fullscreen-overlay gomoku-app__win-celebration" role="status" aria-live="polite">
      <div class="gomoku-app__win-sparkles" aria-hidden="true">
        {SPARKLE_POSITIONS.map((pos, index) => (
          <span
            key={index}
            class="gomoku-app__sparkle"
            style={{ left: pos.left, top: pos.top, animationDelay: pos.delay }}
          />
        ))}
      </div>

      <div class="gomoku-app__fullscreen-card gomoku-app__win-celebration-card">
        <p class="gomoku-app__win-celebration-kicker">对局结束</p>
        <div class="gomoku-app__win-celebration-hero">
          <span class={`gomoku-app__win-celebration-stone gomoku-app__win-celebration-stone--${winnerStone}`} />
          <div class="gomoku-app__win-celebration-title">
            {modelWon ? (
              <>
                <GomokuModelName name={opponentFriendlyName} class="gomoku-app__win-celebration-model" />
                <span class="gomoku-app__win-celebration-title-suffix">获胜！</span>
              </>
            ) : heuristicWon ? (
              <>
                <span class="gomoku-app__win-celebration-title-suffix">{GOMOKU_HEURISTIC_AI_NAME}获胜！</span>
              </>
            ) : aiWon ? (
              <>
                <GomokuModelName name={opponentFriendlyName} class="gomoku-app__win-celebration-model" />
                <span class="gomoku-app__win-celebration-title-suffix">获胜！</span>
              </>
            ) : gameMode === 'pve' ? (
              <span class="gomoku-app__win-celebration-title-suffix">你获胜！</span>
            ) : (
              <span class="gomoku-app__win-celebration-title-suffix">
                {winResult.player === 1 ? '人类一获胜！' : '人类二获胜！'}
              </span>
            )}
          </div>
        </div>
        <div class="gomoku-app__win-celebration-sub">
          {(aiWon || modelWon) && (
            <GomokuModelName name={opponentFriendlyName} class="gomoku-app__win-celebration-sub-model" />
          )}
          <span>
            {gameMode === 'pvp' && `${playerLabel(winResult.player)} · `}
            {gameMode === 'pve' && winResult.player === humanPlayer && '你 · '}
            {gameMode === 'aivai' && heuristicWon && `${GOMOKU_HEURISTIC_AI_NAME} · `}
            {gameMode === 'aivai' && modelWon && `${opponentFriendlyName} · `}
            {winResult.cells.length} 连 · {directionLabel(winResult.direction)}
          </span>
        </div>
        <button type="button" class="gomoku-app__overlay-dismiss-btn" onClick={onDismiss}>
          查看棋局
        </button>
      </div>
    </div>
  )
}
