import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { flushSync } from 'preact/compat'
import type { LiveTokenUsage } from '../browser/estimate-token-usage.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { injectInstant3dBridge } from '../../assets/3d/inject-instant3d-bridge.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
import {
  formatScene3dOutboundPrompt,
  generateScene3dHtmlStreaming,
  SCENE3D_DEFAULT_PROMPT,
  SCENE3D_SAMPLE_PROMPTS,
  type Scene3dGenerationPhase,
  type Scene3dGenerationUpdate,
} from './generate-scene3d-stream.ts'
import {
  loadScene3dLabPrefs,
  saveScene3dLabRuntimeMode,
  type Scene3dRuntimeMode,
} from './scene3d-lab-prefs.ts'
import {
  clearScene3dLabArchives,
  defaultArchiveTitle,
  loadScene3dLabArchives,
  removeScene3dLabArchive,
  saveScene3dLabArchive,
  type Scene3dLabArchive,
} from './scene3d-lab-storage.ts'
import './scene3d-lab.css'

type InspectorTab = 'code' | 'raw' | 'prompt' | 'archives' | 'tokens'

function phaseLabel(
  phase: Scene3dGenerationPhase | undefined,
  progress: number,
  streamConnected: boolean,
): string {
  if (phase === 'waiting') {
    return streamConnected ? '已连接，等待首个 token…' : '连接 AI…'
  }
  if (phase === 'generating') {
    return `生成中 ${Math.round(progress)}%`
  }
  return '就绪'
}

function formatUsageSummary(usage: LiveTokenUsage | undefined): string {
  if (!usage) {
    return 'Token —'
  }
  const suffix = usage.estimated ? '（估算）' : ''
  return `↑${formatTokenCount(usage.promptTokens)} ↓${formatTokenCount(usage.completionTokens)} Σ${formatTokenCount(usage.totalTokens)}${suffix}`
}

const EMPTY_USAGE: LiveTokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimated: true,
}

