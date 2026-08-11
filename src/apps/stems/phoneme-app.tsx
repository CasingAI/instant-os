import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { isModelCached, PHONEME_MODEL_LABEL, PHONEME_MODEL_URL } from '../../os/model-cache.ts'
import { filesCreateText, filesReadText, filesStat, filesWriteText } from '../files/files-api.ts'
import { ensureTmpFolder } from '../files/files-tmp.ts'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureUserSpecialFolders, userSpecialFolderPath } from '../files/files-user-special.ts'
import { resolveNodeByAbsolutePath, readFileBlob } from '../files/files-vfs.ts'
import { VscodeIcon } from '../../icons/app-icons.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import { InvestigationPanel, LiveTimeline } from '../vscode/vscode-ai-chat-surface.tsx'
import { VscodeAiComposerBlock } from '../vscode/vscode-ai-panel.tsx'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  resolveVscodeAiModelKey,
  tokenizerFamilyForVscodeAiModelKey,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
  type VscodeModelPickerDecoded,
} from '../vscode/vscode-ai-models.ts'
import {
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  type VscodeAiContextUsage,
} from '../vscode/vscode-ai-context-usage.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import type {
  VscodeAiAgentProgress,
  VscodeAiAgentResult,
  VscodeAiInvestigation,
} from '../vscode/vscode-ai-agent.ts'
import {
  loadVscodePrefs,
  saveVscodePrefs,
  type VscodeAiModelOptionPrefs,
  type VscodeModelSource,
} from '../vscode/vscode-prefs.ts'
import { createVscodeTerminalSessionId } from '../vscode/vscode-terminal-sessions.ts'
import type OpenAI from 'openai'
import type { AlignedPhone, PhonemeEngineProvider, PhonemeProgress } from './phoneme-types.ts'
import { enqueueAiTask } from '../../ai/ai-inference-service.ts'
import {
  buildPhonemeAlignContext,
  createPhonemeAlignTools,
  createPhonemeRunCommandHost,
  runPhonemeAlignAgent,
  runPhonemeChatAgent,
} from './phoneme-align-agent.ts'
import {
  buildPhonemeSidecarText,
  buildPhonemeWorkspaceFiles,
  countAlignedLrcLines,
  extractLrcFromAnswer,
  parsePhonemeSidecarText,
  phonemeAlignedLrcPath,
  phonemeSidecarPath,
  PHONEME_ALIGN_LRC_FILE,
  PHONEME_ALIGN_LYRICS_FILE,
  PHONEME_ALIGN_PHONES_FILE,
  PHONEME_ALIGN_WORKSPACE_SUBDIR,
} from './phoneme-align-workspace.ts'
import {
  PhonemeTerminalHost,
  PHONEME_DEFAULT_WORKSPACE,
  type PhonemeTerminalHostApi,
} from './phoneme-terminal-host.tsx'
import { PhonemeAlignView } from './phoneme-align-view.tsx'
import { ipaToPinyin } from './phoneme-ipa-mapping.ts'
import { loadStemsArchive, STEMS_ARCHIVE_EXTENSION } from './stems-persistence.ts'
import '../help/help.css'
import '../vscode/vscode-ai.css'
import './phoneme.css'

/** 每帧显示 top-K 音素 */
const TOP_K = 3
/** 结果列表最多显示的行数 */
const MAX_ROWS = 200
/** 模型选择记忆存储键 */
const ALIGN_MODEL_STORAGE_KEY = 'phoneme:align-model'
/** composer 上下文占用估算的防抖时长（与 ProDude 一致） */
const CONTEXT_USAGE_DEBOUNCE_MS = 280

/** CTC 特殊标记（非真实音素）：空白 / 句界 / 未知 */
const PHONEME_SPECIAL_SYMBOLS = new Set(['<pad>', '<s>', '</s>', '<unk>'])
function isPhonemeSpecialSymbol(symbol: string): boolean {
  return PHONEME_SPECIAL_SYMBOLS.has(symbol)
}

/** 音素 ID → IPA 符号（倒排 vocab.json） */
let phonemeVocab: string[] | null = null
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
  /** 帧时间（秒） */
  time: number
  /** argmax 音素符号 */
  argmax: string
  /** top-K [符号, 概率] */
  top: [string, number][]
}

/** Agent 对齐面板的状态机 */
type AlignState = 'idle' | 'running' | 'done' | 'error'

/** 对话消息（对齐轮的用户消息 = 歌词摘要 + 歌词原文） */
type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  investigation?: VscodeAiInvestigation
}

/** 调查时间线为空时不附加（与 ProDude 一致，避免空折叠面板） */
function nonEmptyInvestigation(
  investigation: VscodeAiInvestigation,
): VscodeAiInvestigation | undefined {
  return investigation.activities.length > 0 || investigation.timeline.length > 0
    ? investigation
    : undefined
}

/**
 * 写文本文件：不存在则创建（filesCreateText），存在则覆盖（filesWriteText）。
 * filesWriteText 只覆盖已有文件，首次创建必须走 filesCreateText，否则报「文件不存在」。
 */
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

