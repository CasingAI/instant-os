import { useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { Switch } from '../../ui/switch.tsx'
import {
  loadNotificationCenterSettings,
  patchNotificationCenterSettings,
} from '../../os/notification-center-settings-storage.ts'
import {
  OS_TEST_NOTIFICATION_ID,
  dismissOsNotification,
  postOsNotification,
  type OsNotificationPhase,
} from '../../os/os-notifications.ts'

type NotificationCenterSettingsViewProps = {
  onBack: () => void
}

const TEST_TILE = { kind: 'tile' as const, emoji: '🔔', color: '#6b7a8f' }

const TEST_FAILURE_BODY =
  '这是一条测试失败通知的详情说明。列表里只显示短副标题，完整错误与诊断信息只出现在通知详情中，避免把长文本塞进通知中心列表。'

function postTestNotification(phase: OsNotificationPhase): void {
  const base = {
    id: OS_TEST_NOTIFICATION_ID,
    title: '测试通知',
    icon: TEST_TILE,
  }

  if (phase === 'running') {
    postOsNotification({
      ...base,
      subtitle: '正在处理',
      phase: 'running',
      progress: {
        percent: 42,
        statLabel: '步骤',
        statValue: '2/5',
      },
      banner: 'progress',
    })
    return
  }

  if (phase === 'success') {
    postOsNotification(
      {
        ...base,
        subtitle: '已完成',
        phase: 'success',
        banner: 'once',
        actions: [{ id: 'dismiss', label: '忽略' }],
      },
      {
        onAction: {
          dismiss: () => dismissOsNotification(OS_TEST_NOTIFICATION_ID),
        },
      },
    )
    return
  }

  if (phase === 'failure') {
    postOsNotification(
      {
        ...base,
        subtitle: '发送失败',
        phase: 'failure',
        body: TEST_FAILURE_BODY,
        banner: 'once',
        actions: [{ id: 'dismiss', label: '忽略' }],
      },
      {
        onAction: {
          dismiss: () => dismissOsNotification(OS_TEST_NOTIFICATION_ID),
        },
      },
    )
    return
  }

  postOsNotification(
    {
      ...base,
      subtitle: '请注意',
      phase: 'warning',
      body: '这是一条测试警告。可用于确认警告色、横幅与详情模板是否一致。',
      banner: 'once',
      actions: [{ id: 'dismiss', label: '忽略' }],
    },
    {
      onAction: {
        dismiss: () => dismissOsNotification(OS_TEST_NOTIFICATION_ID),
      },
    },
  )
}

export function NotificationCenterSettingsView({ onBack }: NotificationCenterSettingsViewProps) {
  const [showWeather, setShowWeather] = useState(
    () => loadNotificationCenterSettings().showWeather,
  )
  const [showStocks, setShowStocks] = useState(() => loadNotificationCenterSettings().showStocks)
  const [saveError, setSaveError] = useState(false)

  const handleToggle =
    (key: 'showWeather' | 'showStocks', setter: (value: boolean) => void) =>
    (checked: boolean) => {
      if (!patchNotificationCenterSettings({ [key]: checked })) {
        setSaveError(true)
        return
      }
      setSaveError(false)
      setter(checked)
    }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">通知中心</h2>
          <p class="settings__section-subtitle">选择在通知中心顶部显示的内容。</p>

          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">天气</span>
              <Switch
                checked={showWeather}
                onChange={handleToggle('showWeather', setShowWeather)}
                label="显示天气"
              />
            </div>
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">股票</span>
              <Switch
                checked={showStocks}
                onChange={handleToggle('showStocks', setShowStocks)}
                label="显示股票"
              />
            </div>
          </div>

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，请检查设备存储空间。
            </p>
          )}
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">测试通知</h2>
          <p class="settings__section-subtitle">
            发送一条系统通知以预览统一模板。重复发送会覆盖上一条测试通知。
          </p>
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--button"
              onClick={() => postTestNotification('running')}
            >
              <span class="settings__row-name">发送进行中</span>
            </button>
            <button
              type="button"
              class="settings__row settings__row--button"
              onClick={() => postTestNotification('success')}
            >
              <span class="settings__row-name">发送成功</span>
            </button>
            <button
              type="button"
              class="settings__row settings__row--button"
              onClick={() => postTestNotification('failure')}
            >
              <span class="settings__row-name">发送失败</span>
            </button>
            <button
              type="button"
              class="settings__row settings__row--button"
              onClick={() => postTestNotification('warning')}
            >
              <span class="settings__row-name">发送警告</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
