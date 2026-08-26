import { useEffect, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SettingsChoiceOptionList } from '../../ui/settings-choice-option-list.tsx'
import {
  ExtAppManifestFetchError,
  useDevExtApps,
} from '../../os/dev-ext-apps-context.tsx'
import {
  loadExperimentalSettings,
  patchExperimentalSettings,
} from '../../os/experimental-settings-storage.ts'
import {
  loadSystemDebugLogSettings,
  patchSystemDebugLogSettings,
} from '../../os/system-debug-log-settings-storage.ts'
import {
  clearAllSystemDebugData,
  fetchSystemDebugStats,
} from '../../os/system-debug-log.ts'
import {
  getDataCapacityBytes,
  clearDevDataStorageFill,
  fillDataStorageToCapacityForDev,
  getCombinedDataStorageBytes,
} from '../../os/device-data-storage.ts'
import {
  DEVICE_CAPACITY_BYTES,
  clearDevSystemStorageFill,
  fillSystemStorageToCapacityForDev,
  getTotalLocalStorageBytes,
} from '../../os/device-storage.ts'
import {
  loadModelSourceSettings,
  MODEL_SOURCE_OPTIONS,
  saveModelSourceSettings,
  type ModelSource,
} from '../../os/model-source-settings-storage.ts'
import { formatStorageSize } from './format-storage-size.ts'

type DeveloperSettingsViewProps = {
  onBack: () => void
}

