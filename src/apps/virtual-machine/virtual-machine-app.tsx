import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import {
  formatVmBackendLabel,
  getVmBackend,
  vmPowerUnavailableMessage,
} from './virtual-machine-backends.ts'
import {
  defaultVirtualMachineSettings,
  formatVmBootOrderLabel,
  formatVmDisplayModeLabel,
  formatVmMemoryLabel,
  formatVmNetworkBackendLabel,
  formatVmNetworkLabel,
  formatVmPathSummary,
  settingsFromRecord,
} from './virtual-machine-config.ts'
import {
  buildStartMessage,
  loadVirtualMachineDisks,
  virtualMachineHasBootMedia,
} from './virtual-machine-disks.ts'
import { VirtualMachineActivity } from './virtual-machine-activity.tsx'
import { isHttpDiskUrl } from './virtual-machine-protocol.ts'
import { useVirtualMachineRuntime } from './virtual-machine-runtime.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'
import { VirtualMachineSettingsDialog } from './virtual-machine-settings-dialog.tsx'
import { formatVmVgaResolution } from './virtual-machine-stats-format.ts'
import {
  addVirtualMachine,
  nextVirtualMachineName,
  readVirtualMachineStore,
  removeVirtualMachine,
  subscribeVirtualMachineStore,
  updateVirtualMachine,
} from './virtual-machine-store.ts'
import type { VirtualMachineRecord, VirtualMachineSettings } from './virtual-machine-types.ts'
import { VM_DISPLAY_MODE_IDS, type VmDisplayModeId } from './virtual-machine-types.ts'
import './virtual-machine.css'

const APP_ID = 'virtual-machine' as const
const THEME = '#3d5a80'
const POWER_HINT_MS = 4000

const DISPLAY_MODE_SEGMENTS: readonly { id: VmDisplayModeId; label: string }[] =
  VM_DISPLAY_MODE_IDS.map((id) => ({
    id,
    label: formatVmDisplayModeLabel(id),
  }))

type SettingsSession =
  | { mode: 'create'; initial: VirtualMachineSettings }
  | { mode: 'edit'; id: string; initial: VirtualMachineSettings }

function formatMachineMeta(machine: VirtualMachineRecord, running: boolean): string {
  return `${formatVmMemoryLabel(machine.memoryMb)} · ${formatVmBackendLabel(machine.backend)} · ${
    running ? '运行中' : '已停止'
  }`
}

function formatStatus(machine: VirtualMachineRecord | undefined, running: boolean): string {
  if (!machine) {
    return '未选择'
  }
  return `${running ? '运行中' : '已停止'} · ${formatVmBackendLabel(machine.backend)}`
}

