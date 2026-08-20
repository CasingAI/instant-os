import { useEffect, useState } from 'preact/hooks'
import {
  BACKGROUND_REFRESH_TASKS,
  REFRESH_INTERVAL_OPTIONS,
  loadBackgroundRefreshSettings,
  loadTaskState,
  patchBackgroundRefreshSettings,
  subscribeBackgroundRefreshSettings,
  type BackgroundRefreshTaskId,
  type BackgroundRefreshTaskState,
} from '../../os/background-refresh-settings-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import { useSettingsWideLayout } from './settings-layout-breakpoints.ts'
import { SettingsChoicePickerView } from './settings-choice-picker-view.tsx'

type BackgroundRefreshSettingsViewProps = {
  onBack: () => void
  onOpenTask: (taskId: BackgroundRefreshTaskId) => void
}

function formatRefreshTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '从未'
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function taskStatesEqual(
  left: Map<BackgroundRefreshTaskId, BackgroundRefreshTaskState>,
  right: Map<BackgroundRefreshTaskId, BackgroundRefreshTaskState>,
): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const [id, state] of right) {
    const current = left.get(id)
    if (
      !current ||
      current.lastSuccessAt !== state.lastSuccessAt ||
      current.lastAttemptAt !== state.lastAttemptAt ||
      current.lastResult !== state.lastResult
    ) {
      return false
    }
  }
  return true
}

function taskRowValue(state: BackgroundRefreshTaskState): string {
  if (!state.lastSuccessAt) {
    return state.lastResult === 'failure' ? '失败' : '从未'
  }
  if (state.lastResult === 'failure') {
    return `${formatRefreshTimestamp(state.lastSuccessAt)}（失败）`
  }
  return formatRefreshTimestamp(state.lastSuccessAt)
}

export function BackgroundRefreshSettingsView({
  onBack,
  onOpenTask,
}: BackgroundRefreshSettingsViewProps) {
  const { hostRef, wideLayout } = useSettingsWideLayout()
  const [enabled, setEnabled] = useState(() => loadBackgroundRefreshSettings().enabled)
  const [intervalHours, setIntervalHours] = useState(
    () => loadBackgroundRefreshSettings().intervalHours,
  )
  const [taskStates, setTaskStates] = useState(
    () =>
      new Map<BackgroundRefreshTaskId, BackgroundRefreshTaskState>(
        BACKGROUND_REFRESH_TASKS.map((task) => [
          task.id,
          loadTaskState(loadBackgroundRefreshSettings(), task.id),
        ]),
      ),
  )
  const [picker, setPicker] = useState<'interval' | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const sync = () => {
      const settings = loadBackgroundRefreshSettings()
      setEnabled((current) => (current === settings.enabled ? current : settings.enabled))
      setIntervalHours((current) =>
        current === settings.intervalHours ? current : settings.intervalHours,
      )
      const next = new Map(
        BACKGROUND_REFRESH_TASKS.map((task) => [task.id, loadTaskState(settings, task.id)]),
      )
      setTaskStates((current) => (taskStatesEqual(current, next) ? current : next))
    }
    sync()
    return subscribeBackgroundRefreshSettings(sync)
  }, [])

  const handleToggle = (next: boolean) => {
    if (next === enabled) return
    if (!patchBackgroundRefreshSettings({ enabled: next })) {
      setSaveError('无法保存设置（存储空间可能已满）')
      return
    }
    setEnabled(next)
    setSaveError(undefined)
  }

  const handleIntervalChange = (hours: number) => {
    if (hours === intervalHours) return
    if (!patchBackgroundRefreshSettings({ intervalHours: hours })) {
      setSaveError('无法保存设置（存储空间可能已满）')
      return
    }
    setIntervalHours(hours)
    setSaveError(undefined)
  }

  if (picker === 'interval') {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        <SettingsChoicePickerView
          title="刷新间隔"
          backLabel="背景刷新"
          options={REFRESH_INTERVAL_OPTIONS.map((option) => ({
            id: String(option.hours),
            label: option.label,
          }))}
          value={String(intervalHours)}
          onChange={(value) => {
            handleIntervalChange(Number(value))
            setPicker(undefined)
          }}
          onBack={() => setPicker(undefined)}
        />
      </div>
    )
  }

  return (
    <div class="settings" ref={hostRef}>
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">背景刷新</h2>
          <p class="settings__section-subtitle">
            开启后按设定间隔定期更新下列远端数据。
          </p>

          <div class="settings__list">
            <SettingsSwitchRow label="背景刷新" checked={enabled} onChange={handleToggle} />
            <SettingsChoiceField
              label="刷新间隔"
              value={String(intervalHours)}
              options={REFRESH_INTERVAL_OPTIONS.map((option) => ({
                id: String(option.hours),
                label: option.label,
              }))}
              onChange={(value) => handleIntervalChange(Number(value))}
              wideLayout={wideLayout}
              onNavigate={() => setPicker('interval')}
            />
          </div>

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error" role="status">
              {saveError}
            </p>
          )}
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">刷新项目</h2>
          <div class="settings__list">
            {BACKGROUND_REFRESH_TASKS.map((task) => {
              const state = taskStates.get(task.id) ?? {
                lastSuccessAt: 0,
                lastAttemptAt: 0,
                lastResult: undefined,
              }
              return (
                <SettingsNavRow
                  key={task.id}
                  label={task.label}
                  value={taskRowValue(state)}
                  onClick={() => onOpenTask(task.id)}
                />
              )
            })}
          </div>
          <p class="settings__section-footnote">点击项目可查看详情并立即刷新。</p>
        </section>
      </div>
    </div>
  )
}
