import type { ComponentChildren } from 'preact'

type SettingsKeepLayerProps = {
  show: boolean
  keep: boolean
  children: ComponentChildren
}

/** 子页面返回时保留 DOM（隐藏而非卸载），维持滚动与组件状态。 */
export function SettingsKeepLayer({ show, keep, children }: SettingsKeepLayerProps) {
  if (!show && !keep) {
    return null
  }

  return (
    <div class="settings-layer" hidden={!show}>
      {children}
    </div>
  )
}
