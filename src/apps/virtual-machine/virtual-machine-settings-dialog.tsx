import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { HelpHint } from '../../ui/help-hint.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import {
  IosRangeSlider,
  type IosRangeSliderMark,
} from '../../ui/ios-range-slider.tsx'
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
  isVmOsPresetId,
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
  VM_OS_PRESET_CHOICES,
  VM_PC_TYPE_CHOICES,
  VM_POINTER_MODE_CHOICES,
  VM_SNAP_EDGE_PX_MAX,
  VM_SNAP_EDGE_PX_MIN,
  VM_SNAP_EDGE_PX_STEP,
  VM_STORAGE_DEVICE_LIMITS,
  VM_VGA_MEMORY_CHOICES,
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
  isVmImeKeyEvent,
  upsertVmKeyMappings,
  vmKeySpecFromKeyboardEvent,
  vmKeySpecIdentity,
  vmKeySpecLabel,
  VM_KEY_MAPPING_PRESETS,
  VM_KEY_QUICK_PICKS,
  VM_KEY_MAPPINGS_LIMIT,
  type VmKeySpec,
} from './virtual-machine-keymap.ts'
import {
  VIRTUAL_MACHINE_NAME_MAX_LENGTH,
  type VirtualMachineSettings,
  type VmStorageDevice,
  type VmStorageDeviceType,
} from './virtual-machine-types.ts'

const THEME = '#3d5a80'

const MEMORY_SLIDER_MARKS: IosRangeSliderMark[] = [
  { value: 512, label: '512M' },
  { value: 1024, label: '1G' },
  { value: 1536, label: '1.5G' },
  { value: VM_MEMORY_MB_MAX, label: '2G' },
]

const BLANK_DISK_SLIDER_MARKS: IosRangeSliderMark[] = [
  { value: 256, label: '256M' },
  { value: 512, label: '512M' },
  { value: 1024, label: '1G' },
  { value: VM_BLANK_DISK_MAX_SIZE_MB, label: '2G' },
]

type SettingsTab = 'general' | 'hardware' | 'storage' | 'devices' | 'experience'

/** 添加映射的两步捕获：先按来源键，再按目标键或从快选里挑。 */
type KeymapCapture = { step: 'from' } | { step: 'to'; from: VmKeySpec }

type VirtualMachineSettingsDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  initial: VirtualMachineSettings
  /** 正在编辑的这台是否在运行：重启才生效的选项置灰，立即生效的照常可改。 */
  running?: boolean
  onClose: () => void
  onSave: (settings: VirtualMachineSettings) => Promise<void>
}

