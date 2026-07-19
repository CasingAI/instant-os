import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildScene3dModelPreviewHtml } from '../../assets/3d/build-scene3d-preview-html.ts'
import {
  catalogEntryById,
  formatSizeMeters,
  INSTANT3D_CATALOG,
  INSTANT3D_SOURCE_PACKS,
  placementKindLabel,
  type Instant3dCatalogEntry,
  type Instant3dSourceId,
} from '../../assets/3d/asset-catalog.ts'
import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
import { readDefaultModelFriendlyName } from '../../ai/openai-config.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { analyzeModelVision } from './model-vision-analyze.ts'
import {
  captureModelVisionViews,
  ensureModelVisionCaptureRuntime,
  releaseModelVisionCaptureRuntime,
  yieldForModelVisionGc,
} from './model-vision-capture.ts'
import { shrinkCapturedViews, shrinkImageDataUrl } from './model-vision-shrink.ts'
import {
  clearModelVisionResults,
  deleteModelVisionResult,
  getModelVisionResult,
  getModelVisionSummaryMap,
  migrateModelVisionEmbeddedMedia,
  putModelVisionResult,
} from './model-vision-storage.ts'
import { downloadModelVisionResultsJson } from './model-vision-export.ts'
import {
  MODEL_VISION_CHANGED_EVENT,
  toModelVisionSummary,
  type ModelVisionResultRecord,
  type ModelVisionResultSummary,
  type ModelVisionRowStatus,
} from './model-vision-types.ts'
import { DATA_STORAGE_CHANGED_EVENT } from '../../os/device-data-storage.ts'
import './model-vision.css'

const APP_ID = 'model-vision' as const

type PackFilter = 'all' | Instant3dSourceId
type StatusFilter = 'all' | 'pending' | 'done' | 'error'
type BusyMap = Record<string, ModelVisionRowStatus>

function statusLabel(status: ModelVisionRowStatus): string {
  switch (status) {
    case 'capturing':
      return '多视角截图'
    case 'analyzing':
      return '综合识别'
    case 'done':
      return '已识别'
    case 'error':
      return '失败'
    default:
      return '未识别'
  }
}

function resolveRowStatus(
  modelId: string,
  summaries: Map<string, ModelVisionResultSummary>,
  busy: BusyMap,
): ModelVisionRowStatus {
  const live = busy[modelId]
  if (live) return live
  const record = summaries.get(modelId)
  if (!record) return 'idle'
  if (record.error) return 'error'
  return 'done'
}

function formatOrientation(
  record: Pick<ModelVisionResultRecord, 'orientation'>,
): string {
  const parts: string[] = []
  const { orientation } = record
  if (orientation.placementKind) {
    parts.push(placementKindLabel(orientation.placementKind))
  }
  if (orientation.forward) parts.push(`延伸 ${orientation.forward}`)
  if (orientation.face) parts.push(`正面 ${orientation.face}`)
  if (orientation.back) parts.push(`背面 ${orientation.back}`)
  if (orientation.connects && orientation.connects.length > 0) {
    parts.push(`接口 ${orientation.connects.join('/')}`)
  }
  if (orientation.confidence) parts.push(`置信度 ${orientation.confidence}`)
  return parts.length > 0 ? parts.join('；') : '未解析出朝向字段'
}

