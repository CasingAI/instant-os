import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosRangeSlider } from '../../ui/ios-range-slider.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import {
  canAddDeviceType,
  deviceAcceptExtensions,
  devicePickTitle,
  deviceTypeLabel,
  deviceTypeSlotLabel,
  devicesByType,
  formatVmCpuModelLabel,
  formatVmMemoryLabel,
  formatVmNetworkBackendLabel,
  formatVmNetworkLabel,
  formatVmPathSummary,
  formatVmPcTypeLabel,
  isVmBootOrderId,
  isVmBuildModeId,
  isVmCpuModelId,
  isVmDiskWriteModeId,
  isVmDisplayModeId,
  isVmNetworkBackendId,
  isVmNetworkId,
  isVmPcTypeId,
  isVmPointerModeId,
  isVmVgaMemoryMb,
  acpiFromPcType,
  pcTypeFromAcpi,
  VM_BOOT_ORDER_CHOICES,
  VM_BUILD_MODE_CHOICES,
  VM_CPU_MODEL_CHOICES,
  VM_DISK_WRITE_MODE_CHOICES,
  VM_DISPLAY_MODE_CHOICES,
  VM_MEMORY_MB_MAX,
  VM_MEMORY_MB_MIN,
  VM_MEMORY_MB_STEP,
  VM_NETWORK_BACKEND_CHOICES,
  VM_NETWORK_CHOICES,
  VM_PC_TYPE_CHOICES,
  VM_POINTER_MODE_CHOICES,
  VM_STORAGE_DEVICE_LIMITS,
} from './virtual-machine-config.ts'
import {
  createBlankVirtualMachineDisk,
  VM_BLANK_DISK_DEFAULT_SIZE_MB,
  VM_BLANK_DISK_MAX_SIZE_MB,
  VM_BLANK_DISK_MIN_SIZE_MB,
  VM_BLANK_DISK_SIZE_STEP_MB,
} from './virtual-machine-disks.ts'
import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import {
  VIRTUAL_MACHINE_NAME_MAX_LENGTH,
  type VirtualMachineSettings,
  type VmStorageDevice,
  type VmStorageDeviceType,
} from './virtual-machine-types.ts'

const THEME = '#3d5a80'

type SettingsTab = 'general' | 'hardware' | 'storage' | 'devices'

type VirtualMachineSettingsDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  initial: VirtualMachineSettings
  onClose: () => void
  onSave: (settings: VirtualMachineSettings) => Promise<void>
}

const TAB_ITEMS = [
  { id: 'general', label: '常规' },
  { id: 'hardware', label: '硬件' },
  { id: 'storage', label: '存储' },
  { id: 'devices', label: '外设' },
] as const

type VmDeviceId = 'network' | 'speaker' | 'keyboard' | 'mouse'

const DEVICE_ITEMS: readonly { id: VmDeviceId; label: string }[] = [
  { id: 'network', label: '网络' },
  { id: 'speaker', label: '扬声器' },
  { id: 'keyboard', label: '键盘' },
  { id: 'mouse', label: '鼠标' },
]

type VmHardwareId = 'ram' | 'vga' | 'cpu' | 'pc-type'

const HARDWARE_ITEMS: readonly { id: VmHardwareId; label: string }[] = [
  { id: 'ram', label: '内存' },
  { id: 'vga', label: '显存' },
  { id: 'cpu', label: '处理器' },
  { id: 'pc-type', label: 'PC 类型' },
]

function cloneSettings(settings: VirtualMachineSettings): VirtualMachineSettings {
  return {
    ...settings,
    devices: settings.devices.map((device) => ({ ...device })),
  }
}

