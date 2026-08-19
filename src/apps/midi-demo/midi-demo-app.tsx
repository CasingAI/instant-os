import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import {
  AbcParseError,
  DEFAULT_SAMPLE_ABC,
  parseAbc,
  scoreDurationTicks,
  type Score,
  type ScoreNote,
} from './midi-demo-abc.ts'
import { composeAbcScore, MIDI_DEMO_EXAMPLES } from './midi-demo-agent.ts'
import { decodeMidi, encodeMidi, PIANO_PROGRAM, PIANO_PROGRAM_NAME } from './midi-demo-midi.ts'
import { playDecodedMidi, stopAllMidiPlayback, type MidiPlayHandle } from './midi-demo-play.ts'
import './midi-demo.css'

const APP_ID = 'midi-demo' as const

type Compiled = {
  abc: string
  score: Score
  midi: Uint8Array
  notes: ScoreNote[]
}

function compileAbc(abc: string): Compiled {
  const score = parseAbc(abc)
  const midi = encodeMidi(score)
  const decoded = decodeMidi(midi)
  return { abc, score, midi, notes: decoded.notes }
}

function downloadMidi(bytes: Uint8Array, title: string): void {
  const safe = title.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-|-$/g, '') || 'piano'
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safe}.mid`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const m = Math.floor(clamped / 60)
  const s = Math.floor(clamped % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MidiDemoApp() {
  const { setAppWindowTitle } = useOs()
  const aiReady = useOpenAiReady()
  const [prompt, setPrompt] = useState('C 大调八小节抒情钢琴小品，双手，中等速度')
  const [abc, setAbc] = useState(DEFAULT_SAMPLE_ABC)
  const [compiled, setCompiled] = useState<Compiled | undefined>(() => compileAbc(DEFAULT_SAMPLE_ABC))
  const [compileError, setCompileError] = useState<string | undefined>()
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | undefined>()
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 })
  const abortRef = useRef<AbortController | undefined>(undefined)
  const playRef = useRef<MidiPlayHandle | undefined>(undefined)

  useEffect(() => {
    setAppWindowTitle(APP_ID, compiled?.score.title ? `MIDI 演示 — ${compiled.score.title}` : 'MIDI 演示')
  }, [compiled?.score.title, setAppWindowTitle])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      playRef.current?.stop()
      stopAllMidiPlayback()
    }
  }, [])

  const stopPlayback = useCallback(() => {
    playRef.current?.stop()
    playRef.current = undefined
    setPlaying(false)
    setProgress({ elapsed: 0, total: 0 })
  }, [])

  const applyAbc = useCallback(
    (source = abc) => {
      try {
        stopPlayback()
        const next = compileAbc(source)
        setCompiled(next)
        setCompileError(
          next.score.warnings.length > 0 ? next.score.warnings.slice(0, 4).join('；') : undefined,
        )
        return next
      } catch (error) {
        const message = error instanceof AbcParseError || error instanceof Error ? error.message : '乐谱无法转换成 MIDI'
        setCompileError(message)
        return undefined
      }
    },
    [abc, stopPlayback],
  )

  const handleGenerate = useCallback(async () => {
    if (generating || !aiReady) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    stopPlayback()
    setGenerating(true)
    setGenerateError(undefined)
    setCompileError(undefined)
    setAbc('')
    try {
      const text = await composeAbcScore({
        prompt,
        signal: controller.signal,
        onChunk: (accumulated) => {
          setAbc(accumulated)
        },
      })
      setAbc(text)
      applyAbc(text)
    } catch (error) {
      if (isStreamAbortError(error, controller.signal)) return
      setGenerateError(error instanceof Error ? error.message : '生成失败')
    } finally {
      if (abortRef.current === controller) abortRef.current = undefined
      setGenerating(false)
    }
  }, [aiReady, applyAbc, generating, prompt, stopPlayback])

  const handleStopGenerate = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handlePlay = useCallback(() => {
    const current = compiled ?? applyAbc()
    if (!current || current.notes.length === 0) return
    stopPlayback()
    setPlaying(true)
    playRef.current = playDecodedMidi({
      notes: current.notes,
      tempoBpm: current.score.tempoBpm,
      ticksPerQuarter: current.score.ticksPerQuarter,
      onProgress: (elapsed, total) => {
        setProgress({ elapsed, total })
      },
      onEnded: () => {
        setPlaying(false)
        playRef.current = undefined
      },
    })
  }, [applyAbc, compiled, stopPlayback])

  const handleDownload = useCallback(() => {
    const current = compiled ?? applyAbc()
    if (!current) return
    downloadMidi(current.midi, current.score.title)
  }, [applyAbc, compiled])

  const abcDirty = compiled != null && abc !== compiled.abc
  const canPlay = (compiled?.notes.length ?? 0) > 0 && !abcDirty

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '乐谱',
        items: [
          {
            type: 'action',
            label: generating ? '停止生成' : '生成',
            shortcut: '⌘R',
            disabled: generating ? false : !aiReady || !prompt.trim(),
            onClick: generating ? handleStopGenerate : () => void handleGenerate(),
          },
          {
            type: 'action',
            label: '应用乐谱',
            disabled: generating || !abc.trim(),
            onClick: () => applyAbc(),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: playing ? '停止' : '播放',
            disabled: generating || (!playing && !canPlay && !abc.trim()),
            onClick: playing ? stopPlayback : handlePlay,
          },
          {
            type: 'action',
            label: '下载 MIDI',
            disabled: !compiled,
            onClick: handleDownload,
          },
        ],
      },
    ]
  }, [
    abc,
    aiReady,
    applyAbc,
    canPlay,
    compiled,
    generating,
    handleDownload,
    handleGenerate,
    handlePlay,
    handleStopGenerate,
    playing,
    prompt,
    stopPlayback,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const noteCount = compiled?.notes.length ?? 0
  const durationSec = compiled
    ? (scoreDurationTicks(compiled.score) / compiled.score.ticksPerQuarter) * (60 / compiled.score.tempoBpm)
    : 0

  return (
    <div class="midi-demo">
      <section class="midi-demo__compose">
        <label class="midi-demo__label" for="midi-demo-prompt">
          描述曲子
        </label>
        <textarea
          id="midi-demo-prompt"
          class="midi-demo__prompt"
          rows={2}
          value={prompt}
          disabled={generating}
          placeholder="例如：C 大调八小节抒情钢琴小品"
          onInput={(event) => setPrompt((event.target as HTMLTextAreaElement).value)}
        />
        <div class="midi-demo__chips">
          {MIDI_DEMO_EXAMPLES.map((example) => (
            <IosButton
              key={example}
              size="compact"
              disabled={generating}
              onClick={() => setPrompt(example)}
            >
              {example}
            </IosButton>
          ))}
        </div>
        <div class="midi-demo__compose-actions">
          {generating ? (
            <IosButton tone="danger" onClick={handleStopGenerate}>
              停止
            </IosButton>
          ) : (
            <IosButton
              tone="primary"
              disabled={!aiReady || !prompt.trim()}
              onClick={() => void handleGenerate()}
            >
              生成乐谱
            </IosButton>
          )}
          {!aiReady && <p class="midi-demo__hint">先在钥匙串或「系统设置 → 账户」配置 API Key。</p>}
          {generating && <p class="midi-demo__hint">正在生成 ABC…</p>}
        </div>
        {generateError && <p class="midi-demo__error">{generateError}</p>}
      </section>

      <div class="midi-demo__body">
        <section class="midi-demo__score">
          <div class="midi-demo__section-head">
            <h2>ABC 乐谱</h2>
            <IosButton
              size="compact"
              disabled={generating || !abc.trim()}
              onClick={() => applyAbc()}
            >
              应用乐谱
            </IosButton>
          </div>
          <textarea
            class="midi-demo__abc"
            spellcheck={false}
            value={abc}
            disabled={generating}
            onInput={(event) => setAbc((event.target as HTMLTextAreaElement).value)}
          />
          {abcDirty && <p class="midi-demo__hint">乐谱已修改，点「应用乐谱」重新转换成 MIDI。</p>}
          {compileError && <p class="midi-demo__error">{compileError}</p>}
        </section>

        <section class="midi-demo__preview">
          <div class="midi-demo__section-head">
            <h2>钢琴卷帘</h2>
            <span class="midi-demo__meta">
              {compiled
                ? `${compiled.score.meterNum}/${compiled.score.meterDen} · ${compiled.score.tempoBpm} BPM · ${noteCount} 个音`
                : '尚未转换'}
            </span>
          </div>
          <PianoRoll
            notes={compiled?.notes ?? []}
            progress={playing ? progress.elapsed / Math.max(progress.total, 0.001) : undefined}
          />
        </section>
      </div>

      <footer class="midi-demo__bar">
        <div class="midi-demo__transport">
          {playing ? (
            <IosButton tone="danger" onClick={stopPlayback}>
              停止
            </IosButton>
          ) : (
            <IosButton tone="primary" disabled={!canPlay} onClick={handlePlay}>
              播放
            </IosButton>
          )}
          <IosButton disabled={!compiled} onClick={handleDownload}>
            下载 .mid
          </IosButton>
          <span class="midi-demo__clock">
            {playing ? `${formatTime(progress.elapsed)} / ${formatTime(progress.total)}` : formatTime(durationSec)}
          </span>
        </div>
        <p class="midi-demo__instrument">
          乐器 = 钢琴（GM #{PIANO_PROGRAM} {PIANO_PROGRAM_NAME}）
        </p>
      </footer>
    </div>
  )
}

function PianoRoll({ notes, progress }: { notes: readonly ScoreNote[]; progress?: number }) {
  if (notes.length === 0) {
    return (
      <div class="midi-demo-roll midi-demo-roll--empty">
        <p>转换成功后，这里显示从 MIDI 解出的音符。</p>
      </div>
    )
  }
  let min = 127
  let max = 0
  let end = 1
  for (const note of notes) {
    min = Math.min(min, note.midi)
    max = Math.max(max, note.midi)
    end = Math.max(end, note.startTick + note.durationTick)
  }
  min = Math.max(0, min - 2)
  max = Math.min(127, max + 2)
  const span = Math.max(1, max - min)
  return (
    <div class="midi-demo-roll" role="img" aria-label="钢琴卷帘">
      {notes.map((note, index) => (
        <div
          key={`${note.voice}-${note.midi}-${note.startTick}-${index}`}
          class={`midi-demo-roll__note${note.voice === 2 ? ' midi-demo-roll__note--bass' : ''}`}
          style={{
            left: `${(note.startTick / end) * 100}%`,
            width: `${Math.max((note.durationTick / end) * 100, 0.6)}%`,
            bottom: `${((note.midi - min) / span) * 100}%`,
            height: `${Math.max(100 / span, 3)}%`,
          }}
        />
      ))}
      {progress != null && (
        <div class="midi-demo-roll__playhead" style={{ left: `${Math.min(progress, 1) * 100}%` }} />
      )}
    </div>
  )
}
