type ChromoExtensionsPanelProps = {
  /** Viewer ready (for page-side tools like vConsole). */
  pageReady: boolean
  /** Page navigation still in progress (non-blocking hint). */
  pageLoading?: boolean
  /** Viewer iframe exists (DebugPanel lives in viewer, not the page). */
  viewerReady?: boolean
  vConsoleEnabled: boolean
  vConsoleBusy?: boolean
  vConsoleError?: string
  onVConsoleEnabledChange: (enabled: boolean) => void
  debugPanelEnabled: boolean
  onDebugPanelEnabledChange: (enabled: boolean) => void
}

function ExtensionToggle(props: {
  checked: boolean
  disabled?: boolean
  ariaLabel: string
  onChange: (enabled: boolean) => void
}) {
  return (
    <label class="chromo-extensions__toggle">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange((event.target as HTMLInputElement).checked)
        }}
        aria-label={props.ariaLabel}
      />
      <span class="chromo-extensions__toggle-ui" aria-hidden="true" />
    </label>
  )
}

export function ChromoExtensionsPanel({
  pageReady,
  pageLoading = false,
  viewerReady = true,
  vConsoleEnabled,
  vConsoleBusy = false,
  vConsoleError,
  onVConsoleEnabledChange,
  debugPanelEnabled,
  onDebugPanelEnabledChange,
}: ChromoExtensionsPanelProps) {
  const vConsoleStatus = !pageReady
    ? '页面未就绪'
    : vConsoleBusy
      ? '加载中…'
      : pageLoading
        ? '页面仍在加载'
        : vConsoleEnabled
          ? '已启用'
          : '未启用'

  const debugStatus = !viewerReady
    ? 'Viewer 未就绪'
    : debugPanelEnabled
      ? '已启用'
      : '未启用'

  return (
    <div class="chromo-extensions">
      <p class="chromo-extensions__intro">
        在此启用页内 / Viewer 调试扩展。默认均关闭，避免干扰正常浏览。
      </p>

      <ul class="chromo-extensions__list" role="list">
        <li class="chromo-extensions__item">
          <div class="chromo-extensions__item-main">
            <div class="chromo-extensions__item-title">Chromo 调试面板</div>
            <div class="chromo-extensions__item-desc">
              Viewer 左下角绿色「调」圆钮：查看 bridge 日志、通讯、网络与状态。与页内
              vConsole 独立；导航后仍保留。
            </div>
          </div>
          <div class="chromo-extensions__item-side">
            <span class="chromo-extensions__status">{debugStatus}</span>
            <ExtensionToggle
              checked={debugPanelEnabled}
              disabled={!viewerReady}
              ariaLabel="在 Viewer 中启用 Chromo 调试面板"
              onChange={onDebugPanelEnabledChange}
            />
          </div>
        </li>

        <li class="chromo-extensions__item">
          <div class="chromo-extensions__item-main">
            <div class="chromo-extensions__item-title">vConsole</div>
            <div class="chromo-extensions__item-desc">
              代理页内移动端调试面板（Element、Network、Storage、Log）。右下角绿色按钮打开；与
              Chromo DevTools Console 可能重复采集日志；导航后会自动重注入。
            </div>
            {vConsoleError ? (
              <div class="chromo-extensions__item-error" role="alert">
                {vConsoleError}
              </div>
            ) : null}
          </div>
          <div class="chromo-extensions__item-side">
            <span class="chromo-extensions__status">{vConsoleStatus}</span>
            <ExtensionToggle
              checked={vConsoleEnabled}
              disabled={!pageReady || vConsoleBusy}
              ariaLabel="在页面中启用 vConsole"
              onChange={onVConsoleEnabledChange}
            />
          </div>
        </li>
      </ul>
    </div>
  )
}
