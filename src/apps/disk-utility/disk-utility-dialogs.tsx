import { useEffect, useMemo, useState } from 'preact/hooks'
import { WindowModal } from '../../window/window-modal.tsx'
import { formatStorageSize } from '../../os/format-storage-size.ts'
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

  if (!state) return undefined

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

  if (!state) return undefined

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

  if (!state) return undefined

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(`${state.label} 磁盘测速结果\n${resultText}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <WindowModal
      open
      title={`测速 · ${state.label}`}
      themeColor={DISK_UTILITY_THEME}
      scrollBody
      panelClass="disk-utility-benchmark-modal"
      onClose={busy ? undefined : onClose}
      footer={
        <div class="disk-utility-benchmark__footer">
          <button
            type="button"
            class="disk-utility-benchmark__copy-btn"
            disabled={busy || !hasResult}
            onClick={() => void handleCopy()}
          >
            {copied ? '已复制' : '复制结果'}
          </button>
        </div>
      }
      actions={[
        {
          key: 'cancel',
          label: busy ? '停止' : '关闭',
          tone: 'secondary',
          disabled: false,
          onClick: () => {
            if (busy) {
              controller?.abort()
              return
            }
            onClose()
          },
        },
        {
          key: 'run',
          label: '开始测速',
          tone: 'primary',
          disabled: busy,
          onClick: () => {
            if (!controller) return
            onRun(controller.signal)
          },
        },
      ]}
    >
      <p class="window-modal__message">
        将在「{state.label}」创建临时文件并分项测试不同存储路径的速度，测试结束后自动删除。
      </p>

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
