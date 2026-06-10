import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'

type ExperimentalSettingsViewProps = {
  onBack: () => void
}

export function ExperimentalSettingsView({ onBack }: ExperimentalSettingsViewProps) {
  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">实验性特性</h2>
          <p class="settings__section-subtitle">这些功能仍在开发中，可能不稳定或随时调整。</p>
          <div class="settings__box settings__empty">暂无实验性特性</div>
        </section>
      </div>
    </div>
  )
}