export function VirtualMachineApp({ windowId }: { windowId?: string }) {
  const { activeWindowId } = useOs()
  const isActiveWindow = windowId === undefined || windowId === activeWindowId
  const modal = useWindowModal()
  const runtimeOrigin = getVmRuntimeOrigin()
  const {
    iframeRef,
    ready: runtimeReady,
    stats: runtimeStats,
    bootProgress,
    start: startRuntime,
    stop: stopEmulator,
    reset: resetRuntime,
    setDisplayMode,
    newRequestId,
  } = useVirtualMachineRuntime(runtimeOrigin)
  const [machines, setMachines] = useState<VirtualMachineRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [runningId, setRunningId] = useState<string | undefined>(undefined)
  const [powerBusy, setPowerBusy] = useState(false)
  const [powerHint, setPowerHint] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [settingsSession, setSettingsSession] = useState<SettingsSession | undefined>(undefined)

  const applyStore = useCallback((next: VirtualMachineRecord[]) => {
    setMachines(next)
    setSelectedId((current) => {
      if (current && next.some((machine) => machine.id === current)) {
        return current
      }
      return next[0]?.id
    })
    setReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void readVirtualMachineStore().then((store) => {
        if (!cancelled) {
          applyStore(store.machines)
        }
      })
    }
    refresh()
    const unsubscribe = subscribeVirtualMachineStore(refresh)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyStore])

  useEffect(() => {
    if (!powerHint || powerBusy) {
      return
    }
    const timer = window.setTimeout(() => setPowerHint(undefined), POWER_HINT_MS)
    return () => window.clearTimeout(timer)
  }, [powerBusy, powerHint])

  const selected = useMemo(
    () => machines.find((machine) => machine.id === selectedId),
    [machines, selectedId],
  )
  const selectedBackend = selected ? getVmBackend(selected.backend) : undefined
  const selectedRunning = Boolean(selected && runningId === selected.id)
  const hasSelection = selected !== undefined
  const settingsOpen = settingsSession !== undefined
  const canStart = Boolean(
    hasSelection && !powerBusy && !selectedRunning && (runtimeOrigin ? runtimeReady : true),
  )
  const canStop = Boolean(hasSelection && selectedRunning && !powerBusy)

  const handleNew = useCallback(() => {
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'create',
        initial: defaultVirtualMachineSettings(nextVirtualMachineName(machines)),
      }
    })
    setPowerHint(undefined)
  }, [machines])

  const handleSettings = useCallback(() => {
    if (!selected) {
      return
    }
    setSettingsSession((current) => {
      if (current) {
        return current
      }
      return {
        mode: 'edit',
        id: selected.id,
        initial: settingsFromRecord(selected),
      }
    })
    setPowerHint(undefined)
  }, [selected])

  const handleSaveSettings = useCallback(
    async (settings: VirtualMachineSettings) => {
      if (!settingsSession) {
        return
      }
      if (settingsSession.mode === 'create') {
        const machine = await addVirtualMachine(settings)
        setSelectedId(machine.id)
      } else {
        await updateVirtualMachine(settingsSession.id, settings)
      }
      setSettingsSession(undefined)
      setPowerHint(undefined)
    },
    [settingsSession],
  )

  const stopRuntime = useCallback(async () => {
    await stopEmulator()
    setRunningId(undefined)
  }, [stopEmulator])

  const handleDisplayMode = useCallback(
    async (mode: VmDisplayModeId) => {
      if (!selected) {
        return
      }
      if (selectedRunning && runtimeReady) {
        try {
          await setDisplayMode(mode)
        } catch (error) {
          setPowerHint(error instanceof Error ? error.message : '切换显示比例失败')
          return
        }
      }
      await updateVirtualMachine(selected.id, {
        ...settingsFromRecord(selected),
        displayMode: mode,
      })
      setPowerHint(undefined)
    },
    [runtimeReady, selected, selectedRunning, setDisplayMode],
  )

  const handleDelete = useCallback(() => {
    if (!selected) {
      return
    }
    const target = selected
    void (async () => {
      const confirmed = await modal.confirm({
        title: '删除虚拟机',
        message: `要删除「${target.name}」吗？此操作无法撤销。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        confirmTone: 'danger',
        themeColor: THEME,
      })
      if (!confirmed) {
        return
      }
      if (runningId === target.id) {
        try {
          await stopRuntime()
        } catch (error) {
          setPowerHint(error instanceof Error ? error.message : '关机失败')
          return
        }
      }
      const index = machines.findIndex((machine) => machine.id === target.id)
      const remaining = await removeVirtualMachine(target.id)
      const next = remaining[Math.min(Math.max(index, 0), Math.max(remaining.length - 1, 0))]
      setSelectedId(next?.id)
      setPowerHint(undefined)
    })()
  }, [machines, modal, runningId, selected, stopRuntime])

  const handlePower = useCallback(
    (action: 'start' | 'stop' | 'reset') => {
      if (!selected || !selectedBackend) {
        return
      }
      if (!selectedBackend.available || !runtimeOrigin) {
        setPowerHint(vmPowerUnavailableMessage(action))
        return
      }
      if (!runtimeReady) {
        setPowerHint('模拟器尚未就绪')
        return
      }
      if (action === 'start') {
        if (runningId && runningId !== selected.id) {
          setPowerHint('请先关闭当前虚拟机')
          return
        }
        if (runningId === selected.id) {
          return
        }
        if (!virtualMachineHasBootMedia(selected)) {
          setPowerHint('请先在设置里挂载硬盘、光盘或软盘')
          return
        }
      } else if (runningId !== selected.id) {
        setPowerHint(action === 'stop' ? '这台虚拟机未在运行' : '请先开机')
        return
      }

      const machine = selected
      void (async () => {
        setPowerBusy(true)
        try {
          if (action === 'stop') {
            await stopRuntime()
            setPowerHint(undefined)
            return
          }
          if (action === 'reset') {
            await resetRuntime()
            setPowerHint(undefined)
            return
          }
          const hasRemoteDisk = [
            machine.hdaPath,
            machine.cdromPath,
            machine.fdaPath,
            machine.statePath,
          ].some(isHttpDiskUrl)
          setPowerHint(hasRemoteDisk ? '正在启动模拟器…' : '正在读取镜像…')
          const disks = await loadVirtualMachineDisks(machine)
          setPowerHint('正在启动模拟器…')
          const message = buildStartMessage(newRequestId(), machine, disks)
          await startRuntime(message)
          setRunningId(machine.id)
          setPowerHint(
            machine.network === 'none'
              ? undefined
              : machine.networkBackend === 'off'
                ? '已挂网卡但未选网络后端，按离线启动'
                : undefined,
          )
        } catch (error) {
          setPowerHint(error instanceof Error ? error.message : '操作失败')
        } finally {
          setPowerBusy(false)
        }
      })()
    },
    [
      newRequestId,
      resetRuntime,
      runningId,
      runtimeOrigin,
      runtimeReady,
      selected,
      selectedBackend,
      startRuntime,
      stopRuntime,
    ],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建虚拟机',
            shortcut: '⌘N',
            onClick: handleNew,
          },
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '删除',
            disabled: !hasSelection || powerBusy,
            onClick: handleDelete,
          },
        ],
      },
      {
        label: '虚拟机',
        items: [
          {
            type: 'action',
            label: '设置虚拟机',
            disabled: !hasSelection,
            onClick: handleSettings,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '开机',
            disabled: !canStart,
            onClick: () => handlePower('start'),
          },
          {
            type: 'action',
            label: '关机',
            disabled: !canStop,
            onClick: () => handlePower('stop'),
          },
          {
            type: 'action',
            label: '重置',
            disabled: !canStop,
            onClick: () => handlePower('reset'),
          },
        ],
      },
    ]
  }, [canStart, canStop, handleDelete, handleNew, handlePower, handleSettings, hasSelection, powerBusy])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  useEffect(() => {
    if (!isActiveWindow) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        handleNew()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNew, isActiveWindow])

  const screenMessage = !ready
    ? '正在加载…'
    : !runtimeOrigin
      ? '未配置虚拟机运行时'
      : !runtimeReady
        ? '正在连接模拟器…'
        : selected
          ? selectedRunning
            ? undefined
            : '已关机。点开机启动。'
          : '选择左侧的虚拟机，或新建一台。'

  const bannerText = powerBusy && bootProgress ? bootProgress : powerHint

  return (
    <div class="virtual-machine">
      <div class="virtual-machine__toolbar">
        <div class="virtual-machine__toolbar-actions">
          <IosButton size="compact" onClick={handleNew}>
            新建
          </IosButton>
          <IosButton size="compact" disabled={!hasSelection} onClick={handleSettings}>
            设置
          </IosButton>
          <IosButton
            size="compact"
            disabled={!canStart}
            onClick={() => handlePower('start')}
          >
            开机
          </IosButton>
          <IosButton size="compact" disabled={!canStop} onClick={() => handlePower('stop')}>
            关机
          </IosButton>
          <IosButton size="compact" disabled={!canStop} onClick={() => handlePower('reset')}>
            重置
          </IosButton>
        </div>
        {selected ? (
          <SegmentedControl
            value={selected.displayMode}
            items={DISPLAY_MODE_SEGMENTS}
            onChange={(mode) => void handleDisplayMode(mode)}
            ariaLabel="显示比例"
            className="virtual-machine__display-mode"
          />
        ) : null}
        <span class="virtual-machine__status">{formatStatus(selected, selectedRunning)}</span>
      </div>
      {bannerText ? (
        <div class="virtual-machine__banner" role="status">
          {bannerText}
        </div>
      ) : null}
      <div class="virtual-machine__body">
        <aside class="virtual-machine__list-pane" aria-label="虚拟机列表">
          <div class="virtual-machine__list-head">虚拟机</div>
          {machines.length === 0 && ready ? (
            <p class="virtual-machine__list-empty">还没有虚拟机。点「新建」添加一台。</p>
          ) : (
            <ul class="virtual-machine__list">
              {machines.map((machine) => {
                const active = machine.id === selectedId
                const running = machine.id === runningId
                return (
                  <li key={machine.id}>
                    <button
                      type="button"
                      class={
                        active
                          ? 'virtual-machine__row virtual-machine__row--active'
                          : 'virtual-machine__row'
                      }
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(machine.id)
                        setPowerHint(undefined)
                      }}
                      onDblClick={() => {
                        setSelectedId(machine.id)
                        setSettingsSession({
                          mode: 'edit',
                          id: machine.id,
                          initial: settingsFromRecord(machine),
                        })
                        setPowerHint(undefined)
                      }}
                    >
                      <span class="virtual-machine__row-name">{machine.name}</span>
                      <span class="virtual-machine__row-meta">
                        {formatMachineMeta(machine, running)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        <section class="virtual-machine__display-pane" aria-label="显示器">
          <div class="virtual-machine__screen">
            {runtimeOrigin ? (
              <iframe
                ref={iframeRef}
                class={
                  selectedRunning
                    ? 'virtual-machine__frame'
                    : 'virtual-machine__frame virtual-machine__frame--idle'
                }
                title="虚拟机显示器"
                src={runtimeOrigin}
                referrerPolicy="origin"
                sandbox="allow-scripts allow-same-origin allow-modals"
                allow="autoplay; fullscreen; pointer-lock"
              />
            ) : null}
            {screenMessage ? (
              <div class="virtual-machine__screen-message">{screenMessage}</div>
            ) : null}
          </div>
          <VirtualMachineActivity stats={runtimeStats} running={Boolean(selectedRunning)} />
          {selected ? (
            <dl class="virtual-machine__inspector">
              <div class="virtual-machine__inspector-item">
                <dt>名称</dt>
                <dd>{selected.name}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>后端</dt>
                <dd>{formatVmBackendLabel(selected.backend)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>内存</dt>
                <dd>{formatVmMemoryLabel(selected.memoryMb)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>显存</dt>
                <dd>{formatVmMemoryLabel(selected.vgaMemoryMb)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>分辨率</dt>
                <dd>
                  {selectedRunning && runtimeStats
                    ? formatVmVgaResolution(runtimeStats)
                    : '—'}
                </dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>启动</dt>
                <dd>{formatVmBootOrderLabel(selected.bootOrder)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>网卡</dt>
                <dd>
                  {selected.network === 'none'
                    ? formatVmNetworkLabel(selected.network)
                    : `${formatVmNetworkLabel(selected.network)} · ${formatVmNetworkBackendLabel(
                        selected.networkBackend,
                      )}`}
                </dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>硬盘</dt>
                <dd>{formatVmPathSummary(selected.hdaPath)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>光盘</dt>
                <dd>{formatVmPathSummary(selected.cdromPath)}</dd>
              </div>
              <div class="virtual-machine__inspector-item">
                <dt>快照</dt>
                <dd>{formatVmPathSummary(selected.statePath)}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      </div>
      <VirtualMachineSettingsDialog
        open={settingsOpen}
        mode={settingsSession?.mode ?? 'create'}
        initial={settingsSession?.initial ?? defaultVirtualMachineSettings()}
        onClose={() => setSettingsSession(undefined)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
