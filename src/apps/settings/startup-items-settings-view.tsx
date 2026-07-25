import { useState } from 'preact/hooks'
import {
  createStartupItem,
  loadStartupItemsSettings,
  saveStartupItemsSettings,
  type StartupItem,
} from '../../os/startup-items-settings-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'

type StartupItemsSettingsViewProps = {
  onBack: () => void
}

export function StartupItemsSettingsView({ onBack }: StartupItemsSettingsViewProps) {
  const [items, setItems] = useState<StartupItem[]>(() => loadStartupItemsSettings().items)
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [statusError, setStatusError] = useState(false)

  const handleChangeLabel = (id: string, label: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, label } : item)))
    setStatusMessage(undefined)
  }

  const handleChangeCommand = (id: string, command: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, command } : item)))
    setStatusMessage(undefined)
  }

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, enabled } : item)))
    setStatusMessage(undefined)
  }

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
    setStatusMessage(undefined)
  }

  const handleAdd = () => {
    setItems((prev) => [
      ...prev,
      createStartupItem({
        enabled: true,
        label: '',
        command: "await instant.openApp('files')",
      }),
    ])
    setStatusMessage(undefined)
  }

  const handleSave = () => {
    for (const item of items) {
      if (!item.command.trim()) {
        setStatusError(true)
        setStatusMessage('存在空的命令，请填写或删除该行')
        return
      }
    }
    if (!saveStartupItemsSettings({ version: 1, items })) {
      setStatusError(true)
      setStatusMessage('无法保存（存储空间可能已满）')
      return
    }
    setItems(loadStartupItemsSettings().items)
    setStatusError(false)
    setStatusMessage('已保存。下次进入桌面时按列表顺序执行已启用项。')
  }

  const enabledCount = items.filter((item) => item.enabled).length

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">启动项</h2>
          <p class="settings__section-subtitle">
            桌面就绪后按顺序执行的命令。语法与终端相同（JavaScript），可使用{' '}
            <code>instant.openApp</code>、<code>instant.openPath</code> 等 API。
          </p>

          <div class="settings__box settings__box--startup-items">
            <div class="settings__list settings__list--startup-items">
              {items.length === 0 ? (
                <p class="settings__section-footnote settings__section-footnote--flush">
                  暂无启动项。添加命令后保存即可在下次启动时执行。
                </p>
              ) : (
                items.map((item) => (
                  <div class="settings__startup-item" key={item.id}>
                    <div class="settings__startup-item-toolbar">
                      <IosSwitch
                        checked={item.enabled}
                        onChange={(checked) => handleToggleEnabled(item.id, checked)}
                        label={item.enabled ? '启用' : '停用'}
                      />
                      <input
                        class="settings__input settings__input--list"
                        type="text"
                        value={item.label}
                        placeholder="名称（可选）"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="启动项名称"
                        onInput={(event) =>
                          handleChangeLabel(item.id, (event.currentTarget as HTMLInputElement).value)
                        }
                      />
                      <button
                        type="button"
                        class="settings__btn settings__btn--plain"
                        onClick={() => handleRemove(item.id)}
                      >
                        删除
                      </button>
                    </div>
                    <textarea
                      class="settings__input settings__input--startup-command"
                      value={item.command}
                      placeholder="await instant.openApp('files')"
                      autoComplete="off"
                      spellCheck={false}
                      rows={2}
                      aria-label={item.label.trim() || '启动命令'}
                      onInput={(event) =>
                        handleChangeCommand(
                          item.id,
                          (event.currentTarget as HTMLTextAreaElement).value,
                        )
                      }
                    />
                  </div>
                ))
              )}
            </div>

            <div class="settings__actions settings__actions--in-box settings__actions--form">
              <button type="button" class="settings__btn" onClick={handleAdd}>
                添加启动项
              </button>
              <button type="button" class="settings__btn" onClick={handleSave}>
                保存
              </button>
            </div>

            <div class="settings__form-status" aria-live="polite">
              {statusMessage ? (
                <span class={statusError ? 'settings__form-status--error' : undefined}>
                  {statusMessage}
                </span>
              ) : items.length > 0 ? (
                <span class="settings__hint">
                  当前编辑中共 {items.length} 项，其中 {enabledCount} 项已启用
                </span>
              ) : undefined}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
