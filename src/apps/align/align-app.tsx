/**
 * 歌词对齐 2：音素识别（复用 wav2vec2）+ LLM G2P + 确定性 DTW → 增强 LRC。
 * 无 QuickJS 终端；对话修正仍走 LLM，但不算时间戳。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import { AlignIcon } from '../../icons/app-icons.tsx'
import { isModelCached, PHONEME_MODEL_LABEL, PHONEME_MODEL_URL } from '../../os/model-cache.ts'
import { IosButton } from '../../ui/ios-button.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { filesCreateText, filesReadText, filesStat, filesWriteText } from '../files/files-api.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureUserSpecialFolders, userSpecialFolderPath } from '../files/files-user-special.ts'
import { readFileBlob, resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import { PhonemeAlignView } from '../stems/phoneme-align-view.tsx'
import { ipaToPinyin } from '../stems/phoneme-ipa-mapping.ts'
import {
  buildPhonemeSidecarText,
  parsePhonemeSidecarText,
  phonemeAlignedLrcPath,
  phonemeSidecarPath,
} from '../stems/phoneme-align-workspace.ts'
import type { AlignedPhone, PhonemeEngineProvider, PhonemeProgress } from '../stems/phoneme-types.ts'
import { loadStemsArchive, STEMS_ARCHIVE_EXTENSION } from '../stems/stems-persistence.ts'
import type {
  VscodeAiAgentProgress,
  VscodeAiAgentResult,
  VscodeAiInvestigation,
} from '../vscode/vscode-ai-agent.ts'
import { InvestigationPanel, LiveTimeline } from '../vscode/vscode-ai-chat-surface.tsx'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
  type VscodeModelPickerDecoded,
} from '../vscode/vscode-ai-models.ts'
import { VscodeAiComposerBlock } from '../vscode/vscode-ai-panel.tsx'
import {
  loadVscodePrefs,
  saveVscodePrefs,
  type VscodeAiModelOptionPrefs,
} from '../vscode/vscode-prefs.ts'
import { runAlignChatAgent, runG2pAgent, type G2pProgress } from './align-agent.ts'
import { alignUnitsToPhones } from './align-dtw.ts'
import { buildAlignLrc } from './align-lrc.ts'
import '../help/help.css'
import '../vscode/vscode-ai.css'
import './align.css'

const TOP_K = 3
const MAX_ROWS = 200
const ALIGN_MODEL_STORAGE_KEY = 'align:model'

const PHONEME_SPECIAL_SYMBOLS = new Set(['<pad>', '<s>', '</s>', '<unk>'])
function isPhonemeSpecialSymbol(symbol: string): boolean {
  return PHONEME_SPECIAL_SYMBOLS.has(symbol)
}

let phonemeVocab: string[] | undefined
async function loadVocab(): Promise<string[]> {
  if (phonemeVocab) return phonemeVocab
  const response = await fetch('/assets/phoneme/vocab.json')
  const json: Record<string, number> = await response.json()
  const byId = new Array<string>(Math.max(...Object.values(json)) + 1)
  for (const [symbol, id] of Object.entries(json)) {
    byId[id] = symbol
  }
  phonemeVocab = byId
  return byId
}

type FrameRow = {
  time: number
  argmax: string
  top: [string, number][]
}

type AlignState = 'idle' | 'g2p' | 'dtw' | 'done' | 'error'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  investigation?: VscodeAiInvestigation
}

function nonEmptyInvestigation(
  investigation: VscodeAiInvestigation,
): VscodeAiInvestigation | undefined {
  return investigation.activities.length > 0 || investigation.timeline.length > 0
    ? investigation
    : undefined
}

async function writeTextOrCreate(path: string, text: string): Promise<void> {
  const existing = await filesStat(path)
  if (existing === undefined) {
    await filesCreateText(path, text)
    return
  }
  if (existing.kind !== 'file') {
    throw new Error(`路径冲突：${path} 不是文件`)
  }
  await filesWriteText(path, text)
}

export function AlignApp() {
  const { showSystemOpenDialog, dialog: systemDialog } = useSystemOpenDialog()
  const [sourceName, setSourceName] = useState('')
  const [archiveSource, setArchiveSource] = useState<string | undefined>(undefined)
  const [provider, setProvider] = useState<PhonemeEngineProvider | undefined>(undefined)
  const [gpuAvailable, setGpuAvailable] = useState<boolean | undefined>(undefined)
  const [modelCached, setModelCached] = useState<boolean | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [audioInfo, setAudioInfo] = useState<{ duration: number; sampleRate: number } | undefined>(
    undefined,
  )
  const [rows, setRows] = useState<FrameRow[] | undefined>(undefined)
  const [phones, setPhones] = useState<AlignedPhone[] | undefined>(undefined)
  const recogAbortRef = useRef<AbortController | undefined>(undefined)

  type RecogPhase = 'idle' | 'unpacking' | 'loading' | 'running' | 'done'
  const [recogPhase, setRecogPhase] = useState<RecogPhase>('idle')
  const [recogProgress, setRecogProgress] = useState<{ chunk: number; total: number } | undefined>(
    undefined,
  )

  const [lyrics, setLyrics] = useState('')
  const lyricsRef = useRef('')
  const [lyricsSourceName, setLyricsSourceName] = useState('')
  const [alignState, setAlignState] = useState<AlignState>('idle')
  const [liveProgress, setLiveProgress] = useState<VscodeAiAgentProgress | undefined>(undefined)
  const [g2pProgress, setG2pProgress] = useState<G2pProgress | undefined>(undefined)
  const [alignResult, setAlignResult] = useState('')
  const alignResultRef = useRef('')
  const [alignError, setAlignError] = useState<string | undefined>(undefined)
  const [savedTo, setSavedTo] = useState<string | undefined>(undefined)
  const [copiedHint, setCopiedHint] = useState<string | undefined>(undefined)
  const [alignViewOpen, setAlignViewOpen] = useState(false)
  const alignAbortRef = useRef<AbortController | undefined>(undefined)

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const chatMessagesRef = useRef<ChatMessage[]>([])
  const chatHistoryRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[] | undefined>(undefined)
  const [chatRunning, setChatRunning] = useState(false)
  const [draft, setDraft] = useState('')

  const audioPathRef = useRef<string | undefined>(undefined)
  const providerRef = useRef<PhonemeEngineProvider | undefined>(undefined)
  const [recogSavedTo, setRecogSavedTo] = useState<string | undefined>(undefined)
  const [recogLoaded, setRecogLoaded] = useState(false)
  const [recogSaveError, setRecogSaveError] = useState<string | undefined>(undefined)
  const [recogLoadFallback, setRecogLoadFallback] = useState<string | undefined>(undefined)
  const [alignSavedTo, setAlignSavedTo] = useState<string | undefined>(undefined)
  const [alignSidecarError, setAlignSidecarError] = useState<string | undefined>(undefined)
  const [alignRestoredFrom, setAlignRestoredFrom] = useState<string | undefined>(undefined)

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const [alignModel, setAlignModel] = useState<VscodeModelPickerDecoded>(() => {
    try {
      const saved = localStorage.getItem(ALIGN_MODEL_STORAGE_KEY)
      if (saved) return decodeVscodeModelPickerValue(saved)
    } catch {
      // ignore
    }
    return { source: 'text' }
  })
  const [aiModelOptions, setAiModelOptions] = useState<Record<string, VscodeAiModelOptionPrefs>>(
    {},
  )

  useEffect(() => {
    setGpuAvailable('gpu' in navigator)
    void isModelCached(PHONEME_MODEL_URL).then((cached) => setModelCached(cached))
  }, [])

  const decodeLogits = useCallback(
    async (logits: Float32Array, numFrames: number, numPhonemes: number) => {
      const vocab = await loadVocab()
      const frameSec = 0.02
      const frameRows: FrameRow[] = []
      const phoneList: AlignedPhone[] = []

      for (let f = 0; f < numFrames; f++) {
        const base = f * numPhonemes
        let best = -Infinity
        let bestId = 0
        const top: [string, number][] = []
        for (let p = 0; p < numPhonemes; p++) {
          const value = logits[base + p]
          if (value > best) {
            best = value
            bestId = p
          }
          const candidate = vocab[p] ?? `#${p}`
          if (isPhonemeSpecialSymbol(candidate)) continue
          if (top.length < TOP_K) {
            top.push([candidate, value])
            top.sort((a, b) => b[1] - a[1])
          } else if (value > top[TOP_K - 1][1]) {
            top[TOP_K - 1] = [candidate, value]
            top.sort((a, b) => b[1] - a[1])
          }
        }

        const symbol = vocab[bestId] ?? `#${bestId}`
        if (!isPhonemeSpecialSymbol(symbol)) {
          frameRows.push({ time: f * frameSec, argmax: symbol, top })
        }

        const last = phoneList[phoneList.length - 1]
        if (symbol === '<pad>' || symbol === '<s>' || symbol === '</s>' || symbol === '<unk>') {
          if (last && last.symbol === symbol) last.end = f * frameSec
        } else if (last && last.symbol === symbol) {
          last.end = f * frameSec
        } else {
          phoneList.push({ symbol, start: f * frameSec, end: f * frameSec + frameSec })
        }
      }
      return { rows: frameRows, phones: phoneList }
    },
    [],
  )

  const resetAlign = useCallback(() => {
    alignAbortRef.current?.abort()
    alignAbortRef.current = undefined
    setAlignState('idle')
    setLiveProgress(undefined)
    setG2pProgress(undefined)
    setAlignResult('')
    alignResultRef.current = ''
    setAlignError(undefined)
    setSavedTo(undefined)
    setAlignSavedTo(undefined)
    setAlignSidecarError(undefined)
    setAlignRestoredFrom(undefined)
    setChatRunning(false)
    setChatMessages([])
    chatMessagesRef.current = []
    chatHistoryRef.current = undefined
  }, [])

  const appendChatMessage = useCallback(
    (role: 'user' | 'assistant', content: string, extras?: Partial<ChatMessage>) => {
      const message: ChatMessage = { role, content, ...extras }
      chatMessagesRef.current = [...chatMessagesRef.current, message]
      setChatMessages(chatMessagesRef.current)
    },
    [],
  )

  const updateChatHistory = useCallback((result: VscodeAiAgentResult) => {
    if (result.wireMessages && result.wireMessages.length > 0) {
      chatHistoryRef.current = result.wireMessages
    } else {
      chatHistoryRef.current = chatMessagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    }
  }, [])

  const persistAlignedLrc = useCallback(async (audioPath: string, lrcText: string) => {
    try {
      const lrcPath = phonemeAlignedLrcPath(audioPath)
      await writeTextOrCreate(lrcPath, lrcText)
      setAlignSavedTo(lrcPath)
      setAlignSidecarError(undefined)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      console.error('对齐结果旁存保存失败', cause)
      setAlignSavedTo(undefined)
      setAlignSidecarError(`对齐结果旁存写入失败：${reason}`)
    }
  }, [])

  /** G2P → DTW → LRC */
  const runAlign = useCallback(
    async (phoneList: AlignedPhone[], lyricsText: string, modelKey: string | undefined) => {
      if (alignAbortRef.current) return
      const controller = new AbortController()
      alignAbortRef.current = controller
      setAlignState('g2p')
      setLiveProgress(undefined)
      setG2pProgress(undefined)
      setAlignResult('')
      alignResultRef.current = ''
      setAlignError(undefined)
      setSavedTo(undefined)
      const totalLines = lyricsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
      appendChatMessage(
        'user',
        `歌词 ${totalLines} 行 · ${phoneList.length} 音素\n\n${lyricsText.trim()}`,
      )
      try {
        const g2p = await runG2pAgent({
          lyrics: lyricsText,
          modelKey,
          signal: controller.signal,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            setG2pProgress(progress)
          },
        })
        if (controller.signal.aborted) return
        setAlignState('dtw')
        setLiveProgress(undefined)
        setG2pProgress(undefined)
        const alignedUnits = alignUnitsToPhones(g2p.units, phoneList)
        const lrc = buildAlignLrc(alignedUnits, g2p.lines).trim()
        if (!lrc) {
          setAlignError('对齐未产出可用的 LRC，请重试')
          setAlignState('error')
          return
        }
        setAlignResult(lrc)
        alignResultRef.current = lrc
        setAlignState('done')
        if (audioPathRef.current) {
          void persistAlignedLrc(audioPathRef.current, lrc)
        }
        updateChatHistory(g2p.agent)
        appendChatMessage(
          'assistant',
          `G2P ${g2p.units.length} 单元 · DTW 对齐完成，已生成 ${totalLines} 行增强 LRC`,
          { investigation: nonEmptyInvestigation(g2p.agent.investigation) },
        )
      } catch (cause) {
        if (controller.signal.aborted) {
          setAlignState('idle')
          return
        }
        setAlignError(cause instanceof Error ? cause.message : String(cause))
        setAlignState('error')
      } finally {
        if (alignAbortRef.current === controller) alignAbortRef.current = undefined
        setLiveProgress(undefined)
        setG2pProgress(undefined)
      }
    },
    [appendChatMessage, persistAlignedLrc, updateChatHistory],
  )

  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || alignAbortRef.current) return
      const controller = new AbortController()
      alignAbortRef.current = controller
      setDraft('')
      setChatRunning(true)
      setLiveProgress(undefined)
      setAlignError(undefined)
      appendChatMessage('user', trimmed)
      try {
        const result = await runAlignChatAgent({
          lrc: alignResultRef.current,
          userMessage: trimmed,
          history: chatHistoryRef.current,
          modelKey: alignModel.source === 'custom' ? alignModel.modelKey : undefined,
          signal: controller.signal,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            setLiveProgress(progress)
          },
        })
        if (controller.signal.aborted) return
        updateChatHistory(result)
        appendChatMessage('assistant', result.text.trim() || '（无回复）', {
          investigation: nonEmptyInvestigation(result.investigation),
        })
        const lrc = (result.revisedLrc ?? '').trim()
        if (lrc && lrc !== alignResultRef.current) {
          alignResultRef.current = lrc
          setAlignResult(lrc)
          setAlignState('done')
          if (audioPathRef.current) {
            void persistAlignedLrc(audioPathRef.current, lrc)
          }
        }
      } catch (cause) {
        if (controller.signal.aborted) {
          appendChatMessage('assistant', '（已停止）')
          return
        }
        appendChatMessage('assistant', cause instanceof Error ? cause.message : String(cause), {
          isError: true,
        })
      } finally {
        if (alignAbortRef.current === controller) alignAbortRef.current = undefined
        setChatRunning(false)
        setLiveProgress(undefined)
      }
    },
    [alignModel, appendChatMessage, persistAlignedLrc, updateChatHistory],
  )

  const startAlignIfReady = useCallback(
    (phoneList: AlignedPhone[] | undefined) => {
      const targets = phoneList ?? phones
      if (!targets || targets.length === 0) {
        setAlignError('请先完成音素识别')
        return
      }
      const text = lyricsRef.current.trim()
      if (!text) {
        setAlignError('请先粘贴或载入歌词文本')
        return
      }
      void runAlign(
        targets,
        text,
        alignModel.source === 'custom' ? alignModel.modelKey : undefined,
      )
    },
    [phones, runAlign, alignModel],
  )

  const handleSend = useCallback(() => {
    stickToBottomRef.current = true
    void sendChat(draft)
  }, [draft, sendChat])

  const handleStop = useCallback(() => {
    alignAbortRef.current?.abort()
  }, [])

  const handleLyricsChange = useCallback((value: string) => {
    setLyrics(value)
    lyricsRef.current = value
  }, [])

  const handleModelPickerChange = useCallback((encoded: string) => {
    setAlignModel(decodeVscodeModelPickerValue(encoded))
    try {
      localStorage.setItem(ALIGN_MODEL_STORAGE_KEY, encoded)
    } catch {
      // ignore
    }
  }, [])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
  }, [])

  const savePhonemeSidecar = useCallback(
    async (
      audioPath: string,
      phoneList: AlignedPhone[],
      providerLabel: PhonemeEngineProvider | undefined,
      duration: number,
      sampleRate: number,
    ) => {
      try {
        const sidecarPath = phonemeSidecarPath(audioPath)
        await writeTextOrCreate(
          sidecarPath,
          buildPhonemeSidecarText({
            duration,
            sampleRate,
            provider: providerLabel,
            phoneList,
          }),
        )
        setRecogSavedTo(sidecarPath)
        setRecogSaveError(undefined)
        setRecogLoadFallback(undefined)
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        console.error('识别结果旁存保存失败', cause)
        setRecogSavedTo(undefined)
        setRecogSaveError(`旁存写入失败：${reason}`)
      }
    },
    [],
  )

  const startRecognition = useCallback(
    async (audio: Float32Array, sampleRate: number, duration: number) => {
      setError(undefined)
      setRows(undefined)
      setPhones(undefined)
      setBusy(true)
      setRecogPhase('loading')
      setRecogProgress(undefined)
      setAudioInfo({ duration, sampleRate })
      setRecogSavedTo(undefined)
      setRecogLoaded(false)
      resetAlign()

      recogAbortRef.current?.abort()
      const abort = new AbortController()
      recogAbortRef.current = abort
      const audioPath = audioPathRef.current

      try {
        const { logits, numFrames, numPhonemes } = await enqueueAiTask<
          PhonemeProgress,
          { logits: Float32Array; numFrames: number; numPhonemes: number }
        >(
          'phoneme-wav2vec2',
          { type: 'recognize', audio, sampleRate },
          {
            signal: abort.signal,
            route: (msg) => {
              if (msg.kind === 'model-loading') {
                setRecogPhase('loading')
                return { action: 'continue' }
              }
              if (msg.kind === 'model-loaded') {
                setProvider(msg.provider)
                providerRef.current = msg.provider
                setRecogPhase('running')
                return { action: 'continue' }
              }
              if (msg.kind === 'progress') {
                setRecogProgress({ chunk: msg.chunk, total: msg.total })
                return { action: 'continue' }
              }
              if (msg.kind === 'done') {
                return {
                  action: 'resolve',
                  value: {
                    logits: msg.logits,
                    numFrames: msg.numFrames,
                    numPhonemes: msg.numPhonemes,
                  },
                }
              }
              return { action: 'reject', error: new Error(msg.message) }
            },
          },
        )
        if (abort.signal.aborted) return
        setRecogPhase('done')
        const { rows: frameRows, phones: phoneList } = await decodeLogits(
          logits,
          numFrames,
          numPhonemes,
        )
        if (abort.signal.aborted) return
        setRows(frameRows)
        setPhones(phoneList)
        if (audioPath) {
          await savePhonemeSidecar(audioPath, phoneList, providerRef.current, duration, sampleRate)
        }
        if (abort.signal.aborted) return
        setBusy(false)
        startAlignIfReady(phoneList)
      } catch (cause) {
        if (abort.signal.aborted) return
        setRecogLoadFallback(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
    },
    [decodeLogits, resetAlign, savePhonemeSidecar, startAlignIfReady],
  )

  const recognizeAudioPath = useCallback(
    async (path: string) => {
      const node = await resolveNodeByAbsolutePath(path)
      if (!node || node.kind !== 'file') return
      setSourceName(node.name)
      setError(undefined)
      setRows(undefined)
      setPhones(undefined)
      setRecogSavedTo(undefined)
      setRecogLoaded(false)
      setArchiveSource(undefined)
      try {
        if (!path.endsWith(STEMS_ARCHIVE_EXTENSION)) {
          throw new Error('请选择分轨结果文件（.stems.zip）')
        }
        const { blob } = await readFileBlob(node.id)
        setBusy(true)
        setRecogPhase('unpacking')
        const { manifest, stems } = await loadStemsArchive(blob)
        const vocals = stems.find((stem) => stem.stemId === 'vocals')
        if (!vocals) throw new Error('分轨压缩包中没有 vocals 人声轨，无法识别')
        setArchiveSource(manifest.sourceName)
        await startRecognition(vocals.data, manifest.sampleRate, manifest.durationSec)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
    },
    [startRecognition],
  )

  const handlePickFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择分轨结果（.stems.zip）',
      acceptExtensions: ['stems.zip'],
    })
    if (!path) return
    audioPathRef.current = path
    setRecogSavedTo(undefined)
    setRecogLoaded(false)
    setRecogSaveError(undefined)
    setRecogLoadFallback(undefined)
    setArchiveSource(undefined)
    resetAlign()
    const sidecarPath = phonemeSidecarPath(path)
    const fallback = (reason: string) => {
      console.warn('旁存识别结果不可用，将重新识别', sidecarPath, reason)
      setRecogLoadFallback(reason)
    }
    try {
      const existing = await filesStat(sidecarPath)
      if (!existing || existing.kind !== 'file') {
        fallback('同目录未找到旁存文件')
      } else {
        const parsed = parsePhonemeSidecarText(await filesReadText(sidecarPath))
        if (parsed.phones.length > 0) {
          const node = await resolveNodeByAbsolutePath(path)
          if (node && node.kind === 'file') setSourceName(node.name)
          setPhones(parsed.phones)
          setRows(undefined)
          setAudioInfo(
            parsed.duration !== undefined && parsed.sampleRate !== undefined
              ? { duration: parsed.duration, sampleRate: parsed.sampleRate }
              : undefined,
          )
          const loadedProvider = parsed.provider
            ? (parsed.provider as PhonemeEngineProvider)
            : undefined
          setProvider(loadedProvider)
          providerRef.current = loadedProvider
          setRecogPhase('done')
          setRecogSavedTo(sidecarPath)
          setRecogLoaded(true)
          let restoredAlign = false
          try {
            const alignedLrcPath = phonemeAlignedLrcPath(path)
            const alignedExisting = await filesStat(alignedLrcPath)
            if (alignedExisting && alignedExisting.kind === 'file') {
              const restored = (await filesReadText(alignedLrcPath)).trim()
              if (restored) {
                alignResultRef.current = restored
                setAlignResult(restored)
                setAlignState('done')
                setAlignRestoredFrom(alignedLrcPath)
                restoredAlign = true
              }
            }
          } catch (cause) {
            console.warn('对齐结果旁存载入失败，已忽略', cause)
          }
          if (!restoredAlign) {
            startAlignIfReady(parsed.phones)
          }
          return
        }
        fallback('旁存文件内没有可用的音素行')
      }
    } catch (cause) {
      fallback(cause instanceof Error ? cause.message : String(cause))
    }
    await recognizeAudioPath(path)
  }, [recognizeAudioPath, resetAlign, showSystemOpenDialog, startAlignIfReady])

  const handleLoadLyricsFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择歌词文件',
      acceptExtensions: ['lrc', 'txt'],
    })
    if (!path) return
    try {
      const text = await filesReadText(path)
      setLyrics(text)
      lyricsRef.current = text
      setLyricsSourceName(path.split('/').pop() ?? '')
      setAlignError(undefined)
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [showSystemOpenDialog])

  const handleCopyResult = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(alignResult)
      setSavedTo('已复制到剪贴板')
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [alignResult])

  const handleCopyPhonesAndLyrics = useCallback(async () => {
    if (!phones || phones.length === 0) return
    const phoneRows: string[] = []
    for (const p of phones) {
      const py = ipaToPinyin(p.symbol)
      if (!py) continue
      phoneRows.push(`${p.start.toFixed(2)}-${p.end.toFixed(2)}s\t${py}\t${p.symbol}`)
    }
    const text = [
      '【歌词】',
      lyrics.trim() || '（未输入歌词）',
      '',
      `【音素序列】（${phoneRows.length} 个，时间戳/拼音/IPA）`,
      phoneRows.join('\n'),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedHint('已复制')
    } catch (cause) {
      setCopiedHint(cause instanceof Error ? `复制失败：${cause.message}` : '复制失败')
    }
    window.setTimeout(() => setCopiedHint(undefined), 2000)
  }, [phones, lyrics])

  const handleSaveResult = useCallback(async () => {
    if (!alignResult) return
    const base =
      sourceName.replace(/\.stems\.zip$/i, '').replace(/\.[^.]+$/, '') || '歌词'
    const path = joinFilesAbsolutePath(userSpecialFolderPath('Musics'), `${base}.lrc`)
    try {
      await ensureUserSpecialFolders()
      await writeTextOrCreate(path, alignResult)
      setSavedTo(path)
      setAlignError(undefined)
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [alignResult, sourceName])

  useEffect(() => {
    return () => {
      recogAbortRef.current?.abort()
      alignAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [alignState, chatMessages.length, chatRunning, liveProgress, g2pProgress, alignResult])

  const displayedRows = useMemo(() => rows?.slice(0, MAX_ROWS) ?? [], [rows])
  const lyricsLineCount = useMemo(
    () => lyrics.trim().split(/\n+/).filter(Boolean).length,
    [lyrics],
  )
  const hasChat = chatMessages.length > 0
  const liveTimeline = liveProgress?.timeline ?? []
  const liveAnswer = liveProgress?.answerText ?? ''
  const showLiveAnswer = liveAnswer.length > 0
  const recognitionReady = (phones?.length ?? 0) > 0
  const turnRunning =
    alignState === 'g2p' || alignState === 'dtw' || chatRunning
  const canAlign =
    recognitionReady && lyrics.trim().length > 0 && !busy && !turnRunning && textModels.length > 0
  const canSend = !busy && !turnRunning && draft.trim().length > 0 && textModels.length > 0
  const composerPlaceholder = !recognitionReady
    ? '先打开分轨结果（.stems.zip）完成音素识别…'
    : alignResult
      ? '继续和 Agent 对话（可让它修改对齐结果）…'
      : '和 Agent 对话，或点「开始对齐」生成逐字 LRC…'
  const modelSelectValue = useMemo(
    () => encodeVscodeModelPickerValue(alignModel.source, alignModel.modelKey),
    [alignModel],
  )

  const handleAiModelOptionsChange = useCallback(
    (next: Record<string, VscodeAiModelOptionPrefs>) => {
      setAiModelOptions(next)
      saveVscodePrefs({ ...loadVscodePrefs(), aiModelOptions: next })
    },
    [],
  )

  return (
    <div class="align">
      {alignViewOpen && phones && alignResult ? (
        /* 包一层 .phoneme 以复用双轨视图的 CSS 变量与 phoneme-av 样式 */
        <div class="phoneme" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <PhonemeAlignView
            phones={phones}
            lrcText={alignResult}
            duration={audioInfo?.duration ?? null}
            sourceName={sourceName}
            onClose={() => setAlignViewOpen(false)}
          />
        </div>
      ) : (
        <>
          <div class="align__toolbar">
            <span class="align__toolbar-title">歌词对齐 2</span>
            <IosButton tone="primary" disabled={busy} onClick={() => void handlePickFile()}>
              打开分轨结果…
            </IosButton>
            <IosButton disabled={busy} onClick={() => void handleLoadLyricsFile()}>
              从文件读取歌词
            </IosButton>
            <IosButton
              tone="primary"
              disabled={!canAlign}
              onClick={() => void startAlignIfReady(undefined)}
            >
              开始对齐
            </IosButton>
            <IosButton
              disabled={!recognitionReady || !alignResult}
              onClick={() => setAlignViewOpen(true)}
              title="双轨视图：查看每个音素对应的歌词字"
            >
              对齐视图
            </IosButton>
            {lyricsSourceName && (
              <span class="align__lyrics-source" title={lyricsSourceName}>
                {lyricsSourceName}
              </span>
            )}
            {busy && (
              <span class="align__hint">
                {recogPhase === 'unpacking' && '正在解包分轨压缩包…'}
                {recogPhase === 'loading' && '加载模型中…'}
                {recogPhase === 'running' &&
                  (recogProgress
                    ? `推断中 ${recogProgress.chunk}/${recogProgress.total} 块…`
                    : '推断中…')}
              </span>
            )}
            {sourceName && <span class="align__source">{sourceName}</span>}
            {archiveSource && (
              <span
                class="align__lyrics-source align__source-badge"
                title={`人声轨来自「${archiveSource}」的分轨结果`}
              >
                人声轨
              </span>
            )}

            <div class="align__toolbar-right">
              {provider && (
                <span
                  class={`align__engine align__engine--${provider}`}
                  title={provider === 'webgpu' ? 'WebGPU 加速' : 'WASM 回退'}
                >
                  {provider === 'webgpu' ? 'WebGPU' : 'WASM'}
                </span>
              )}
              {gpuAvailable === false && (
                <span class="align__hint">无 WebGPU，将使用 WASM</span>
              )}
              {modelCached === false && (
                <span class="align__hint">模型未缓存（首次需下载）</span>
              )}
            </div>
          </div>

          {error && <p class="align__error">{error}</p>}

          <div class="align__layout">
            <aside class="align__left">
              {!rows && !phones && !busy ? (
                <div class="align__empty">
                  <div class="align__empty-icon">
                    <AlignIcon size={48} />
                  </div>
                  <p>打开分轨结果（.stems.zip），用里面的人声轨做音素识别</p>
                  <p class="align__empty-hint">
                    对齐方式：LLM 转音素 + DTW 强制对齐（无终端）
                    <br />
                    模型：{PHONEME_MODEL_LABEL}（{Math.round(241691639 / 1024 / 1024)} MB）
                  </p>
                </div>
              ) : (
                <>
                  {busy && !rows && (
                    <div class="align__progress-card">
                      <div class="align__section-title">识别进度</div>
                      <div class="align__progress-phase">
                        {recogPhase === 'unpacking' && '正在解包分轨压缩包，提取人声轨…'}
                        {recogPhase === 'loading' && '正在加载 wav2vec2 模型…'}
                        {recogPhase === 'running' && '正在运行音素识别…'}
                      </div>
                      {recogProgress && (
                        <div class="align__progress-bar-wrap">
                          <div
                            class="align__progress-bar"
                            style={{
                              width: `${Math.round((recogProgress.chunk / recogProgress.total) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                      {recogProgress && (
                        <div class="align__progress-label">
                          {recogProgress.chunk} / {recogProgress.total} 块
                        </div>
                      )}
                    </div>
                  )}

                  {audioInfo && (
                    <div class="align__audio-info">
                      <div class="align__section-title">音频信息</div>
                      <div class="align__audio-stats">
                        <span>时长 {audioInfo.duration.toFixed(1)}s</span>
                        <span>{audioInfo.sampleRate}Hz</span>
                        {rows && <span>{rows.length} 帧</span>}
                        {phones && <span>{phones.length} 音素</span>}
                      </div>
                    </div>
                  )}

                  {rows && phones && (
                    <div class="align__copy-row">
                      <IosButton onClick={() => void handleCopyPhonesAndLyrics()}>
                        复制音素 + 歌词
                      </IosButton>
                      {copiedHint && <span class="align__hint">{copiedHint}</span>}
                    </div>
                  )}

                  {phones && (
                    <details class="align__details">
                      <summary class="align__details-summary">
                        音素识别详情（{phones.length} 个音素段）
                      </summary>
                      <div class="align__details-body">
                        <div class="align__section-title">音素序列</div>
                        <div class="align__phones">
                          {phones.map((p, i) => (
                            <span
                              key={i}
                              class="align__phone"
                              title={`${p.start.toFixed(2)}s - ${p.end.toFixed(2)}s`}
                            >
                              {p.symbol}
                              <span class="align__phone-time">{p.start.toFixed(2)}s</span>
                            </span>
                          ))}
                        </div>

                        {rows && (
                          <>
                            <div class="align__section-title">
                              逐帧 top-{TOP_K}（前 {displayedRows.length} / {rows.length} 帧）
                            </div>
                            <div class="align__table">
                              <table>
                                <thead>
                                  <tr>
                                    <th>时间</th>
                                    <th>argmax</th>
                                    <th>top-3 音素（logits）</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {displayedRows.map((row, i) => (
                                    <tr key={i}>
                                      <td class="align__time">{row.time.toFixed(2)}s</td>
                                      <td class="align__argmax">{row.argmax}</td>
                                      <td class="align__top">
                                        {row.top.map(([symbol, value], j) => (
                                          <span key={j} class="align__top-item">
                                            {symbol}:{value.toFixed(1)}
                                          </span>
                                        ))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    </details>
                  )}

                  {recogSavedTo && (
                    <div class="align__sidecar-hint">
                      <span title={recogSavedTo}>
                        {recogLoaded
                          ? `已载入识别结果（${recogSavedTo.split('/').pop() ?? ''}）`
                          : `识别结果已保存：${recogSavedTo}`}
                      </span>
                      {recogLoaded && audioPathRef.current && (
                        <IosButton
                          size="compact"
                          onClick={() => void recognizeAudioPath(audioPathRef.current!)}
                        >
                          重新识别
                        </IosButton>
                      )}
                    </div>
                  )}
                  {recogSaveError && (
                    <div class="align__sidecar-hint align__sidecar-hint--error" title={recogSaveError}>
                      {recogSaveError}
                    </div>
                  )}
                  {recogLoadFallback && !recogSavedTo && (
                    <div
                      class="align__sidecar-hint align__sidecar-hint--warn"
                      title={recogLoadFallback}
                    >
                      未找到可载入的识别结果（{recogLoadFallback}），正在重新识别…
                    </div>
                  )}

                  {alignRestoredFrom && (
                    <div
                      class="align__sidecar-hint align__sidecar-hint--restored"
                      title={alignRestoredFrom}
                    >
                      已恢复上次对齐结果（{alignRestoredFrom.split('/').pop() ?? ''}），可直接查看对齐视图
                    </div>
                  )}
                  {alignSavedTo && !alignRestoredFrom && (
                    <div class="align__sidecar-hint" title={alignSavedTo}>
                      对齐结果已保存：{alignSavedTo}
                    </div>
                  )}
                  {alignSidecarError && (
                    <div
                      class="align__sidecar-hint align__sidecar-hint--error"
                      title={alignSidecarError}
                    >
                      {alignSidecarError}
                    </div>
                  )}

                  <div class="align__lyrics-card">
                    <div class="align__lyrics-card-head">
                      <span class="align__section-title">歌词</span>
                      <span class="align__lyrics-meta">
                        {lyricsLineCount} 行
                        {lyricsSourceName && (
                          <span class="align__lyrics-source" title={lyricsSourceName}>
                            {lyricsSourceName}
                          </span>
                        )}
                      </span>
                    </div>
                    <textarea
                      class="align__lyrics-input"
                      value={lyrics}
                      onInput={(e) => handleLyricsChange(e.currentTarget.value)}
                      rows={8}
                      placeholder="粘贴歌词（任意语言，可多行）…"
                      disabled={turnRunning}
                    />
                  </div>
                </>
              )}
            </aside>

            <div class="align__right">
              <div class="align__align-header">
                <span class="align__section-title">歌词对齐 2</span>
                {!hasChat && alignState !== 'done' && (
                  <span class="align__align-badge align__align-badge--idle">
                    {!recognitionReady ? '等待识别' : lyrics.trim() ? '待对齐' : '等待歌词'}
                  </span>
                )}
                {alignState === 'g2p' && (
                  <span class="align__align-badge align__align-badge--running">
                    G2P：歌词转音素…
                  </span>
                )}
                {alignState === 'dtw' && (
                  <span class="align__align-badge align__align-badge--running">DTW 对齐中…</span>
                )}
                {chatRunning && (
                  <span class="align__align-badge align__align-badge--running">Agent 回复中…</span>
                )}
                {alignState === 'done' && (
                  <span class="align__align-badge align__align-badge--done">对齐完成</span>
                )}
                {alignState === 'error' && (
                  <span class="align__align-badge align__align-badge--error">对齐失败</span>
                )}
              </div>

              <div class="help-app vscode-ai align__chat-shell help-app--width-full">
                <div
                  class="help-app__chat vscode-ai__chat"
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                >
                  {!hasChat ? (
                    <div class="help-app__welcome vscode-ai__welcome">
                      <div class="help-app__welcome-icon" aria-hidden="true">
                        <AlignIcon size={56} />
                      </div>
                      <h2 class="help-app__welcome-title">歌词对齐 2</h2>
                      <p class="help-app__welcome-sub">
                        打开分轨结果完成音素识别，输入歌词后点「开始对齐」。
                        <br />
                        LLM 只做歌词→音素，时间戳由 DTW 确定性算出；之后可继续对话修正。
                      </p>
                    </div>
                  ) : (
                    <div class="help-app__messages">
                      {chatMessages.map((message, index) => {
                        if (message.role === 'user') {
                          return (
                            <div
                              key={index}
                              class={`help-app__message help-app__message--user${message.isError ? ' help-app__message--error' : ''}`}
                            >
                              <span class="help-app__avatar" aria-hidden="true">
                                🙂
                              </span>
                              <div
                                class={`help-app__bubble vscode-ai__bubble--user${message.isError ? ' help-app__bubble--error' : ''}`}
                              >
                                <div class="help-app__answer help-app__answer--plain align__user-msg">
                                  {message.content}
                                </div>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={index}
                            class={`help-app__message help-app__message--assistant${message.isError ? ' help-app__message--error' : ''}`}
                          >
                            <div class="vscode-ai__message-main">
                              <span class="help-app__avatar" aria-hidden="true">
                                {message.isError ? '!' : <AlignIcon size={30} />}
                              </span>
                              <div class="vscode-ai__message-stack">
                                <div
                                  class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}${message.investigation ? ' help-app__bubble--with-investigation' : ''}`}
                                >
                                  {message.investigation ? (
                                    <InvestigationPanel investigation={message.investigation} />
                                  ) : undefined}
                                  {!message.isError ? (
                                    <div class="help-app__answer">
                                      <HelpMarkdown text={message.content} />
                                    </div>
                                  ) : (
                                    <div class="help-app__answer help-app__answer--plain">
                                      {message.content}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {turnRunning && (
                        <div class="help-app__message help-app__message--assistant">
                          <div class="vscode-ai__message-main">
                            <span class="help-app__avatar" aria-hidden="true">
                              <AlignIcon size={30} />
                            </span>
                            <div class="vscode-ai__message-stack">
                              <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                                {alignState === 'g2p' && g2pProgress ? (
                                  <div class="align__g2p-stream">
                                    <div class="align__g2p-status">
                                      AI 正在转换音素… {g2pProgress.chars} 字符
                                    </div>
                                    {g2pProgress.text && (
                                      <pre class="align__g2p-preview">{g2pProgress.text}</pre>
                                    )}
                                  </div>
                                ) : alignState === 'dtw' ? (
                                  <div class="align__g2p-status">DTW 强制对齐中…</div>
                                ) : (
                                  <>
                                    <LiveTimeline items={liveTimeline} />
                                    {showLiveAnswer &&
                                      !liveTimeline.some((item) => item.kind === 'text') && (
                                        <div
                                          class={buildLiveAnswerClassName({
                                            streaming: true,
                                            separated: liveTimeline.length > 0,
                                          })}
                                        >
                                          <HelpMarkdown text={liveAnswer} streaming />
                                        </div>
                                      )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {alignState === 'done' && alignResult && (
                        <div class="help-app__message help-app__message--assistant">
                          <div class="vscode-ai__message-main">
                            <span class="help-app__avatar" aria-hidden="true">
                              <AlignIcon size={30} />
                            </span>
                            <div class="vscode-ai__message-stack">
                              <div class="help-app__bubble">
                                <div class="align__align-result">
                                  <div class="help-app__answer">
                                    <HelpMarkdown text={alignResult} />
                                  </div>
                                  <div class="align__align-result-actions">
                                    <IosButton size="compact" onClick={() => void handleCopyResult()}>
                                      复制
                                    </IosButton>
                                    <IosButton size="compact" onClick={() => void handleSaveResult()}>
                                      保存到「音乐」文件夹
                                    </IosButton>
                                    <IosButton
                                      size="compact"
                                      onClick={() => void startAlignIfReady(undefined)}
                                    >
                                      重新对齐
                                    </IosButton>
                                    {savedTo && (
                                      <span class="align__lyrics-source" title={savedTo}>
                                        {savedTo}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {alignState === 'error' && alignError && (
                        <div class="help-app__message help-app__message--assistant">
                          <div class="vscode-ai__message-main">
                            <span class="help-app__avatar" aria-hidden="true">
                              !
                            </span>
                            <div class="vscode-ai__message-stack">
                              <div class="help-app__bubble help-app__bubble--error">
                                <div class="help-app__answer help-app__answer--plain">
                                  {alignError}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div class="help-app__composer-wrap vscode-ai__composer-wrap">
                  <VscodeAiComposerBlock
                    value={draft}
                    onChange={setDraft}
                    onSend={handleSend}
                    inputRef={inputRef}
                    placeholder={composerPlaceholder}
                    inputDisabled={busy || turnRunning}
                    sendDisabled={!canSend}
                    busy={turnRunning}
                    onStop={handleStop}
                    mode="agent"
                    onModeChange={() => undefined}
                    hideMode
                    modelPickerValue={modelSelectValue}
                    onModelPickerChange={handleModelPickerChange}
                    textModels={textModels}
                    capabilityTags={capabilityTags}
                    aiModelOptions={aiModelOptions}
                    onAiModelOptionsChange={handleAiModelOptionsChange}
                    contextUsage={undefined}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {systemDialog}
    </div>
  )
}
