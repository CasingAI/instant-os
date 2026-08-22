import { createPortal } from 'preact/compat'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { formatVmBackendLabel } from './virtual-machine-backends.ts'
import {
  formatVmBootOrderLabel,
  formatVmBuildModeLabel,
  formatVmMemoryLabel,
  formatVmNetworkBackendLabel,
  formatVmNetworkLabel,
  formatVmPathSummary,
} from './virtual-machine-config.ts'
import { formatVmVgaResolution } from './virtual-machine-stats-format.ts'
import type { VirtualMachineRecord } from './virtual-machine-types.ts'
import type { VmRuntimeSnapshot } from './virtual-machine-runtime.ts'

export type VirtualMachineInspectorOverlayProps = {
  machine: VirtualMachineRecord
  running: boolean
  snapshot: VmRuntimeSnapshot | undefined
  onClose: () => void
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="virtual-machine-inspector__section">
      <h4 class="virtual-machine-inspector__section-title">{title}</h4>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: preact.ComponentChildren }) {
  return (
    <div class="virtual-machine-inspector__row">
      <span class="virtual-machine-inspector__label">{label}</span>
      <span class="virtual-machine-inspector__value">{value}</span>
    </div>
  )
}

function CapabilityBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      class={
        active
          ? 'virtual-machine-inspector__badge virtual-machine-inspector__badge--active'
          : 'virtual-machine-inspector__badge'
      }
    >
      {label}
    </span>
  )
}

export function VirtualMachineInspectorOverlay({
  machine,
  running,
  snapshot,
  onClose,
}: VirtualMachineInspectorOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const stats = snapshot?.stats
  const mouseCapabilities = stats?.mouseCapabilities

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const displayModeLabel = useMemo(() => {
    if (machine.displayMode === 'stretch') return '拉伸'
    if (machine.displayMode === 'native') return '原始'
    return '等比'
  }, [machine.displayMode])

  return createPortal(
    <div class="virtual-machine-inspector__overlay" onClick={handleOverlayClick}>
      <div
        ref={panelRef}
        class="virtual-machine-inspector__panel"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div class="virtual-machine-inspector__header">
          <h3 class="virtual-machine-inspector__title">虚拟机详细信息</h3>
          <button
            type="button"
            class="virtual-machine-inspector__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div class="virtual-machine-inspector__body">
          <Section title="配置">
            <Row label="名称" value={machine.name} />
            <Row label="后端" value={formatVmBackendLabel(machine.backend)} />
            <Row label="构建模式" value={formatVmBuildModeLabel(machine.buildMode)} />
            <Row label="内存" value={formatVmMemoryLabel(machine.memoryMb)} />
            <Row label="显存" value={formatVmMemoryLabel(machine.vgaMemoryMb)} />
            <Row label="启动顺序" value={formatVmBootOrderLabel(machine.bootOrder)} />
            <Row label="显示比例" value={displayModeLabel} />
          </Section>

          <Section title="运行状态">
            <Row label="状态" value={running ? '运行中' : '已停止'} />
            <Row label="分辨率" value={running && stats ? formatVmVgaResolution(stats) : '—'} />
            <Row label="已运行" value={running && stats ? `${Math.round(stats.runningMs / 1000)}s` : '—'} />
            <Row label="速度" value={running && stats ? `${stats.speedMips.toFixed(1)} mIPS` : '—'} />
          </Section>

          <Section title="鼠标能力">
            <div class="virtual-machine-inspector__badges">
              <CapabilityBadge active={Boolean(mouseCapabilities?.enabled)} label="鼠标已启用" />
              <CapabilityBadge active={Boolean(mouseCapabilities?.pointerLocked)} label="Pointer Lock" />
              <CapabilityBadge active={Boolean(mouseCapabilities?.absoluteMouse)} label="Absolute Mouse" />
            </div>
            <p class="virtual-machine-inspector__hint">
              {mouseCapabilities?.absoluteMouse
                ? 'Guest 已启用 absolute mouse，宿主指针位置会直接映射到客户机内部。'
                : running
                  ? 'Guest 尚未报告 absolute mouse 支持。'
                  : '虚拟机未运行，无法检测鼠标能力。'}
            </p>
          </Section>

          <Section title="外设">
            <Row label="键盘" value={machine.keyboard ? '开启' : '关闭'} />
            <Row label="鼠标" value={machine.mouse ? '开启' : '关闭'} />
            <Row label="扬声器" value={machine.speaker ? '开启' : '关闭'} />
            <Row
              label="网卡"
              value={
                machine.network === 'none'
                  ? formatVmNetworkLabel(machine.network)
                  : `${formatVmNetworkLabel(machine.network)} · ${formatVmNetworkBackendLabel(machine.networkBackend)}`
              }
            />
          </Section>

          <Section title="存储">
            <Row label="硬盘" value={formatVmPathSummary(machine.hdaPath)} />
            <Row label="光盘" value={formatVmPathSummary(machine.cdromPath)} />
            <Row label="软盘" value={formatVmPathSummary(machine.fdaPath)} />
            <Row label="快照" value={formatVmPathSummary(machine.statePath)} />
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