async function runOneModel(
  entry: Instant3dCatalogEntry,
  captureHost: HTMLIFrameElement,
  setBusy: (modelId: string, status: ModelVisionRowStatus | undefined) => void,
  options: { silent?: boolean; skipMedia?: boolean } = {},
): Promise<ModelVisionResultRecord> {
  setBusy(entry.id, 'capturing')
  let capture = await captureModelVisionViews(entry.url, captureHost)
  let views = capture.views
  let thumbnailDataUrlRaw = capture.thumbnailDataUrl
  capture = { views: [], thumbnailDataUrl: '' }
  try {
    setBusy(entry.id, 'analyzing')
    const analysis = await analyzeModelVision(entry, views)
    let viewPreviews: Awaited<ReturnType<typeof shrinkCapturedViews>> | undefined
    let thumbnailDataUrl: string | undefined
    if (options.skipMedia) {
      for (const view of views) {
        view.dataUrl = ''
      }
      views = []
      thumbnailDataUrlRaw = ''
    } else {
      viewPreviews = await shrinkCapturedViews(views)
      thumbnailDataUrl = await shrinkImageDataUrl(thumbnailDataUrlRaw, 320, 0.88)
      for (const view of views) {
        view.dataUrl = ''
      }
      views = []
      thumbnailDataUrlRaw = ''
    }
    return await putModelVisionResult(
      {
        modelId: entry.id,
        label: entry.label,
        source: entry.source,
        url: entry.url,
        providerId: analysis.providerId,
        model: analysis.model,
        visualDescription: analysis.visualDescription,
        appearanceNotes: analysis.appearanceNotes,
        orientation: analysis.orientation,
        rawText: analysis.rawText,
        viewPreviews,
        thumbnailDataUrl,
      },
      { silent: options.silent === true, skipMedia: options.skipMedia === true },
    )
  } finally {
    views = []
    thumbnailDataUrlRaw = ''
    setBusy(entry.id, undefined)
  }
}

