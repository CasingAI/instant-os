import { Button } from '../../ui/button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'

type ChromoSettingsPageProps = {
  bookmarksBarVisible: boolean
  onToggleBookmarksBar: () => void
  onClearHistory: () => void
}

export function ChromoSettingsPage({
  bookmarksBarVisible,
  onToggleBookmarksBar,
  onClearHistory,
}: ChromoSettingsPageProps) {
  return (
    <div class="chromo-internal" role="document" aria-labelledby="chromo-settings-title">
      <header class="chromo-internal__header">
        <h1 id="chromo-settings-title" class="chromo-internal__title">
          设置
        </h1>
        <p class="chromo-internal__subtitle">Chromo</p>
      </header>

      <div class="chromo-settings__body">
        <section class="chromo-settings__section">
          <h2 class="chromo-settings__heading">外观</h2>
          <div class="chromo-settings__group">
            <div class="chromo-settings__row chromo-settings__row--switch">
              <span class="chromo-settings__label">显示书签栏</span>
              <IosSwitch
                checked={bookmarksBarVisible}
                onChange={() => onToggleBookmarksBar()}
                label="显示书签栏"
              />
            </div>
          </div>
        </section>

        <section class="chromo-settings__section">
          <h2 class="chromo-settings__heading">隐私</h2>
          <div class="chromo-settings__group">
            <div class="chromo-settings__row chromo-settings__row--action">
              <div>
                <div class="chromo-settings__label">浏览数据</div>
                <div class="chromo-settings__hint">清除访问过的网页记录</div>
              </div>
              <Button onClick={onClearHistory}>
                清空历史记录
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
