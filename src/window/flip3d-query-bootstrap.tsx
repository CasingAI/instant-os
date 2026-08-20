import { useEffect, useRef } from 'preact/hooks'
import { useOs } from '../os/os-context.tsx'
import type { BuiltinAppId } from '../os/types.ts'
import { markWelcomeSeen } from '../os/welcome-first-run.ts'
import { listFlip3dWindowIds } from './flip3d.ts'

const PREVIEW_APPS: readonly BuiltinAppId[] = [
  'files',
  'appstore',
  'browser',
  'settings',
  'textedit',
  'calendar',
  'weather',
  'stocks',
  'news',
  'help',
  'system-info',
  'task-manager',
  'mail',
  'books',
  'translate',
  'music',
]

function previewAppCount(): number {
  const raw = new URLSearchParams(location.search).get('flip3d')
  if (raw == null) {
    return 0
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, PREVIEW_APPS.length)
  }
  return 4
}

/** `?flip3d=1` 开 4 窗；`?flip3d=12` 开更多，方便对照后层。 */
export function Flip3dQueryBootstrap() {
  const { windows, openApp, enterFlip3d, flip3dActive } = useOs()
  const count = previewAppCount()
  const wanted = count > 0
  const openedRef = useRef(false)
  const scheduledRef = useRef(false)

  useEffect(() => {
    if (!wanted || openedRef.current) {
      return
    }
    openedRef.current = true
    markWelcomeSeen()
    for (const appId of PREVIEW_APPS.slice(0, count)) {
      openApp(appId)
    }
  }, [count, openApp, wanted])

  useEffect(() => {
    if (!wanted || scheduledRef.current || flip3dActive) {
      return
    }
    if (listFlip3dWindowIds(windows).length < count) {
      return
    }
    scheduledRef.current = true
    console.info('[flip3d-preview] entering', count)
    window.setTimeout(() => {
      const result = enterFlip3d()
      console.info('[flip3d-preview]', result)
    }, 720)
  }, [count, enterFlip3d, flip3dActive, wanted, windows])

  return null
}