export function ModelVisionApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const captureRef = useRef<HTMLIFrameElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const abortRef = useRef(false)
  const runningRef = useRef(false)
  const summariesRef = useRef<Map<string, ModelVisionResultSummary>>(new Map())

  const [packFilter, setPackFilter] = useState<PackFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(
    () => INSTANT3D_CATALOG[0]?.id ?? '',
  )
  /** 批量时只用于列表高亮/滚动，不触发 3D 预览与详情大图加载 */
  const [highlightId, setHighlightId] = useState<string>(
    () => INSTANT3D_CATALOG[0]?.id ?? '',
  )
  const [summaries, setSummaries] = useState<Map<string, ModelVisionResultSummary>>(
    () => new Map(),
  )
  const [selectedDetail, setSelectedDetail] = useState<ModelVisionResultRecord>()
  const [busy, setBusyState] = useState<BusyMap>({})
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>()
  const [error, setError] = useState<string>()
  const [visionModelName, setVisionModelName] = useState('图像识别模型')

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  summariesRef.current = summaries
  const listFocusId = batchRunning ? highlightId : selectedId

  const setBusy = (modelId: string, status: ModelVisionRowStatus | undefined) => {
    setBusyState((current) => {
      if (status === undefined) {
        if (!(modelId in current)) return current
        const next = { ...current }
        delete next[modelId]
        return next
      }
      return { ...current, [modelId]: status }
    })
  }

  useEffect(() => {
    setAppWindowTitle(APP_ID, '模型识图')
  }, [setAppWindowTitle])

  useEffect(() => {
    try {
      setVisionModelName(readDefaultModelFriendlyName('vision'))
    } catch {
      setVisionModelName('未配置图像识别模型')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void migrateModelVisionEmbeddedMedia().finally(() => {
      if (cancelled) return
      void getModelVisionSummaryMap().then((map) => {
        if (!cancelled) setSummaries(map)
      })
    })
    const onChanged = () => {
      if (runningRef.current) return
      void getModelVisionSummaryMap().then((map) => {
        if (!cancelled) setSummaries(map)
      })
    }
    window.addEventListener(MODEL_VISION_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(MODEL_VISION_CHANGED_EVENT, onChanged)
      // 关应用时卸掉持久 WebGL，避免上下文一直占着
      if (captureRef.current) {
        releaseModelVisionCaptureRuntime(captureRef.current)
      } else {
        releaseModelVisionCaptureRuntime()
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setSelectedDetail(undefined)
      return
    }
    void getModelVisionResult(selectedId).then((record) => {
      if (!cancelled) setSelectedDetail(record)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    const node = rowRefs.current.get(listFocusId)
    if (!node) return
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [listFocusId, batchProgress?.done])

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return INSTANT3D_CATALOG.filter((entry) => {
      if (packFilter !== 'all' && entry.source !== packFilter) return false
      const status = resolveRowStatus(entry.id, summaries, busy)
      if (statusFilter === 'pending' && status === 'done') return false
      if (statusFilter === 'done' && status !== 'done') return false
      if (statusFilter === 'error' && status !== 'error') return false
      if (!needle) return true
      return (
        entry.id.toLowerCase().includes(needle) ||
        entry.label.toLowerCase().includes(needle) ||
        entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
      )
    })
  }, [busy, packFilter, query, statusFilter, summaries])

  const selectedEntry = catalogEntryById(selectedId)
  const selectedStatus = resolveRowStatus(selectedId, summaries, busy)
  const selectedSummary = selectedId ? summaries.get(selectedId) : undefined
  const detailMatchesSelection = selectedDetail?.modelId === selectedId
  // 批量不落预览图时详情可能稍晚才从库读出；列表摘要已有文字，优先用它展示，避免误报「尚未识别」
  const displayResult = (detailMatchesSelection ? selectedDetail : undefined) ?? selectedSummary
  const displayViewPreviews = detailMatchesSelection ? selectedDetail?.viewPreviews : undefined
  const displayThumbnail = detailMatchesSelection ? selectedDetail?.thumbnailDataUrl : undefined
  const hasDisplayPreviews = Boolean(displayViewPreviews && displayViewPreviews.length > 0)

  const doneCount = useMemo(() => {
    let count = 0
    for (const entry of INSTANT3D_CATALOG) {
      const record = summaries.get(entry.id)
      if (record && !record.error) count += 1
    }
    return count
  }, [summaries])

  useEffect(() => {
    if (!previewRef.current) return
    if (batchRunning) {
      // 批量时卸掉交互预览，防止每个模型都新建 WebGL 场景
      writeHtmlToIframe(previewRef.current, '<!DOCTYPE html><html><body></body></html>')
      return
    }
    if (!selectedEntry) return
    ensureIframeBlankDocument(previewRef.current)
    writeHtmlToIframe(previewRef.current, '<!DOCTYPE html><html><body></body></html>')
    const html = injectScene3dBridge(buildScene3dModelPreviewHtml(selectedEntry.id))
    writeHtmlToIframe(previewRef.current, html)
  }, [selectedEntry?.id, batchRunning])

  const stopBatch = () => {
    abortRef.current = true
  }

  const analyzeSelected = async () => {
    if (!selectedEntry || !captureRef.current || runningRef.current) return
    const existing = summariesRef.current.get(selectedEntry.id)
    if (existing && !existing.error) {
      const ok = window.confirm('该模型已有识别结果。确定要重新识别并覆盖吗？')
      if (!ok) return
    }

    runningRef.current = true
    setError(undefined)
    try {
      await ensureModelVisionCaptureRuntime(captureRef.current)
      const saved = await runOneModel(selectedEntry, captureRef.current, setBusy, {
        silent: false,
        skipMedia: false,
      })
      const summary = toModelVisionSummary(saved)
      setSummaries((current) => {
        const next = new Map(current)
        next.set(summary.modelId, summary)
        return next
      })
      setSelectedDetail(saved)
    } catch (err) {
      const message = err instanceof Error ? err.message : '识别失败'
      setError(message)
      setBusy(selectedEntry.id, undefined)
      await putModelVisionResult(
        {
          modelId: selectedEntry.id,
          label: selectedEntry.label,
          source: selectedEntry.source,
          url: selectedEntry.url,
          providerId: 'unknown',
          model: visionModelName,
          visualDescription: '',
          appearanceNotes: '',
          orientation: {},
          rawText: '',
          error: message,
        },
        { skipMedia: true },
      ).catch(() => undefined)
    } finally {
      runningRef.current = false
    }
  }

  const analyzeBatch = async () => {
    if (!captureRef.current || runningRef.current) return
    const queue = filteredEntries.filter((entry) => {
      const status = resolveRowStatus(entry.id, summariesRef.current, busy)
      return status !== 'done'
    })
    if (queue.length === 0) {
      setError('当前筛选下没有可识别的模型（已成功的不会覆盖）')
      return
    }

    abortRef.current = false
    runningRef.current = true
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: queue.length })
    setError(undefined)

    try {
      await ensureModelVisionCaptureRuntime(captureRef.current)
      for (let index = 0; index < queue.length; index += 1) {
        if (abortRef.current) break
        const entry = queue[index]
        if (!entry) continue

        const latest = summariesRef.current.get(entry.id)
        if (latest && !latest.error) {
          setBatchProgress({ done: index + 1, total: queue.length })
          continue
        }

        setHighlightId(entry.id)
        setBatchProgress({ done: index, total: queue.length })
        try {
          // 批量：静默写库；预览图压缩后落盘。当前选中项立刻带图更新详情。
          const saved = await runOneModel(entry, captureRef.current, setBusy, {
            silent: true,
            skipMedia: false,
          })
          const summary = toModelVisionSummary(saved)
          setSummaries((current) => {
            const next = new Map(current)
            next.set(summary.modelId, summary)
            summariesRef.current = next
            return next
          })
          if (saved.modelId === selectedIdRef.current) {
            setSelectedDetail(saved)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '识别失败'
          setBusy(entry.id, undefined)
          const failedSummary: ModelVisionResultSummary = {
            modelId: entry.id,
            label: entry.label,
            source: entry.source,
            url: entry.url,
            analyzedAt: Date.now(),
            providerId: 'unknown',
            model: visionModelName,
            visualDescription: '',
            appearanceNotes: '',
            orientation: {},
            byteSize: 0,
            error: message,
            hasViewPreviews: false,
          }
          await putModelVisionResult(
            {
              modelId: entry.id,
              label: entry.label,
              source: entry.source,
              url: entry.url,
              providerId: 'unknown',
              model: visionModelName,
              visualDescription: '',
              appearanceNotes: '',
              orientation: {},
              rawText: '',
              error: message,
            },
            { silent: true, skipMedia: true },
          ).catch(() => undefined)
          setSummaries((current) => {
            const next = new Map(current)
            next.set(entry.id, failedSummary)
            summariesRef.current = next
            return next
          })
          setError(`${entry.label}：${message}`)
        }
        setBatchProgress({ done: index + 1, total: queue.length })
        // 每条之间让出主线程，给字符串/解码图一点回收窗口
        await yieldForModelVisionGc()
      }
    } finally {
      runningRef.current = false
      setBatchRunning(false)
      abortRef.current = false
      setBatchProgress(undefined)
      if (captureRef.current) {
        releaseModelVisionCaptureRuntime(captureRef.current)
      }
      // 批量结束后再拉一次轻量摘要，并通知设置里的占用统计
      void getModelVisionSummaryMap().then(setSummaries)
      window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
    }
  }

  const clearSelected = async () => {
    if (!selectedId) return
    await deleteModelVisionResult(selectedId)
    setSelectedDetail(undefined)
  }

  const clearAll = async () => {
    if (!window.confirm('清除全部识别结果？此操作不可撤销。')) return
    await clearModelVisionResults()
    setSelectedDetail(undefined)
  }

  const exportResults = async () => {
    try {
      await downloadModelVisionResultsJson()
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    }
  }

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: '模型识图',
        items: [
          ...aboutAppMenuPrefix('关于模型识图', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏模型识图',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '导出全部结果…',
            onClick: () => void exportResults(),
          },
          {
            type: 'action',
            label: '清除当前结果',
            onClick: () => void clearSelected(),
          },
          {
            type: 'action',
            label: '清除全部结果',
            onClick: () => void clearAll(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出模型识图',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="model-vision-app">
      <header class="model-vision-app__toolbar">
        <span class="model-vision-app__brand">模型识图</span>
        <span class="model-vision-app__hint">
          用视觉模型标注 3D 朝向 · 当前 {visionModelName} · 已完成 {doneCount}/
          {INSTANT3D_CATALOG.length}
          {batchProgress
            ? ` · 批量 ${batchProgress.done}/${batchProgress.total}`
            : ''}
        </span>
        <div class="model-vision-app__actions">
          <button
            type="button"
            class="model-vision-app__btn model-vision-app__btn--primary"
            disabled={batchRunning || !selectedEntry}
            onClick={() => void analyzeSelected()}
          >
            识别当前
          </button>
          <button
            type="button"
            class="model-vision-app__btn"
            disabled={batchRunning}
            onClick={() => void analyzeBatch()}
          >
            批量未完成
          </button>
          <button
            type="button"
            class="model-vision-app__btn"
            disabled={!batchRunning}
            onClick={stopBatch}
          >
            停止
          </button>
          <button
            type="button"
            class="model-vision-app__btn"
            disabled={batchRunning || summaries.size === 0}
            onClick={() => void exportResults()}
          >
            导出
          </button>
        </div>
      </header>

      <div class="model-vision-app__body">
        <aside class="model-vision-app__sidebar">
          <div class="model-vision-app__filters">
            <div class="model-vision-app__filters-row">
              <select
                class="model-vision-app__select"
                value={packFilter}
                onChange={(event) =>
                  setPackFilter((event.currentTarget as HTMLSelectElement).value as PackFilter)
                }
              >
                <option value="all">全部素材包</option>
                {INSTANT3D_SOURCE_PACKS.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.title}
                  </option>
                ))}
              </select>
              <select
                class="model-vision-app__select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    (event.currentTarget as HTMLSelectElement).value as StatusFilter,
                  )
                }
              >
                <option value="all">全部状态</option>
                <option value="pending">未完成</option>
                <option value="done">已识别</option>
                <option value="error">失败</option>
              </select>
            </div>
            <input
              class="model-vision-app__search"
              type="search"
              placeholder="搜索名称 / modelId / 关键词（如 road）"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            />
            <div class="model-vision-app__stats">列表 {filteredEntries.length} 个</div>
          </div>

          <div class="model-vision-app__list" role="listbox" aria-label="模型列表">
            {filteredEntries.map((entry) => {
              const status = resolveRowStatus(entry.id, summaries, busy)
              const active = entry.id === listFocusId
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  class={`model-vision-app__row${active ? ' model-vision-app__row--active' : ''}`}
                  ref={(node) => {
                    if (node) rowRefs.current.set(entry.id, node)
                    else rowRefs.current.delete(entry.id)
                  }}
                  onClick={() => {
                    setSelectedId(entry.id)
                    setHighlightId(entry.id)
                  }}
                >
                  <span
                    class={[
                      'model-vision-app__status-dot',
                      status === 'done' ? 'model-vision-app__status-dot--done' : '',
                      status === 'error' ? 'model-vision-app__status-dot--error' : '',
                      status === 'capturing' || status === 'analyzing'
                        ? 'model-vision-app__status-dot--busy'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                  <span>
                    <div class="model-vision-app__row-title">{entry.label}</div>
                    <div class="model-vision-app__row-meta">{entry.id}</div>
                  </span>
                  <span class="model-vision-app__row-badge">{statusLabel(status)}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <main class="model-vision-app__main">
          <div class="model-vision-app__preview-float" aria-label="3D 预览">
            <div class="model-vision-app__preview-float-bar">3D 预览</div>
            <div class="model-vision-app__preview-float-body">
              <iframe
                ref={previewRef}
                class="model-vision-app__preview-frame"
                title="模型预览"
                sandbox="allow-scripts allow-same-origin"
                src="about:blank"
              />
            </div>
          </div>
          <iframe
            ref={captureRef}
            class="model-vision-app__capture-frame"
            title="离屏截图"
            sandbox="allow-scripts allow-same-origin"
            src="about:blank"
          />

          <div class="model-vision-app__detail">
            {!selectedEntry ? (
              <div class="model-vision-app__empty">请选择一个模型</div>
            ) : (
              <>
                <h2 class="model-vision-app__detail-title">{selectedEntry.label}</h2>
                <p class="model-vision-app__detail-sub">
                  {selectedEntry.id} · {formatSizeMeters(selectedEntry.appearance.sizeMeters)} ·{' '}
                  {statusLabel(selectedStatus)}
                </p>

                {error && <p class="model-vision-app__error">{error}</p>}

                <section class="model-vision-app__section">
                  <h3 class="model-vision-app__section-title">目录现有描述</h3>
                  <div class="model-vision-app__card">
                    <p>{selectedEntry.appearance.description}</p>
                    {selectedEntry.appearance.placement.kind !== 'free' && (
                      <p>
                        摆放：{placementKindLabel(selectedEntry.appearance.placement.kind)} ·{' '}
                        {selectedEntry.appearance.placement.hint}
                      </p>
                    )}
                  </div>
                </section>

                <section class="model-vision-app__section">
                  <h3 class="model-vision-app__section-title">视觉识别结果</h3>
                  {!displayResult ? (
                    <div class="model-vision-app__card">
                      <p>尚未识别。点「识别当前」或「批量识别」开始。</p>
                    </div>
                  ) : displayResult.error ? (
                    <div class="model-vision-app__card">
                      <p class="model-vision-app__error">{displayResult.error}</p>
                    </div>
                  ) : (
                    <div class="model-vision-app__card">
                      {hasDisplayPreviews && displayViewPreviews ? (
                        <div class="model-vision-app__view-grid">
                          {displayViewPreviews.map((view) => (
                            <figure key={view.id} class="model-vision-app__view-card">
                              <img
                                src={view.dataUrl}
                                alt={`${selectedEntry.label} · ${view.label}`}
                              />
                              <figcaption>{view.label}</figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : (
                        displayThumbnail && (
                          <p>
                            <img
                              class="model-vision-app__thumb"
                              src={displayThumbnail}
                              alt={`${selectedEntry.label} 识别缩略图`}
                            />
                          </p>
                        )
                      )}
                      {hasDisplayPreviews && displayViewPreviews ? (
                        <p class="model-vision-app__view-note">
                          已用 {displayViewPreviews.length} 个视角综合识别
                        </p>
                      ) : !detailMatchesSelection && selectedSummary && !selectedSummary.error ? (
                        <p class="model-vision-app__view-note">正在加载预览…</p>
                      ) : undefined}
                      <p>{displayResult.visualDescription}</p>
                      {displayResult.appearanceNotes && (
                        <p>{displayResult.appearanceNotes}</p>
                      )}
                      <dl class="model-vision-app__dl">
                        <dt>朝向</dt>
                        <dd>{formatOrientation(displayResult)}</dd>
                        {displayResult.orientation.axisLandmarks && (
                          <>
                            <dt>轴对照</dt>
                            <dd>{displayResult.orientation.axisLandmarks}</dd>
                          </>
                        )}
                        {displayResult.orientation.placementHint && (
                          <>
                            <dt>默认姿态</dt>
                            <dd>{displayResult.orientation.placementHint}</dd>
                          </>
                        )}
                        {displayResult.orientation.sceneUseHint && (
                          <>
                            <dt>摆放建议</dt>
                            <dd>{displayResult.orientation.sceneUseHint}</dd>
                          </>
                        )}
                        <dt>模型</dt>
                        <dd>
                          {displayResult.model} · {displayResult.providerId}
                        </dd>
                        <dt>时间</dt>
                        <dd>{new Date(displayResult.analyzedAt).toLocaleString()}</dd>
                      </dl>
                    </div>
                  )}
                </section>

                {selectedDetail?.rawText && !selectedDetail.error && (
                  <section class="model-vision-app__section">
                    <h3 class="model-vision-app__section-title">原始返回</h3>
                    <pre class="model-vision-app__raw">{selectedDetail.rawText}</pre>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
