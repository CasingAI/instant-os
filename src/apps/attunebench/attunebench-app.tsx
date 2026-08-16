import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { usePlaygroundTextModels } from '../llm-playground/llm-playground-api.ts'
import {
  SUBSETS,
  loadSubset,
  type SubsetId,
} from './dataset.ts'
import {
  createAttuneBenchRun,
  deleteAttuneBenchRun,
  getCompletedOutputs,
  readAttuneBenchStore,
  updateRunStatus,
  type AttuneBenchStore,
  type RunStatus,
} from './storage.ts'
import { runBatch } from './batched-runner.ts'
import { MODES, MODE_LABELS, type EvalMode } from './constants.ts'
import type { ConversationData, EMRunOutput } from './types.ts'
import { AttuneBenchReportView, estimateRunCost } from './report.tsx'
import './attunebench.css'

export function AttuneBenchApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const models = usePlaygroundTextModels()

  const [selectedModelRefKey, setSelectedModelRefKey] = useState<string>('')
  const [selectedSubset, setSelectedSubset] = useState<SubsetId>('Subsample20')
  const [selectedModes, setSelectedModes] = useState<EvalMode[]>(['default'])
  const [useJudge, setUseJudge] = useState(false)
  const [judgeModelRefKey, setJudgeModelRefKey] = useState<string>('')

  const [loadedConversations, setLoadedConversations] = useState<ConversationData[]>([])
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 })
  const [loading, setLoading] = useState(false)

  const [completedOutputs, setCompletedOutputs] = useState<EMRunOutput[]>([])
  const [outputsLoading, setOutputsLoading] = useState(false)

  const [store, setStore] = useState<AttuneBenchStore>(() => readAttuneBenchStore())
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!selectedModelRefKey && models.length > 0) {
      const first = models[0]
      setSelectedModelRefKey(`${first.providerEntryId}:${first.modelId}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length])

  // 使用自定义 judge 时默认选第一个模型
  const effectiveJudgeRefKey = useJudge
    ? judgeModelRefKey || selectedModelRefKey
    : null

  const refreshStore = useCallback(() => {
    const latest = readAttuneBenchStore()
    setStore(latest)
    return latest
  }, [])

  const handleLoadData = async () => {
    setLoading(true)
    setLoadedConversations([])
    setLoadProgress({ loaded: 0, total: 0 })
    try {
      const conversations = await loadSubset(selectedSubset, (loaded, total) => {
        setLoadProgress({ loaded, total })
      })
      setLoadedConversations(conversations)
      if (conversations.length > 0) {
        setRunMessage(`已加载 ${conversations.length} 条对话。`)
      }
    } catch (error) {
      setRunMessage(`数据加载失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const costEstimate = useMemo(
    () => estimateRunCost(loadedConversations, selectedModes, useJudge),
    [loadedConversations, selectedModes, useJudge],
  )

  const handleStartRun = async () => {
    if (!selectedModelRefKey || !loadedConversations.length) return
    const modes = selectedModes.length > 0 ? selectedModes : ['default']

    // 每个模型创建一个 run（断点续跑粒度 = 模型×对话×模式）
    const { run } = createAttuneBenchRun({
      subset: selectedSubset,
      modelRefKey: selectedModelRefKey,
      modes: modes.map((m) => m as string),
      judgeModelRefKey: effectiveJudgeRefKey,
      conversationIds: loadedConversations.map((c) => c.conversationId),
    })
    refreshStore()
    setActiveRunId(run.id)

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setRunMessage('评测开始…')

    await runBatch({
      runId: run.id,
      conversations: loadedConversations,
      config: {
        modelRefKey: selectedModelRefKey,
        modes: modes.map((m) => m as string),
        judgeModelRefKey: effectiveJudgeRefKey,
        concurrency: 2,
      },
      signal: controller.signal,
      hooks: {
        onCellStart: (cell, index, total) => {
          setRunMessage(`正在评测：${cell.mode} 模式 · ${index + 1}/${total}`)
        },
        onCellDone: (cell, index) => {
          setRunMessage(`完成一个单元：${cell.mode}（${index + 1}）`)
          refreshStore()
        },
        onCellError: (cell, error) => {
          setRunMessage(`单元失败：${cell.mode} — ${error}`)
          refreshStore()
        },
      },
    })

    setRunning(false)
    abortRef.current = null
    refreshStore()
  }

  const handlePause = () => {
    if (activeRunId) {
      updateRunStatus(activeRunId, 'paused')
    }
    abortRef.current?.abort()
    setRunning(false)
    setRunMessage('已暂停，进度已保存，可随时继续。')
    refreshStore()
  }

  const handleResume = async () => {
    if (!activeRunId) return
    // 以持久化到设备存储的最新的 run 配置为准，避免闭包状态过期
    const latest = refreshStore()
    const run = latest.runs[activeRunId]
    if (!run) {
      setRunMessage('未找到该次评测记录，已清除。')
      setActiveRunId(null)
      return
    }
    if (!loadedConversations.length) {
      setRunMessage('请先重新「下载数据」以恢复对话上下文，再点击继续评测。')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setRunMessage('继续评测…')

    await runBatch({
      runId: activeRunId,
      conversations: loadedConversations,
      config: {
        modelRefKey: run.config.modelRefKey,
        modes: run.config.modes,
        judgeModelRefKey: run.config.judgeModelRefKey,
        concurrency: 2,
      },
      signal: controller.signal,
      hooks: {
        onCellStart: (cell, index, total) => {
          setRunMessage(`续跑：${cell.mode} · ${index + 1}/${total}`)
        },
        onCellDone: () => refreshStore(),
        onCellError: (cell, error) => {
          setRunMessage(`单元失败：${cell.mode} — ${error}`)
          refreshStore()
        },
      },
    })
    setRunning(false)
    abortRef.current = null
    refreshStore()
  }

  const handleClearRun = () => {
    if (activeRunId) {
      deleteAttuneBenchRun(activeRunId)
    }
    setActiveRunId(null)
    setRunMessage('')
    refreshStore()
  }

  // 从 IndexedDB 加载当前 run 的已完成结果（异步）
  useEffect(() => {
    if (!activeRunId) {
      setCompletedOutputs([])
      setOutputsLoading(false)
      return
    }
    let cancelled = false
    setOutputsLoading(true)
    getCompletedOutputs(activeRunId)
      .then((outputs) => {
        if (!cancelled) setCompletedOutputs(outputs)
      })
      .catch(() => {
        if (!cancelled) setCompletedOutputs([])
      })
      .finally(() => {
        if (!cancelled) setOutputsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeRunId, store])

  const activeRun = activeRunId ? store.runs[activeRunId] : undefined
  const runStatus: RunStatus = activeRun?.status ?? 'idle'

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'attunebench' && !window.minimized)
    return [
      {
        label: '评测',
        items: [
          ...aboutAppMenuPrefix('关于 评测', () => showBuiltinAbout('attunebench')),
          {
            type: 'action',
            label: '隐藏 评测',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 评测',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('attunebench'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar('attunebench', menuBar)

  const groupedModels = useMemo(() => {
    const groups: Array<{ label: string; models: typeof models }> = []
    const labelCounts = new Map<string, number>()
    for (const model of models) {
      let label: string = model.providerId
      const count = labelCounts.get(label) ?? 0
      labelCounts.set(label, count + 1)
      const groupLabel = count > 0 ? `${label} ${count + 1}` : label
      let group = groups.find((item) => item.label === groupLabel)
      if (!group) {
        group = { label: groupLabel, models: [] }
        groups.push(group)
      }
      group.models.push(model)
    }
    return groups
  }, [models])

  const toggleMode = (mode: EvalMode) => {
    setSelectedModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode],
    )
  }

  return (
    <div className="attunebench">
      <div className="attunebench__main">
        <h1 className="attunebench__heading">AI 情商评测</h1>
        <p className="attunebench__sub">
          基于 AttuneBench 基准，用真实多轮对话评测模型的情绪智能。评测可随时中断、从断点继续。
        </p>

        <section className="attunebench__section">
          <h2 className="attunebench__section-title">配置</h2>

          <div className="attunebench__field" data-label="数据集">
            <select
              value={selectedSubset}
              onChange={(e) => setSelectedSubset((e.currentTarget as HTMLSelectElement).value as SubsetId)}
              disabled={running}
            >
              {SUBSETS.map((subset) => (
                <option key={subset.id} value={subset.id}>
                  {subset.label}（{subset.count} 条对话）
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void handleLoadData()} disabled={loading || running}>
              {loading ? '下载中…' : loadedConversations.length ? `重新下载（已载 ${loadedConversations.length}）` : '下载数据'}
            </button>
          </div>
          {loading && (
            <p className="attunebench__hint">
              下载进度：{loadProgress.loaded}/{loadProgress.total || '—'}
            </p>
          )}

          <div className="attunebench__field" data-label="模型">
            <select
              value={selectedModelRefKey}
              onChange={(e) => setSelectedModelRefKey((e.currentTarget as HTMLSelectElement).value)}
              disabled={running || models.length === 0}
            >
              {groupedModels.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((model) => {
                    const refKey = `${model.providerEntryId}:${model.modelId}`
                    return (
                      <option key={refKey} value={refKey}>
                        {model.name}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="attunebench__field attunebench__field--modes" data-label="运行模式">
            <div className="attunebench__modes">
              {MODES.map((mode) => (
                <label key={mode}>
                  <input
                    type="checkbox"
                    checked={selectedModes.includes(mode)}
                    onChange={() => toggleMode(mode)}
                    disabled={running}
                  />
                  <span>{MODE_LABELS[mode]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="attunebench__field" data-label="草稿裁判">
            <label className="attunebench__judge">
              <input
                type="checkbox"
                checked={useJudge}
                onChange={(e) => setUseJudge((e.currentTarget as HTMLInputElement).checked)}
                disabled={running}
              />
              <span>使用独立裁判模型评估草稿质量（可选，恢复默认关闭）</span>
            </label>
            {useJudge && (
              <div>
                <select
                  value={judgeModelRefKey}
                  onChange={(e) => setJudgeModelRefKey((e.currentTarget as HTMLSelectElement).value)}
                  disabled={running}
                >
                  {models.map((model) => {
                    const refKey = `${model.providerEntryId}:${model.modelId}`
                    return (
                      <option key={refKey} value={refKey}>
                        {model.name}
                      </option>
                    )
                  })}
                </select>
                {!judgeModelRefKey && selectedModelRefKey && (
                  <p className="attunebench__hint">将使用被评测模型自身作为裁判。</p>
                )}
              </div>
            )}
          </div>

          {loadedConversations.length > 0 && (
            <p className="attunebench__cost">
              已载 {loadedConversations.length} 条对话，每对话预计约 {costEstimate.callsPerConversation} 次
              LLM 调用，合计约 {costEstimate.totalCalls} 次。
            </p>
          )}
        </section>

        <section className="attunebench__actions">
          <button
            type="button"
            className="attunebench__btn attunebench__btn--primary"
            onClick={() => void handleStartRun()}
            disabled={running || !selectedModelRefKey || loadedConversations.length === 0}
          >
            开始评测
          </button>
          {running ? (
            <button type="button" className="attunebench__btn" onClick={handlePause}>
              暂停/中断
            </button>
          ) : (
            activeRun && runStatus === 'paused' && (
              <button type="button" className="attunebench__btn" onClick={() => void handleResume()}>
                继续评测
              </button>
            )
          )}
          {activeRun && (
            <button type="button" className="attunebench__btn" onClick={handleClearRun}>
              清除本次
            </button>
          )}
        </section>

        {runMessage && <p className="attunebench__status">{runMessage}</p>}

        {activeRun && (runStatus === 'completed' || completedOutputs.length > 0) && (
          <section className="attunebench__report-area">
            <h2 className="attunebench__section-title">报告</h2>
            {outputsLoading ? (
              <p className="attunebench__hint">加载中…</p>
            ) : (
              <AttuneBenchReportView
                conversations={loadedConversations}
                outputs={completedOutputs}
                modelRefKey={activeRun.config.modelRefKey}
              />
            )}
          </section>
        )}

        {!activeRun && loadedConversations.length === 0 && !loading && (
          <p className="attunebench__empty">
            请先选择数据集并「下载数据」，再开始评测。
          </p>
        )}
      </div>
    </div>
  )
}
