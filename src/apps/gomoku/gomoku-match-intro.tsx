import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Player } from './gomoku-logic.ts'
import { GOMOKU_HEURISTIC_AI_NAME } from './gomoku-agent.ts'
import { GomokuModelName } from './gomoku-model-name.tsx'
import type { GomokuGameMode } from './gomoku-storage.ts'
import { playLotteryRevealSound, playLotteryTickSound } from './gomoku-sounds.ts'

const VERSUS_MS = 2000
const REVEAL_MS = 2000

type IntroPhase = 'versus' | 'shuffle' | 'reveal'

type GomokuMatchIntroProps = {
  opponentFriendlyName: string
  gameMode: GomokuGameMode
  onComplete: (humanPlayer: Player) => void
}

export function GomokuMatchIntro({ opponentFriendlyName, gameMode, onComplete }: GomokuMatchIntroProps) {
  const humanPlayer = useMemo<Player>(() => (Math.random() < 0.5 ? 1 : 2), [])
  const [phase, setPhase] = useState<IntroPhase>('versus')
  const [activeSide, setActiveSide] = useState<'human' | 'opponent'>('human')
  const onCompleteRef = useRef(onComplete)

  onCompleteRef.current = onComplete

  const humanFirst = humanPlayer === 1
  const winnerSide: 'human' | 'opponent' = humanFirst ? 'human' : 'opponent'

  useEffect(() => {
    const timer = setTimeout(() => setPhase('shuffle'), VERSUS_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (phase !== 'shuffle') return

    const delays = [60, 60, 70, 70, 80, 90, 100, 110, 120, 130, 150, 170, 200, 240, 300]
    let step = 0
    let side: 'human' | 'opponent' = 'human'
    let timeoutId: ReturnType<typeof setTimeout>

    const tick = () => {
      playLotteryTickSound(step, delays.length)

      if (step >= delays.length - 1) {
        setActiveSide(winnerSide)
        setPhase('reveal')
        playLotteryRevealSound(humanFirst)
        return
      }

      side = side === 'human' ? 'opponent' : 'human'
      setActiveSide(side)
      step += 1
      timeoutId = setTimeout(tick, delays[step])
    }

    timeoutId = setTimeout(tick, delays[0])

    return () => clearTimeout(timeoutId)
  }, [humanFirst, phase, winnerSide])

  useEffect(() => {
    if (phase !== 'reveal') return
    const timer = setTimeout(() => onCompleteRef.current(humanPlayer), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [humanPlayer, phase])

  const humanRole = humanFirst ? '黑棋 · 先手' : '白棋 · 后手'
  const opponentRole = humanFirst ? '白棋 · 后手' : '黑棋 · 先手'

  const isPvp = gameMode === 'pvp'
  const isAivai = gameMode === 'aivai'
  const leftName = isPvp ? '人类一' : isAivai ? GOMOKU_HEURISTIC_AI_NAME : '你'
  const rightName = isPvp ? '人类二' : opponentFriendlyName
  const showStoneColors = phase === 'reveal'
  const leftStoneColor = showStoneColors ? (humanFirst ? 'black' : 'white') : 'pending'
  const rightStoneColor = showStoneColors ? (humanFirst ? 'white' : 'black') : 'pending'
  const leftUsesModelName = isAivai
  const rightUsesModelName = !isPvp

  return (
    <div class="gomoku-app__fullscreen-overlay" role="status" aria-live="polite">
      <div class="gomoku-app__fullscreen-card">
        {phase === 'versus' && (
          <>
            <p class="gomoku-app__match-banner-kicker">即将对战</p>
            <div class="gomoku-app__match-banner-versus">
              <div class="gomoku-app__match-banner-player">
                <span class="gomoku-app__match-banner-stone gomoku-app__match-banner-stone--black" />
                <span class={`gomoku-app__match-banner-name${leftUsesModelName ? ' gomoku-app__model-name' : ''}`}>{leftName}</span>
              </div>
              <span class="gomoku-app__match-banner-vs">VS</span>
              <div class="gomoku-app__match-banner-player">
                <span class="gomoku-app__match-banner-stone gomoku-app__match-banner-stone--white" />
                <span class={`gomoku-app__match-banner-name${rightUsesModelName ? ' gomoku-app__model-name' : ''}`}>{rightName}</span>
              </div>
            </div>
          </>
        )}

        {(phase === 'shuffle' || phase === 'reveal') && (
          <>
            <p class="gomoku-app__match-banner-kicker">抽签决定先手</p>
            <div class="gomoku-app__lottery">
              <div
                class={`gomoku-app__lottery-card gomoku-app__lottery-card--human${activeSide === 'human' ? ' gomoku-app__lottery-card--active' : ''}${phase === 'reveal' && winnerSide === 'human' ? ' gomoku-app__lottery-card--winner' : ''}`}
              >
                <span
                  class={`gomoku-app__lottery-stone gomoku-app__lottery-stone--${leftStoneColor}${phase === 'shuffle' && activeSide === 'human' ? ' gomoku-app__lottery-stone--shaking' : ''}`}
                />
                <span class={`gomoku-app__lottery-name${leftUsesModelName ? ' gomoku-app__model-name' : ''}`}>{leftName}</span>
                <span class="gomoku-app__lottery-role">{phase === 'reveal' ? humanRole : '…'}</span>
              </div>

              <div class="gomoku-app__lottery-divider" aria-hidden="true">
                <span class="gomoku-app__lottery-divider-icon">🎋</span>
              </div>

              <div
                class={`gomoku-app__lottery-card gomoku-app__lottery-card--opponent${activeSide === 'opponent' ? ' gomoku-app__lottery-card--active' : ''}${phase === 'reveal' && winnerSide === 'opponent' ? ' gomoku-app__lottery-card--winner' : ''}`}
              >
                <span
                  class={`gomoku-app__lottery-stone gomoku-app__lottery-stone--${rightStoneColor}${phase === 'shuffle' && activeSide === 'opponent' ? ' gomoku-app__lottery-stone--shaking' : ''}`}
                />
                <span class={`gomoku-app__lottery-name${rightUsesModelName ? ' gomoku-app__model-name' : ''}`}>{rightName}</span>
                <span class="gomoku-app__lottery-role">{phase === 'reveal' ? opponentRole : '…'}</span>
              </div>
            </div>

            {phase === 'reveal' && (
              <div class="gomoku-app__lottery-result">
                {humanFirst ? (
                  isAivai ? (
                    <>
                      <span class="gomoku-app__model-name">{GOMOKU_HEURISTIC_AI_NAME}</span>
                      <span>执黑先手！</span>
                    </>
                  ) : (
                    <span>{leftName}执黑先手！</span>
                  )
                ) : isPvp ? (
                  <span>{rightName}执黑先手！</span>
                ) : isAivai ? (
                  <>
                    <GomokuModelName name={rightName} />
                    <span>执黑先手！</span>
                  </>
                ) : (
                  <>
                    <GomokuModelName name={rightName} />
                    <span>执黑先手！</span>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {phase === 'versus' && (
          <div class="gomoku-app__match-banner-hint">
            {gameMode === 'pvp' ? (
              <span>人人对战 · 双方均由你操控</span>
            ) : gameMode === 'aivai' ? (
              <>
                <span>双 AI 对战</span>
                <span class="gomoku-app__match-banner-hint-label">{GOMOKU_HEURISTIC_AI_NAME}</span>
                <span>VS</span>
                <GomokuModelName name={opponentFriendlyName} />
              </>
            ) : (
              <>
                <span>人机对战</span>
                <span class="gomoku-app__match-banner-hint-label">对手</span>
                <GomokuModelName name={opponentFriendlyName} />
              </>
            )}
          </div>
        )}
        {phase === 'shuffle' && <p class="gomoku-app__match-banner-hint">签筒摇动中…</p>}
      </div>
    </div>
  )
}
