import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { osNowMs } from '../../os/os-clock.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { FixedRowVirtualList } from '../../ui/fixed-row-virtual-list.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { readFileBlob, resolveNodeByAbsolutePath } from '../files/files-vfs.ts'
import { deleteMusicTrack, saveMusicTrackBlob } from './music-audio-storage.ts'
import {
  getMusicPlayerState,
  playDocument,
  playFromLibrary,
  stopMusicPlayback,
  subscribeMusicPlayer,
} from './music-player.ts'
import { MusicPlayerBar } from './music-player-bar.tsx'
import {
  addTrackToStore,
  createMusicTrackId,
  formatTrackDuration,
  isAudioExtension,
  MUSIC_AUDIO_EXTENSIONS,
  MUSIC_STORE_CHANGED_EVENT,
  parseMusicFileName,
  readMusicStore,
  removeTrackFromStore,
  writeMusicStore,
} from './music-storage.ts'
import type { MusicLibraryStore, MusicTrack } from './music-types.ts'
import './music.css'

const APP_ID = 'music' as const
const DEFAULT_TITLE = '音乐'
const AUDIO_ACCEPT = ['audio/*', ...MUSIC_AUDIO_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

registerFileOpenHandler({
  appId: APP_ID,
  extensions: MUSIC_AUDIO_EXTENSIONS,
  rank: 10,
})

/** 尽力读取音频时长（秒）；解码失败或超时返回 0，播放时再校准。 */
function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    const cleanup = () => {
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
    }
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(0)
    }, 8000)
    audio.addEventListener(
      'loadedmetadata',
      () => {
        window.clearTimeout(timer)
        const duration = audio.duration
        cleanup()
        resolve(Number.isFinite(duration) ? duration : 0)
      },
      { once: true },
    )
    audio.addEventListener(
      'error',
      () => {
        window.clearTimeout(timer)
        cleanup()
        resolve(0)
      },
      { once: true },
    )
    audio.src = url
  })
}

type TransientTrack = {
  track: MusicTrack
  blob: Blob
}

