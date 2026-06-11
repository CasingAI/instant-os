import type { ComponentChild } from 'preact'
import { gomokuAiDegradeOpponentLabel, GOMOKU_HEURISTIC_AI_NAME, type GomokuAiDegradeReason } from './gomoku-agent.ts'
import { formatCoord, playerLabel, sideLabel, type MoveRecord, type Player, type WinResult } from './gomoku-logic.ts'
import { GomokuModelName } from './gomoku-model-name.tsx'
import type { GomokuGameMode } from './gomoku-storage.ts'

type SessionPhase = 'idle' | 'intro' | 'active'
type GamePhase = 'playing' | 'won' | 'draw'

type GomokuInfoPanelsProps = {
  id?: string
  class?: string
  modeLabel: string
  sessionPhase: SessionPhase
  gameMode: GomokuGameMode
  gamePhase: GamePhase
  currentPlayer: Player
  humanPlayer: Player
  heuristicPlayer: Player
  aiPlayer: Player
  modelPlayer: Player
  moves: MoveRecord[]
  lastMove: MoveRecord | undefined
  winResult: WinResult | undefined
  usingRemoteAi: boolean
  usingRemoteModel: boolean
  aiDegradeReason: GomokuAiDegradeReason | undefined
  isHumanTurn: boolean
  opponentFriendlyName: string
  statusContent: ComponentChild
  renderAivaiTurnLabel: (
    currentPlayer: Player,
    heuristicPlayer: Player,
    usingRemoteModel: boolean,
    opponentFriendlyName: string,
    aiDegradeReason: GomokuAiDegradeReason | undefined,
  ) => ComponentChild
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

export function GomokuInfoPanels({
  id,
  class: className,
  modeLabel,
  sessionPhase,
  gameMode,
  gamePhase,
  currentPlayer,
  humanPlayer,
  heuristicPlayer,
  aiPlayer,
  modelPlayer,
  moves,
  lastMove,
  winResult,
  usingRemoteAi,
  usingRemoteModel,
  aiDegradeReason,
  isHumanTurn,
  opponentFriendlyName,
  statusContent,
  renderAivaiTurnLabel,
}: GomokuInfoPanelsProps) {
  return (
    <div id={id} class={`gomoku-app__info-panels${className ? ` ${className}` : ''}`}>
      <section class="gomoku-app__panel gomoku-app__panel--status">
        <h2 class="gomoku-app__panel-title">对局</h2>
        {sessionPhase === 'idle' ? (
          <div class="gomoku-app__turn">
            <span class="gomoku-app__turn-label">未开局</span>
          </div>
        ) : sessionPhase === 'intro' ? (
          <div class="gomoku-app__turn">
            <span class="gomoku-app__turn-label">抽签中</span>
          </div>
        ) : gamePhase === 'playing' ? (
          <div class="gomoku-app__turn">
            <span class={`gomoku-app__turn-stone gomoku-app__turn-stone--${currentPlayer === 1 ? 'black' : 'white'}`} />
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
                  currentPlayer,
                  heuristicPlayer,
                  usingRemoteModel,
                  opponentFriendlyName,
                  aiDegradeReason,
                )
              ) : (
                playerLabel(currentPlayer)
              )}
            </span>
          </div>
        ) : (
          <div class="gomoku-app__turn">
            <span class="gomoku-app__turn-label">{gamePhase === 'won' ? '对局结束' : '平局'}</span>
          </div>
        )}
        <div
          class={`gomoku-app__status${gamePhase === 'won' ? ' gomoku-app__status--win' : ''}${gamePhase === 'draw' ? ' gomoku-app__status--draw' : ''}`}
        >
          {statusContent}
        </div>
      </section>

      <section class="gomoku-app__panel gomoku-app__panel--details">
        <h2 class="gomoku-app__panel-title">对局信息</h2>
        <ul class="gomoku-app__debug-list">
          <li>
            <span>模式</span>
            <strong>{modeLabel}</strong>
          </li>
          {gameMode === 'pve' && (
            <li>
              <span>我方</span>
              <strong>{sessionPhase === 'active' ? sideLabel(humanPlayer, 1) : '—'}</strong>
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
            <strong>{moves.length}</strong>
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
                  : gamePhase === 'won'
                    ? '已判定'
                    : gamePhase === 'draw'
                      ? '平局'
                      : '进行中'}
            </strong>
          </li>
          {winResult && (
            <>
              <li>
                <span>方向</span>
                <strong>{directionLabel(winResult.direction)}</strong>
              </li>
              <li>
                <span>连子</span>
                <strong>{winResult.cells.length}</strong>
              </li>
              <li>
                <span>胜线</span>
                <strong>{winResult.cells.map((c) => formatCoord(c.row, c.col)).join(' ')}</strong>
              </li>
            </>
          )}
        </ul>
      </section>
    </div>
  )
}
