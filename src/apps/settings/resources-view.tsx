import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { INSTANT3D_CATALOG } from '../../assets/3d/asset-catalog.ts'

type ResourcesViewProps = {
  onBack: () => void
  onOpen3d: () => void
}

export function ResourcesView({ onBack, onOpen3d }: ResourcesViewProps) {
  const modelCount = INSTANT3D_CATALOG.length

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">资源</h2>
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--button settings__row--nav"
              onClick={onOpen3d}
            >
              <span class="settings__row-name">3D 资源</span>
              <span class="settings__row-size">{modelCount} 个模型</span>
              <SettingsDisclosureIcon />
            </button>
          </div>
          <p class="settings__section-footnote">
            查看 Instant OS 内置的 3D 模型与几何基元，供 AI 生成 3D 场景时使用。
          </p>
        </section>
      </div>
    </div>
  )
}