type DeveloperFeatureProps = {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function DeveloperFeature({ title, description, checked, onChange }: DeveloperFeatureProps) {
  return (
    <div class="settings__experimental-feature">
      <div class="settings__list">
        <div class="settings__toggle-row">
          <span class="settings__toggle-row-label">{title}</span>
          <IosSwitch checked={checked} onChange={onChange} label={title} />
        </div>
      </div>
      <p class="settings__section-footnote">{description}</p>
    </div>
  )
}

export function DeveloperSettingsView({ onBack }: DeveloperSettingsViewProps) {
  const { sessionExtApps, addSessionExtApp, removeSessionExtApp, openSessionExtApp } = useDevExtApps()
  const [fullscreenImmersiveChrome, setFullscreenImmersiveChrome] = useState(
    () => loadExperimentalSettings().fullscreenImmersiveChrome,
  )
  const [speechApp, setSpeechApp] = useState(
    () => loadExperimentalSettings().speechApp,
  )
  const [externalBridge, setExternalBridge] = useState(
    () => loadExperimentalSettings().externalBridge,
  )
  const [generatedAppLegacyLoading, setGeneratedAppLegacyLoading] = useState(
    () => !loadExperimentalSettings().generatedAppProcessIsolation,
  )
  const [alwaysShowCursor, setAlwaysShowCursor] = useState(
    () => loadExperimentalSettings().alwaysShowCursor,
  )
  const [vmCrashReport, setVmCrashReport] = useState(
    () => loadExperimentalSettings().vmCrashReport,
  )
  const [systemDebugLog, setSystemDebugLog] = useState(
    () => loadSystemDebugLogSettings().enabled,
  )
  const [systemDebugLogBytes, setSystemDebugLogBytes] = useState<number | undefined>(undefined)
  const [systemDebugLogClearing, setSystemDebugLogClearing] = useState(false)
  const [modelSource, setModelSource] = useState<ModelSource>(
    () => loadModelSourceSettings().source,
  )
  const [saveError, setSaveError] = useState(false)
  const [devUrl, setDevUrl] = useState('http://localhost:6175/')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | undefined>(undefined)
  const [addSuccess, setAddSuccess] = useState<string | undefined>(undefined)
  const [fillBusy, setFillBusy] = useState<'system' | 'data' | undefined>(undefined)
  const [clearFillBusy, setClearFillBusy] = useState<'system' | 'data' | undefined>(undefined)
  const [systemFillStatus, setSystemFillStatus] = useState<string | undefined>(undefined)
  const [dataFillStatus, setDataFillStatus] = useState<string | undefined>(undefined)
  const [fillError, setFillError] = useState<string | undefined>(undefined)
  const storageBusy = fillBusy !== undefined || clearFillBusy !== undefined

  useEffect(() => {
    void fetchSystemDebugStats().then((stats) => {
      if (stats !== undefined) {
        setSystemDebugLogBytes(stats.bytes)
      }
    })
  }, [])

  const handleToggleImmersiveChrome = (checked: boolean) => {
    if (!patchExperimentalSettings({ fullscreenImmersiveChrome: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setFullscreenImmersiveChrome(checked)
  }

  const handleToggleSpeechApp = (checked: boolean) => {
    if (!patchExperimentalSettings({ speechApp: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setSpeechApp(checked)
  }

  const handleToggleExternalBridge = (checked: boolean) => {
    if (!patchExperimentalSettings({ externalBridge: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setExternalBridge(checked)
  }

  const handleToggleGeneratedAppLegacyLoading = (checked: boolean) => {
    if (!patchExperimentalSettings({ generatedAppProcessIsolation: !checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setGeneratedAppLegacyLoading(checked)
  }

  const handleToggleAlwaysShowCursor = (checked: boolean) => {
    if (!patchExperimentalSettings({ alwaysShowCursor: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setAlwaysShowCursor(checked)
  }

  const handleVmCrashReportChange = (value: string) => {
    const mode = value === 'record' || value === 'throw' ? value : 'off'
    if (!patchExperimentalSettings({ vmCrashReport: mode })) {
      setSaveError(true)
      return
    }
    setSaveError(false)
    setVmCrashReport(mode)
  }

  const handleToggleSystemDebugLog = (checked: boolean) => {
    if (!patchSystemDebugLogSettings({ enabled: checked })) {
      setSaveError(true)
      return
    }
    setSaveError(false)
    setSystemDebugLog(checked)
  }

  const handleClearSystemDebugData = async () => {
    setSystemDebugLogClearing(true)
    try {
      await clearAllSystemDebugData()
      setSystemDebugLogBytes(0)
    } finally {
      setSystemDebugLogClearing(false)
    }
  }

  const handleModelSourceChange = (value: string) => {
    const source: ModelSource = value === 'local' ? 'local' : 'remote'
    void (async () => {
      if (!(await saveModelSourceSettings({ source }))) {
        setSaveError(true)
        return
      }
      setSaveError(false)
      setModelSource(source)
    })()
  }

  const handleAddDevExtApp = async () => {
    setAddBusy(true)
    setAddError(undefined)
    setAddSuccess(undefined)

    try {
      const record = await addSessionExtApp(devUrl)
      setAddSuccess(`已添加「${record.manifest.name}」到桌面`)
      window.setTimeout(() => setAddSuccess(undefined), 2500)
    } catch (error) {
      if (error instanceof ExtAppManifestFetchError) {
        setAddError(error.message)
      } else {
        setAddError('添加失败，请稍后重试')
      }
    } finally {
      setAddBusy(false)
    }
  }

  const handleFillSystemStorage = () => {
    setFillBusy('system')
    setFillError(undefined)
    setSystemFillStatus('正在写入系统空间…')

    try {
      const before = getTotalLocalStorageBytes()
      if (before >= DEVICE_CAPACITY_BYTES) {
        setSystemFillStatus(`系统空间已满（${formatStorageSize(DEVICE_CAPACITY_BYTES)}）`)
        return
      }

      const result = fillSystemStorageToCapacityForDev()
      setSystemFillStatus(
        `已写满：新增 ${formatStorageSize(result.addedBytes)}，当前 ${formatStorageSize(result.totalBytes)} / ${formatStorageSize(DEVICE_CAPACITY_BYTES)}`,
      )
    } catch {
      setFillError('写满系统空间失败，请稍后重试')
      setSystemFillStatus(undefined)
    } finally {
      setFillBusy(undefined)
    }
  }

  const handleClearSystemFill = () => {
    setClearFillBusy('system')
    setFillError(undefined)

    try {
      clearDevSystemStorageFill()
      const total = getTotalLocalStorageBytes()
      setSystemFillStatus(
        `已清除填充数据，当前 ${formatStorageSize(total)} / ${formatStorageSize(DEVICE_CAPACITY_BYTES)}`,
      )
    } catch {
      setFillError('清除系统空间填充数据失败，请稍后重试')
    } finally {
      setClearFillBusy(undefined)
    }
  }

  const handleFillDataStorage = async () => {
    setFillBusy('data')
    setFillError(undefined)
    setDataFillStatus('正在写入数据空间…')

    try {
      const before = await getCombinedDataStorageBytes()
      const capacityBytes = getDataCapacityBytes()
      if (before >= capacityBytes) {
        setDataFillStatus(`数据空间已满（${formatStorageSize(capacityBytes)}）`)
        return
      }

      const result = await fillDataStorageToCapacityForDev()
      setDataFillStatus(
        `已写满：新增 ${formatStorageSize(result.addedBytes)}，当前 ${formatStorageSize(result.totalBytes)} / ${formatStorageSize(capacityBytes)}`,
      )
    } catch {
      setFillError('写满数据空间失败，请稍后重试')
      setDataFillStatus(undefined)
    } finally {
      setFillBusy(undefined)
    }
  }

  const handleClearDevFill = async () => {
    setClearFillBusy('data')
    setFillError(undefined)

    try {
      await clearDevDataStorageFill()
      const total = await getCombinedDataStorageBytes()
      const capacityBytes = getDataCapacityBytes()
      setDataFillStatus(
        `已清除填充数据，当前 ${formatStorageSize(total)} / ${formatStorageSize(capacityBytes)}`,
      )
    } catch {
      setFillError('清除数据空间填充数据失败，请稍后重试')
    } finally {
      setClearFillBusy(undefined)
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">开发者选项</h2>
          <p class="settings__section-subtitle">
            面向开发与调试的选项。部分功能可能不稳定；外链调试应用仅保存在本次会话，重启后自动消失。
          </p>

          <div class="settings__developer-ext-section">
            <h3 class="settings__section-title settings__section-title--minor">模型下载</h3>
            <SettingsChoiceOptionList
              ariaLabel="模型下载来源"
              options={MODEL_SOURCE_OPTIONS}
              value={modelSource}
              onChange={handleModelSourceChange}
            />
            <p class="settings__section-footnote">
              默认从模型网关（R2）拉取，生产与本地开发相同。同源只读本站 /assets，适合本地
              pnpm
              dev、且 public/assets 里已有权重时。切换后尚未加载的推理会按新来源下载。
            </p>
          </div>

          <div class="settings__developer-ext-section">
            {/* 【实验性 · 未完成】外链应用平台（Bridge）整条链路尚未定稿 */}
            <h3 class="settings__section-title settings__section-title--minor">外链应用调试（实验性 · 未完成）</h3>
            <DeveloperFeature
              title="启用外链应用平台"
              description="未完成的实验特性。开启后，可在下方添加外链调试应用；系统设置中也会出现「外链 AI 授权」入口。协议与授权流程尚未定稿。"
              checked={externalBridge}
              onChange={handleToggleExternalBridge}
            />

            {externalBridge ? (
              <>
                <p class="settings__section-footnote settings__section-footnote--flush">
                  输入外链应用模板的本地开发地址（例如 instant-os-extAppTemplate 的 pnpm
                  dev），系统会读取 instant-os.manifest.json 并临时添加到桌面。在 Instant OS
                  内打开后将走宿主真实 AI，而非模板内的 Mock。
                </p>

                <div class="settings__box">
                  <label class="settings__field">
                    <span class="settings__field-label">开发服务器地址</span>
                    <input
                      class="settings__input"
                      type="url"
                      placeholder="http://localhost:6175/"
                      value={devUrl}
                      disabled={addBusy}
                      onInput={(event) => setDevUrl((event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>

                  <div class="settings__actions settings__actions--in-box">
                    <div class="settings__form-status" aria-live="polite">
                      {addError ? (
                        <span class="settings__form-status--error">{addError}</span>
                      ) : addSuccess ? (
                        <span class="settings__form-status--ok">{addSuccess}</span>
                      ) : undefined}
                    </div>
                    <button
                      type="button"
                      class="settings__btn settings__btn--default"
                      disabled={addBusy || !devUrl.trim()}
                      onClick={() => void handleAddDevExtApp()}
                    >
                      {addBusy ? '正在添加…' : '添加到桌面'}
                    </button>
                  </div>
                </div>

                {sessionExtApps.length > 0 ? (
                  <div class="settings__list settings__developer-app-list">
                    <div class="settings__list-head settings__list-head--developer-app">
                      <span>应用</span>
                      <span>开发地址</span>
                      <span>操作</span>
                    </div>
                    <div class="settings__list-body settings__list-body--apps">
                      {sessionExtApps.map((app) => (
                        <div class="settings__row settings__row--static settings__developer-app-row" key={app.id}>
                          <span class="settings__row-name">
                            {app.manifest.name}
                            <span class="settings__row-badge settings__row-badge--dev">DEV</span>
                          </span>
                          <span class="settings__row-hint">{app.devUrl}</span>
                          <div class="settings__developer-app-actions">
                            <button
                              type="button"
                              class="settings__btn settings__btn--small"
                              onClick={() => openSessionExtApp(app.id)}
                            >
                              打开
                            </button>
                            <button
                              type="button"
                              class="settings__btn settings__btn--small settings__btn--danger"
                              onClick={() => removeSessionExtApp(app.id)}
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p class="settings__section-footnote settings__section-footnote--flush">
                    当前会话尚未添加外链调试应用。
                  </p>
                )}
              </>
            ) : undefined}
          </div>

          <div class="settings__developer-ext-section">
            <h3 class="settings__section-title settings__section-title--minor">存储调试</h3>
            <p class="settings__section-footnote settings__section-footnote--flush">
              分别将系统空间（localStorage，上限 {formatStorageSize(DEVICE_CAPACITY_BYTES)}）与数据空间（IndexedDB，上限{' '}
              {formatStorageSize(getDataCapacityBytes())}）写入至硬上限，用于测试快满通知与写满拦截。填充数据可单独清除，不影响其它真实数据。
            </p>

            <div class="settings__box">
              <p class="settings__field-label">系统空间</p>
              <div class="settings__actions settings__actions--in-box">
                <div class="settings__form-status" aria-live="polite">
                  {systemFillStatus ? (
                    <span class="settings__form-status--ok">{systemFillStatus}</span>
                  ) : undefined}
                </div>
                <div class="settings__developer-app-actions">
                  <button
                    type="button"
                    class="settings__btn settings__btn--danger"
                    disabled={storageBusy}
                    onClick={handleFillSystemStorage}
                  >
                    {fillBusy === 'system' ? '正在写满…' : '写满系统空间'}
                  </button>
                  <button
                    type="button"
                    class="settings__btn settings__btn--default"
                    disabled={storageBusy}
                    onClick={handleClearSystemFill}
                  >
                    {clearFillBusy === 'system' ? '正在清除…' : '清除填充数据'}
                  </button>
                </div>
              </div>
            </div>

            <div class="settings__box">
              <p class="settings__field-label">数据空间</p>
              <div class="settings__actions settings__actions--in-box">
                <div class="settings__form-status" aria-live="polite">
                  {dataFillStatus ? (
                    <span class="settings__form-status--ok">{dataFillStatus}</span>
                  ) : undefined}
                </div>
                <div class="settings__developer-app-actions">
                  <button
                    type="button"
                    class="settings__btn settings__btn--danger"
                    disabled={storageBusy}
                    onClick={() => void handleFillDataStorage()}
                  >
                    {fillBusy === 'data' ? '正在写满…' : '写满数据空间'}
                  </button>
                  <button
                    type="button"
                    class="settings__btn settings__btn--default"
                    disabled={storageBusy}
                    onClick={() => void handleClearDevFill()}
                  >
                    {clearFillBusy === 'data' ? '正在清除…' : '清除填充数据'}
                  </button>
                </div>
              </div>
            </div>

            {fillError ? (
              <p class="settings__section-footnote settings__form-status--error">{fillError}</p>
            ) : undefined}
          </div>

          <div class="settings__experimental-features">
            <DeveloperFeature
              title="全屏沉浸顶栏"
              description="开启后，窗口进入全屏时会隐藏菜单栏与标题栏；将指针移至屏幕顶部 5 像素内时，会以悬浮方式唤出菜单栏与当前窗口标题栏。"
              checked={fullscreenImmersiveChrome}
              onChange={handleToggleImmersiveChrome}
            />
            <DeveloperFeature
              title="语音实验室（实验性 · 未完成）"
              description="未完成的实验特性。开启后，语音实验室会出现在桌面和程序坞中，系统设置中也会出现「语音」入口，可测试系统语音服务（识别 / 合成）；能力与产品定位均未定稿。"
              checked={speechApp}
              onChange={handleToggleSpeechApp}
            />
            <DeveloperFeature
              title="始终显示鼠标指针"
              description="开启后，启动界面与冷启动过渡期间也会显示系统鼠标指针，便于调试与录屏。"
              checked={alwaysShowCursor}
              onChange={handleToggleAlwaysShowCursor}
            />
            <div class="settings__experimental-feature">
              <div class="settings__list">
                <div class="settings__toggle-row">
                  <span class="settings__toggle-row-label">系统诊断日志（黑匣子）</span>
                  <IosSwitch
                    checked={systemDebugLog}
                    onChange={handleToggleSystemDebugLog}
                    label="系统诊断日志"
                  />
                </div>
              </div>
              <p class="settings__section-footnote">
                打开后在 npm run / QuickJS / 文件系统 / 虚拟机等高危路径采样记录面包屑，由独立
                Worker 收集并心跳监测主线程；主线程卡死时 Worker 仍能记录「未响应」并落盘。开启会在高危路径上产生少量开销，默认关闭。整页卡死后请新开标签页查看「事件日志 →
                系统」；本数据写入独立诊断库，不计入数据空间。
              </p>
              <div class="settings__actions settings__actions--in-box">
                <span class="settings__section-footnote" aria-live="polite">
                  {systemDebugLogBytes !== undefined
                    ? `诊断库占用约 ${formatStorageSize(systemDebugLogBytes)}`
                    : ''}
                </span>
                <button
                  type="button"
                  class="settings__btn settings__btn--default"
                  disabled={systemDebugLogClearing}
                  onClick={() => void handleClearSystemDebugData()}
                >
                  {systemDebugLogClearing ? '正在清空…' : '清空诊断数据'}
                </button>
              </div>
            </div>
            <div class="settings__experimental-feature">
              <h3 class="settings__section-title settings__section-title--minor">虚拟机崩溃报告</h3>
              <SettingsChoiceOptionList
                ariaLabel="虚拟机崩溃报告模式"
                options={[
                  { id: 'off', label: '关闭' },
                  { id: 'record', label: '记录' },
                  { id: 'throw', label: '抛出' },
                ]}
                value={vmCrashReport}
                onChange={handleVmCrashReportChange}
              />
              <p class="settings__section-footnote">
                控制模拟器致命错误（WASM 崩溃 / 栈溢出）的呈现方式。关闭：只显示固定提示；记录：写入系统诊断日志（需开启黑匣子）并在运行时 Console 输出原文；抛出：原始错误原样进入 Console（完整堆栈），同时仍会停模拟器并通知宿主。切换后需重新开机虚拟机生效。
              </p>
            </div>
            <DeveloperFeature
              title="停用窗口合成器加速"
              description="非系统应用默认在 sandbox 中通过 Blob URL 加载（不含同源权限）。开启后改回同源 iframe 写入，便于排查兼容问题，但子应用异常时可能拖死系统界面。切换后会重新加载已打开的非系统应用窗口。"
              checked={generatedAppLegacyLoading}
              onChange={handleToggleGeneratedAppLegacyLoading}
            />
          </div>
          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，请检查设备存储空间。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/** @deprecated 使用 DeveloperSettingsView */
export const ExperimentalSettingsView = DeveloperSettingsView