function createDeviceId(): string {
  return `vm-device-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
}

function createDevice(type: VmStorageDeviceType, path = ''): VmStorageDevice {
  return {
    id: createDeviceId(),
    type,
    source: 'local',
    path,
  }
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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined)
  const [selectedDevice, setSelectedDevice] = useState<VmDeviceId>('network')
  const [selectedHardware, setSelectedHardware] = useState<VmHardwareId>('ram')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [createDiskOpen, setCreateDiskOpen] = useState(false)
  const [createDiskSizeMb, setCreateDiskSizeMb] = useState(VM_BLANK_DISK_DEFAULT_SIZE_MB)
  const [createDiskName, setCreateDiskName] = useState('')
  const [addModalOpen, setAddModalOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    const cloned = cloneSettings(initial)
    setDraft(cloned)
    setTab('general')
    setSelectedDeviceId(cloned.devices[0]?.id)
    setSelectedDevice('network')
    setSelectedHardware('ram')
    setError(undefined)
    setBusy(false)
    setCreateDiskOpen(false)
    setCreateDiskSizeMb(VM_BLANK_DISK_DEFAULT_SIZE_MB)
    setCreateDiskName('')
    setAddModalOpen(false)
  }, [open, initial])

  const patch = useCallback((partial: Partial<VirtualMachineSettings>) => {
    setDraft((current) => ({ ...current, ...partial }))
    setError(undefined)
  }, [])

  const selectedDeviceIndex = useMemo(() => {
    if (!selectedDeviceId) {
      return -1
    }
    return draft.devices.findIndex((device) => device.id === selectedDeviceId)
  }, [draft.devices, selectedDeviceId])

  const selectedStorage = selectedDeviceIndex >= 0 ? draft.devices[selectedDeviceIndex] : undefined

  const addDevice = useCallback(
    (type: VmStorageDeviceType) => {
      if (!canAddDeviceType(draft.devices, type)) {
        return
      }
      const device = createDevice(type)
      const next = [...draft.devices, device]
      patch({ devices: next })
      setSelectedDeviceId(device.id)
      setAddModalOpen(false)
    },
    [draft.devices, patch],
  )

  const removeDevice = useCallback(
    (id: string) => {
      const next = draft.devices.filter((device) => device.id !== id)
      patch({ devices: next })
      if (selectedDeviceId === id) {
        setSelectedDeviceId(next[0]?.id)
      }
    },
    [draft.devices, patch, selectedDeviceId],
  )

  const updateDevice = useCallback(
    (id: string, updates: Partial<Pick<VmStorageDevice, 'path' | 'source'>>) => {
      const next = draft.devices.map((device) =>
        device.id === id ? { ...device, ...updates, source: updates.source ?? device.source } : device,
      )
      patch({ devices: next })
    },
    [draft.devices, patch],
  )

  const pickDevicePath = useCallback(
    async (id: string) => {
      const device = draft.devices.find((d) => d.id === id)
      if (!device) {
        return
      }
      const path = await showSystemOpenDialog({
        title: devicePickTitle(device.type),
        selectionMode: 'file',
        acceptExtensions: deviceAcceptExtensions(device.type),
      })
      if (!path) {
        return
      }
      updateDevice(id, { path, source: 'local' })
    },
    [draft.devices, showSystemOpenDialog, updateDevice],
  )

  const openCreateBlankDisk = useCallback(() => {
    setCreateDiskOpen(true)
    setCreateDiskSizeMb(VM_BLANK_DISK_DEFAULT_SIZE_MB)
    setCreateDiskName('')
  }, [])

  const closeCreateBlankDisk = useCallback(() => {
    setCreateDiskOpen(false)
  }, [])

  const handleCreateBlankDisk = useCallback(async () => {
    if (!selectedStorage || selectedStorage.type !== 'hdd') {
      return
    }
    const name = createDiskName.trim() || 'blank'
    setBusy(true)
    try {
      const path = await createBlankVirtualMachineDisk({
        name,
        sizeMb: createDiskSizeMb,
      })
      updateDevice(selectedStorage.id, { path, source: 'local' })
      setCreateDiskOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '创建空白硬盘失败')
    } finally {
      setBusy(false)
    }
  }, [createDiskName, createDiskSizeMb, selectedStorage, updateDevice])

  const handleSave = useCallback(async () => {
    const name = draft.name.trim()
    if (!name) {
      setTab('general')
      setError('请输入名称')
      return
    }
    for (const device of draft.devices) {
      if (isHttpDiskUrl(device.path)) {
        setTab('storage')
        setSelectedDeviceId(device.id)
        setError(`${deviceTypeLabel(device.type)}只支持本地文件`)
        return
      }
    }
    setBusy(true)
    try {
      await onSave({ ...draft, name })
    } finally {
      setBusy(false)
    }
  }, [draft, onSave])

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

  return (
    <>
      <WindowModal
        open={open}
        title="虚拟机设置"
        themeColor={THEME}
        wide
        scrollBody
        align="top"
        panelClass="virtual-machine-settings-modal"
        onClose={busy ? undefined : onClose}
        actions={actions}
      >
        <SegmentedControl
          value={tab}
          items={TAB_ITEMS}
          onChange={setTab}
          ariaLabel="设置分类"
          className="virtual-machine-settings__tabs"
        />
        <p class="window-modal__message">
          {mode === 'create'
            ? '点「创建」后才会把这台虚拟机加入列表。开机时才会把镜像交给模拟器。'
            : '改动保存后只更新配置。正在运行的虚拟机不会立刻套用，需要关机后再开。'}
        </p>
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
              label="构建模式"
              value={draft.buildMode}
              options={VM_BUILD_MODE_CHOICES}
              onChange={(value) => {
                if (isVmBuildModeId(value)) {
                  patch({ buildMode: value })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              Debug 版加载未压缩 JS，可单步调试 V86 内部；Release 版压缩混淆，性能更好。运行中切换需要重新开机。
            </p>
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
              label="快速启动"
              checked={draft.fastboot}
              disabled={busy}
              detail="跳过 Bochs BIOS 启动菜单。"
              onChange={(fastboot) => patch({ fastboot })}
            />
          </div>
        ) : null}
        {tab === 'hardware' ? (
          <div class="virtual-machine-settings__pane">
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              左边选硬件，右边调参数。内存建议不超过标签页物理内存的 1/4。
            </p>
            <div class="virtual-machine-settings__storage virtual-machine-settings__storage--devices">
              <div class="virtual-machine-settings__drives" role="listbox" aria-label="硬件">
                {HARDWARE_ITEMS.map((item) => {
                  const active = item.id === selectedHardware
                  const meta =
                    item.id === 'ram'
                      ? formatVmMemoryLabel(draft.memoryMb)
                      : item.id === 'vga'
                        ? formatVmMemoryLabel(draft.vgaMemoryMb)
                        : item.id === 'cpu'
                          ? formatVmCpuModelLabel(draft.cpuModel)
                          : formatVmPcTypeLabel(pcTypeFromAcpi(draft.acpi))
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
                      onClick={() => setSelectedHardware(item.id)}
                    >
                      <span class="virtual-machine-settings__drive-name">{item.label}</span>
                      <span class="virtual-machine-settings__drive-meta">{meta}</span>
                    </button>
                  )
                })}
              </div>
              <div class="virtual-machine-settings__source">
                <span class="virtual-machine-settings__source-title">
                  {HARDWARE_ITEMS.find((item) => item.id === selectedHardware)?.label}
                </span>
                {selectedHardware === 'ram' ? (
                  <>
                    <IosRangeSlider
                      label="内存"
                      value={draft.memoryMb}
                      min={VM_MEMORY_MB_MIN}
                      max={VM_MEMORY_MB_MAX}
                      step={VM_MEMORY_MB_STEP}
                      suffix="MB"
                      disabled={busy}
                      onChange={(mb) => patch({ memoryMb: mb })}
                    />
                    <p class="virtual-machine-settings__hint">
                      当前 {formatVmMemoryLabel(draft.memoryMb)}。最少 {VM_MEMORY_MB_MIN} MB，最多{' '}
                      {VM_MEMORY_MB_MAX} MB（v86 无法分配满 2048 MB）。浏览器标签页建议不超过物理内存
                      1/4。
                    </p>
                  </>
                ) : null}
                {selectedHardware === 'vga' ? (
                  <>
                    <IosRangeSlider
                      label="显存"
                      value={draft.vgaMemoryMb}
                      min={2}
                      max={16}
                      step={2}
                      suffix="MB"
                      disabled={busy}
                      onChange={(vgaMemoryMb) => {
                        if (isVmVgaMemoryMb(vgaMemoryMb)) {
                          patch({ vgaMemoryMb })
                        }
                      }}
                    />
                    <p class="virtual-machine-settings__hint">
                      当前 {draft.vgaMemoryMb} MB。显存用于 VGA 帧缓冲，文本/简单 GUI 用 2 MB 足够。
                    </p>
                  </>
                ) : null}
                {selectedHardware === 'cpu' ? (
                  <>
                    <SettingsChoiceField
                      label="处理器"
                      value={draft.cpuModel}
                      options={VM_CPU_MODEL_CHOICES}
                      onChange={(value) => {
                        if (isVmCpuModelId(value)) {
                          patch({ cpuModel: value })
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                    />
                    <p class="virtual-machine-settings__hint">
                      默认的 Pentium III 级别适用于大多数系统。Windows NT 4.0 等老系统需要降低 CPUID level 才能启动。
                    </p>
                  </>
                ) : null}
                {selectedHardware === 'pc-type' ? (
                  <>
                    <SettingsChoiceField
                      label="PC 类型"
                      value={pcTypeFromAcpi(draft.acpi)}
                      options={VM_PC_TYPE_CHOICES}
                      onChange={(value) => {
                        if (isVmPcTypeId(value)) {
                          patch({ acpi: acpiFromPcType(value) })
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                    />
                    <p class="virtual-machine-settings__hint">
                      安装 Windows 2000 及更高版本时须使用 Standard PC。安装程序蓝屏阶段若默认是 ACPI PC，按 F5 改选 Standard PC。
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {tab === 'storage' ? (
          <div class="virtual-machine-settings__pane">
            <SettingsChoiceField
              label="硬盘写入"
              value={draft.diskWriteMode}
              options={VM_DISK_WRITE_MODE_CHOICES}
              onChange={(value) => {
                if (isVmDiskWriteModeId(value)) {
                  patch({ diskWriteMode: value })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              不写入时客户机改动只留在内存，要保留就靠快照，不会改镜像文件。实时写入会在运行中把扇区写回镜像。关机时写入会在关机或断电时一次性刷入。带着快照启动时，回写会改底盘镜像，容易和快照对不上；XP 这类机建议不写入。
            </p>
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              左侧是已挂载的存储设备，右侧编辑镜像来源。v86 最多支持 2 硬盘、1 光盘、2 软驱、1 快照。
            </p>
            <div class="virtual-machine-settings__storage">
              <div class="virtual-machine-settings__drives" role="listbox" aria-label="存储设备">
                {draft.devices.map((device, index) => {
                  const typeCount = devicesByType(draft.devices, device.type).findIndex(
                    (d) => d.id === device.id,
                  )
                  const active = device.id === selectedDeviceId
                  return (
                    <button
                      key={device.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      class={`virtual-machine-settings__drive${
                        active ? ' virtual-machine-settings__drive--active' : ''
                      }`}
                      disabled={busy}
                      onClick={() => setSelectedDeviceId(device.id)}
                    >
                      <span class="virtual-machine-settings__drive-name">
                        {deviceTypeSlotLabel(device.type, typeCount >= 0 ? typeCount : index)}
                      </span>
                      <span class="virtual-machine-settings__drive-meta">
                        {formatVmPathSummary(device.path)}
                      </span>
                    </button>
                  )
                })}
                <div class="virtual-machine-settings__add-device">
                  <IosButton
                    size="compact"
                    tone="secondary"
                    disabled={busy}
                    onClick={() => setAddModalOpen(true)}
                  >
                    添加设备…
                  </IosButton>
                </div>
              </div>
              <div class="virtual-machine-settings__source">
                {selectedStorage ? (
                  <>
                    <span class="virtual-machine-settings__source-title">
                      {deviceTypeSlotLabel(
                        selectedStorage.type,
                        devicesByType(draft.devices, selectedStorage.type).findIndex(
                          (d) => d.id === selectedStorage.id,
                        ),
                      )}
                    </span>
                    <p class="virtual-machine-settings__hint">
                      从 Instant OS 文件里选镜像。大文件会占内存。
                    </p>
                    <div class="virtual-machine-settings__path">
                      <input
                        class="virtual-machine-settings__input"
                        type="text"
                        value={selectedStorage.path}
                        placeholder="未选择"
                        spellcheck={false}
                        autoComplete="off"
                        disabled={busy}
                        onInput={(event) =>
                          updateDevice(selectedStorage.id, {
                            path: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <IosButton
                        size="compact"
                        disabled={busy}
                        onClick={() => void pickDevicePath(selectedStorage.id)}
                      >
                        选择…
                      </IosButton>
                      {selectedStorage.type === 'hdd' ? (
                        <IosButton
                          size="compact"
                          disabled={busy}
                          onClick={() => openCreateBlankDisk()}
                        >
                          新建…
                        </IosButton>
                      ) : null}
                      {selectedStorage.path.trim() ? (
                        <IosButton
                          size="compact"
                          disabled={busy}
                          onClick={() => updateDevice(selectedStorage.id, { path: '' })}
                        >
                          清除
                        </IosButton>
                      ) : null}
                    </div>
                    <div class="virtual-machine-settings__path">
                      <IosButton
                        size="compact"
                        tone="danger"
                        disabled={busy}
                        onClick={() => removeDevice(selectedStorage.id)}
                      >
                        删除设备
                      </IosButton>
                    </div>
                  </>
                ) : (
                  <p class="virtual-machine-settings__hint">
                    点击左侧「添加设备」加入硬盘、光盘或软驱。
                  </p>
                )}
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
                      Fetch 后端仅 HTTP，由浏览器直接发起请求，目标站点需放行 CORS；第一版不支持系统代理。
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
                      自动：客机尚未报告绝对坐标时用独占；一旦支持绝对坐标就切到跟随，运行中也会随驱动状态切换。
                      强制跟随：始终跟随，指针可移出画面。
                      强制独占：始终点击锁定；与绝对坐标不兼容，客机光标可能消失。
                      运行中修改此项会立即生效。
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </WindowModal>
      <WindowModal
        open={createDiskOpen}
        title="新建空白硬盘"
        themeColor={THEME}
        wide
        onClose={busy ? undefined : closeCreateBlankDisk}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            disabled: busy,
            onClick: closeCreateBlankDisk,
          },
          {
            key: 'create',
            label: '创建',
            tone: 'primary',
            disabled: busy,
            busy,
            onClick: () => void handleCreateBlankDisk(),
          },
        ]}
      >
        <div class="virtual-machine-settings__create-disk">
          <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
            在 /user/Disks 下创建全零原始镜像，挂载到当前硬盘。
          </p>
          <div class="virtual-machine-settings__field">
            <label
              class="virtual-machine-settings__label"
              for="virtual-machine-create-disk-name"
            >
              文件名
            </label>
            <input
              id="virtual-machine-create-disk-name"
              class="virtual-machine-settings__input"
              type="text"
              value={createDiskName}
              placeholder="blank"
              maxLength={128}
              autoComplete="off"
              spellcheck={false}
              disabled={busy}
              onInput={(event) =>
                setCreateDiskName((event.currentTarget as HTMLInputElement).value)
              }
            />
          </div>
          <IosRangeSlider
            label="容量"
            value={createDiskSizeMb}
            min={VM_BLANK_DISK_MIN_SIZE_MB}
            max={VM_BLANK_DISK_MAX_SIZE_MB}
            step={VM_BLANK_DISK_SIZE_STEP_MB}
            suffix="MB"
            disabled={busy}
            onChange={(mb) => setCreateDiskSizeMb(mb)}
          />
          <p class="virtual-machine-settings__hint">
            当前 {createDiskSizeMb} MB。创建后为空盘，需从光盘/软盘启动后分区、格式化才能使用。
          </p>
        </div>
      </WindowModal>
      <WindowModal
        open={addModalOpen}
        title="添加存储设备"
        themeColor={THEME}
        panelClass="virtual-machine-settings-modal"
        onClose={busy ? undefined : () => setAddModalOpen(false)}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            disabled: busy,
            onClick: () => setAddModalOpen(false),
          },
        ]}
      >
        <div class="virtual-machine-settings__add-modal">
          <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
            点一项即可加入设备列表。
          </p>
          <div class="virtual-machine-settings__add-options" role="listbox" aria-label="设备类型">
            {VM_STORAGE_DEVICE_LIMITS.map(({ type, maxCount }) => {
              const used = devicesByType(draft.devices, type).length
              const disabled = used >= maxCount
              return (
                <button
                  key={type}
                  type="button"
                  role="option"
                  aria-disabled={disabled}
                  class="virtual-machine-settings__add-option"
                  disabled={busy || disabled}
                  onClick={() => addDevice(type)}
                >
                  <span class="virtual-machine-settings__add-option-name">
                    {deviceTypeLabel(type)}
                  </span>
                  <span class="virtual-machine-settings__add-option-meta">
                    {disabled ? '已达上限' : `${used} / ${maxCount}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </WindowModal>
      {openDialog}
    </>
  )
}
