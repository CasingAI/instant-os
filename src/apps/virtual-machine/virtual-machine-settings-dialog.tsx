import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import {
  formatVmNetworkBackendLabel,
  formatVmNetworkLabel,
  formatVmPathSummary,
  isVmBootOrderId,
  isVmDisplayModeId,
  isVmMemoryMb,
  isVmNetworkBackendId,
  isVmNetworkId,
  isVmPointerModeId,
  isVmVgaMemoryMb,
  VM_BOOT_ORDER_CHOICES,
  VM_CDROM_ACCEPT_EXTENSIONS,
  VM_DISPLAY_MODE_CHOICES,
  VM_FLOPPY_ACCEPT_EXTENSIONS,
  VM_HARD_DISK_ACCEPT_EXTENSIONS,
  VM_MEMORY_CHOICES,
  VM_NETWORK_BACKEND_CHOICES,
  VM_NETWORK_CHOICES,
  VM_POINTER_MODE_CHOICES,
  VM_STATE_ACCEPT_EXTENSIONS,
  VM_VGA_MEMORY_CHOICES,
} from './virtual-machine-config.ts'
import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import {
  applyGuestPreset,
  detectAppliedGuestPreset,
  inferDriveSources,
  primaryDriveForPreset,
  VM_DRIVE_IDS,
  VM_DRIVE_LABELS,
  VM_DRIVE_SOURCE_IDS,
  VM_DRIVE_SOURCE_LABELS,
  VM_GUEST_PRESETS,
  type VmDriveId,
  type VmDriveSourceId,
  type VmGuestPresetId,
} from './virtual-machine-presets.ts'
import {
  VIRTUAL_MACHINE_NAME_MAX_LENGTH,
  type VirtualMachineSettings,
} from './virtual-machine-types.ts'

const THEME = '#3d5a80'

type SettingsTab = 'general' | 'storage' | 'devices'

type VirtualMachineSettingsDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  initial: VirtualMachineSettings
  onClose: () => void
  onSave: (settings: VirtualMachineSettings) => Promise<void>
}

const TAB_ITEMS = [
  { id: 'general', label: '常规' },
  { id: 'storage', label: '存储' },
  { id: 'devices', label: '外设' },
] as const

const DRIVE_ACCEPT: Record<VmDriveId, readonly string[]> = {
  hdaPath: VM_HARD_DISK_ACCEPT_EXTENSIONS,
  cdromPath: VM_CDROM_ACCEPT_EXTENSIONS,
  fdaPath: VM_FLOPPY_ACCEPT_EXTENSIONS,
  statePath: VM_STATE_ACCEPT_EXTENSIONS,
}

const DRIVE_PICK_TITLE: Record<VmDriveId, string> = {
  hdaPath: '选择硬盘镜像',
  cdromPath: '选择光盘镜像',
  fdaPath: '选择软盘镜像',
  statePath: '选择快照',
}

const DRIVE_SOURCE_ITEMS = VM_DRIVE_SOURCE_IDS.map((id) => ({
  id,
  label: VM_DRIVE_SOURCE_LABELS[id],
}))

type VmDeviceId = 'network' | 'speaker' | 'keyboard' | 'mouse'

const DEVICE_ITEMS: readonly { id: VmDeviceId; label: string }[] = [
  { id: 'network', label: '网络' },
  { id: 'speaker', label: '扬声器' },
  { id: 'keyboard', label: '键盘' },
  { id: 'mouse', label: '鼠标' },
]

function cloneSettings(settings: VirtualMachineSettings): VirtualMachineSettings {
  return { ...settings }
}

function SwitchRow({
  label,
  checked,
  disabled,
  detail,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  detail?: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div class="virtual-machine-settings__switch-row">
      <div class="virtual-machine-settings__switch-copy">
        <span class="virtual-machine-settings__label">{label}</span>
        {detail ? <p class="virtual-machine-settings__hint">{detail}</p> : null}
      </div>
      <IosSwitch checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  )
}

