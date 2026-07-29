import { useMemo, useState } from 'preact/hooks'
import { SearchIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  SettingsChoiceOptionList,
  type SettingsChoiceOption,
} from '../../ui/settings-choice-option-list.tsx'

type SettingsChoicePickerViewProps = {
  title: string
  backLabel: string
  options: readonly SettingsChoiceOption[]
  value: string
  onChange: (value: string) => void
  onBack: () => void
  footnote?: string
  /** 顶部搜索过滤 */
  searchable?: boolean
  searchPlaceholder?: string
  /**
   * 选中后是否自动返回上一页。
   * 默认 true（短列表下拉替代场景）；长列表建议 false，由返回按钮离开。
   */
  closeOnSelect?: boolean
  /** 隐藏内容区小标题，标题改放导航栏中央 */
  titleInNav?: boolean
  /** 网络请求进行中：空列表显示转圈，有列表则盖遮罩 */
  loading?: boolean
  loadingLabel?: string
}

export function SettingsChoicePickerView({
  title,
  backLabel,
  options,
  value,
  onChange,
  onBack,
  footnote,
  searchable = false,
  searchPlaceholder = '搜索',
  closeOnSelect = true,
  titleInNav = false,
  loading = false,
  loadingLabel = '加载中…',
}: SettingsChoicePickerViewProps) {
  const [query, setQuery] = useState('')

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => {
      const label = option.label.toLowerCase()
      const id = option.id.toLowerCase()
      return label.includes(needle) || id.includes(needle)
    })
  }, [options, query])

  const handleChange = (next: string) => {
    if (loading) return
    onChange(next)
    if (closeOnSelect) {
      onBack()
    }
  }

  const showEmptyLoading = loading && filteredOptions.length === 0

  return (
    <>
      <div
        class={`settings__nav${titleInNav ? ' settings__nav--titled' : ''}`}
      >
        <div class="settings__nav-bar">
          <IosNavBackButton
            label={backLabel}
            onClick={onBack}
            disabled={loading}
          />
          {titleInNav ? (
            <h1 class="settings__nav-heading">{title}</h1>
          ) : (
            <span class="settings__nav-heading-spacer" aria-hidden="true" />
          )}
          <span class="settings__nav-trailing" aria-hidden="true" />
        </div>
      </div>
      <div class="settings__body">
        {searchable && (
          <div class="settings__search-bar">
            <div class="settings__search">
              <span class="settings__search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                type="search"
                class="settings__search-input"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                spellcheck={false}
                enterkeyhint="search"
                disabled={loading}
                onInput={(event) =>
                  setQuery((event.currentTarget as HTMLInputElement).value)
                }
              />
            </div>
          </div>
        )}
        <div class="settings__content settings__content--compact">
        <section class="settings__section">
          {!titleInNav && <h2 class="settings__section-title">{title}</h2>}
          {showEmptyLoading ? (
            <div class="settings__box settings__loading" aria-live="polite">
              <span class="settings__loading-spinner" aria-hidden="true" />
              <span>{loadingLabel}</span>
            </div>
          ) : filteredOptions.length > 0 ? (
            <div
              class={
                loading ? 'settings__choice-loading' : undefined
              }
            >
              <SettingsChoiceOptionList
                options={filteredOptions}
                value={value}
                onChange={handleChange}
                ariaLabel={title}
              />
              {loading && (
                <div
                  class="settings__choice-loading-overlay"
                  aria-live="polite"
                >
                  <span class="settings__loading-spinner" aria-hidden="true" />
                  <span>{loadingLabel}</span>
                </div>
              )}
            </div>
          ) : (
            <div class="settings__box settings__empty">
              {query.trim() ? '无匹配结果' : '暂无选项'}
            </div>
          )}
          {footnote && !loading && (
            <p class="settings__section-footnote">{footnote}</p>
          )}
        </section>
        </div>
      </div>
    </>
  )
}
