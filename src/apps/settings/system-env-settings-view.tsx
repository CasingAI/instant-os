import { useMemo, useState } from 'preact/hooks'
import {
  DEFAULT_SYSTEM_ENV_ENTRIES,
  isValidSystemEnvKey,
  loadSystemEnvSettings,
  resetSystemEnvSettings,
  saveSystemEnvSettings,
} from '../../os/system-env-settings-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'

type SystemEnvSettingsViewProps = {
  onBack: () => void
}

type EnvRow = {
  id: string
  key: string
  value: string
}

let rowSeq = 0

function nextRowId(): string {
  rowSeq += 1
  return `system-env-row-${rowSeq}`
}

function entriesToRows(entries: Record<string, string>): EnvRow[] {
  return Object.keys(entries)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      id: nextRowId(),
      key,
      value: entries[key] ?? '',
    }))
}

function rowsToEntries(rows: EnvRow[]): { ok: true; entries: Record<string, string> } | { ok: false; message: string } {
  const entries: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) {
      return { ok: false, message: '存在空的变量名，请填写或删除该行' }
    }
    if (!isValidSystemEnvKey(key)) {
      return { ok: false, message: `变量名「${key}」无效：不能包含空格或 =` }
    }
    if (key in entries) {
      return { ok: false, message: `变量名「${key}」重复` }
    }
    entries[key] = row.value
  }
  return { ok: true, entries }
}

export function SystemEnvSettingsView({ onBack }: SystemEnvSettingsViewProps) {
  const [rows, setRows] = useState<EnvRow[]>(() => entriesToRows(loadSystemEnvSettings().entries))
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined)
  const [statusError, setStatusError] = useState(false)

  const sortedPreview = useMemo(
    () => rows.map((row) => row.key.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const handleChangeKey = (id: string, key: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, key } : row)))
    setStatusMessage(undefined)
  }

  const handleChangeValue = (id: string, value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)))
    setStatusMessage(undefined)
  }

  const handleRemove = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
    setStatusMessage(undefined)
  }

  const handleAdd = () => {
    setRows((prev) => [...prev, { id: nextRowId(), key: '', value: '' }])
    setStatusMessage(undefined)
  }

  const handleSave = () => {
    const parsed = rowsToEntries(rows)
    if (!parsed.ok) {
      setStatusError(true)
      setStatusMessage(parsed.message)
      return
    }
    if (!saveSystemEnvSettings({ version: 1, entries: parsed.entries })) {
      setStatusError(true)
      setStatusMessage('无法保存（存储空间可能已满）')
      return
    }
    setRows(entriesToRows(parsed.entries))
    setStatusError(false)
    setStatusMessage('已保存。仅影响之后新开的终端与脚本会话。')
  }

  const handleReset = () => {
    if (!resetSystemEnvSettings()) {
      setStatusError(true)
      setStatusMessage('无法恢复默认（存储空间可能已满）')
      return
    }
    setRows(entriesToRows({ ...DEFAULT_SYSTEM_ENV_ENTRIES }))
    setStatusError(false)
    setStatusMessage('已恢复系统默认环境变量。仅影响之后新开的终端与脚本会话。')
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">环境变量</h2>
          <p class="settings__section-subtitle">
            系统默认环境变量，供新终端会话与脚本宿主继承。修改后不会热更新已打开的会话，需关闭后重新打开。
          </p>

          <div class="settings__box settings__box--system-env">
            <div class="settings__list settings__list--system-env">
              <div class="settings__list-head settings__list-head--system-env" aria-hidden="true">
                <span>名称</span>
                <span>值</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <p class="settings__section-footnote settings__section-footnote--flush">
                  暂无变量。可添加自定义项，或恢复系统默认。
                </p>
              ) : (
                rows.map((row) => (
                  <div class="settings__system-env-row" key={row.id}>
                    <input
                      class="settings__input settings__input--list"
                      type="text"
                      value={row.key}
                      placeholder="NAME"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="变量名"
                      onInput={(event) =>
                        handleChangeKey(row.id, (event.currentTarget as HTMLInputElement).value)
                      }
                    />
                    <input
                      class="settings__input settings__input--list"
                      type="text"
                      value={row.value}
                      placeholder="value"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`变量 ${row.key || '未命名'} 的值`}
                      onInput={(event) =>
                        handleChangeValue(row.id, (event.currentTarget as HTMLInputElement).value)
                      }
                    />
                    <button
                      type="button"
                      class="settings__btn settings__btn--plain"
                      onClick={() => handleRemove(row.id)}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>

            <div class="settings__actions settings__actions--in-box settings__actions--form">
              <button type="button" class="settings__btn" onClick={handleAdd}>
                添加变量
              </button>
              <button type="button" class="settings__btn" onClick={handleSave}>
                保存
              </button>
              <button type="button" class="settings__btn settings__btn--plain" onClick={handleReset}>
                恢复默认
              </button>
            </div>

            <div class="settings__form-status" aria-live="polite">
              {statusMessage ? (
                <span class={statusError ? 'settings__form-status--error' : undefined}>
                  {statusMessage}
                </span>
              ) : sortedPreview.length > 0 ? (
                <span class="settings__hint">当前编辑中共 {sortedPreview.length} 项</span>
              ) : undefined}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
