import { useEffect, useMemo, useState } from 'preact/hooks'
import { readAppDisplayName } from '../bridge/instant-os-host.ts'
import './SplashScreen.css'

const MIN_SPLASH_MS = 900
const EXIT_ANIMATION_MS = 240

type SplashScreenProps = {
  onComplete: () => void
}

function resolveColorScheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveSplashAsset(scheme: 'light' | 'dark'): string {
  return scheme === 'light' ? './splash-light.svg' : './splash-dark.svg'
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [scheme, setScheme] = useState<'light' | 'dark'>(resolveColorScheme)
  const [exiting, setExiting] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const splashSrc = useMemo(() => resolveSplashAsset(scheme), [scheme])
  const appName = readAppDisplayName()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      setScheme(media.matches ? 'light' : 'dark')
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    let exitTimer: number | undefined
    const readyTimer = window.setTimeout(() => {
      setExiting(true)
      exitTimer = window.setTimeout(() => {
        onComplete()
      }, EXIT_ANIMATION_MS)
    }, MIN_SPLASH_MS)

    return () => {
      window.clearTimeout(readyTimer)
      if (exitTimer !== undefined) {
        window.clearTimeout(exitTimer)
      }
    }
  }, [onComplete])

  return (
    <div
      class={`splash-screen splash-screen--${scheme}${exiting ? ' splash-screen--exiting' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
    >
      {imageFailed ? (
        <div class="splash-screen__fallback" aria-hidden="true">
          {appName.slice(0, 1) || 'A'}
        </div>
      ) : (
        <img
          class="splash-screen__art"
          src={splashSrc}
          alt=""
          onError={() => setImageFailed(true)}
        />
      )}
      <p class="splash-screen__label">{appName}</p>
    </div>
  )
}