export function PhonemeApp() {
  const { showSystemOpenDialog, dialog: systemDialog } = useSystemOpenDialog()
  const [sourceName, setSourceName] = useState('')
  /** 从 .stems.zip 载入时记录原始源文件名（manifest.sourceName），用于「人声轨」徽章 */
  const [archiveSource, setArchiveSource] = useState<string | null>(null)
  const [provider, setProvider] = useState<PhonemeEngineProvider | null>(null)
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
  const [modelCached, setModelCached] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioInfo, setAudioInfo] = useState<{ duration: number; sampleRate: number } | null>(null)
  const [rows, setRows] = useState<FrameRow[] | null>(null)
  const [phones, setPhones] = useState<AlignedPhone[] | null>(null)
  const pendingAudioRef = useRef<{ audio: Float32Array; sampleRate: number } | null>(null)
  /** 识别任务的取消控制器：重新识别 / 卸载时 abort 在途任务（调度器负责释放模型） */
  const recogAbortRef = useRef<AbortController | null>(null)

  // —— 识别进度 ——
  type RecogPhase = 'idle' | 'unpacking' | 'loading' | 'running' | 'done'
  const [recogPhase, setRecogPhase] = useState<RecogPhase>('idle')
  const [recogProgress, setRecogProgress] = useState<{ chunk: number; total: number } | null>(null)

  // —— 歌词对齐状态 ——
  const [lyrics, setLyrics] = useState('')
  const lyricsRef = useRef('')
  const [lyricsSourceName, setLyricsSourceName] = useState('')
  const [alignState, setAlignState] = useState<AlignState>('idle')
  const [liveProgress, setLiveProgress] = useState<VscodeAiAgentProgress | null>(null)
  const [alignResult, setAlignResult] = useState('')
  const [alignError, setAlignError] = useState<string | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  /** 对齐写入进度（轮询 aligned.lrc 已写入行数） */
  const [alignProgress, setAlignProgress] = useState<{ lines: number; total: number } | null>(
    null,
  )
  /** 复制音素+歌词后的瞬时提示 */
  const [copiedHint, setCopiedHint] = useState<string | null>(null)
  /** 双轨对齐视图（整窗全屏）开关 */
  const [alignViewOpen, setAlignViewOpen] = useState(false)
  const alignAbortRef = useRef<AbortController | null>(null)
  /** 隐藏挂载的 Agent 终端 API（PhonemeTerminalHost 就绪后提供） */
  const terminalApiRef = useRef<PhonemeTerminalHostApi | null>(null)
  /** 本对话的终端 ownerId / 工作区（跨轮保留；resetAlign 才关闭） */
  const alignSessionRef = useRef<string | null>(null)
  const alignWorkspaceRef = useRef<string | null>(null)
  const alignPollRef = useRef<number | null>(null)

  // —— 多轮对话 ——
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const chatMessagesRef = useRef<ChatMessage[]>([])
  /** 上一轮的续聊历史（wireMessages 优先，纯文本兜底） */
  const chatHistoryRef = useRef<OpenAI.Chat.ChatCompletionMessageParam[] | null>(null)
  const [chatRunning, setChatRunning] = useState(false)
  /** composer 聊天输入 */
  const [draft, setDraft] = useState('')
  /** composer 上下文占用环（估算 + Agent 返回后校准；ProDude 同款接线） */
  const [composerContextUsage, setComposerContextUsage] = useState<
    VscodeAiContextUsage | undefined
  >(undefined)
  /** 当前展示的 alignResult，供聊天轮检测 Agent 是否改动了 aligned.lrc */
  const alignResultRef = useRef('')

  // —— 识别结果旁存 ——
  /** 当前音频绝对路径（识别完成时写入 {同名}.phones.tsv） */
  const audioPathRef = useRef<string | null>(null)
  const providerRef = useRef<PhonemeEngineProvider | null>(null)
  const [recogSavedTo, setRecogSavedTo] = useState<string | null>(null)
  const [recogLoaded, setRecogLoaded] = useState(false)
  /** 旁存保存失败原因（非空时红字提示；成功后清空） */
  const [recogSaveError, setRecogSaveError] = useState<string | null>(null)
  /** 旁存载入兜底原因（非空时提示「未找到旁存，正在重新识别」；成功后清空） */
  const [recogLoadFallback, setRecogLoadFallback] = useState<string | null>(null)

  // —— 对齐结果旁存（{同名}.aligned.lrc，重开同音频恢复，免重新对齐）——
  /** 上次对齐结果自动保存到的路径（非空时提示） */
  const [alignSavedTo, setAlignSavedTo] = useState<string | null>(null)
  /** 对齐结果旁存保存失败原因（非空时红字提示；成功后清空） */
  const [alignSidecarError, setAlignSidecarError] = useState<string | null>(null)
  /** 本次打开从旁存恢复了对齐结果的路径（非空时提示「已恢复上次对齐」） */
  const [alignRestoredFrom, setAlignRestoredFrom] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  // —— 共享 Agent composer（与 ProDude 同款）：模型选择（跨会话记忆）——
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()
  const [alignModel, setAlignModel] = useState<VscodeModelPickerDecoded>(() => {
    try {
      const saved = localStorage.getItem(ALIGN_MODEL_STORAGE_KEY)
      if (saved) return decodeVscodeModelPickerValue(saved)
    } catch {
      // localStorage 不可用时忽略
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

  /** 解码 logits → 每帧 top-K + 合并连续相同音素的时间段 */
  const decodeLogits = useCallback(
    async (logits: Float32Array, numFrames: number, numPhonemes: number) => {
      const vocab = await loadVocab()
      const frameSec = 0.02 // 每帧 20ms（16kHz 下 wav2vec2 帧移 320/16000）
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

  const handleTerminalApiChange = useCallback((api: PhonemeTerminalHostApi | null) => {
    terminalApiRef.current = api
  }, [])

  /** 停止 aligned.lrc 进度轮询 */
  const stopAlignPoll = useCallback(() => {
    if (alignPollRef.current !== null) {
      window.clearInterval(alignPollRef.current)
      alignPollRef.current = null
    }
  }, [])

  /** 关闭本对话的终端会话（释放 QuickJS 实例；工作区文件留在 tmp，下次启动自动清理） */
  const closeAlignTerminal = useCallback(() => {
    const api = terminalApiRef.current
    const sessionId = alignSessionRef.current
    if (api && sessionId) {
      api.closeAiTerminal('agent', sessionId)
    }
    alignSessionRef.current = null
    alignWorkspaceRef.current = null
  }, [])

  /** 清空本次对话（新音频/重新开始）：中止、关闭终端会话、清消息 */
  const resetAlign = useCallback(() => {
    alignAbortRef.current?.abort()
    alignAbortRef.current = null
    stopAlignPoll()
    closeAlignTerminal()
    setAlignState('idle')
    setLiveProgress(null)
    setAlignResult('')
    alignResultRef.current = ''
    setAlignError(null)
    setSavedTo(null)
    setAlignProgress(null)
    setAlignSavedTo(null)
    setAlignSidecarError(null)
    setAlignRestoredFrom(null)
    setChatRunning(false)
    setChatMessages([])
    chatMessagesRef.current = []
    chatHistoryRef.current = null
    setComposerContextUsage(undefined)
  }, [closeAlignTerminal, stopAlignPoll])

  /** 追加一条对话消息（ref + state 同步） */
  const appendChatMessage = useCallback(
    (role: 'user' | 'assistant', content: string, extras?: Partial<ChatMessage>) => {
      const message: ChatMessage = { role, content, ...extras }
      chatMessagesRef.current = [...chatMessagesRef.current, message]
      setChatMessages(chatMessagesRef.current)
    },
    [],
  )

  /** 本轮结束后更新续聊历史（wireMessages 优先，纯文本兜底） */
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

  /** 懒创建终端会话 + 工作区（跨轮保留；resetAlign 才关闭） */
  const ensureAlignSession = useCallback(async () => {
    const api = terminalApiRef.current
    if (!api) throw new Error('对齐终端未就绪，请稍后重试')
    const existing = alignSessionRef.current
    if (existing && alignWorkspaceRef.current) {
      return { api, sessionId: existing, workspaceDir: alignWorkspaceRef.current }
    }
    // 会话 tmpdir/phoneme-align：tmp 卷永远可写、不记 ChangeSet、开机自动清理
    const sessionId = createVscodeTerminalSessionId()
    alignSessionRef.current = sessionId
    const ensured = await api.ensureAiTerminal('agent', sessionId, '歌词对齐')
    const workspaceDir = joinFilesAbsolutePath(
      ensured.handle.getTmpDir(),
      PHONEME_ALIGN_WORKSPACE_SUBDIR,
    )
    await ensureTmpFolder(workspaceDir)
    await writeTextOrCreate(joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_LRC_FILE), '')
    alignWorkspaceRef.current = workspaceDir
    return { api, sessionId, workspaceDir }
  }, [])

  /** 把当前素材写进工作区（对齐轮开始前调用；聊天轮不调用，避免覆盖 Agent 改过的文件） */
  const writeAlignMaterials = useCallback(
    async (workspaceDir: string, phoneList: AlignedPhone[], lyricsText: string) => {
      // 自愈：确保工作区目录链存在再写入（tmp 卷可能被清理或目录状态陈旧）
      await ensureTmpFolder(workspaceDir)
      const files = buildPhonemeWorkspaceFiles({ lyrics: lyricsText, phoneList })
      await writeTextOrCreate(
        joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_LYRICS_FILE),
        files.lyricsText,
      )
      await writeTextOrCreate(
        joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_PHONES_FILE),
        files.phonesTsv,
      )
    },
    [],
  )

  /** 对齐结果旁存到音频同目录（{同名}.aligned.lrc）：重开同音频恢复，免重新对齐 */
  const persistAlignedLrc = useCallback(async (audioPath: string, lrcText: string) => {
    try {
      const lrcPath = phonemeAlignedLrcPath(audioPath)
      await writeTextOrCreate(lrcPath, lrcText)
      setAlignSavedTo(lrcPath)
      setAlignSidecarError(null)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      console.error('对齐结果旁存保存失败', cause)
      setAlignSavedTo(null)
      setAlignSidecarError(`对齐结果旁存写入失败：${reason}`)
    }
  }, [])

  /** 对齐轮：写素材 → Agent 用终端逐行写 aligned.lrc → 展示结果并加入对话 */
  const runAlign = useCallback(
    async (phoneList: AlignedPhone[], lyricsText: string, modelKey: string | undefined) => {
      if (alignAbortRef.current) return
      const controller = new AbortController()
      alignAbortRef.current = controller
      stopAlignPoll()
      setAlignState('running')
      setLiveProgress(null)
      setAlignResult('')
      alignResultRef.current = ''
      setAlignError(null)
      setSavedTo(null)
      setAlignProgress(null)
      const totalLines = lyricsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
      appendChatMessage(
        'user',
        `歌词 ${totalLines} 行 · ${phoneList.length} 音素\n\n${lyricsText.trim()}`,
      )
      try {
        const { api, sessionId, workspaceDir } = await ensureAlignSession()
        if (controller.signal.aborted) return
        await writeAlignMaterials(workspaceDir, phoneList, lyricsText)
        await writeTextOrCreate(joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_LRC_FILE), '')
        if (controller.signal.aborted) return
        alignWorkspaceRef.current = workspaceDir

        // 轮询 aligned.lrc 已写入行数 → 头部徽章实时进度
        const alignedPath = joinFilesAbsolutePath(workspaceDir, PHONEME_ALIGN_LRC_FILE)
        alignPollRef.current = window.setInterval(() => {
          if (controller.signal.aborted) return
          void filesReadText(alignedPath)
            .then((text) => {
              if (controller.signal.aborted) return
              setAlignProgress({ lines: countAlignedLrcLines(text), total: totalLines })
            })
            .catch(() => {
              // 文件尚未建立，忽略
            })
        }, 1200)

        const result = await runPhonemeAlignAgent({
          lyrics: lyricsText,
          phoneList,
          workspaceDir,
          terminalApi: api,
          chatSessionId: sessionId,
          chatTitle: '歌词对齐',
          workspaceFolder: PHONEME_DEFAULT_WORKSPACE,
          signal: controller.signal,
          modelKey,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            setLiveProgress(progress)
            if (progress.contextUsage) {
              setComposerContextUsage(progress.contextUsage)
            }
          },
        })
        if (controller.signal.aborted) return
        stopAlignPoll()
        // 优先用 Agent 写入工作区的 aligned.lrc；没走完文件流程时回退提取回复正文
        const aligned = (result.alignedLrc ?? extractLrcFromAnswer(result.text)).trim()
        if (!aligned) {
          setAlignError(`Agent 未产出可用的对齐结果（工作区：${workspaceDir}），请重试`)
          setAlignState('error')
          return
        }
        setAlignResult(aligned)
        alignResultRef.current = aligned
        setAlignProgress({ lines: countAlignedLrcLines(aligned), total: totalLines })
        setAlignState('done')
        // 旁存到音频同目录：重开同音频时恢复，免重新对齐
        if (audioPathRef.current) {
          void persistAlignedLrc(audioPathRef.current, aligned)
        }
        updateChatHistory(result)
        appendChatMessage('assistant', result.text.trim() || `全部 ${totalLines} 行已写入 aligned.lrc`, {
          investigation: nonEmptyInvestigation(result.investigation),
        })
      } catch (cause) {
        if (controller.signal.aborted) {
          stopAlignPoll()
          setAlignProgress(null)
          setAlignState('idle')
          return
        }
        stopAlignPoll()
        setAlignError(cause instanceof Error ? cause.message : String(cause))
        setAlignState('error')
      } finally {
        stopAlignPoll()
        if (alignAbortRef.current === controller) alignAbortRef.current = null
      }
    },
    [appendChatMessage, ensureAlignSession, stopAlignPoll, updateChatHistory, writeAlignMaterials, persistAlignedLrc],
  )

  /** 聊天轮：自由对话（Agent 可改 aligned.lrc，改完刷新结果展示） */
  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || alignAbortRef.current) return
      const controller = new AbortController()
      alignAbortRef.current = controller
      setDraft('')
      setChatRunning(true)
      setLiveProgress(null)
      setAlignError(null)
      appendChatMessage('user', trimmed)
      try {
        const { api, sessionId, workspaceDir } = await ensureAlignSession()
        if (controller.signal.aborted) return
        const result = await runPhonemeChatAgent({
          userMessage: trimmed,
          history: chatHistoryRef.current ?? undefined,
          workspaceDir,
          terminalApi: api,
          chatSessionId: sessionId,
          chatTitle: '歌词对齐',
          workspaceFolder: PHONEME_DEFAULT_WORKSPACE,
          signal: controller.signal,
          modelKey: alignModel.source === 'custom' ? alignModel.modelKey : undefined,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            setLiveProgress(progress)
            if (progress.contextUsage) {
              setComposerContextUsage(progress.contextUsage)
            }
          },
        })
        if (controller.signal.aborted) return
        updateChatHistory(result)
        appendChatMessage('assistant', result.text.trim() || '（无回复）', {
          investigation: nonEmptyInvestigation(result.investigation),
        })
        // Agent 可能直接改了 aligned.lrc → 刷新结果展示
        const lrc = (result.alignedLrc ?? '').trim()
        if (lrc && lrc !== alignResultRef.current) {
          alignResultRef.current = lrc
          setAlignResult(lrc)
          setAlignState('done')
          // Agent 改过的对齐结果同样旁存，保持恢复的是最新版
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
        if (alignAbortRef.current === controller) alignAbortRef.current = null
        setChatRunning(false)
        setLiveProgress(null)
      }
    },
    [alignModel, appendChatMessage, ensureAlignSession, updateChatHistory, persistAlignedLrc],
  )

  /** 识别完成 / 手动点击共用入口：有歌词才真正启动 */
  const startAlignIfReady = useCallback(
    (phoneList: AlignedPhone[] | null) => {
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

  /** composer 发送 = 聊天轮（与 Agent 自由对话） */
  const handleSend = useCallback(() => {
    stickToBottomRef.current = true
    void sendChat(draft)
  }, [draft, sendChat])

  /** composer 停止 = 中止当前轮（保留会话与消息，可继续对话） */
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
      // 持久化失败忽略
    }
  }, [])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
  }, [])

  /** 识别完成 → 旁存到音频同目录（避免下次重新识别） */
  const savePhonemeSidecar = useCallback(
    async (
      audioPath: string,
      phoneList: AlignedPhone[],
      providerLabel: PhonemeEngineProvider | null,
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
            provider: providerLabel ?? undefined,
            phoneList,
          }),
        )
        setRecogSavedTo(sidecarPath)
        setRecogSaveError(null)
        setRecogLoadFallback(null)
      } catch (cause) {
        // 目标目录只读等：不阻塞主流程，但必须让用户看到，否则「没保存」无从查起
        const reason = cause instanceof Error ? cause.message : String(cause)
        console.error('识别结果旁存保存失败', cause)
        setRecogSavedTo(null)
        setRecogSaveError(`旁存写入失败：${reason}`)
      }
    },
    [],
  )

  /** 启动识别（打开文件与拖放文件共用），经由 AI 推理调度服务执行 */
  const startRecognition = useCallback(
    async (audio: Float32Array, sampleRate: number, duration: number) => {
      setError(null)
      setRows(null)
      setPhones(null)
      setBusy(true)
      setRecogPhase('loading')
      setRecogProgress(null)
      setAudioInfo({ duration, sampleRate })
      pendingAudioRef.current = { audio, sampleRate }
      setRecogSavedTo(null)
      setRecogLoaded(false)
      resetAlign()

      recogAbortRef.current?.abort()
      const abort = new AbortController()
      recogAbortRef.current = abort

      // 本次识别对应的音频路径：任务完成时再读 ref 可能已指向别的文件
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
        const { rows, phones: phoneList } = await decodeLogits(logits, numFrames, numPhonemes)
        if (abort.signal.aborted) return
        setRows(rows)
        setPhones(phoneList)
        // 先落盘再放行：否则用户识别完立刻重开同一文件时旁存还没写完，会再次触发识别
        if (audioPath) {
          await savePhonemeSidecar(audioPath, phoneList, providerRef.current, duration, sampleRate)
        }
        if (abort.signal.aborted) return
        setBusy(false)
        startAlignIfReady(phoneList)
      } catch (error) {
        if (abort.signal.aborted) return
        setRecogLoadFallback(null)
        setError(error instanceof Error ? error.message : String(error))
        setBusy(false)
      }
    },
    [decodeLogits, resetAlign, savePhonemeSidecar, startAlignIfReady],
  )

  /** 从音频路径读文件 → 解码 → 识别（「打开文件」与「重新识别」共用） */
  const recognizeAudioPath = useCallback(
    async (path: string) => {
      const node = await resolveNodeByAbsolutePath(path)
      if (!node || node.kind !== 'file') return
      setSourceName(node.name)
      setError(null)
      setRows(null)
      setPhones(null)
      setRecogSavedTo(null)
      setRecogLoaded(false)
      setArchiveSource(null)
      try {
        const { blob } = await readFileBlob(node.id)
        // 已分轨压缩包（.stems.zip）：解包直接取 vocals 人声轨，跳过原始混音解码
        if (path.endsWith(STEMS_ARCHIVE_EXTENSION)) {
          setBusy(true)
          setRecogPhase('unpacking')
          const { manifest, stems } = await loadStemsArchive(blob)
          const vocals = stems.find((stem) => stem.stemId === 'vocals')
          if (!vocals) throw new Error('分轨压缩包中没有 vocals 人声轨，无法识别')
          setArchiveSource(manifest.sourceName)
          await startRecognition(vocals.data, manifest.sampleRate, manifest.durationSec)
          return
        }
        const arrayBuffer = await blob.arrayBuffer()
        const audioContext = new AudioContext()
        try {
          const decoded = await audioContext.decodeAudioData(arrayBuffer)
          const channelData = decoded.getChannelData(0)
          const interleaved = new Float32Array(decoded.length * 2)
          for (let i = 0; i < decoded.length; i++) {
            const v = channelData[i]
            interleaved[i * 2] = v
            interleaved[i * 2 + 1] = v
          }
          await startRecognition(interleaved, decoded.sampleRate, decoded.duration)
        } finally {
          void audioContext.close()
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
    },
    [startRecognition],
  )

  /** 打开文件 → 有旁存识别结果直接载入（跳过模型），否则重新识别 */
  const handlePickFile = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择要识别的音频或分轨文件',
      acceptExtensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'stems.zip'],
    })
    if (!path) return
    audioPathRef.current = path
    setRecogSavedTo(null)
    setRecogLoaded(false)
    setRecogSaveError(null)
    setRecogLoadFallback(null)
    setArchiveSource(null)
    resetAlign() // 换歌：清空上一首的对话与终端会话
    // 优先载入旁存的识别结果（{同名}.phones.tsv），避免每次测试重新识别
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
          setRows(null)
          setAudioInfo(
            parsed.duration !== undefined && parsed.sampleRate !== undefined
              ? { duration: parsed.duration, sampleRate: parsed.sampleRate }
              : null,
          )
          const loadedProvider = parsed.provider
            ? (parsed.provider as PhonemeEngineProvider)
            : null
          setProvider(loadedProvider)
          providerRef.current = loadedProvider
          setRecogPhase('done')
          setRecogSavedTo(sidecarPath)
          setRecogLoaded(true)
          // 恢复上次对齐结果（{同名}.aligned.lrc）：有则直接可用，免重新对齐
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
            // 对齐结果旁存损坏/不可读：不阻塞，重新对齐即可
            console.warn('对齐结果旁存载入失败，已忽略', cause)
          }
          // 有恢复的对齐结果时不再自动重跑对齐（避免覆盖），要重跑点「开始对齐」
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

  /** 从 .lrc / .txt 文件读取歌词 */
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
      setAlignError(null)
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [showSystemOpenDialog])

  /** 复制对齐结果 */
  const handleCopyResult = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(alignResult)
      setSavedTo('已复制到剪贴板')
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [alignResult])

  /** 复制音素序列（时间戳 + 拼音 + 原始 IPA）与歌词原文 */
  const handleCopyPhonesAndLyrics = useCallback(async () => {
    if (!phones || phones.length === 0) return
    const rows: string[] = []
    for (const p of phones) {
      const py = ipaToPinyin(p.symbol)
      if (!py) continue // 跳过 CTC 特殊标记（与发给 Agent 的 XML 一致）
      rows.push(`${p.start.toFixed(2)}-${p.end.toFixed(2)}s\t${py}\t${p.symbol}`)
    }
    const text = [
      '【歌词】',
      lyrics.trim() || '（未输入歌词）',
      '',
      `【音素序列】（${rows.length} 个，时间戳/拼音/IPA）`,
      rows.join('\n'),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedHint('已复制')
    } catch (cause) {
      setCopiedHint(cause instanceof Error ? `复制失败：${cause.message}` : '复制失败')
    }
    window.setTimeout(() => setCopiedHint(null), 2000)
  }, [phones, lyrics])

  /** 保存对齐结果为同名 .lrc 到「音乐」文件夹 */
  const handleSaveResult = useCallback(async () => {
    if (!alignResult) return
    const base =
      sourceName.replace(/\.stems\.zip$/i, '').replace(/\.[^.]+$/, '') || '歌词'
    const path = joinFilesAbsolutePath(userSpecialFolderPath('Musics'), `${base}.lrc`)
    try {
      await ensureUserSpecialFolders()
      await writeTextOrCreate(path, alignResult)
      setSavedTo(path)
      setAlignError(null)
    } catch (cause) {
      setAlignError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [alignResult, sourceName])

  useEffect(() => {
    return () => {
      // 取消在途识别：调度器负责 terminate worker 并释放模型内存
      recogAbortRef.current?.abort()
      alignAbortRef.current?.abort()
      stopAlignPoll()
      closeAlignTerminal()
    }
  }, [closeAlignTerminal, stopAlignPoll])

  /** 新内容到达时跟随滚底（用户上翻查看时暂停跟随） */
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [alignState, chatMessages.length, chatRunning, liveProgress, alignResult])

  const displayedRows = useMemo(() => rows?.slice(0, MAX_ROWS) ?? [], [rows])
  const lyricsLineCount = useMemo(() => lyrics.trim().split(/\n+/).filter(Boolean).length, [lyrics])
  const hasChat = chatMessages.length > 0
  const liveTimeline = liveProgress?.timeline ?? []
  const liveAnswer = liveProgress?.answerText ?? ''
  const showLiveAnswer = liveAnswer.length > 0
  const recognitionReady = (phones?.length ?? 0) > 0
  const turnRunning = alignState === 'running' || chatRunning
  const canAlign =
    recognitionReady && lyrics.trim().length > 0 && !busy && !turnRunning && textModels.length > 0
  const canSend = !busy && !turnRunning && draft.trim().length > 0 && textModels.length > 0
  const composerPlaceholder = !recognitionReady
    ? '先打开音频文件完成音素识别…'
    : alignResult
      ? '继续和 Agent 对话（可让它修改对齐结果）…'
      : '和 Agent 对话，或点「开始对齐」生成逐字 LRC…'
  const modelSelectValue = useMemo(
    () => encodeVscodeModelPickerValue(alignModel.source, alignModel.modelKey),
    [alignModel],
  )

  /** 模型选项（思考开关等）改动 → 持久化，运行时经 openAiConfig 生效 */
  const handleAiModelOptionsChange = useCallback(
    (next: Record<string, VscodeAiModelOptionPrefs>) => {
      setAiModelOptions(next)
      saveVscodePrefs({ ...loadVscodePrefs(), aiModelOptions: next })
    },
    [],
  )

  // —— composer 上下文占用环（与 ProDude 同款：空闲估算 + Agent 返回校准）——
  const alignResolvedModelKey = useMemo(
    () =>
      resolveVscodeAiModelKey({
        aiModelSource: alignModel.source as VscodeModelSource,
        aiModelKey: alignModel.modelKey,
      }),
    [alignModel],
  )
  const alignResolvedModelId = useMemo(
    () => openAiConfigForVscodeAiModelKey(alignResolvedModelKey).defaultModel,
    [alignResolvedModelKey],
  )
  const alignResolvedProviderEntryId = useMemo(
    () => parseVscodeAiModelRefKey(alignResolvedModelKey ?? '')?.providerEntryId,
    [alignResolvedModelKey],
  )
  const alignResolvedTokenizerFamily = useMemo(
    () => tokenizerFamilyForVscodeAiModelKey(alignResolvedModelKey),
    [alignResolvedModelKey],
  )

  useEffect(() => {
    void prepareVscodeAiContextUsage(alignResolvedModelId, alignResolvedTokenizerFamily)
  }, [alignResolvedModelId, alignResolvedTokenizerFamily])

  useEffect(() => {
    if (busy || turnRunning) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await prepareVscodeAiContextUsage(alignResolvedModelId, alignResolvedTokenizerFamily)
        if (cancelled || busy || turnRunning) return
        const api = terminalApiRef.current
        const sessionId = alignSessionRef.current ?? 'phoneme-draft'
        const context = buildPhonemeAlignContext(PHONEME_DEFAULT_WORKSPACE, api, sessionId)
        const toolsHost: VscodeAiToolsHost | undefined = api
          ? {
              getContext: () => context,
              runCommandHost: createPhonemeRunCommandHost({
                workspaceFolder: PHONEME_DEFAULT_WORKSPACE,
                chatSessionId: sessionId,
                chatTitle: '歌词对齐',
                terminalApi: api,
                npmLastChanges: { current: undefined },
                lastChangeSource: { current: undefined },
                turnChangeSessions: { current: [] },
              }),
              chatSessionId: sessionId,
              ensureAiTerminal: (kind, ownerId, title) =>
                api.ensureAiTerminal(kind, ownerId, title),
              getAiTerminalHandle: (kind, ownerId) =>
                api.getAiTerminalHandle(kind, ownerId),
              getAiTerminalSnapshot: (kind, ownerId) =>
                api.getAiTerminalSnapshot(kind, ownerId),
              closeAiTerminal: (kind, ownerId) => api.closeAiTerminal(kind, ownerId),
            }
          : undefined
        const usage = await measureVscodeAiContextUsage({
          mode: 'agent',
          context,
          history: chatHistoryRef.current ?? [],
          userMessage: draft,
          model: alignResolvedModelId,
          providerEntryId: alignResolvedProviderEntryId,
          modelKey: alignResolvedModelKey,
          tokenizerFamily: alignResolvedTokenizerFamily,
          tools: toolsHost ? createPhonemeAlignTools(toolsHost) : undefined,
          aiModelOptions,
        })
        if (cancelled || busy || turnRunning) return
        setComposerContextUsage(usage)
      })()
    }, CONTEXT_USAGE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    aiModelOptions,
    alignResolvedModelId,
    alignResolvedModelKey,
    alignResolvedProviderEntryId,
    alignResolvedTokenizerFamily,
    busy,
    chatMessages,
    draft,
    turnRunning,
  ])

  return (
    <div class="phoneme">
      {alignViewOpen && phones && alignResult ? (
        /* 整窗全屏：双轨对齐视图（音素 ↔ 歌词逐字对应） */
        <PhonemeAlignView
          phones={phones}
          lrcText={alignResult}
          duration={audioInfo?.duration ?? null}
          sourceName={sourceName}
          onClose={() => setAlignViewOpen(false)}
        />
      ) : (
        <>
      {/* 工具栏 */}
      <div class="phoneme__toolbar">
        <span class="phoneme__toolbar-title">歌词对齐</span>
        <IosButton tone="primary" disabled={busy} onClick={() => void handlePickFile()}>
          打开音频 / 分轨…
        </IosButton>
        <IosButton disabled={busy} onClick={() => void handleLoadLyricsFile()}>
          从文件读取歌词
        </IosButton>
        <IosButton
          tone="primary"
          disabled={!canAlign}
          onClick={() => void startAlignIfReady(null)}
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
          <span class="phoneme__lyrics-source" title={lyricsSourceName}>
            {lyricsSourceName}
          </span>
        )}
        {busy && (
            <span class="phoneme__hint">
              {recogPhase === 'unpacking' && '正在解包分轨压缩包…'}
              {recogPhase === 'loading' && '加载模型中…'}
              {recogPhase === 'running' && (recogProgress
                ? `推断中 ${recogProgress.chunk}/${recogProgress.total} 块…`
                : '推断中…')}
            </span>
          )}
        {sourceName && <span class="phoneme__source">{sourceName}</span>}
        {archiveSource && (
          <span
            class="phoneme__lyrics-source phoneme__source-badge"
            title={`人声轨来自「${archiveSource}」的分轨结果`}
          >
            🎤 人声轨
          </span>
        )}

        <div class="phoneme__toolbar-right">
          {provider && (
            <span
              class={`phoneme__engine phoneme__engine--${provider}`}
              title={provider === 'webgpu' ? 'WebGPU 加速' : 'WASM 回退'}
            >
              {provider === 'webgpu' ? 'WebGPU' : 'WASM'}
            </span>
          )}
          {gpuAvailable === false && (
            <span class="phoneme__hint">⚠️ 无 WebGPU，将使用 WASM</span>
          )}
          {modelCached === false && (
            <span class="phoneme__hint">模型未缓存（首次需下载）</span>
          )}
        </div>
      </div>

      {error && <p class="phoneme__error">{error}</p>}

      <div class="phoneme__layout">
        {/* 左侧：音素识别 */}
        <aside class="phoneme__left">
          {!rows && !phones && !busy ? (
            <div class="phoneme__empty">
              <div class="phoneme__empty-icon">🎤</div>
              <p>选择一段音频（或直接打开 .stems.zip 分轨压缩包用里面的人声），运行音素识别</p>
              <p class="phoneme__empty-hint">
                模型：{PHONEME_MODEL_LABEL}（{Math.round(241691639 / 1024 / 1024)} MB）
              </p>
            </div>
          ) : (
            <>
              {busy && !rows && (
                <div class="phoneme__progress-card">
                  <div class="phoneme__section-title">识别进度</div>
                  <div class="phoneme__progress-phase">
                    {recogPhase === 'unpacking' && '正在解包分轨压缩包，提取人声轨…'}
                    {recogPhase === 'loading' && '正在加载 wav2vec2 模型…'}
                    {recogPhase === 'running' && '正在运行音素识别…'}
                  </div>
                  {recogProgress && (
                    <div class="phoneme__progress-bar-wrap">
                      <div
                        class="phoneme__progress-bar"
                        style={{ width: `${Math.round((recogProgress.chunk / recogProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  {recogProgress && (
                    <div class="phoneme__progress-label">
                      {recogProgress.chunk} / {recogProgress.total} 块
                    </div>
                  )}
                </div>
              )}

              {audioInfo && (
                <div class="phoneme__audio-info">
                  <div class="phoneme__section-title">音频信息</div>
                  <div class="phoneme__audio-stats">
                    <span>时长 {audioInfo.duration.toFixed(1)}s</span>
                    <span>{audioInfo.sampleRate}Hz</span>
                    {rows && <span>{rows.length} 帧</span>}
                    {phones && <span>{phones.length} 音素</span>}
                  </div>
                </div>
              )}

              {rows && phones && (
                <div class="phoneme__copy-row">
                  <IosButton onClick={() => void handleCopyPhonesAndLyrics()}>
                    复制音素 + 歌词
                  </IosButton>
                  {copiedHint && <span class="phoneme__hint">{copiedHint}</span>}
                </div>
              )}

              {phones && (
                <details class="phoneme__details">
                  <summary class="phoneme__details-summary">
                    音素识别详情（{phones.length} 个音素段）
                  </summary>
                  <div class="phoneme__details-body">
                    <div class="phoneme__section-title">音素序列</div>
                    <div class="phoneme__phones">
                      {phones.map((p, i) => (
                        <span
                          key={i}
                          class="phoneme__phone"
                          title={`${p.start.toFixed(2)}s - ${p.end.toFixed(2)}s`}
                        >
                          {p.symbol}
                          <span class="phoneme__phone-time">{p.start.toFixed(2)}s</span>
                        </span>
                      ))}
                    </div>

                    {rows && (
                      <>
                        <div class="phoneme__section-title">
                          逐帧 top-{TOP_K}（前 {displayedRows.length} / {rows.length} 帧）
                        </div>
                        <div class="phoneme__table">
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
                                  <td class="phoneme__time">{row.time.toFixed(2)}s</td>
                                  <td class="phoneme__argmax">{row.argmax}</td>
                                  <td class="phoneme__top">
                                    {row.top.map(([symbol, value], j) => (
                                      <span key={j} class="phoneme__top-item">
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

              {/* 识别结果旁存提示 */}
              {recogSavedTo && (
                <div class="phoneme__sidecar-hint">
                  <span
                    title={recogSavedTo}
                  >
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
              {/* 旁存保存失败 / 载入兜底：让「为什么没秒载入」可见可查 */}
              {recogSaveError && (
                <div class="phoneme__sidecar-hint phoneme__sidecar-hint--error" title={recogSaveError}>
                  {recogSaveError}
                </div>
              )}
              {recogLoadFallback && !recogSavedTo && (
                <div
                  class="phoneme__sidecar-hint phoneme__sidecar-hint--warn"
                  title={recogLoadFallback}
                >
                  未找到可载入的识别结果（{recogLoadFallback}），正在重新识别…
                </div>
              )}

              {/* 对齐结果旁存提示：恢复 / 自动保存 / 保存失败 */}
              {alignRestoredFrom && (
                <div class="phoneme__sidecar-hint phoneme__sidecar-hint--restored" title={alignRestoredFrom}>
                  已恢复上次对齐结果（{alignRestoredFrom.split('/').pop() ?? ''}），可直接查看对齐视图
                </div>
              )}
              {alignSavedTo && !alignRestoredFrom && (
                <div class="phoneme__sidecar-hint" title={alignSavedTo}>
                  对齐结果已保存：{alignSavedTo}
                </div>
              )}
              {alignSidecarError && (
                <div class="phoneme__sidecar-hint phoneme__sidecar-hint--error" title={alignSidecarError}>
                  {alignSidecarError}
                </div>
              )}

              {/* 歌词输入 */}
              <div class="phoneme__lyrics-card">
                <div class="phoneme__lyrics-card-head">
                  <span class="phoneme__section-title">歌词</span>
                  <span class="phoneme__lyrics-meta">
                    {lyricsLineCount} 行
                    {lyricsSourceName && (
                      <span class="phoneme__lyrics-source" title={lyricsSourceName}>
                        {lyricsSourceName}
                      </span>
                    )}
                  </span>
                </div>
                <textarea
                  class="phoneme__lyrics-input"
                  value={lyrics}
                  onInput={(e) => handleLyricsChange(e.currentTarget.value)}
                  rows={8}
                  placeholder="粘贴不精确歌词（可多行）…"
                  disabled={turnRunning}
                />
              </div>
            </>
          )}
        </aside>

        {/* 右侧：歌词对齐 + 共享 Agent 聊天壳（与 ProDude 同款） */}
        <div class="phoneme__right">
          <div class="phoneme__align-header">
            <span class="phoneme__section-title">歌词对齐</span>
            {!hasChat && alignState !== 'done' && (
              <span class="phoneme__align-badge phoneme__align-badge--idle">
                {!recognitionReady ? '等待识别' : lyrics.trim() ? '待对齐' : '等待歌词'}
              </span>
            )}
            {alignState === 'running' && (
              <span class="phoneme__align-badge phoneme__align-badge--running">
                {alignProgress
                  ? `Agent 对齐中 · 已写入 ${alignProgress.lines}/${alignProgress.total} 行…`
                  : 'Agent 对齐中…'}
              </span>
            )}
            {chatRunning && (
              <span class="phoneme__align-badge phoneme__align-badge--running">Agent 回复中…</span>
            )}
            {alignState === 'done' && (
              <span class="phoneme__align-badge phoneme__align-badge--done">对齐完成</span>
            )}
            {alignState === 'error' && (
              <span class="phoneme__align-badge phoneme__align-badge--error">对齐失败</span>
            )}
          </div>

          <div class="help-app vscode-ai phoneme__chat-shell help-app--width-full">
            <div
              class="help-app__chat vscode-ai__chat"
              ref={chatScrollRef}
              onScroll={handleChatScroll}
            >
              {!hasChat ? (
                <div class="help-app__welcome vscode-ai__welcome">
                  <div class="help-app__welcome-icon" aria-hidden="true">
                    <VscodeIcon size={56} />
                  </div>
                  <h2 class="help-app__welcome-title">歌词对齐</h2>
                  <p class="help-app__welcome-sub">
                    打开音频或 .stems.zip 分轨压缩包完成音素识别
                    <br />
                    （压缩包直接用里面的人声轨，结果自动保存、下次秒载入），
                    <br />
                    左侧输入歌词后点「开始对齐」生成逐字 LRC，之后可以继续和 Agent 自由对话。
                  </p>
                </div>
              ) : (
                <div class="help-app__messages">
                  {/* 多轮对话消息 */}
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
                            <div class="help-app__answer help-app__answer--plain phoneme__user-msg">
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
                            {message.isError ? '!' : <VscodeIcon size={30} />}
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

                  {/* 运行中：LiveTimeline + 流式文本 */}
                  {turnRunning && (
                    <div class="help-app__message help-app__message--assistant">
                      <div class="vscode-ai__message-main">
                        <span class="help-app__avatar" aria-hidden="true">
                          <VscodeIcon size={30} />
                        </span>
                        <div class="vscode-ai__message-stack">
                          <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                            {/* LiveTimeline 空数组时自带「等待响应」，勿再叠加第二个 */}
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
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 对齐完成：LRC 结果卡片 */}
                  {alignState === 'done' && alignResult && (
                    <div class="help-app__message help-app__message--assistant">
                      <div class="vscode-ai__message-main">
                        <span class="help-app__avatar" aria-hidden="true">
                          <VscodeIcon size={30} />
                        </span>
                        <div class="vscode-ai__message-stack">
                          <div class="help-app__bubble">
                            <div class="phoneme__align-result">
                              <div class="help-app__answer">
                                <HelpMarkdown text={alignResult} />
                              </div>
                              <div class="phoneme__align-result-actions">
                                <IosButton size="compact" onClick={() => void handleCopyResult()}>
                                  复制
                                </IosButton>
                                <IosButton size="compact" onClick={() => void handleSaveResult()}>
                                  保存到「音乐」文件夹
                                </IosButton>
                                <IosButton
                                  size="compact"
                                  onClick={() => void startAlignIfReady(null)}
                                >
                                  重新对齐
                                </IosButton>
                                {savedTo && (
                                  <span class="phoneme__lyrics-source" title={savedTo}>
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

                  {/* 对齐失败 */}
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
                contextUsage={composerContextUsage}
              />
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {/* 隐藏挂载的 Agent 终端（InstantREPL），供对齐 Agent 读写工作区 */}
      <PhonemeTerminalHost
        workspaceFolder={PHONEME_DEFAULT_WORKSPACE}
        onApiChange={handleTerminalApiChange}
      />

      {systemDialog}
    </div>
  )
}