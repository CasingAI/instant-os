/**
 * 歌词对齐 2：音素识别（复用 wav2vec2）+ LLM G2P + 确定性 DTW → 增强 LRC。
 * 无 QuickJS 终端；对话修正仍走 LLM，但不算时间戳。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import { AlignIcon } from '../../icons/app-icons.tsx'
import {
  isModelCached,
  PHONEME_MODEL_BYTES,
  PHONEME_MODEL_LABEL,
  PHONEME_MODEL_URL,
  ZIPFORMER_MODEL_BYTES,
  ZIPFORMER_MODEL_LABEL,
  ZIPFORMER_MODEL_URL,
} from '../../os/model-cache.ts'
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
import { alignUnitsToPhones, interpolateUnits } from './align-dtw.ts'
import { ctcViterbiAlign, type CtcTarget } from './align-ctc.ts'
import { buildPinyinReverseIndex, lyricsToPinyinLines, stripLrcMarkup, toG2pLines } from './pinyin-g2p.ts'
import { alignTextToUnits, expandHypSegments, type HypSegment } from './align-text-dtw.ts'
import { buildLyricsSkeleton } from './align-g2p.ts'
import { buildAlignLrc, looksLikeBrokenLrc } from './align-lrc.ts'
import type { AlignedUnit, G2pLine, G2pUnit } from './align-types.ts'
import type { ZipformerProgress } from './zipformer-worker.ts'
import '../help/help.css'
import '../vscode/vscode-ai.css'
import './align.css'

const TOP_K = 3
const MAX_ROWS = 200
const ALIGN_MODEL_STORAGE_KEY = 'align:model'
/** 引擎切换顺序 */
const ENGINE_OPTIONS: AlignEngine[] = ['zipformer', 'wav2vec2', 'legacy']

/** zipformer 识别段 → 双轨视图/旁存用的 AlignedPhone（逐字） */
function zipSegmentsToPhones(segments: HypSegment[]): AlignedPhone[] {
  return expandHypSegments(segments).map((u) => ({
    symbol: u.text,
    start: u.start,
    end: u.end,
  }))
}

const PHONEME_SPECIAL_SYMBOLS = new Set(['<pad>', '<s>', '</s>', '<unk>'])
function isPhonemeSpecialSymbol(symbol: string): boolean {
  return PHONEME_SPECIAL_SYMBOLS.has(symbol)
}

let phonemeVocab: string[] | undefined
let phonemeVocabById: Record<string, number> | undefined
async function loadVocab(): Promise<string[]> {
  if (phonemeVocab) return phonemeVocab
  const response = await fetch('/assets/phoneme/vocab.json')
  const json: Record<string, number> = await response.json()
  const byId = new Array<string>(Math.max(...Object.values(json)) + 1)
  for (const [symbol, id] of Object.entries(json)) {
    byId[id] = symbol
  }
  phonemeVocab = byId
  phonemeVocabById = json
  return byId
}

type FrameRow = {
  time: number
  argmax: string
  top: [string, number][]
}

type AlignState = 'idle' | 'g2p' | 'dtw' | 'done' | 'error'

/** 对齐引擎：zipformer=CTC 识别+文本对齐 / wav2vec2=歌词约束 CTC / legacy=LLM G2P + 音素 DTW */
type AlignEngine = 'zipformer' | 'wav2vec2' | 'legacy'

/** 引擎名 → 展示文案 */
const ENGINE_LABEL: Record<AlignEngine, string> = {
  zipformer: 'Zipformer',
  wav2vec2: '歌词约束',
  legacy: '旧方案',
}

