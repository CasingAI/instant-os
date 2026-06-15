import { useEffect, useState } from 'preact/hooks'

const CORE_FEATURES = [
  {
    id: 'appstore',
    title: '应用集市',
    description: '搜索、生成并使用专属于你的 AI 应用',
  },
  {
    id: 'safari',
    title: '网络浏览器',
    description: '访问任意网址，由 AI 即时渲染网页',
  },
  {
    id: 'icode',
    title: 'iCode',
    description: '对话式 AI 编程套件，轻松编写专属程序',
  },
] as const

const REVEAL_INTERVAL_MS = 560

type SetupCompleteViewProps = {
  saveError?: boolean
  onRevealComplete?: () => void
}

export function SetupCompleteView({ saveError, onRevealComplete }: SetupCompleteViewProps) {
  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    setVisibleCount(0)
    const timers = CORE_FEATURES.map((_, index) =>
      window.setTimeout(() => {
        const nextCount = index + 1
        setVisibleCount(nextCount)
        if (nextCount === CORE_FEATURES.length) {
          onRevealComplete?.()
        }
      }, REVEAL_INTERVAL_MS * (index + 1)),
    )

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [onRevealComplete])

  return (
    <div class="setup-complete">
      <header class="setup-complete__head">
        <h1 class="setup-complete__title">一切就绪</h1>
        <p class="setup-complete__lead">
          接下来，你可以开始使用
          <span class="setup-complete__emphasis">极为先进的 AI 桌面环境</span>。
        </p>
      </header>

      <ul class="setup-complete__features" aria-label="核心功能">
        {CORE_FEATURES.map((feature, index) => (
          <li
            key={feature.id}
            class={`setup-complete__feature${
              index < visibleCount ? ' setup-complete__feature--visible' : ''
            }`}
          >
            <span class="setup-complete__check" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path
                  d="M5 11.5 L9.5 16 L17 7"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="setup-complete__feature-copy">
              <strong class="setup-complete__feature-title">{feature.title}</strong>
              <span class="setup-complete__feature-desc">{feature.description}</span>
            </span>
          </li>
        ))}
      </ul>

      {saveError && (
        <p class="setup-assistant__error setup-complete__error" role="alert">
          保存失败，请返回检查配置或确认设备存储未满。
        </p>
      )}
    </div>
  )
}
