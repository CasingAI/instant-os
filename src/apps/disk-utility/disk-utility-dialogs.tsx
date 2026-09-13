import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { WindowModal, type WindowModalAction } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { Progress } from '../../ui/progress.tsx'
import {
  analyzeVirtualMachineDiskCache,
  discardVirtualMachineDiskCache,
  mergeVirtualMachineDiskCacheIntoImage,
  type VmDiskFirstAidReport,
} from '../virtual-machine/virtual-machine-disk-first-aid.ts'
import { recommendFatVariant, type DiskScheme, type FatVariant } from './disk-utility-format.ts'
import { buildPlannedDiskMap } from './disk-utility-disk-map.ts'
import { DiskMapBar } from './disk-utility-disk-map-bar.tsx'
import {
  BENCHMARK_ITEMS,
  benchmarkResultText,
  initialBenchmarkItems,
  type BenchmarkItemId,
  type BenchmarkItemState,
} from './disk-utility-benchmark.ts'
import {
  DISK_SCAN_ITEM_LABELS,
  DISK_SCAN_ITEM_ORDER,
  diskScanResultText,
  type DiskScanItemId,
  type DiskScanItemState,
  type DiskScanReport,
} from './disk-utility-scan.ts'
import type { DiskRepairResult } from './disk-utility-repair.ts'
import type { DiskPartitionInfo } from './disk-utility-data.ts'

export const DISK_UTILITY_THEME = '#2f3640'

const VARIANT_OPTIONS: Array<{ id: FatVariant | 'auto'; label: string }> = [
  { id: 'auto', label: '自动' },
  { id: 'FAT12', label: 'FAT12' },
  { id: 'FAT16', label: 'FAT16' },
  { id: 'FAT32', label: 'FAT32' },
]

const SCHEME_OPTIONS: Array<{ id: DiskScheme; label: string }> = [
  { id: 'mbr', label: 'MBR（单分区）' },
  { id: 'superfloppy', label: '无分区表' },
]

function variantHint(sizeBytes: number, variant: FatVariant | 'auto'): string {
  const chosen = variant === 'auto' ? recommendFatVariant(sizeBytes) : variant
  if (variant === 'auto') return `按容量将使用 ${chosen}`
  return chosen
}

export type EraseDialogState = {
  kind: 'disk' | 'partition'
  path: string
  label: string
  sizeBytes: number
  partition?: { index: number; startBytes: number; sizeBytes: number }
}

export type PartitionDialogState = {
  path: string
  label: string
  sizeBytes: number
}