export function VirtualMachineSettingsDialog({
  open,
  mode,
  initial,
  onClose,
  onSave,
}: VirtualMachineSettingsDialogProps) {
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const [draft, setDraft] = useState<VirtualMachineSettings>(() => cloneSettings(initial))
  const [tab, setTab] = useState<SettingsTab>('general')
  const [selectedDrive, setSelectedDrive] = useState<VmDriveId>('hdaPath')
  const [selectedDevice, setSelectedDevice] = useState<VmDeviceId>('network')
  const [sourceByDrive, setSourceByDrive] = useState<Record<VmDriveId, VmDriveSourceId>>(() =>
    inferDriveSources(initial),
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setDraft(cloneSettings(initial))
    setTab('general')
    setSelectedDrive('hdaPath')
    setSelectedDevice('network')
    setSourceByDrive(inferDriveSources(initial))
    setError(undefined)
    setBusy(false)
  }, [open, initial])

  const patch = useCallback((partial: Partial<VirtualMachineSettings>) => {
    setDraft((current) => ({ ...current, ...partial }))
    setError(undefined)
  }, [])

  const pickDrive = useCallback(
    async (kind: VmDriveId) => {
      const path = await showSystemOpenDialog({
        title: DRIVE_PICK_TITLE[kind],
        selectionMode: 'file',
        acceptExtensions: DRIVE_ACCEPT[kind],
      })
      if (!path) {
        return
      }
      setSourceByDrive((current) => ({ ...current, [kind]: 'local' }))
      patch({ [kind]: path })
    },
    [patch, showSystemOpenDialog],
  )

  const setDrivePath = useCallback(
    (kind: VmDriveId, path: string) => {
      patch({ [kind]: path })
    },
    [patch],
  )

  const changeDriveSource = useCallback(
    (kind: VmDriveId, source: VmDriveSourceId) => {
      setSourceByDrive((current) => ({ ...current, [kind]: source }))
      const path = draft[kind]
      if (source === 'local' && isHttpDiskUrl(path)) {
        patch({ [kind]: '' })
        return
      }
      if (source === 'network' && path.trim() && !isHttpDiskUrl(path)) {
        patch({ [kind]: '' })
      }
    },
    [draft, patch],
  )

  const applyPreset = useCallback(
    (presetId: VmGuestPresetId) => {
      const next = applyGuestPreset(draft, presetId)
      setDraft(next)
      setSourceByDrive(inferDriveSources(next))
      setSelectedDrive(primaryDriveForPreset(presetId))
      setError(undefined)
    },
    [draft],
  )

  const handleSave = useCallback(async () => {
    const name = draft.name.trim()
    if (!name) {
      setTab('general')
      setError('请输入名称')
      return
    }
    for (const drive of VM_DRIVE_IDS) {
      const path = draft[drive].trim()
      if (sourceByDrive[drive] === 'network' && path && !isHttpDiskUrl(path)) {
        setTab('storage')
        setSelectedDrive(drive)
        setError(`${VM_DRIVE_LABELS[drive]}的网络镜像需要 http(s) 地址`)
        return
      }
    }
    setBusy(true)
    try {
      await onSave({ ...draft, name })
    } finally {
      setBusy(false)
    }
  }, [draft, onSave, sourceByDrive])

  const actions = useMemo(
    () => [
      {
        key: 'cancel',
        label: '取消',
        tone: 'secondary' as const,
        disabled: busy,
        onClick: onClose,
      },
      {
        key: 'save',
        label: mode === 'create' ? '创建' : '保存',
        tone: 'primary' as const,
        disabled: busy,
        busy,
        onClick: () => {
          void handleSave()
        },
      },
    ],
    [busy, handleSave, mode, onClose],
  )

  const appliedPreset = detectAppliedGuestPreset(draft)
  const selectedSource = sourceByDrive[selectedDrive]
  const selectedPath = draft[selectedDrive]

  return (
    <>
      <WindowModal
        open={open}
        title="虚拟机设置"
        themeColor={THEME}
        wide
        scrollBody
        panelClass="virtual-machine-settings-modal"
        onClose={busy ? undefined : onClose}
        actions={actions}
      >
        <p class="window-modal__message">
          {mode === 'create'
            ? '点「创建」后才会把这台虚拟机加入列表。开机时才会把镜像交给模拟器。'
            : '改动保存后只更新配置。正在运行的虚拟机不会立刻套用，需要关机后再开。'}
        </p>
        <SegmentedControl
          value={tab}
          items={TAB_ITEMS}
          onChange={setTab}
          ariaLabel="设置分类"
          className="virtual-machine-settings__tabs"
        />
        {error ? <p class="window-modal__error">{error}</p> : null}
        {tab === 'general' ? (
          <div class="virtual-machine-settings__pane">
            <div class="virtual-machine-settings__field">
              <label class="virtual-machine-settings__label" for="virtual-machine-settings-name">
                名称
              </label>
              <input
                id="virtual-machine-settings-name"
                class="virtual-machine-settings__input"
                type="text"
                value={draft.name}
                maxLength={VIRTUAL_MACHINE_NAME_MAX_LENGTH}
                autoComplete="off"
                spellcheck={false}
                disabled={busy}
                onInput={(event) =>
                  patch({ name: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </div>
            <div class="virtual-machine-settings__field">
              <span class="virtual-machine-settings__label">后端</span>
              <input
                class="virtual-machine-settings__input"
                type="text"
                value="V86"
                disabled
                readOnly
              />
            </div>
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              目前只有 V86。模拟器在独立页面里运行，不和桌面抢同一条主线程。
            </p>
            <SettingsChoiceField
              label="内存"
              value={String(draft.memoryMb)}
              options={VM_MEMORY_CHOICES}
              onChange={(value) => {
                const memoryMb = Number(value)
                if (isVmMemoryMb(memoryMb)) {
                  patch({ memoryMb })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <SettingsChoiceField
              label="显存"
              value={String(draft.vgaMemoryMb)}
              options={VM_VGA_MEMORY_CHOICES}
              onChange={(value) => {
                const vgaMemoryMb = Number(value)
                if (isVmVgaMemoryMb(vgaMemoryMb)) {
                  patch({ vgaMemoryMb })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <SettingsChoiceField
              label="启动顺序"
              value={draft.bootOrder}
              options={VM_BOOT_ORDER_CHOICES}
              onChange={(value) => {
                if (isVmBootOrderId(value)) {
                  patch({ bootOrder: value })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <SettingsChoiceField
              label="显示比例"
              value={draft.displayMode}
              options={VM_DISPLAY_MODE_CHOICES}
              onChange={(value) => {
                if (isVmDisplayModeId(value)) {
                  patch({ displayMode: value })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              只影响画面呈现，不改客户机内部分辨率；运行中也能在工具栏切换。
            </p>
            <SwitchRow
              label="ACPI"
              checked={draft.acpi}
              disabled={busy}
              detail="对应 v86 的 ACPI/APIC，实验性，部分客户机需要。"
              onChange={(acpi) => patch({ acpi })}
            />
            <SwitchRow
              label="快速启动"
              checked={draft.fastboot}
              disabled={busy}
              detail="跳过 Bochs BIOS 启动菜单。"
              onChange={(fastboot) => patch({ fastboot })}
            />
          </div>
        ) : null}
        {tab === 'storage' ? (
          <div class="virtual-machine-settings__pane">
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              左边选盘，右边选来源。本地文件开机时整份读进内存；网络和预制走 copy.sh 这类地址，按块拉取。
            </p>
            <div class="virtual-machine-settings__storage">
              <div class="virtual-machine-settings__drives" role="listbox" aria-label="存储设备">
                {VM_DRIVE_IDS.map((drive) => {
                  const active = drive === selectedDrive
                  return (
                    <button
                      key={drive}
                      type="button"
                      role="option"
                      aria-selected={active}
                      class={`virtual-machine-settings__drive${
                        active ? ' virtual-machine-settings__drive--active' : ''
                      }`}
                      disabled={busy}
                      onClick={() => setSelectedDrive(drive)}
                    >
                      <span class="virtual-machine-settings__drive-name">
                        {VM_DRIVE_LABELS[drive]}
                      </span>
                      <span class="virtual-machine-settings__drive-meta">
                        {formatVmPathSummary(draft[drive])}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div class="virtual-machine-settings__source">
                <span class="virtual-machine-settings__source-title">
                  {VM_DRIVE_LABELS[selectedDrive]}
                </span>
                <SegmentedControl
                  value={selectedSource}
                  items={DRIVE_SOURCE_ITEMS}
                  onChange={(source) => changeDriveSource(selectedDrive, source)}
                  ariaLabel="镜像来源"
                  className="virtual-machine-settings__source-tabs"
                />
                {selectedSource === 'local' ? (
                  <>
                    <p class="virtual-machine-settings__hint">
                      从 Instant OS 文件里选镜像。大文件会占内存。
                    </p>
                    <div class="virtual-machine-settings__path">
                      <input
                        class="virtual-machine-settings__input"
                        type="text"
                        value={isHttpDiskUrl(selectedPath) ? '' : selectedPath}
                        placeholder="未选择"
                        spellcheck={false}
                        autoComplete="off"
                        disabled={busy}
                        onInput={(event) =>
                          setDrivePath(
                            selectedDrive,
                            (event.currentTarget as HTMLInputElement).value,
                          )
                        }
                      />
                      <IosButton
                        size="compact"
                        disabled={busy}
                        onClick={() => void pickDrive(selectedDrive)}
                      >
                        选择…
                      </IosButton>
                      {selectedPath.trim() ? (
                        <IosButton
                          size="compact"
                          disabled={busy}
                          onClick={() => setDrivePath(selectedDrive, '')}
                        >
                          清除
                        </IosButton>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {selectedSource === 'network' ? (
                  <>
                    <p class="virtual-machine-settings__hint">
                      填 http(s) 地址。copy.sh 允许跨域（Access-Control-Allow-Origin: *），可直接用。
                    </p>
                    <input
                      class="virtual-machine-settings__input"
                      type="text"
                      value={selectedPath}
                      placeholder="https://"
                      spellcheck={false}
                      autoComplete="off"
                      disabled={busy}
                      onInput={(event) =>
                        setDrivePath(
                          selectedDrive,
                          (event.currentTarget as HTMLInputElement).value,
                        )
                      }
                    />
                    {selectedPath.trim() ? (
                      <div class="virtual-machine-settings__path">
                        <IosButton
                          size="compact"
                          disabled={busy}
                          onClick={() => setDrivePath(selectedDrive, '')}
                        >
                          清除
                        </IosButton>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {selectedSource === 'preset' ? (
                  <>
                    <p class="virtual-machine-settings__hint">
                      会改内存、ACPI、启动顺序，并换掉各盘。来自 v86 官网，按块下载。
                    </p>
                    <div class="virtual-machine-settings__presets">
                      {VM_GUEST_PRESETS.map((preset) => {
                        const selected = appliedPreset === preset.id
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            class={`virtual-machine-settings__preset${
                              selected ? ' virtual-machine-settings__preset--active' : ''
                            }`}
                            disabled={busy}
                            onClick={() => applyPreset(preset.id)}
                          >
                            <span class="virtual-machine-settings__preset-name">{preset.name}</span>
                            <span class="virtual-machine-settings__preset-detail">
                              {preset.detail}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {tab === 'devices' ? (
          <div class="virtual-machine-settings__pane">
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              左边选设备，右边改配置。网络后端选 Fetch 后，客户机里配 HTTP 代理
              <code> 10.0.2.2:8000 </code>才能出网。
            </p>
            <div class="virtual-machine-settings__storage virtual-machine-settings__storage--devices">
              <div class="virtual-machine-settings__drives" role="listbox" aria-label="设备">
                {DEVICE_ITEMS.map((item) => {
                  const active = item.id === selectedDevice
                  const meta =
                    item.id === 'network'
                      ? draft.network === 'none'
                        ? formatVmNetworkLabel(draft.network)
                        : `${formatVmNetworkLabel(draft.network)} · ${formatVmNetworkBackendLabel(
                            draft.networkBackend,
                          )}`
                      : item.id === 'speaker'
                        ? draft.speaker
                          ? '开启'
                          : '关闭'
                        : item.id === 'keyboard'
                          ? draft.keyboard
                            ? '开启'
                            : '关闭'
                          : draft.mouse
                            ? '开启'
                            : '关闭'
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      class={`virtual-machine-settings__drive${
                        active ? ' virtual-machine-settings__drive--active' : ''
                      }`}
                      disabled={busy}
                      onClick={() => setSelectedDevice(item.id)}
                    >
                      <span class="virtual-machine-settings__drive-name">{item.label}</span>
                      <span class="virtual-machine-settings__drive-meta">{meta}</span>
                    </button>
                  )
                })}
              </div>
              <div class="virtual-machine-settings__source">
                <span class="virtual-machine-settings__source-title">
                  {DEVICE_ITEMS.find((item) => item.id === selectedDevice)?.label}
                </span>
                {selectedDevice === 'network' ? (
                  <>
                    <SettingsChoiceField
                      label="网卡形态"
                      value={draft.network}
                      options={VM_NETWORK_CHOICES}
                      onChange={(value) => {
                        if (isVmNetworkId(value)) {
                          patch(
                            value === 'none'
                              ? { network: value, networkBackend: 'off' }
                              : { network: value },
                          )
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                    />
                    <SettingsChoiceField
                      label="网络后端"
                      value={draft.networkBackend}
                      options={VM_NETWORK_BACKEND_CHOICES}
                      onChange={(value) => {
                        if (isVmNetworkBackendId(value)) {
                          patch({ networkBackend: value })
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy || draft.network === 'none'}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                    />
                    <p class="virtual-machine-settings__hint">
                      Fetch 后端（仅 HTTP）由浏览器直接发起请求，目标站点需放行 CORS；第一版不支持系统代理。
                      {draft.network !== 'none'
                        ? ' 客户机内把 HTTP 代理指向 10.0.2.2:8000 即可出网。'
                        : ''}
                    </p>
                  </>
                ) : null}
                {selectedDevice === 'speaker' ? (
                  <SwitchRow
                    label="扬声器"
                    checked={draft.speaker}
                    disabled={busy}
                    detail="PC 喇叭与声音输出，经 iframe 播放。"
                    onChange={(speaker) => patch({ speaker })}
                  />
                ) : null}
                {selectedDevice === 'keyboard' ? (
                  <SwitchRow
                    label="键盘"
                    checked={draft.keyboard}
                    disabled={busy}
                    detail="关闭后客户机收不到按键。"
                    onChange={(keyboard) => patch({ keyboard })}
                  />
                ) : null}
                {selectedDevice === 'mouse' ? (
                  <>
                    <SwitchRow
                      label="鼠标"
                      checked={draft.mouse}
                      disabled={busy}
                      detail="关闭后客户机收不到指针。"
                      onChange={(mouse) => patch({ mouse })}
                    />
                    <SettingsChoiceField
                      label="指针模式"
                      value={draft.pointerMode}
                      options={VM_POINTER_MODE_CHOICES}
                      onChange={(value) => {
                        if (isVmPointerModeId(value)) {
                          patch({ pointerMode: value })
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy || !draft.mouse}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                    />
                    <p class="virtual-machine-settings__hint">
                      独占：点击屏幕后指针被锁定，无法移出屏幕；按 Esc 释放，再次点击重新锁定。
                      注意：独占模式解决的是「鼠标移出屏幕」问题，不是鼠标灵敏度或拉伸同步问题。
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </WindowModal>
      {openDialog}
    </>
  )
}