export function MusicApp({ windowId }: { windowId?: string }) {
  const { windows, setAppWindowTitle, closeWindowsForApp, minimizeWindow } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()

  const [store, setStore] = useState<MusicLibraryStore>(() => readMusicStore())
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | undefined>()
  const [transient, setTransient] = useState<TransientTrack | undefined>()
  const [playerState, setPlayerState] = useState(() => getMusicPlayerState())

  const fileInputRef = useRef<HTMLInputElement>(null)
  const handledDocumentRef = useRef<string | undefined>(undefined)

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId

  useEffect(() => {
    setAppWindowTitle(APP_ID, DEFAULT_TITLE)
  }, [setAppWindowTitle])

  useEffect(() => {
    return subscribeMusicPlayer(() => setPlayerState(getMusicPlayerState()))
  }, [])

  useEffect(() => {
    const onStoreChanged = () => setStore(readMusicStore())
    window.addEventListener(MUSIC_STORE_CHANGED_EVENT, onStoreChanged)
    return () => window.removeEventListener(MUSIC_STORE_CHANGED_EVENT, onStoreChanged)
  }, [])

  // 窗口内播放：窗口关闭（组件卸载）即停播
  useEffect(() => {
    return () => {
      stopMusicPlayback()
    }
  }, [])

  // 从「文件」App 打开音频：解析 documentId 读取文件并播放（不进入曲库）
  useEffect(() => {
    if (!pendingDocumentId || handledDocumentRef.current === pendingDocumentId) {
      return
    }
    handledDocumentRef.current = pendingDocumentId
    let cancelled = false
    void (async () => {
      try {
        const node = await resolveNodeByAbsolutePath(pendingDocumentId)
        if (!node || node.kind !== 'file' || cancelled) {
          return
        }
        const { blob } = await readFileBlob(node.id)
        if (cancelled) {
          return
        }
        const parsed = parseMusicFileName(node.name)
        const track: MusicTrack = {
          id: `doc-${node.id}`,
          title: parsed.title,
          artist: parsed.artist,
          fileName: node.name,
          extension: parsed.extension,
          mimeType: blob.type,
          byteSize: blob.size,
          durationSec: 0,
          addedAt: osNowMs(),
        }
        playDocument(track, blob)
        setTransient({ track, blob })
      } catch {
        // 读取失败时保持空播放器，不打断用户
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingDocumentId])

  const handleFilesPicked = useCallback(
    async (files: FileList) => {
      const picked = Array.from(files).filter((file) => isAudioExtension(file.name.split('.').pop()))
      if (picked.length === 0) {
        return
      }
      setImporting(true)
      setImportError(undefined)
      const imported: MusicTrack[] = []
      let quotaExceeded = false
      let failed = 0
      for (const file of picked) {
        try {
          const id = createMusicTrackId()
          const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' })
          const saved = await saveMusicTrackBlob(id, blob)
          if (!saved) {
            quotaExceeded = true
            failed += 1
            continue
          }
          const parsed = parseMusicFileName(file.name)
          const track: MusicTrack = {
            id,
            title: parsed.title,
            artist: parsed.artist,
            fileName: file.name,
            extension: parsed.extension,
            mimeType: blob.type,
            byteSize: blob.size,
            durationSec: await readAudioDuration(blob),
            addedAt: osNowMs(),
          }
          const next = addTrackToStore(readMusicStore(), track)
          writeMusicStore(next)
          imported.push(track)
        } catch {
          failed += 1
        }
      }
      setStore(readMusicStore())
      setImporting(false)
      if (quotaExceeded) {
        setImportError('数据空间不足，部分文件未能导入')
      } else if (failed > 0) {
        setImportError(`有 ${failed} 个文件导入失败`)
      }
      if (imported.length > 0) {
        playFromLibrary(imported, 0)
      }
    },
    [],
  )

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleAddTransientToLibrary = useCallback(async () => {
    if (!transient) {
      return
    }
    const id = createMusicTrackId()
    const saved = await saveMusicTrackBlob(id, transient.blob)
    if (!saved) {
      setImportError('数据空间不足，无法添加到曲库')
      return
    }
    const track: MusicTrack = { ...transient.track, id, addedAt: osNowMs() }
    const next = addTrackToStore(readMusicStore(), track)
    writeMusicStore(next)
    setStore(next)
    setTransient(undefined)
    setImportError(undefined)
    playFromLibrary([track], 0)
  }, [transient])

  const handleDeleteTrack = useCallback(
    async (track: MusicTrack) => {
      const confirmed = await modal.confirm({
        title: '删除歌曲',
        message: `确定从曲库删除「${track.title}」吗？`,
        confirmLabel: '删除',
        confirmTone: 'danger',
      })
      if (!confirmed) {
        return
      }
      await deleteMusicTrack(track.id)
      const next = removeTrackFromStore(readMusicStore(), track.id)
      writeMusicStore(next)
      setStore(next)
      if (getMusicPlayerState().current?.id === track.id) {
        stopMusicPlayback()
      }
    },
    [modal],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    return [
      {
        label: '音乐',
        items: [
          ...aboutAppMenuPrefix('关于音乐', () => showBuiltinAbout('music')),
          {
            type: 'action',
            label: '隐藏音乐',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出音乐',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
    ]
  }, [closeWindowsForApp, minimizeWindow, showBuiltinAbout, windows])

  useAppMenuBar(APP_ID, menuBar)

  const tracks = store.tracks
  const currentId = playerState.current?.id
  const currentIndex = tracks.findIndex((track) => track.id === currentId)

  const trackRow = useCallback(
    (track: MusicTrack, index: number) => (
      <div
        class={currentId === track.id ? 'music__row music__row--current' : 'music__row'}
        onClick={() => playFromLibrary(tracks, index)}
      >
        <span class="music__row-index" aria-hidden="true">
          {currentId === track.id ? '▶' : index + 1}
        </span>
        <span class="music__row-title" title={track.title}>
          {track.title}
        </span>
        <span class="music__row-artist">{track.artist ?? '未知艺人'}</span>
        <span class="music__row-duration">{formatTrackDuration(track.durationSec)}</span>
        {editing ? (
          <button
            type="button"
            class="music__row-delete"
            aria-label={`删除 ${track.title}`}
            onClick={(event) => {
              event.stopPropagation()
              void handleDeleteTrack(track)
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
    ),
    [currentId, editing, handleDeleteTrack, tracks],
  )

  return (
    <div ref={hostRef} class={`music${narrowLayout && layoutReady ? ' music--narrow' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const input = event.target as HTMLInputElement
          const files = input.files
          if (files) {
            void handleFilesPicked(files)
          }
          input.value = ''
        }}
      />

      <header class="music__toolbar">
        {tracks.length > 0 ? (
          <IosButton size="compact" disabled={importing} onClick={() => setEditing((value) => !value)}>
            {editing ? '完成' : '编辑'}
          </IosButton>
        ) : (
          <span class="music__toolbar-spacer" />
        )}
        <span class="music__toolbar-title music__toolbar-title--center">我的音乐</span>
        <IosButton size="compact" disabled={importing} onClick={handleImportClick}>
          {importing ? '导入中…' : '导入音乐'}
        </IosButton>
      </header>

      {importError ? (
        <div class="music__import-error" role="alert">
          {importError}
          <button
            type="button"
            class="music__import-error-close"
            aria-label="关闭提示"
            onClick={() => setImportError(undefined)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <div class="music__main">
        {tracks.length === 0 ? (
          <div class="music__empty">
            <span class="music__empty-note" aria-hidden="true">
              ♪
            </span>
            <p class="music__empty-title">还没有音乐</p>
            <p class="music__empty-hint">
              点击右上角「导入音乐」，从本机选择音频文件加入曲库；也可以直接在「文件」中打开音频。
            </p>
            <IosButton size="compact" disabled={importing} onClick={handleImportClick}>
              {importing ? '导入中…' : '导入音乐'}
            </IosButton>
          </div>
        ) : (
          <FixedRowVirtualList
            items={tracks}
            itemKey={(track) => track.id}
            renderItem={(track, index) => trackRow(track, index)}
            rowHeight={52}
            className="music__list"
            scrollToIndex={currentIndex >= 0 ? currentIndex : undefined}
          />
        )}
      </div>

      {transient ? (
        <div class="music__transient">
          <span class="music__transient-text" title={transient.track.fileName}>
            正在播放「{transient.track.title}」
          </span>
          <IosButton size="compact" onClick={() => void handleAddTransientToLibrary()}>
            添加到曲库
          </IosButton>
        </div>
      ) : null}

      <MusicPlayerBar />
    </div>
  )
}
