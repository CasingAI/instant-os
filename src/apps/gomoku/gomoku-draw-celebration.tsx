type GomokuDrawCelebrationProps = {
  onDismiss: () => void
}

export function GomokuDrawCelebration({ onDismiss }: GomokuDrawCelebrationProps) {
  return (
    <div class="gomoku-app__fullscreen-overlay gomoku-app__draw-celebration" role="status" aria-live="polite">
      <div class="gomoku-app__fullscreen-card gomoku-app__draw-celebration-card">
        <p class="gomoku-app__draw-celebration-kicker">对局结束</p>
        <p class="gomoku-app__draw-celebration-title">平局</p>
        <p class="gomoku-app__draw-celebration-sub">棋盘已无空位，双方均未五连。</p>
        <button type="button" class="gomoku-app__overlay-dismiss-btn" onClick={onDismiss}>
          查看棋局
        </button>
      </div>
    </div>
  )
}