export function Scene3dLabApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const [prompt, setPrompt] = useState<string>(SCENE3D_DEFAULT_PROMPT)
  const [hasPreview, setHasPreview] = useState(false)
  const [htmlCode, setHtmlCode] = useState('')
  const [rawText, setRawText] = useState('')
  const [usage, setUsage] = useState<LiveTokenUsage>(EMPTY_USAGE)
  const [codeDirty, setCodeDirty] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('code')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<Scene3dGenerationPhase | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [archiveTitle, setArchiveTitle] = useState('')
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [activeArchiveId, setActiveArchiveId] = useState<string | undefined>()
  const [runtimeMode, setRuntimeMode] = useState<Scene3dRuntimeMode>(
    () => loadScene3dLabPrefs().runtimeMode,
  )
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const codeEditorRef = useRef<HTMLTextAreaElement>(null)
  const rawEditorRef = useRef<HTMLTextAreaElement>(null)
  const outboundPrompt = useMemo(
    () => formatScene3dOutboundPrompt(prompt, runtimeMode),
    [prompt, runtimeMode],
  )
  const archives = useMemo(() => loadScene3dLabArchives(), [archiveRevision])

  useEffect(() => {
    ensureIframeBlankDocument(iframeRef.current)
  }, [])

  const applyStreamUpdate = useCallback((update: Scene3dGenerationUpdate) => {
    flushSync(() => {
      if (update.streamConnected) {
        setStreamConnected(true)
      }
      setPhase(update.phase)
      setProgress(update.progress)
      setRawText(update.rawText)
      if (!codeDirty) {
        setHtmlCode(update.html)
      }
      setUsage(update.usage)
      if (update.html && !codeDirty) {
        setCodeDirty(false)
      }
    })

    if (rawEditorRef.current) {
      rawEditorRef.current.value = update.rawText
    }
    if (codeEditorRef.current && update.html && !codeDirty) {
      codeEditorRef.current.value = update.html
    }
  }, [codeDirty])

  useEffect(() => {
    setAppWindowTitle('scene3d-lab', '3D 实验室')
  }, [setAppWindowTitle])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'scene3d-lab' && !window.minimized)

    return [
      {
        label: '3D 实验室',
        items: [
          ...aboutAppMenuPrefix('关于 3D 实验室', () => showBuiltinAbout('scene3d-lab')),
          {
            type: 'action',
            label: inspectorOpen ? '隐藏调试面板' : '显示调试面板',
            onClick: () => setInspectorOpen((open) => !open),
          },
          {
            type: 'action',
            label: '存档当前场景',
            disabled: !htmlCode.trim(),
            onClick: () => {
              setInspectorOpen(true)
              setInspectorTab('archives')
              setArchiveTitle((current) => current || defaultArchiveTitle(prompt))
            },
          },
          {
            type: 'action',
            label: '隐藏 3D 实验室',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 3D 实验室',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('scene3d-lab'),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, htmlCode, inspectorOpen, minimizeWindow, prompt, showBuiltinAbout, windows])

  useAppMenuBar('scene3d-lab', menuBar)

  const applyPreview = useCallback((html: string) => {
    const trimmed = html.trim()
    if (!trimmed) {
      setError('HTML 不能为空')
      return
    }
    setError(undefined)
    const bridged = injectInstant3dBridge(trimmed)
    const wrote = writeHtmlToIframe(iframeRef.current, bridged)
    if (!wrote) {
      setError('无法写入预览 iframe')
      return
    }
    setHasPreview(true)
    setCodeDirty(false)
  }, [])

  const onApplyCode = useCallback(() => {
    applyPreview(htmlCode)
  }, [applyPreview, htmlCode])

  const loadArchive = useCallback(
    (archive: Scene3dLabArchive) => {
      setPrompt(archive.prompt)
      setHtmlCode(archive.html)
      setRawText(archive.rawText)
      setUsage(archive.usage)
      setCodeDirty(false)
      setActiveArchiveId(archive.id)
      setError(undefined)
      applyPreview(archive.html)
      if (codeEditorRef.current) {
        codeEditorRef.current.value = archive.html
      }
      if (rawEditorRef.current) {
        rawEditorRef.current.value = archive.rawText
      }
    },
    [applyPreview],
  )

  const onSaveArchive = useCallback(() => {
    const saved = saveScene3dLabArchive({
      title: archiveTitle,
      prompt,
      html: htmlCode,
      rawText,
      usage,
    })
    if (!saved) {
      setError('存档失败：HTML 为空或设备存储空间不足')
      return
    }
    setArchiveRevision((value) => value + 1)
    setActiveArchiveId(saved.id)
    setArchiveTitle(saved.title)
    setError(undefined)
    setInspectorOpen(true)
    setInspectorTab('archives')
  }, [archiveTitle, htmlCode, prompt, rawText, usage])

  const onGenerate = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || generating) {
      return
    }

    setGenerating(true)
    setError(undefined)
    setPhase('waiting')
    setStreamConnected(false)
    setProgress(0)
    setRawText('')
    setActiveArchiveId(undefined)
    setInspectorTab('raw')

    try {
      const result = await generateScene3dHtmlStreaming(trimmed, applyStreamUpdate, { runtimeMode })
      setHtmlCode(result.html)
      setRawText(result.rawText)
      setUsage(result.usage)
      setArchiveTitle(defaultArchiveTitle(trimmed))
      applyPreview(result.html)
      setInspectorTab('code')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '生成失败'
      setError(message)
    } finally {
      setGenerating(false)
      setStreamConnected(false)
      setPhase(undefined)
    }
  }, [applyPreview, applyStreamUpdate, generating, prompt, runtimeMode])

  const onRuntimeModeChange = useCallback((mode: Scene3dRuntimeMode) => {
    setRuntimeMode(mode)
    saveScene3dLabRuntimeMode(mode)
  }, [])

  useEffect(() => {
    const editor = inspectorTab === 'code' ? codeEditorRef.current : rawEditorRef.current
    if (!editor || !generating) {
      return
    }
    editor.scrollTop = editor.scrollHeight
  }, [htmlCode, inspectorTab, generating, rawText])

  return (
    <div class="scene3d-lab">
      <div class="scene3d-lab__toolbar">
        <div class="scene3d-lab__toolbar-main">
          <textarea
            id="scene3d-lab-prompt"
            class="scene3d-lab__prompt"
            rows={1}
            aria-label="场景提示词"
            value={prompt}
            onInput={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)}
            placeholder="描述 3D 场景，例如：客厅里有沙发、茶几和落地灯…"
          />
          <div class="scene3d-lab__actions">
            <button type="button" class="scene3d-lab__generate" disabled={generating} onClick={onGenerate}>
              {generating ? '生成中…' : '生成'}
            </button>
            <button
              type="button"
              class="scene3d-lab__secondary"
              disabled={!htmlCode.trim() || generating}
              onClick={onApplyCode}
            >
              {codeDirty ? '应用' : '重载'}
            </button>
            <button
              type="button"
              class="scene3d-lab__secondary"
              disabled={!htmlCode.trim() || generating}
              onClick={() => {
                setInspectorOpen(true)
                setInspectorTab('archives')
                setArchiveTitle((current) => current || defaultArchiveTitle(prompt))
              }}
            >
              存档
            </button>
            <button
              type="button"
              class="scene3d-lab__ghost"
              onClick={() => setInspectorOpen((open) => !open)}
            >
              {inspectorOpen ? '收起' : '调试'}
            </button>
          </div>
          <div class="scene3d-lab__meta">
            <span class="scene3d-lab__status">{phaseLabel(phase, progress, streamConnected)}</span>
            <span class="scene3d-lab__meta-sep" aria-hidden="true">
              ·
            </span>
            <span class="scene3d-lab__tokens">{formatUsageSummary(usage)}</span>
          </div>
        </div>
        <div class="scene3d-lab__toolbar-secondary">
          <div class="scene3d-lab__runtime-mode" role="group" aria-label="3D 运行时">
            <span class="scene3d-lab__runtime-label">运行时</span>
            <button
              type="button"
              class={`scene3d-lab__runtime-option${runtimeMode === 'instant3d' ? ' scene3d-lab__runtime-option--active' : ''}`}
              onClick={() => onRuntimeModeChange('instant3d')}
            >
              Instant3D
            </button>
            <button
              type="button"
              class={`scene3d-lab__runtime-option${runtimeMode === 'threejs' ? ' scene3d-lab__runtime-option--active' : ''}`}
              onClick={() => onRuntimeModeChange('threejs')}
            >
              Three.js
            </button>
          </div>
          <details class="scene3d-lab__samples-wrap">
            <summary>示例提示词</summary>
            <div class="scene3d-lab__samples">
              {SCENE3D_SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  class="scene3d-lab__sample"
                  onClick={() => setPrompt(sample)}
                >
                  {sample.slice(0, 18)}…
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>

      {error && <p class="scene3d-lab__error">{error}</p>}

      <div class={`scene3d-lab__body${inspectorOpen ? '' : ' scene3d-lab__body--preview-only'}`}>
        <div class="scene3d-lab__preview">
          {!hasPreview && !generating && (
            <div class="scene3d-lab__empty">输入提示词并点击「生成 3D 场景」开始测试</div>
          )}
          {generating && !hasPreview && (
            <div class="scene3d-lab__overlay">{phaseLabel(phase, progress, streamConnected)}</div>
          )}
          <iframe
            ref={iframeRef}
            class={`scene3d-lab__frame${hasPreview ? '' : ' scene3d-lab__frame--hidden'}`}
            title="3D 场景预览"
            sandbox="allow-scripts allow-same-origin"
            src="about:blank"
          />
        </div>

        {inspectorOpen && (
          <aside class="scene3d-lab__inspector">
            <div class="scene3d-lab__inspector-tabs">
              <button
                type="button"
                class={`scene3d-lab__tab${inspectorTab === 'code' ? ' scene3d-lab__tab--active' : ''}`}
                onClick={() => setInspectorTab('code')}
              >
                代码{codeDirty ? ' •' : ''}
              </button>
              <button
                type="button"
                class={`scene3d-lab__tab${inspectorTab === 'raw' ? ' scene3d-lab__tab--active' : ''}`}
                onClick={() => setInspectorTab('raw')}
              >
                原始输出
              </button>
              <button
                type="button"
                class={`scene3d-lab__tab${inspectorTab === 'prompt' ? ' scene3d-lab__tab--active' : ''}`}
                onClick={() => setInspectorTab('prompt')}
              >
                提示词
              </button>
              <button
                type="button"
                class={`scene3d-lab__tab${inspectorTab === 'archives' ? ' scene3d-lab__tab--active' : ''}`}
                onClick={() => setInspectorTab('archives')}
              >
                存档{archives.length > 0 ? ` (${archives.length})` : ''}
              </button>
              <button
                type="button"
                class={`scene3d-lab__tab${inspectorTab === 'tokens' ? ' scene3d-lab__tab--active' : ''}`}
                onClick={() => setInspectorTab('tokens')}
              >
                Token
              </button>
            </div>

            <div class="scene3d-lab__inspector-body">
              <div class="scene3d-lab__panel" hidden={inspectorTab !== 'code'}>
                <div class="scene3d-lab__panel-toolbar">
                  <span>{codeDirty ? '已修改，尚未应用到预览' : `${htmlCode.length.toLocaleString('zh-CN')} 字符`}</span>
                  <button
                    type="button"
                    class="scene3d-lab__panel-action"
                    disabled={!htmlCode.trim() || generating}
                    onClick={onApplyCode}
                  >
                    应用预览
                  </button>
                </div>
                <textarea
                  ref={codeEditorRef}
                  class="scene3d-lab__editor"
                  value={htmlCode}
                  spellcheck={false}
                  onInput={(event) => {
                    setHtmlCode((event.currentTarget as HTMLTextAreaElement).value)
                    setCodeDirty(true)
                  }}
                  placeholder="生成后将显示提取的 HTML，可直接编辑后点击「应用预览」"
                />
              </div>

              <div class="scene3d-lab__panel" hidden={inspectorTab !== 'raw'}>
                <div class="scene3d-lab__panel-toolbar">
                  <span>
                    {rawText.length > 0
                      ? `${rawText.length.toLocaleString('zh-CN')} 字符（含 markdown 围栏）`
                      : streamConnected
                        ? '已连接，等待首个 token…'
                        : '等待连接…'}
                  </span>
                </div>
                <textarea
                  ref={rawEditorRef}
                  class="scene3d-lab__editor scene3d-lab__editor--readonly"
                  value={rawText}
                  readOnly
                  spellcheck={false}
                  placeholder="AI 流式原始回复将显示在这里"
                />
              </div>

              <div class="scene3d-lab__panel" hidden={inspectorTab !== 'prompt'}>
                <div class="scene3d-lab__panel-toolbar">
                  <span>{outboundPrompt.length.toLocaleString('zh-CN')} 字符 · system + user</span>
                </div>
                <textarea
                  class="scene3d-lab__editor scene3d-lab__editor--readonly"
                  value={outboundPrompt}
                  readOnly
                  spellcheck={false}
                  aria-label="发送给 AI 的完整提示词"
                />
              </div>

              <div class="scene3d-lab__panel scene3d-lab__panel--archives" hidden={inspectorTab !== 'archives'}>
                <div class="scene3d-lab__panel-toolbar">
                  <span>已保存 {archives.length} 个场景</span>
                  {archives.length > 0 && (
                    <button
                      type="button"
                      class="scene3d-lab__panel-action scene3d-lab__panel-action--danger"
                      onClick={() => {
                        clearScene3dLabArchives()
                        setArchiveRevision((value) => value + 1)
                        setActiveArchiveId(undefined)
                      }}
                    >
                      清空
                    </button>
                  )}
                </div>
                <div class="scene3d-lab__archive-save">
                  <input
                    class="scene3d-lab__archive-title"
                    type="text"
                    value={archiveTitle}
                    placeholder="存档标题"
                    onInput={(event) =>
                      setArchiveTitle((event.currentTarget as HTMLInputElement).value)
                    }
                  />
                  <button
                    type="button"
                    class="scene3d-lab__panel-action"
                    disabled={!htmlCode.trim() || generating}
                    onClick={onSaveArchive}
                  >
                    保存当前
                  </button>
                </div>
                <div class="scene3d-lab__archive-list">
                  {archives.length === 0 ? (
                    <p class="scene3d-lab__archive-empty">暂无存档。生成场景后可保存提示词、代码与预览。</p>
                  ) : (
                    archives.map((archive) => (
                      <div
                        key={archive.id}
                        class={`scene3d-lab__archive-item${activeArchiveId === archive.id ? ' scene3d-lab__archive-item--active' : ''}`}
                      >
                        <button
                          type="button"
                          class="scene3d-lab__archive-load"
                          onClick={() => loadArchive(archive)}
                        >
                          <span class="scene3d-lab__archive-name">{archive.title}</span>
                          <span class="scene3d-lab__archive-meta">
                            {new Date(archive.savedAt).toLocaleString('zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {' · '}
                            {formatTokenCount(archive.usage.totalTokens)} tokens
                          </span>
                          <span class="scene3d-lab__archive-prompt">{archive.prompt}</span>
                        </button>
                        <button
                          type="button"
                          class="scene3d-lab__archive-delete"
                          aria-label={`删除存档 ${archive.title}`}
                          onClick={() => {
                            removeScene3dLabArchive(archive.id)
                            setArchiveRevision((value) => value + 1)
                            if (activeArchiveId === archive.id) {
                              setActiveArchiveId(undefined)
                            }
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div class="scene3d-lab__panel scene3d-lab__panel--tokens" hidden={inspectorTab !== 'tokens'}>
                <div class="scene3d-lab__panel-toolbar">
                  <span>本次生成 Token 统计</span>
                </div>
                <div class="scene3d-lab__token-panel">
                  <dl class="scene3d-lab__token-stats">
                    <div>
                      <dt>输入 Token</dt>
                      <dd>{formatTokenCount(usage.promptTokens)}</dd>
                    </div>
                    <div>
                      <dt>输出 Token</dt>
                      <dd>{formatTokenCount(usage.completionTokens)}</dd>
                    </div>
                    <div>
                      <dt>合计</dt>
                      <dd>{formatTokenCount(usage.totalTokens)}</dd>
                    </div>
                    <div>
                      <dt>数据来源</dt>
                      <dd>{usage.estimated ? '流式估算（API 未返回 usage 时）' : 'API 实际 usage'}</dd>
                    </div>
                    <div>
                      <dt>原始输出长度</dt>
                      <dd>{rawText.length.toLocaleString('zh-CN')} 字符</dd>
                    </div>
                    <div>
                      <dt>提取 HTML 长度</dt>
                      <dd>{htmlCode.length.toLocaleString('zh-CN')} 字符</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