export function EraseDiskDialog({
  state,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  state: EraseDialogState | undefined
  busy: boolean
  error: string | undefined
  onClose: () => void
  onConfirm: (options: { label: string; scheme: DiskScheme; variant: FatVariant | 'auto' }) => void
}): preact.JSX.Element | undefined {
  const [volumeLabel, setVolumeLabel] = useState('')
  const [scheme, setScheme] = useState<DiskScheme>('mbr')
  const [variant, setVariant] = useState<FatVariant | 'auto'>('auto')

  useEffect(() => {
    if (!state) return
    setVolumeLabel(state.label.slice(0, 11))
    setScheme('mbr')
    setVariant('auto')
  }, [state])

  if (!state) {
    // 保持 WindowModal 挂载：open 变 false 时它自行走退场动画（内容由 contentRef 保留最后一帧）
    return <WindowModal open={false} title="" onClose={onClose} />
  }

  const sizeLabel = formatStorageSize(state.sizeBytes)
  const isPartition = state.kind === 'partition'

  return (
    <WindowModal
      open
      title={isPartition ? '抹掉分区' : '抹掉'}
      themeColor={DISK_UTILITY_THEME}
      onClose={busy ? undefined : onClose}
      actions={[
        { key: 'cancel', label: '取消', tone: 'secondary', disabled: busy, onClick: onClose },
        {
          key: 'erase',
          label: '抹掉',
          tone: 'danger',
          disabled: busy,
          busy,
          onClick: () =>
            onConfirm({
              label: volumeLabel,
              scheme,
              variant,
            }),
        },
      ]}
    >
      <p class="window-modal__message">
        {isPartition
          ? `将抹掉「${state.label}」上的文件系统（${sizeLabel}）。分区表本身保留，该分区内的文件会全部丢失。`
          : `将抹掉「${state.label}」（${sizeLabel}）并写入新的文件系统。镜像里现有的分区和文件会全部丢失。`}
      </p>
      <div class="window-modal__field">
        <label for="disk-utility-erase-name">名称</label>
        <input
          id="disk-utility-erase-name"
          type="text"
          maxlength={11}
          value={volumeLabel}
          disabled={busy}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => setVolumeLabel((event.currentTarget as HTMLInputElement).value)}
        />
      </div>
      {isPartition ? undefined : (
        <div class="window-modal__field">
          <label for="disk-utility-erase-scheme">方案</label>
          <select
            id="disk-utility-erase-scheme"
            class="disk-utility-dialog__select"
            disabled={busy}
            value={scheme}
            onChange={(event) => setScheme((event.currentTarget as HTMLSelectElement).value as DiskScheme)}
          >
            {SCHEME_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div class="window-modal__field">
        <label for="disk-utility-erase-fs">格式</label>
        <select
          id="disk-utility-erase-fs"
          class="disk-utility-dialog__select"
          disabled={busy}
          value={variant}
          onChange={(event) =>
            setVariant((event.currentTarget as HTMLSelectElement).value as FatVariant | 'auto')
          }
        >
          {VARIANT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p class="window-modal__message">{variantHint(state.sizeBytes, variant)}</p>
      {error ? <p class="window-modal__error">{error}</p> : undefined}
    </WindowModal>
  )
}

export function PartitionDiskDialog({
  state,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  state: PartitionDialogState | undefined
  busy: boolean
  error: string | undefined
  onClose: () => void
  onConfirm: (options: { count: number; labels: string[]; variant: FatVariant | 'auto' }) => void
}): preact.JSX.Element | undefined {
  const [count, setCount] = useState(1)
  const [labels, setLabels] = useState<string[]>(['UNTITLED'])
  const [variant, setVariant] = useState<FatVariant | 'auto'>('auto')

  useEffect(() => {
    if (!state) return
    const initial = state.label.replace(/[^A-Za-z0-9]/g, '').slice(0, 11).toUpperCase() || 'UNTITLED'
    setCount(1)
    setLabels([initial])
    setVariant('auto')
  }, [state])

  if (!state) {
    // 保持 WindowModal 挂载：open 变 false 时它自行走退场动画（内容由 contentRef 保留最后一帧）
    return <WindowModal open={false} title="" onClose={onClose} />
  }

  const handleCount = (next: number) => {
    const clamped = Math.min(4, Math.max(1, next))
    setCount(clamped)
    setLabels((prev) => {
      const nextLabels = prev.slice(0, clamped)
      while (nextLabels.length < clamped) {
        nextLabels.push(`DISK${nextLabels.length + 1}`)
      }
      return nextLabels
    })
  }

  const plannedVariant = variant === 'auto' ? recommendFatVariant(Math.floor(state.sizeBytes / count)) : variant
  let plannedSegments: ReturnType<typeof buildPlannedDiskMap> = []
  try {
    plannedSegments = buildPlannedDiskMap({
      diskBytes: state.sizeBytes,
      count,
      labels,
      variantLabel: plannedVariant,
    })
  } catch {
    plannedSegments = []
  }

  return (
    <WindowModal
      open
      title="分区"
      themeColor={DISK_UTILITY_THEME}
      onClose={busy ? undefined : onClose}
      actions={[
        { key: 'cancel', label: '取消', tone: 'secondary', disabled: busy, onClick: onClose },
        {
          key: 'apply',
          label: '应用',
          tone: 'danger',
          disabled: busy,
          busy,
          onClick: () => onConfirm({ count, labels, variant }),
        },
      ]}
    >
      <p class="window-modal__message">
        将重写「{state.label}」的分区表（{formatStorageSize(state.sizeBytes)}），并格式化每个分区。镜像里现有的文件会全部丢失。
      </p>
      {plannedSegments.length > 0 ? (
        <DiskMapBar segments={plannedSegments} diskBytes={state.sizeBytes} compact />
      ) : undefined}
      <div class="window-modal__field">
        <label for="disk-utility-part-count">分区数量</label>
        <select
          id="disk-utility-part-count"
          class="disk-utility-dialog__select"
          disabled={busy}
          value={String(count)}
          onChange={(event) => handleCount(Number((event.currentTarget as HTMLSelectElement).value))}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </div>
      {labels.map((label, index) => (
        <div key={index} class="window-modal__field">
          <label for={`disk-utility-part-name-${index}`}>分区 {index + 1} 名称</label>
          <input
            id={`disk-utility-part-name-${index}`}
            type="text"
            maxlength={11}
            value={label}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => {
              const value = (event.currentTarget as HTMLInputElement).value
              setLabels((prev) => prev.map((item, i) => (i === index ? value : item)))
            }}
          />
        </div>
      ))}
      <div class="window-modal__field">
        <label for="disk-utility-part-fs">格式</label>
        <select
          id="disk-utility-part-fs"
          class="disk-utility-dialog__select"
          disabled={busy}
          value={variant}
          onChange={(event) =>
            setVariant((event.currentTarget as HTMLSelectElement).value as FatVariant | 'auto')
          }
        >
          {VARIANT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p class="window-modal__message">{variantHint(Math.floor(state.sizeBytes / count), variant)}</p>
      {error ? <p class="window-modal__error">{error}</p> : undefined}
    </WindowModal>
  )
}

export type BenchmarkDialogState = {
  rootPath: string
  label: string
}

function benchmarkRowClass(state: BenchmarkItemState): string {
  if (state.status === 'running') return 'disk-utility-benchmark__row--running'
  if (state.status === 'done') return 'disk-utility-benchmark__row--done'
  if (state.status === 'failed') return 'disk-utility-benchmark__row--failed'
  return 'disk-utility-benchmark__row--pending'
}

function benchmarkRowValue(state: BenchmarkItemState): string {
  if (state.status === 'pending') return '待测速'
  if (state.status === 'running') return state.note
  if (state.status === 'done') return state.value
  return `失败：${state.message}`
}

export type ScanDialogState = {
  path: string
  label: string
  partition?: DiskPartitionInfo
}

function scanRowClass(state: DiskScanItemState): string {
  if (state.status === 'running') return 'disk-utility-benchmark__row--running'
  if (state.status === 'done') return 'disk-utility-benchmark__row--done'
  if (state.status === 'failed') return 'disk-utility-benchmark__row--failed'
  return 'disk-utility-benchmark__row--pending'
}

function scanRowValue(state: DiskScanItemState): string {
  if (state.status === 'pending') return '待扫描'
  if (state.status === 'running') return state.note
  if (state.status === 'done') return state.value
  return `失败：${state.message}`
}

export function ScanDialog({
  state,
  busy,
  items,
  report,
  error,
  repairApplying,
  repairResult,
  onClose,
  onRun,
  onPlanRepair,
}: {
  state: ScanDialogState | undefined
  busy: boolean
  items: Record<DiskScanItemId, DiskScanItemState>
  report: DiskScanReport | undefined
  error: string | undefined
  repairApplying: boolean
  repairResult: DiskRepairResult | undefined
  onClose: () => void
  onRun: (signal: AbortSignal) => void
  onPlanRepair: (signal: AbortSignal) => void
}): preact.JSX.Element | undefined {
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const [controller, setController] = useState<AbortController | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!state) {
      controllerRef.current = undefined
      setController(undefined)
      return
    }
    const next = new AbortController()
    controllerRef.current = next
    setController(next)
    return () => {
      next.abort()
      if (controllerRef.current === next) controllerRef.current = undefined
      setController(undefined)
    }
  }, [state])

  if (!state) {
    // 保持 WindowModal 挂载：open 变 false 时它自行走退场动画（内容由 contentRef 保留最后一帧）
    return <WindowModal open={false} title="" onClose={onClose} />
  }

  const hasResult = report !== undefined
  const handleCopy = async () => {
    if (!report || !navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(diskScanResultText(report))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const ensureController = (): AbortSignal => {
    let next = controllerRef.current
    if (!next || next.signal.aborted) {
      next = new AbortController()
      controllerRef.current = next
      setController(next)
    }
    return next.signal
  }

  // 主按钮随流程演进：开始扫描 → 停止扫描 → 扫出问题后同一按钮位变为开始修复（不再另设按钮）
  const primaryAction = busy
    ? (repairApplying
        ? {
            key: 'stop',
            label: '正在修复',
            tone: 'secondary' as const,
            disabled: true,
            onClick: () => undefined,
          }
        : {
            key: 'stop',
            label: '停止扫描',
            tone: 'danger' as const,
            disabled: false,
            onClick: () => controller?.abort(),
          })
    : report?.status === 'issues'
      ? {
          key: 'repair',
          label: '开始修复',
          tone: 'primary' as const,
          disabled: false,
          onClick: () => onPlanRepair(ensureController()),
        }
      : {
          key: 'run',
          label: '开始扫描',
          tone: 'primary' as const,
          disabled: false,
          onClick: () => onRun(ensureController()),
        }

  // intro 随流程阶段切换，单行省略显示，文案保持一行内可读完
  const intro = repairApplying
    ? '正在写入修复，完成后自动复扫验证'
    : busy
      ? report
        ? '正在构建修复计划……'
        : '正在扫描……不会修改镜像'
      : !report
        ? '只读取文件系统结构，不会修改镜像'
        : report.status === 'issues'
          ? '发现问题，可「开始修复」：仅改写 FAT 表与目录项，不动文件数据'
          : report.status === 'clean'
            ? repairResult
              ? '修复完成，复扫未发现问题'
              : '扫描完成，未发现问题'
            : report.status === 'unsupported'
              ? '暂不支持此文件系统，未做修改'
              : '无法识别文件系统，未做修改'

  return (
    <WindowModal
      open
      title="错误扫描"
      titleSize="large"
      titleAlign="left"
      themeColor={DISK_UTILITY_THEME}
      wide
      scrollBody
      heightType="grow"
      onClose={busy ? undefined : onClose}
      showCloseButton
      headerActions={[
        {
          key: 'copy',
          label: copied ? '已复制' : '复制报告',
          tone: 'secondary' as const,
          disabled: busy || !hasResult,
          onClick: () => void handleCopy(),
        },
        ...(primaryAction ? [primaryAction] : []),
      ]}
    >
      <div class="disk-utility-scan__body-header">
        <h2 class="disk-utility-scan__name">{state.label}</h2>
        <p class="disk-utility-scan__intro">{intro}</p>
      </div>
      <table class="disk-utility-scan__table">
        <thead>
          <tr>
            <th class="disk-utility-scan__col-name">检查项</th>
            <th class="disk-utility-scan__col-result">结果</th>
          </tr>
        </thead>
        <tbody>
          {DISK_SCAN_ITEM_ORDER.map((id) => (
            <tr key={id} class={`disk-utility-scan__row ${scanRowClass(items[id])}`}>
              <td class="disk-utility-scan__col-name">{DISK_SCAN_ITEM_LABELS[id]}</td>
              <td class="disk-utility-scan__col-result">{scanRowValue(items[id])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report ? (
        <section class="disk-utility-scan__report" aria-live="polite">
          {repairResult ? (
            <p class="disk-utility-scan__result">
              已执行 {repairResult.applied.length} 项修复，复扫
              {repairResult.after.status === 'clean'
                ? '未发现问题'
                : `仍有 ${repairResult.after.issues.length} 项问题，可再次修复`}
              。
            </p>
          ) : undefined}
          <h4 class="disk-utility-scan__report-title">
            {report.status === 'clean' ? '未发现问题' : report.status === 'unsupported' ? '暂不支持此文件系统' : '发现文件系统问题'}
          </h4>
          <div class="disk-utility-scan__stats">
            {report.orphanClusters !== undefined ? (
              <div class="disk-utility-scan__stat">
                <span>孤儿簇</span>
                <strong>{report.orphanClusters.toLocaleString()}</strong>
                <em>{formatStorageSize(report.orphanBytes ?? 0)}</em>
              </div>
            ) : undefined}
            {report.allocatedClusters !== undefined ? (
              <div class="disk-utility-scan__stat disk-utility-scan__stat--wide">
                <span>已分配 / 可达 / 空闲</span>
                <strong>
                  {report.allocatedClusters.toLocaleString()} / {report.reachableClusters?.toLocaleString() ?? '—'} / {report.freeClusters?.toLocaleString() ?? '—'}
                </strong>
              </div>
            ) : undefined}
          </div>
          {report.issues.length > 0 ? (
            <div class="disk-utility-scan__issues">
              {report.issues.map((issue) => (
                <div key={issue.code} class="disk-utility-scan__issue">
                  <strong>[{issue.severity}]</strong> {issue.message}
                  {issue.examples?.length ? <span>（{issue.examples.join('、')}）</span> : undefined}
                </div>
              ))}
            </div>
          ) : undefined}
        </section>
      ) : undefined}
      {error ? <p class="window-modal__error">{error}</p> : undefined}
    </WindowModal>

  )
}

export type FirstAidDialogState = {
  path: string
  label: string
}

/** 急救流程状态机：打开即自动分析；结果态里再选写入/丢掉。 */
type FirstAidPhase =
  | { kind: 'analyzing' }
  | { kind: 'found'; report: VmDiskFirstAidReport }
  | { kind: 'merging'; mergedBytes: number; totalBytes: number }
  | { kind: 'discarding' }
  | { kind: 'clean' }
  | { kind: 'error'; message: string }

function firstAidErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function FirstAidDialog({
  state,
  onClose,
}: {
  state: FirstAidDialogState | undefined
  onClose: () => void
}): preact.JSX.Element | undefined {
  const modal = useWindowModal()
  const [phase, setPhase] = useState<FirstAidPhase>({ kind: 'analyzing' })
  const analysisSeqRef = useRef(0)
  const mergeAbortRef = useRef<AbortController | undefined>(undefined)

  const runAnalysis = (path: string): void => {
    const seq = (analysisSeqRef.current += 1)
    setPhase({ kind: 'analyzing' })
    void (async () => {
      try {
        const report = await analyzeVirtualMachineDiskCache(path)
        if (seq !== analysisSeqRef.current) return
        setPhase(report ? { kind: 'found', report } : { kind: 'clean' })
      } catch (error) {
        if (seq !== analysisSeqRef.current) return
        setPhase({ kind: 'error', message: firstAidErrorText(error) })
      }
    })()
  }

  useEffect(() => {
    if (!state) return
    runAnalysis(state.path)
    return () => {
      // 关闭对话框 = 放弃进行中的合并（缓存保留，下次急救可再来）
      mergeAbortRef.current?.abort()
      mergeAbortRef.current = undefined
    }
  }, [state])

  if (!state) {
    // 保持 WindowModal 挂载：open 变 false 时它自行走退场动画（内容由 contentRef 保留最后一帧）
    return <WindowModal open={false} title="" onClose={onClose} />
  }

  const startMerge = () => {
    // 每次合并用新控制器：上一次取消留下的已中止信号会让这次合并立刻停下
    const controller = new AbortController()
    mergeAbortRef.current = controller
    setPhase({ kind: 'merging', mergedBytes: 0, totalBytes: 0 })
    void (async () => {
      try {
        await mergeVirtualMachineDiskCacheIntoImage({
          imagePath: state.path,
          signal: controller.signal,
          onProgress: (info) => {
            setPhase((prev) =>
              prev.kind === 'merging'
                ? { kind: 'merging', mergedBytes: info.mergedBytes, totalBytes: info.totalBytes }
                : prev,
            )
          },
        })
        // 完成、取消都重分析：完成 → 没有要处理的；取消 → 缓存剩余量重新报
        runAnalysis(state.path)
      } catch (error) {
        setPhase({ kind: 'error', message: firstAidErrorText(error) })
      }
    })()
  }

  const startDiscard = () => {
    void (async () => {
      const ok = await modal.confirm({
        title: '丢掉缓存？',
        message: '这些改动不会写入硬盘文件。',
        confirmLabel: '丢掉',
        cancelLabel: '取消',
        themeColor: DISK_UTILITY_THEME,
      })
      if (!ok) return
      setPhase({ kind: 'discarding' })
      try {
        await discardVirtualMachineDiskCache(state.path)
        runAnalysis(state.path)
      } catch (error) {
        setPhase({ kind: 'error', message: firstAidErrorText(error) })
      }
    })()
  }

  const working = phase.kind === 'merging' || phase.kind === 'discarding'

  const actions: WindowModalAction[] =
    phase.kind === 'found'
      ? [
          { key: 'discard', label: '丢掉缓存', tone: 'danger', onClick: startDiscard },
          { key: 'merge', label: '写入硬盘文件', tone: 'primary', onClick: startMerge },
        ]
      : phase.kind === 'merging'
        ? [{ key: 'cancel', label: '取消', tone: 'danger', onClick: () => mergeAbortRef.current?.abort() }]
        : phase.kind === 'discarding'
          ? [{ key: 'waiting', label: '正在丢掉缓存', tone: 'secondary', disabled: true, busy: true, onClick: () => undefined }]
          : phase.kind === 'error'
            ? [
                { key: 'retry', label: '重新分析', tone: 'secondary', onClick: () => runAnalysis(state.path) },
                { key: 'close', label: '关闭', tone: 'primary', onClick: onClose },
              ]
            : [
                {
                  key: 'close',
                  label: phase.kind === 'analyzing' ? '正在分析' : '关闭',
                  tone: 'primary',
                  disabled: phase.kind === 'analyzing',
                  busy: phase.kind === 'analyzing',
                  onClick: onClose,
                },
              ]

  const intro =
    phase.kind === 'analyzing'
      ? '正在分析这份盘上有没有未提交的虚拟机硬盘缓存。'
      : phase.kind === 'found'
        ? '可把缓存合并进可见文件，或丢掉这些改动。'
        : phase.kind === 'merging'
          ? '正在把缓存写入硬盘文件……取消会保留剩余缓存，下次急救可再合并。'
          : phase.kind === 'discarding'
            ? '正在丢掉缓存……'
            : phase.kind === 'error'
              ? '分析或操作失败，可重试。'
              : '没有需要处理的缓存。'

  return (
    <WindowModal
      open
      title="急救"
      titleSize="large"
      titleAlign="left"
      themeColor={DISK_UTILITY_THEME}
      onClose={working ? undefined : onClose}
      showCloseButton
      actions={actions}
    >
      <div class="disk-utility-scan__body-header">
        <h2 class="disk-utility-scan__name">{state.label}</h2>
        <p class="disk-utility-scan__intro">{intro}</p>
      </div>
      {phase.kind === 'analyzing' || phase.kind === 'discarding' ? (
        <div class="disk-utility-first-aid__progress">
          <Progress indeterminate status="active" showInfo={false} ariaLabel={phase.kind === 'analyzing' ? '正在分析' : '正在丢掉缓存'} />
        </div>
      ) : undefined}
      {phase.kind === 'found' ? (
        <section class="disk-utility-scan__report" aria-live="polite">
          <h4 class="disk-utility-scan__report-title">
            这份盘上有虚拟机硬盘缓存，约 {formatStorageSize(phase.report.cacheBytes)}
          </h4>
        </section>
      ) : undefined}
      {phase.kind === 'merging' ? (
        <div class="disk-utility-first-aid__progress">
          <Progress
            percent={phase.totalBytes > 0 ? (phase.mergedBytes / phase.totalBytes) * 100 : 0}
            indeterminate={phase.totalBytes <= 0}
            status="active"
            info={
              phase.totalBytes > 0
                ? `${formatStorageSize(phase.mergedBytes)} / ${formatStorageSize(phase.totalBytes)}`
                : undefined
            }
            ariaLabel="写入硬盘文件进度"
          />
        </div>
      ) : undefined}
      {phase.kind === 'clean' ? (
        <p class="disk-utility-scan__result">没有需要处理的缓存。</p>
      ) : undefined}
      {phase.kind === 'error' ? <p class="window-modal__error">{phase.message}</p> : undefined}
    </WindowModal>
  )
}

export function BenchmarkDialog({
  state,
  busy,
  items,
  error,
  onClose,
  onRun,
}: {
  state: BenchmarkDialogState | undefined
  busy: boolean
  items: Record<BenchmarkItemId, BenchmarkItemState> | undefined
  error: string | undefined
  onClose: () => void
  onRun: (signal: AbortSignal) => void
}): preact.JSX.Element | undefined {
  const [controller, setController] = useState<AbortController | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!state) {
      setController(undefined)
      return
    }
    const next = new AbortController()
    setController(next)
    return () => {
      next.abort()
      setController(undefined)
    }
  }, [state])

  const rowStates = items ?? initialBenchmarkItems()
  const resultText = useMemo(() => benchmarkResultText(rowStates), [rowStates])
  const hasResult = useMemo(
    () => BENCHMARK_ITEMS.some((item) => rowStates[item.id].status === 'done' || rowStates[item.id].status === 'failed'),
    [rowStates],
  )

  if (!state) {
    // 保持 WindowModal 挂载：open 变 false 时它自行走退场动画（内容由 contentRef 保留最后一帧）
    return <WindowModal open={false} title="" onClose={onClose} />
  }

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(`${state.label} 磁盘测速结果\n${resultText}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleRun = () => {
    let next = controller
    if (!next || next.signal.aborted) {
      next = new AbortController()
      setController(next)
    }
    onRun(next.signal)
  }

  return (
    <WindowModal
      open
      title="磁盘测速"
      titleSize="large"
      titleAlign="left"
      themeColor={DISK_UTILITY_THEME}
      wide
      scrollBody
      onClose={busy ? undefined : onClose}
      showCloseButton
      headerActions={[
        {
          key: 'copy',
          label: copied ? '已复制' : '复制结果',
          tone: 'secondary',
          disabled: busy || !hasResult,
          onClick: () => void handleCopy(),
        },
          busy
          ? {
              key: 'stop',
              label: '停止测速',
              tone: 'danger',
              disabled: false,
              onClick: () => controller?.abort(),
            }
          : {
              key: 'run',
              label: '开始测速',
              tone: 'primary',
              disabled: false,
              onClick: handleRun,
            },
      ]}
    >
      <div class="disk-utility-benchmark__body-header">
        <h2 class="disk-utility-benchmark__name">{state.label}</h2>
        <p class="disk-utility-benchmark__intro">
          将在「{state.label}」创建临时文件并分项测试不同存储路径的速度，测试结束后自动删除。
        </p>
      </div>

      <table class="disk-utility-benchmark__table">
        <thead>
          <tr>
            <th class="disk-utility-benchmark__col-name">测试项</th>
            <th class="disk-utility-benchmark__col-result">结果</th>
          </tr>
        </thead>
        <tbody>
          {BENCHMARK_ITEMS.map((item) => {
            const rowState = rowStates[item.id]
            return (
              <tr key={item.id} class={`disk-utility-benchmark__row ${benchmarkRowClass(rowState)}`}>
                <td class="disk-utility-benchmark__col-name">{item.label}</td>
                <td class="disk-utility-benchmark__col-result">{benchmarkRowValue(rowState)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {error ? <p class="window-modal__error">{error}</p> : undefined}
    </WindowModal>
  )
}