const TAB_ITEMS = [
  { id: 'general', label: '常规' },
  { id: 'hardware', label: '硬件' },
  { id: 'storage', label: '存储' },
  { id: 'devices', label: '外设' },
  { id: 'experience', label: '体验增强' },
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
    keyMappings: settings.keyMappings.map((mapping) => ({
      from: { ...mapping.from },
      to: { ...mapping.to },
    })),
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
  running = false,
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
  const [keyCapture, setKeyCapture] = useState<KeymapCapture | undefined>(undefined)
  const [keyCaptureError, setKeyCaptureError] = useState<string | undefined>(undefined)

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
    setKeyCapture(undefined)
    setKeyCaptureError(undefined)
  }, [open, initial])

  const patch = useCallback((partial: Partial<VirtualMachineSettings>) => {
    setDraft((current) => ({ ...current, ...partial }))
    setError(undefined)
  }, [])

  const cancelKeyCapture = useCallback(() => {
    setKeyCapture(undefined)
    setKeyCaptureError(undefined)
  }, [])

  const commitKeyMapping = useCallback(
    (from: VmKeySpec, to: VmKeySpec) => {
      if (vmKeySpecIdentity(from) === vmKeySpecIdentity(to)) {
        setKeyCaptureError('来源键和目标键相同，换一个目标键。')
        return
      }
      const exists = draft.keyMappings.some(
        (mapping) => vmKeySpecIdentity(mapping.from) === vmKeySpecIdentity(from),
      )
      if (!exists && draft.keyMappings.length >= VM_KEY_MAPPINGS_LIMIT) {
        setKeyCaptureError(`映射已达上限（${VM_KEY_MAPPINGS_LIMIT} 条），先移除几条再添加。`)
        return
      }
      patch({ keyMappings: upsertVmKeyMappings(draft.keyMappings, [{ from, to }]) })
      setKeyCapture(undefined)
      setKeyCaptureError(undefined)
    },
    [draft.keyMappings, patch],
  )

  // 捕获期间独占键盘：拦截一切按键，不透传给桌面快捷键或对话框表单。
  useEffect(() => {
    if (!keyCapture) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        cancelKeyCapture()
        return
      }
      if (isVmImeKeyEvent(event) || !event.code) {
        setKeyCaptureError('这个键无法识别（输入法状态或浏览器不上报），换个键试试。')
        return
      }
      const spec = vmKeySpecFromKeyboardEvent(event)
      if (keyCapture.step === 'from') {
        setKeyCaptureError(undefined)
        setKeyCapture({ step: 'to', from: spec })
        return
      }
      commitKeyMapping(keyCapture.from, spec)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [cancelKeyCapture, commitKeyMapping, keyCapture])

  const selectedDeviceIndex = useMemo(() => {
    if (!selectedDeviceId) {
      return -1
    }
    return draft.devices.findIndex((device) => device.id === selectedDeviceId)
  }, [draft.devices, selectedDeviceId])

  const selectedStorage = selectedDeviceIndex >= 0 ? draft.devices[selectedDeviceIndex] : undefined

  /* 「不启用增强」：体验增强各子项全部停用（存储值保留，改回客机系统后原样恢复）。 */
  const enhanceOff = draft.osPreset === 'none'

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
    (id: string, updates: Partial<Pick<VmStorageDevice, 'path' | 'source' | 'connected'>>) => {
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

  const pickSharedFolderPath = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择共享文件夹',
      selectionMode: 'folder',
    })
    if (!path) {
      return
    }
    patch({ sharedFolderPath: path })
  }, [patch, showSystemOpenDialog])

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
        {mode === 'create' ? (
          <p class="window-modal__message">
            点「创建」后才会把这台虚拟机加入列表。开机时才会把镜像交给模拟器。
          </p>
        ) : null}
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
              <div class="virtual-machine-settings__label-row">
                <span class="virtual-machine-settings__label">后端</span>
                <HelpHint
                  text="目前只有 V86 后端。模拟器在独立页面里运行，不和桌面抢主线程。"
                  label="后端说明"
                />
              </div>
              <input
                class="virtual-machine-settings__input"
                type="text"
                value="V86"
                disabled
                readOnly
              />
            </div>
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
              disabled={busy || running}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
              hint="Debug 版加载未压缩 JS，可单步调试 V86 内部；Release 版压缩混淆，性能更好。运行中切换需重新开机。"
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
              disabled={busy || running}
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
              hint="只影响画面呈现，不改客户机内部分辨率；运行中也能在工具栏切换。"
            />
            <SwitchRow
              label="快速启动"
              checked={draft.fastboot}
              disabled={busy || running}
              detail="跳过 Bochs BIOS 启动菜单。"
              onChange={(fastboot) => patch({ fastboot })}
            />
          </div>
        ) : null}
        {tab === 'hardware' ? (
          <div class="virtual-machine-settings__pane">
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
                      disabled={busy || running}
                      marks={MEMORY_SLIDER_MARKS}
                      onChange={(mb) => patch({ memoryMb: mb })}
                    />
                    <p class="virtual-machine-settings__hint">建议不超过物理内存的 1/4。</p>
                  </>
                ) : null}
                {selectedHardware === 'vga' ? (
                  <>
                    <SettingsChoiceField
                      label="显存"
                      value={String(draft.vgaMemoryMb)}
                      options={VM_VGA_MEMORY_CHOICES}
                      onChange={(value) => {
                        const mb = Number(value)
                        if (isVmVgaMemoryMb(mb)) {
                          patch({ vgaMemoryMb: mb })
                        }
                      }}
                      wideLayout
                      presentation="form"
                      disabled={busy || running}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                      hint="显存用于 VGA 帧缓冲。默认 16 MB 覆盖到 2560×1600×32；文本/简单 GUI 用 2 MB 足够，客机驱动要求更高时可调大。"
                    />
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
                      disabled={busy || running}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                      hint="默认 Pentium III 级别适用大多数系统。Windows NT 4.0 等老系统需降低 CPUID level 才能启动。"
                    />
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
                      disabled={busy || running}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                      hint="安装 Windows 2000 及更高版本须选 Standard PC。安装蓝屏阶段若默认 ACPI PC，按 F5 改选 Standard PC。"
                    />
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
              disabled={busy || running}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
              hint="不写入：客户机改动只留在内存，要保留就靠快照，不改镜像文件。实时写入：运行中把扇区写回镜像。关机时写入：关机或断电时一次性刷入。带快照启动时回写会改底盘镜像，容易和快照对不上；XP 这类机建议不写入。"
            />
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
                      // 运行中仍可选中查看：光盘/软盘的「连接到虚拟机」要在运行时切。
                      disabled={busy}
                      onClick={() => setSelectedDeviceId(device.id)}
                    >
                      <span class="virtual-machine-settings__drive-name">
                        {deviceTypeSlotLabel(device.type, typeCount >= 0 ? typeCount : index)}
                      </span>
                      <span class="virtual-machine-settings__drive-meta">
                        {device.connected === false
                          ? '已弹出'
                          : formatVmPathSummary(device.path)}
                      </span>
                    </button>
                  )
                })}
                <div class="virtual-machine-settings__add-device">
                  <IosButton
                    size="compact"
                    tone="secondary"
                    disabled={busy || running}
                    onClick={() => setAddModalOpen(true)}
                  >
                    添加设备…
                  </IosButton>
                </div>
              </div>
              <div class="virtual-machine-settings__source">
                {selectedStorage ? (
                  <>
                    <div class="virtual-machine-settings__source-title-row">
                      <span class="virtual-machine-settings__source-title">
                        {deviceTypeSlotLabel(
                          selectedStorage.type,
                          devicesByType(draft.devices, selectedStorage.type).findIndex(
                            (d) => d.id === selectedStorage.id,
                          ),
                        )}
                      </span>
                      {selectedStorage.type !== 'state' ? (
                        <div class="virtual-machine-settings__connect">
                          <span class="virtual-machine-settings__label">连接到虚拟机</span>
                          <IosSwitch
                            checked={selectedStorage.connected !== false}
                            disabled={busy || (running && selectedStorage.type === 'hdd')}
                            label="连接到虚拟机"
                            onChange={(checked) =>
                              updateDevice(selectedStorage.id, { connected: checked })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                    {selectedStorage.connected === false ? (
                      <p class="virtual-machine-settings__hint">
                        已弹出：下次开机才装载，运行中的光盘/软盘保存后立即生效。
                      </p>
                    ) : null}
                    <div class="virtual-machine-settings__path">
                      <input
                        class="virtual-machine-settings__input"
                        type="text"
                        value={selectedStorage.path}
                        placeholder="未选择"
                        spellcheck={false}
                        autoComplete="off"
                        disabled={busy || running}
                        onInput={(event) =>
                          updateDevice(selectedStorage.id, {
                            path: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <IosButton
                        size="compact"
                        disabled={busy || running}
                        onClick={() => void pickDevicePath(selectedStorage.id)}
                      >
                        选择…
                      </IosButton>
                      {selectedStorage.type === 'hdd' ? (
                        <IosButton
                          size="compact"
                          disabled={busy || running}
                          onClick={() => openCreateBlankDisk()}
                        >
                          新建…
                        </IosButton>
                      ) : null}
                      {selectedStorage.path.trim() ? (
                        <IosButton
                          size="compact"
                          disabled={busy || running}
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
                        disabled={busy || running}
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
                      disabled={busy || running}
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
                      disabled={busy || running || draft.network === 'none'}
                      fieldClass="virtual-machine-settings__field"
                      labelClass="virtual-machine-settings__label"
                      hint="Fetch 后端仅 HTTP，由浏览器直接发起请求，目标站点需放行 CORS；暂不支持系统代理。客户机内把 HTTP 代理指向 10.0.2.2:8000 即可出网。"
                    />
                  </>
                ) : null}
                {selectedDevice === 'speaker' ? (
                  <SwitchRow
                    label="扬声器"
                    checked={draft.speaker}
                    disabled={busy || running}
                    detail="PC 喇叭与声音输出，经 iframe 播放。"
                    onChange={(speaker) => patch({ speaker })}
                  />
                ) : null}
                {selectedDevice === 'keyboard' ? (
                  <>
                    <SwitchRow
                      label="键盘"
                      checked={draft.keyboard}
                      disabled={busy || running}
                      detail="关闭后客户机收不到按键。"
                      onChange={(keyboard) => patch({ keyboard })}
                    />
                    <div class="virtual-machine-settings__keymap">
                      <SwitchRow
                        label="按键映射"
                        checked={draft.keyMappingEnabled}
                        disabled={busy || !draft.keyboard}
                        detail="把物理按键改写成目标键后送入客机，保存后立即生效。"
                        onChange={(keyMappingEnabled) => patch({ keyMappingEnabled })}
                      />
                      {draft.keyMappings.length > 0 ? (
                        <ul
                          class="virtual-machine-settings__keymap-list"
                          aria-label="按键映射规则"
                        >
                          {draft.keyMappings.map((mapping) => {
                            const identity = vmKeySpecIdentity(mapping.from)
                            return (
                              <li class="virtual-machine-settings__keymap-row" key={identity}>
                                <span class="virtual-machine-settings__keymap-from">
                                  {vmKeySpecLabel(mapping.from)}
                                </span>
                                <span class="virtual-machine-settings__keymap-arrow" aria-hidden="true">
                                  →
                                </span>
                                <span class="virtual-machine-settings__keymap-to">
                                  {vmKeySpecLabel(mapping.to)}
                                </span>
                                <IosButton
                                  size="compact"
                                  tone="secondary"
                                  disabled={busy || keyCapture !== undefined}
                                  onClick={() =>
                                    patch({
                                      keyMappings: draft.keyMappings.filter(
                                        (item) => vmKeySpecIdentity(item.from) !== identity,
                                      ),
                                    })
                                  }
                                >
                                  移除
                                </IosButton>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p class="virtual-machine-settings__hint">
                          还没有映射。可以把 ⌘ Command 改写成 Ctrl，或给 Delete 等缺失的键找个替身。
                        </p>
                      )}
                      <div class="virtual-machine-settings__keymap-actions">
                        <IosButton
                          size="compact"
                          disabled={
                            busy ||
                            keyCapture !== undefined ||
                            draft.keyMappings.length >= VM_KEY_MAPPINGS_LIMIT
                          }
                          onClick={() => {
                            setKeyCaptureError(undefined)
                            setKeyCapture({ step: 'from' })
                          }}
                        >
                          添加映射…
                        </IosButton>
                        {VM_KEY_MAPPING_PRESETS.map((preset) => (
                          <IosButton
                            key={preset.id}
                            size="compact"
                            tone="secondary"
                            title={preset.description}
                            disabled={busy || keyCapture !== undefined}
                            onClick={() => {
                              setKeyCaptureError(undefined)
                              patch({
                                keyMappingEnabled: true,
                                keyMappings: upsertVmKeyMappings(
                                  draft.keyMappings,
                                  preset.mappings,
                                ),
                              })
                            }}
                          >
                            {preset.label}
                          </IosButton>
                        ))}
                      </div>
                      {keyCapture ? (
                        <div
                          class="virtual-machine-settings__keymap-capture"
                          role="group"
                          aria-label="捕获按键映射"
                        >
                          {keyCapture.step === 'from' ? (
                            <>
                              <span class="virtual-machine-settings__keymap-capture-title">
                                按下要改写的键
                              </span>
                              <p class="virtual-machine-settings__hint">
                                按任意一个键（如 ⌘ Command）。Esc 取消；Fn 等浏览器捕获不到的键无法改写。
                              </p>
                            </>
                          ) : (
                            <>
                              <span class="virtual-machine-settings__keymap-capture-title">
                                <span class="virtual-machine-settings__keymap-capture-key">
                                  {vmKeySpecLabel(keyCapture.from)}
                                </span>
                                改成什么键？按下目标键，或从下面选一个
                              </span>
                              <div class="virtual-machine-settings__keymap-picks">
                                {VM_KEY_QUICK_PICKS.map((pick) => (
                                  <button
                                    key={pick.spec.code}
                                    type="button"
                                    class="virtual-machine-settings__keymap-pick"
                                    disabled={busy}
                                    onClick={() => commitKeyMapping(keyCapture.from, pick.spec)}
                                  >
                                    {pick.label}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                          {keyCaptureError ? (
                            <p class="virtual-machine-settings__keymap-error" role="alert">
                              {keyCaptureError}
                            </p>
                          ) : null}
                          <div class="virtual-machine-settings__keymap-capture-actions">
                            {keyCapture.step === 'to' ? (
                              <IosButton
                                size="compact"
                                tone="secondary"
                                onClick={() => {
                                  setKeyCaptureError(undefined)
                                  setKeyCapture({ step: 'from' })
                                }}
                              >
                                重选来源键
                              </IosButton>
                            ) : null}
                            <IosButton size="compact" tone="secondary" onClick={cancelKeyCapture}>
                              取消
                            </IosButton>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {selectedDevice === 'mouse' ? (
                  <>
                    <SwitchRow
                      label="鼠标"
                      checked={draft.mouse}
                      disabled={busy || running}
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
                      hint="自动：客机不支持绝对坐标时用独占，支持后切到跟随，运行中随驱动状态切换。强制跟随：始终跟随，指针可移出画面。强制独占：点击锁定；客机报告绝对坐标期间自动按跟随工作，退出后恢复锁定。运行中修改立即生效。"
                    />
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {tab === 'experience' ? (
          <div class="virtual-machine-settings__pane">
            <SettingsChoiceField
              label="支持的系统"
              value={draft.osPreset}
              options={VM_OS_PRESET_CHOICES}
              onChange={(value) => {
                if (isVmOsPresetId(value)) {
                  patch({ osPreset: value })
                }
              }}
              wideLayout
              presentation="form"
              disabled={busy || running}
              fieldClass="virtual-machine-settings__field"
              labelClass="virtual-machine-settings__label"
            />
            <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
              {enhanceOff
                ? '已选择「不启用增强」：以下功能全部停用，改选客机系统后恢复逐项设置。'
                : '以下功能需客机已装增强组件，开关只控制宿主侧。'}
            </p>
            <SwitchRow
              label="剪贴板同步"
              checked={enhanceOff ? false : draft.enhanceClipboard}
              disabled={busy || enhanceOff}
              detail="关闭后宿主与虚拟机之间不再互相同步文本剪贴板。"
              onChange={(enhanceClipboard) => patch({ enhanceClipboard })}
            />
            <SwitchRow
              label="文件互传"
              checked={enhanceOff ? false : draft.enhanceFileTransfer}
              disabled={busy || enhanceOff}
              detail="关闭后宿主与虚拟机之间不能复制、剪切文件。"
              onChange={(enhanceFileTransfer) => patch({ enhanceFileTransfer })}
            />
            <SwitchRow
              label="绝对坐标鼠标"
              checked={enhanceOff ? false : draft.enhanceAbsoluteMouse}
              disabled={busy || enhanceOff}
              detail="客机装好 VMware 鼠标驱动后，光标 1:1 跟随宿主。"
              onChange={(enhanceAbsoluteMouse) => patch({ enhanceAbsoluteMouse })}
            />
            <SwitchRow
              label="分辨率自动对齐"
              checked={enhanceOff ? false : draft.resolutionAutoAlign}
              disabled={busy || enhanceOff}
              detail="窗口尺寸变化时客机分辨率跟随宿主 1:1 切换（需客机装对齐代理）。"
              onChange={(resolutionAutoAlign) => patch({ resolutionAutoAlign })}
            />
            <SwitchRow
              label="窗口吸附"
              checked={enhanceOff ? false : draft.enhanceWindowSnap}
              disabled={busy || enhanceOff}
              detail="客机里拖窗口到屏幕边缘自动贴半屏、拖到顶边最大化（Win+方向键同效）；需客机装 v5 及以上增强代理，运行中切换实时生效。"
              onChange={(enhanceWindowSnap) => patch({ enhanceWindowSnap })}
            />
            {!enhanceOff && draft.enhanceWindowSnap ? (
              <>
                <IosRangeSlider
                  label="吸附触发距离"
                  value={draft.enhanceWindowSnapEdgePx}
                  min={VM_SNAP_EDGE_PX_MIN}
                  max={VM_SNAP_EDGE_PX_MAX}
                  step={VM_SNAP_EDGE_PX_STEP}
                  suffix="px"
                  disabled={busy}
                  onChange={(enhanceWindowSnapEdgePx) => patch({ enhanceWindowSnapEdgePx })}
                />
                <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
                  光标贴近屏幕边缘多少像素触发吸附；分辨率越高建议适当调大，运行中修改实时生效。
                </p>
              </>
            ) : null}
            <SwitchRow
              label="共享文件夹"
              checked={enhanceOff ? false : draft.sharedFolderEnabled}
              disabled={busy || enhanceOff}
              detail="客机把共享目录映射成网络驱动器 Z:（WebDAV），实时双向读写；开关变更后自动经增强代理配置客机映射，无需手工脚本。需客机装 v5 及以上增强代理，且网卡启用（ne2k + fetch 后端，纯本地假栈、不需要真实网络）。"
              onChange={(sharedFolderEnabled) => patch({ sharedFolderEnabled })}
            />
            {!enhanceOff && draft.sharedFolderEnabled ? (
              <>
                <div class="virtual-machine-settings__path">
                  <input
                    class="virtual-machine-settings__input"
                    type="text"
                    value={draft.sharedFolderPath}
                    placeholder="/user/Shared"
                    spellcheck={false}
                    autoComplete="off"
                    disabled={busy}
                    onInput={(event) =>
                      patch({ sharedFolderPath: (event.currentTarget as HTMLInputElement).value })
                    }
                  />
                  <IosButton size="compact" disabled={busy} onClick={() => void pickSharedFolderPath()}>
                    选择…
                  </IosButton>
                </div>
                <p class="virtual-machine-settings__hint virtual-machine-settings__hint--block">
                  共享根目录；可选挂载的真实目录（/mount/…）。运行中修改：映射与目录即时切换。
                </p>
              </>
            ) : null}
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
            marks={BLANK_DISK_SLIDER_MARKS}
            onChange={(mb) => setCreateDiskSizeMb(mb)}
          />
          <p class="virtual-machine-settings__hint">创建后为空盘，需分区、格式化后才能使用。</p>
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