/** 引擎名 → 说明文案 */
const ENGINE_TITLES: Record<AlignEngine, string> = {
  zipformer: 'Zipformer-CTC 中文识别 + 识别文本对齐（确定性，无 LLM）',
  wav2vec2: '歌词约束 CTC 对齐：确定性 G2P + Viterbi（无 LLM）',
  legacy: '旧方案：LLM G2P + 音素 DTW',
}

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
  /** 识别阶段保留的 logits（供 wav2vec2 约束对齐；旁存载入时无此数据） */
  const logitsRef = useRef<
    { logits: Float32Array; numFrames: number; numPhonemes: number } | undefined
  >(undefined)

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
  const [engine, setEngine] = useState<AlignEngine>('zipformer')
  /** Zipformer 识别的 token 段（引擎切换/重新识别时清空） */
  const [zipSegments, setZipSegments] = useState<HypSegment[] | undefined>(undefined)
  /** 当前识别结果对应的引擎（旁存重载时判断如何解读） */
  const [recogEngine, setRecogEngine] = useState<AlignEngine | undefined>(undefined)
  const [aiModelOptions, setAiModelOptions] = useState<Record<string, VscodeAiModelOptionPrefs>>(
    {},
  )

  useEffect(() => {
    setGpuAvailable('gpu' in navigator)
  }, [])

  useEffect(() => {
    const url = engine === 'zipformer' ? ZIPFORMER_MODEL_URL : PHONEME_MODEL_URL
    void isModelCached(url).then((cached) => setModelCached(cached))
  }, [engine])

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

  /** 对齐：按引擎分派 → 增强 LRC */
  const runAlign = useCallback(
    async (
      recogInput: AlignedPhone[] | HypSegment[],
      lyricsText: string,
      modelKey: string | undefined,
    ) => {
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
      const cleanedLyrics = stripLrcMarkup(lyricsText).trim()
      if (!cleanedLyrics) {
        setAlignError('歌词中没有可用的文本内容（已自动剥离 LRC 时间戳）')
        setAlignState('error')
        return
      }
      const totalLines = cleanedLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
      appendChatMessage(
        'user',
        `歌词 ${totalLines} 行 · 引擎「${ENGINE_LABEL[engine]}」\n\n${cleanedLyrics}`,
      )
      try {
        let alignedUnits: AlignedUnit[]
        let g2pLines: G2pLine[]
        let chatNote: string

        if (engine === 'zipformer') {
          // 引擎 3：Zipformer 识别 + 识别文本↔歌词对齐（确定性、无 LLM）
          setAlignState('dtw')
          const segments = recogInput as HypSegment[]
          if (segments.length === 0) {
            throw new Error('识别结果为空，请重新识别')
          }
          const refLines = buildLyricsSkeleton(cleanedLyrics)
          const refUnits = refLines.flatMap((line) => line.units)
          if (refUnits.length === 0) throw new Error('没有可对齐的歌词单元')
          const spans = alignTextToUnits(segments, refUnits)
          const known: { unitIndex: number; start: number; end: number }[] = []
          spans.forEach((span, u) => {
            if (span.start >= 0) known.push({ unitIndex: u, start: span.start, end: span.end })
          })
          const obs = zipSegmentsToPhones(segments)
          alignedUnits = interpolateUnits(refUnits, known, obs)
          g2pLines = refLines
          chatNote = `Zipformer 识别 ${segments.length} 段 · 文本对齐完成`
        } else if (engine === 'wav2vec2') {
          // 引擎 2：确定性 G2P + CTC 歌词约束对齐（无 LLM、无终端）
          setAlignState('dtw')
          setG2pProgress(undefined)
          const data = logitsRef.current
          if (!data) {
            throw new Error(
              '「歌词约束」引擎需要识别时保留的声学特征，请先重新识别（旁存载入不含 logits）',
            )
          }
          const vocab = await loadVocab()
          if (!phonemeVocabById) throw new Error('词表加载失败')
          const blankId = phonemeVocabById['<pad>']
          if (blankId === undefined) throw new Error('词表缺少 <pad>')

          const index = buildPinyinReverseIndex(vocab)
          const pinyinLines = lyricsToPinyinLines(cleanedLyrics, index)

          const targets: CtcTarget[] = []
          let ui = 0
          for (const line of pinyinLines) {
            for (const unit of line.units) {
              for (const group of unit.symbolGroups) {
                const ids: number[] = []
                for (const symbol of group) {
                  const id = phonemeVocabById[symbol]
                  if (id !== undefined) ids.push(id)
                }
                if (ids.length > 0) targets.push({ unitIndex: ui, ids })
              }
              ui += 1
            }
          }
          if (targets.length === 0) {
            throw new Error('歌词未能映射出任何音素，无法做约束对齐')
          }
          if (controller.signal.aborted) return

          const frameSec = 0.02 // wav2vec2 帧移 20ms
          const result = ctcViterbiAlign(
            data.logits,
            data.numFrames,
            data.numPhonemes,
            targets,
            blankId,
            frameSec,
          )

          const rawUnits: G2pUnit[] = []
          const known: { unitIndex: number; start: number; end: number }[] = []
          ui = 0
          for (const line of pinyinLines) {
            for (const unit of line.units) {
              rawUnits.push({
                text: unit.text,
                phones: unit.symbolGroups.map((g) => g[0] ?? ''),
              })
              const span = result.unitSpans[ui]
              if (span && span.start >= 0) {
                known.push({ unitIndex: ui, start: span.start, end: span.end })
              }
              ui += 1
            }
          }
          alignedUnits = interpolateUnits(rawUnits, known, recogInput as AlignedPhone[])
          g2pLines = toG2pLines(pinyinLines)
          chatNote = `确定性 G2P · CTC 约束对齐完成（${targets.length} 个音素）`
        } else {
          // 旧引擎：LLM G2P → DTW
          const g2p = await runG2pAgent({
            lyrics: cleanedLyrics,
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
          alignedUnits = alignUnitsToPhones(g2p.units, recogInput as AlignedPhone[])
          g2pLines = g2p.lines
          updateChatHistory(g2p.agent)
          chatNote = `G2P ${g2p.units.length} 单元 · DTW 对齐完成`
        }

        const lrc = buildAlignLrc(alignedUnits, g2pLines).trim()
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
        appendChatMessage('assistant', chatNote)
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
    [appendChatMessage, engine, persistAlignedLrc, updateChatHistory],
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
    (phoneList?: AlignedPhone[], segments?: HypSegment[]) => {
      const text = lyricsRef.current.trim()
      if (!text) {
        setAlignError('请先粘贴或载入歌词文本')
        return
      }
      if (engine === 'zipformer') {
        const segs = segments ?? zipSegments
        if (!segs || segs.length === 0) {
          setAlignError('请先完成 Zipformer 识别')
          return
        }
        void runAlign(segs, text, undefined)
      } else {
        const targets = phoneList ?? phones
        if (!targets || targets.length === 0) {
          setAlignError('请先完成音素识别')
          return
        }
        void runAlign(
          targets,
          text,
          alignModel.source === 'custom' ? alignModel.modelKey : undefined,
        )
      }
    },
    [phones, zipSegments, runAlign, alignModel, engine],
  )

  const handleSend = useCallback(() => {
    stickToBottomRef.current = true
    void sendChat(draft)
  }, [draft, sendChat])

  const handleStop = useCallback(() => {
    alignAbortRef.current?.abort()
  }, [])

  /** 切换引擎：清空旧引擎的识别结果（识别模型不同），等待重新识别 */
  const handleEngineChange = useCallback(
    (next: AlignEngine) => {
      if (next === engine) return
      setEngine(next)
      setPhones(undefined)
      setZipSegments(undefined)
      setRows(undefined)
      resetAlign()
    },
    [engine, resetAlign],
  )

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
      engineLabel?: AlignEngine,
    ) => {
      try {
        const sidecarPath = phonemeSidecarPath(audioPath)
        await writeTextOrCreate(
          sidecarPath,
          buildPhonemeSidecarText({
            duration,
            sampleRate,
            provider: providerLabel,
            engine: engineLabel,
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
      setZipSegments(undefined)
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
        if (engine === 'zipformer') {
          // Zipformer 识别：输出 token 段 + 时间戳
          const { segments } = await enqueueAiTask<
            ZipformerProgress,
            { segments: HypSegment[]; text: string }
          >(
            'align-zipformer',
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
                  return { action: 'resolve', value: { segments: msg.segments, text: msg.text } }
                }
                return { action: 'reject', error: new Error(msg.message) }
              },
            },
          )
          if (abort.signal.aborted) return
          setRecogPhase('done')
          setZipSegments(segments)
          const phonesFromSegs = zipSegmentsToPhones(segments)
          setPhones(phonesFromSegs)
          setRecogEngine('zipformer')
          if (audioPath) {
            await savePhonemeSidecar(
              audioPath,
              phonesFromSegs,
              providerRef.current,
              duration,
              sampleRate,
              'zipformer',
            )
          }
          if (abort.signal.aborted) return
          setBusy(false)
          void startAlignIfReady(undefined, segments)
        } else {
          // wav2vec2 识别（歌词约束 / 旧方案引擎共用）
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
          logitsRef.current = { logits, numFrames, numPhonemes }
          const { rows: frameRows, phones: phoneList } = await decodeLogits(
            logits,
            numFrames,
            numPhonemes,
          )
          if (abort.signal.aborted) return
          setRows(frameRows)
          setPhones(phoneList)
          setRecogEngine('wav2vec2')
          if (audioPath) {
            await savePhonemeSidecar(
              audioPath,
              phoneList,
              providerRef.current,
              duration,
              sampleRate,
              'wav2vec2',
            )
          }
          if (abort.signal.aborted) return
          setBusy(false)
          startAlignIfReady(phoneList)
        }
      } catch (cause) {
        if (abort.signal.aborted) return
        setRecogLoadFallback(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
    },
    [decodeLogits, engine, resetAlign, savePhonemeSidecar, startAlignIfReady],
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
          // 按旁存引擎解读：zipformer 旁存 → 恢复 token 段
          const sidecarEngine = parsed.engine as AlignEngine | undefined
          const restoredSegments =
            sidecarEngine === 'zipformer'
              ? parsed.phones.map((p) => ({ symbol: p.symbol, start: p.start, end: p.end }))
              : undefined
          if (restoredSegments) setZipSegments(restoredSegments)
          else setZipSegments(undefined)
          setRecogEngine(sidecarEngine ?? 'wav2vec2')
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
                // 旧版本可能把 LRC 时间戳当歌词逐字对齐（坏 LRC）：跳过恢复，提示重新对齐
                if (looksLikeBrokenLrc(restored)) {
                  console.warn(
                    '对齐结果旁存疑似歌词时间戳未剥离（坏 LRC），已跳过恢复，请重新对齐',
                    alignedLrcPath,
                  )
                  setAlignRestoredFrom(undefined)
                } else {
                  alignResultRef.current = restored
                  setAlignResult(restored)
                  setAlignState('done')
                  setAlignRestoredFrom(alignedLrcPath)
                  restoredAlign = true
                }
              }
            }
          } catch (cause) {
            console.warn('对齐结果旁存载入失败，已忽略', cause)
          }
          if (!restoredAlign) {
            if (restoredSegments) {
              startAlignIfReady(undefined, restoredSegments)
            } else {
              startAlignIfReady(parsed.phones)
            }
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
      const cleaned = stripLrcMarkup(text).trim()
      if (!cleaned) {
        setAlignError('歌词文件中没有可用的文本内容（已自动剥离 LRC 时间戳）')
        return
      }
      setLyrics(cleaned)
      lyricsRef.current = cleaned
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
            <div class="align__engine-switch" role="group" aria-label="对齐引擎">
              {ENGINE_OPTIONS.map((e) => (
                <button
                  type="button"
                  key={e}
                  class={`align__engine-switch-btn${engine === e ? ' align__engine-switch-btn--active' : ''}`}
                  disabled={busy || turnRunning}
                  onClick={() => handleEngineChange(e)}
                  title={ENGINE_TITLES[e]}
                >
                  {ENGINE_LABEL[e]}
                </button>
              ))}
            </div>
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
              {recogEngine && (
                <span class="align__engine" title={`识别结果来自引擎「${ENGINE_LABEL[recogEngine]}」`}>
                  识别·{ENGINE_LABEL[recogEngine]}
                </span>
              )}
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
                    {engine === 'zipformer' ? (
                      <>
                        引擎：Zipformer-CTC 中文识别（字级时间戳），确定性、无 LLM
                        <br />
                        模型：{ZIPFORMER_MODEL_LABEL}（
                        {Math.round(ZIPFORMER_MODEL_BYTES / 1024 / 1024)} MB）
                      </>
                    ) : engine === 'wav2vec2' ? (
                      <>
                        引擎：歌词约束 CTC 对齐（确定性 G2P + Viterbi）
                        <br />
                        模型：{PHONEME_MODEL_LABEL}（
                        {Math.round(PHONEME_MODEL_BYTES / 1024 / 1024)} MB）
                      </>
                    ) : (
                      <>
                        引擎：LLM 转音素 + 音素 DTW（旧方案）
                        <br />
                        模型：{PHONEME_MODEL_LABEL}（
                        {Math.round(PHONEME_MODEL_BYTES / 1024 / 1024)} MB）
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  {busy && !rows && (
                    <div class="align__progress-card">
                      <div class="align__section-title">识别进度</div>
                      <div class="align__progress-phase">
                        {recogPhase === 'unpacking' && '正在解包分轨压缩包，提取人声轨…'}
                        {recogPhase === 'loading' &&
                          (engine === 'zipformer'
                            ? '正在加载 Zipformer 模型…'
                            : '正在加载 wav2vec2 模型…')}
                        {recogPhase === 'running' && '正在运行语音识别…'}
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
                      placeholder="粘贴歌词（可直接粘贴 .lrc 内容，时间戳会自动剥离）…"
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
