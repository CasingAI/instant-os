import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { osNowMs } from '../../os/os-clock.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { useAppNarrowLayout } from '../../ui/use-app-narrow-layout.ts'
import { FixedRowVirtualList } from '../../ui/fixed-row-virtual-list.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { joinFilesAbsolutePath } from '../files/files-path.ts'
import { ensureUserSpecialFolders, userSpecialFolderPath } from '../files/files-user-special.ts'
import type { FilesNode } from '../files/files-types.ts'
import {
  copyNodeTo,
  createTextFile,
  FILES_VFS_CHANGED_EVENT,
  listDirectory,
  readFileBlob,
  readTextFile,
  removeNode,
  resolveNodeByAbsolutePath,
  writeBinaryFile,
} from '../files/files-vfs.ts'
import { looksLikeLrc, parseLrc } from './music-lyrics.ts'
import { loadLyricOffsetMs, saveLyricOffsetMs } from './music-lyric-offsets.ts'
import { MusicLyricsOffsetBar } from './music-lyrics-offset-bar.tsx'
import { MusicLyricsView } from './music-lyrics-view.tsx'
import { MusicVisualizationView } from './music-visualization-view.tsx'
import { ensureStemLyrics, type StemLyrics } from './music-stems-session.ts'
import {
  getMusicPlayerState,
  playDocument,
  playFromLibrary,
  seekTo,
  stopMusicPlayback,
  subscribeMusicPlayer,
  togglePlay,
} from './music-player.ts'
import { MusicPlayerBar } from './music-player-bar.tsx'
import {
  formatTrackDuration,
  isAudioExtension,
  isLyricsExtension,
  MUSIC_LYRICS_EXTENSIONS,
  parseMusicFileName,
} from './music-storage.ts'
import type { MusicTrack } from './music-types.ts'
import './music.css'

const APP_ID = 'music' as const
const DEFAULT_TITLE = '音乐'
/** 曲库 = 用户目录下的「音乐」特殊文件夹，放进的文件自动识别 */
const MUSIC_FOLDER = userSpecialFolderPath('Musics')

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

function fileBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase()
}

/** 播放后回写的时长缓存（曲库枚举不解码音频，避免大列表卡顿） */
const trackDurationCache = new Map<string, number>()

/** 读取 VFS 歌词文件，校验为有效 LRC 后返回原文；否则 undefined。 */
async function readTrackLyricsText(lrcNode: FilesNode): Promise<string | undefined> {
  try {
    const { text } = await readTextFile(lrcNode.id)
    return looksLikeLrc(text) ? text : undefined
  } catch {
    return undefined
  }
}

/** 由 VFS 音频节点构建曲目；同名 .lrc 自动作为歌词。 */
async function buildTrackFromNode(
  audioNode: FilesNode,
  lrcNode: FilesNode | undefined,
): Promise<MusicTrack> {
  const parsed = parseMusicFileName(audioNode.name)
  const track: MusicTrack = {
    id: audioNode.id,
    title: parsed.title,
    artist: parsed.artist,
    fileName: audioNode.name,
    extension: parsed.extension,
    mimeType: audioNode.mimeType ?? 'audio/mpeg',
    byteSize: audioNode.byteSize,
    durationSec: trackDurationCache.get(audioNode.id) ?? 0,
    addedAt: audioNode.createdAt,
    vfsRef: audioNode.id,
  }
  if (lrcNode) {
    try {
      const { text } = await readTextFile(lrcNode.id)
      if (looksLikeLrc(text)) {
        track.lyricsLrc = text
      }
    } catch {
      // 忽略歌词读取失败
    }
  }
  return track
}

type TransientTrack = {
  track: MusicTrack
  node: FilesNode
}

export function MusicApp({ windowId }: { windowId?: string }) {
  const { windows, activeWindowId, setAppWindowTitle, openApp } = useOs()
  const modal = useWindowModal()
  const { hostRef, narrowLayout, layoutReady } = useAppNarrowLayout()
  const { showSystemOpenDialog, dialog: systemDialog } = useSystemOpenDialog()

  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [musicsFolderId, setMusicsFolderId] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [transient, setTransient] = useState<TransientTrack | undefined>()
  const [playerState, setPlayerState] = useState(() => getMusicPlayerState())
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [visualizerOpen, setVisualizerOpen] = useState(false)
  const [transientLyrics, setTransientLyrics] = useState<string | undefined>()
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0)
  /** 当前曲目的分轨包内歌词（aligned 与 raw 分开，供高精度/普通切换） */
  const [stemLyrics, setStemLyrics] = useState<StemLyrics | undefined>()
  /** 歌词展示来源：'aligned' 高精度（实验室逐字对齐），'standard' 普通（原始歌词或同名 .lrc） */
  const [lyricsSource, setLyricsSource] = useState<'aligned' | 'standard'>('aligned')

  const handledDocumentRef = useRef<string | undefined>(undefined)
  const refreshTimerRef = useRef<number | undefined>(undefined)

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId

  // 空格：曲库 / 歌词 / 可视化界面切换播放（输入框与可编辑区除外）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (windowId && activeWindowId !== appWindow?.id) {
        return
      }
      if (event.key !== ' ' && event.code !== 'Space') {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }
      event.preventDefault()
      event.stopPropagation()
      togglePlay()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeWindowId, appWindow?.id, windowId])

  // 枚举「音乐」文件夹作为曲库（同名 .lrc 自动配对歌词）
  const refreshLibrary = useCallback(async () => {
    setRefreshing(true)
    try {
      const folder = await resolveNodeByAbsolutePath(MUSIC_FOLDER)
      if (!folder || folder.kind !== 'folder') {
        setMusicsFolderId(undefined)
        setTracks([])
        return
      }
      setMusicsFolderId(folder.id)
      const children = await listDirectory('local', folder.id)
      const lrcByBase = new Map<string, FilesNode>()
      for (const child of children) {
        if (child.kind === 'file' && isLyricsExtension(fileExtension(child.name))) {
          lrcByBase.set(fileBaseName(child.name), child)
        }
      }
      const audioNodes = children.filter(
        (child) => child.kind === 'file' && isAudioExtension(fileExtension(child.name)),
      )
      const built = await Promise.all(
        audioNodes.map((node) => buildTrackFromNode(node, lrcByBase.get(fileBaseName(node.name)))),
      )
      setTracks(built)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setAppWindowTitle(APP_ID, DEFAULT_TITLE)
  }, [setAppWindowTitle])

  useEffect(() => {
    return subscribeMusicPlayer(() => setPlayerState(getMusicPlayerState()))
  }, [])

  // 窗口内播放：窗口关闭（组件卸载）即停播
  useEffect(() => {
    return () => {
      stopMusicPlayback()
    }
  }, [])

  // 首次挂载：确保特殊文件夹存在并加载曲库
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureUserSpecialFolders()
      if (!cancelled) {
        await refreshLibrary()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshLibrary])

  // VFS 变更 → 防抖刷新（放进「音乐」文件夹的文件自动识别）
  useEffect(() => {
    const onChange = () => {
      if (refreshTimerRef.current !== undefined) {
        window.clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = undefined
        void refreshLibrary()
      }, 120)
    }
    window.addEventListener(FILES_VFS_CHANGED_EVENT, onChange)
    return () => {
      window.removeEventListener(FILES_VFS_CHANGED_EVENT, onChange)
      if (refreshTimerRef.current !== undefined) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [refreshLibrary])

  // 从「文件」App 打开：音频 → 读取并播放（不进入曲库）；.lrc → 解析为歌词
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
        if (isLyricsExtension(fileExtension(node.name))) {
          const { text } = await readTextFile(node.id)
          if (cancelled) {
            return
          }
          if (!looksLikeLrc(text)) {
            void modal.alert({ title: '无法识别歌词', message: '这不是有效的 LRC 歌词文件。' })
            return
          }
          setTransientLyrics(text)
          setLyricsOpen(true)
          return
        }
        const { blob } = await readFileBlob(node.id)
        if (cancelled) {
          return
        }
        // 自动配对同目录同名 .lrc 作为临时歌词
        let documentLyrics: string | undefined
        try {
          const siblings = await listDirectory(node.locationId, node.parentId)
          const lrc = siblings.find(
            (sibling) =>
              sibling.kind === 'file' &&
              isLyricsExtension(fileExtension(sibling.name)) &&
              fileBaseName(sibling.name) === fileBaseName(node.name),
          )
          if (lrc) {
            documentLyrics = await readTrackLyricsText(lrc)
          }
        } catch {
          // 忽略歌词配对失败
        }
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
          vfsRef: node.id,
        }
        if (documentLyrics) {
          track.lyricsLrc = documentLyrics
        }
        playDocument(track, blob)
        setTransient({ track, node })
      } catch {
        // 读取失败时保持空播放器，不打断用户
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modal, pendingDocumentId])

  const currentId = playerState.current?.id
  /** 当前曲目在曲库中的记录（「文件」打开的单曲不在曲库时为 undefined） */
  const currentLibraryTrack = currentId ? tracks.find((track) => track.id === currentId) : undefined

  // 当前曲目的分轨包内歌词：实验室对齐结果优先于同名 .lrc（stems-first）
  const stemLyricsTrackId = playerState.current?.id
  const stemLyricsVfsRef = playerState.current?.vfsRef
  useEffect(() => {
    let cancelled = false
    setStemLyrics(undefined)
    setLyricsSource('aligned')
    if (!stemLyricsTrackId || !stemLyricsVfsRef) {
      return () => {
        cancelled = true
      }
    }
    void ensureStemLyrics({ trackId: stemLyricsTrackId, vfsRef: stemLyricsVfsRef }).then((lyrics) => {
      if (!cancelled) setStemLyrics(lyrics)
    })
    return () => {
      cancelled = true
    }
  }, [stemLyricsTrackId, stemLyricsVfsRef])

  // 歌词偏移：切曲目时载入该曲目的记忆值（无播放曲目归 0）
  useEffect(() => {
    setLyricOffsetMs(currentId ? loadLyricOffsetMs(currentId) : 0)
  }, [currentId])

  // 歌词偏移变化：更新状态并持久化
  const handleLyricOffsetChange = useCallback(
    (ms: number) => {
      setLyricOffsetMs(ms)
      if (currentId) {
        saveLyricOffsetMs(currentId, ms)
      }
    },
    [currentId],
  )

  // 播放后把真实时长回写曲库列表（时长缓存，避免重复刷新）
  const playerDuration = playerState.duration
  const playerTrackId = playerState.current?.id
  useEffect(() => {
    if (!playerTrackId || playerDuration <= 0) {
      return
    }
    if (trackDurationCache.get(playerTrackId) === playerDuration) {
      return
    }
    trackDurationCache.set(playerTrackId, playerDuration)
    setTracks((current) =>
      current.map((track) =>
        track.id === playerTrackId ? { ...track, durationSec: playerDuration } : track,
      ),
    )
  }, [playerDuration, playerTrackId])

  // 把「文件」打开的单曲复制进「音乐」文件夹（即加入曲库）
  const handleCopyTransientToMusics = useCallback(async () => {
    if (!transient) {
      return
    }
    if (!musicsFolderId) {
      void modal.alert({ title: '无法复制', message: '找不到「音乐」文件夹。' })
      return
    }
    try {
      await copyNodeTo({
        sourceId: transient.node.id,
        destLocationId: 'local',
        destParentId: musicsFolderId,
      })
      setTransient(undefined)
      await refreshLibrary()
    } catch {
      void modal.alert({ title: '复制失败', message: '无法把文件复制到「音乐」文件夹。' })
    }
  }, [modal, musicsFolderId, refreshLibrary, transient])

  const handleDeleteTrack = useCallback(
    async (track: MusicTrack) => {
      const confirmed = await modal.confirm({
        title: '删除歌曲',
        message: `确定从「音乐」文件夹删除「${track.title}」吗？`,
        confirmLabel: '删除',
        confirmTone: 'danger',
      })
      if (!confirmed) {
        return
      }
      try {
        await removeNode(track.vfsRef ?? track.id)
        if (getMusicPlayerState().current?.id === track.id) {
          stopMusicPlayback()
        }
        await refreshLibrary()
      } catch {
        void modal.alert({ title: '删除失败', message: '无法删除该文件。' })
      }
    },
    [modal, refreshLibrary],
  )

  // 把歌词文本写入「音乐」文件夹内与歌曲同名的 .lrc
  const saveLyricsForTrack = useCallback(
    async (track: MusicTrack, lyricsText: string): Promise<boolean> => {
      const lyricsName = `${fileBaseName(track.fileName)}.lrc`
      try {
        const existing = await resolveNodeByAbsolutePath(
          joinFilesAbsolutePath(MUSIC_FOLDER, lyricsName),
        )
        if (existing && existing.kind === 'file') {
          await writeBinaryFile(existing.id, new TextEncoder().encode(lyricsText).buffer)
        } else if (musicsFolderId) {
          await createTextFile({
            locationId: 'local',
            parentId: musicsFolderId,
            name: lyricsName,
            text: lyricsText,
          })
        } else {
          return false
        }
        return true
      } catch {
        return false
      }
    },
    [musicsFolderId],
  )

  // 手动为曲目添加/替换歌词（从系统打开对话框选 .lrc，写入同名 .lrc）
  const handleLyricsPick = useCallback(
    async (track: MusicTrack) => {
      const path = await showSystemOpenDialog({
        title: '选择歌词文件',
        acceptExtensions: MUSIC_LYRICS_EXTENSIONS,
      })
      if (!path) {
        return
      }
      const node = await resolveNodeByAbsolutePath(path)
      if (!node || node.kind !== 'file') {
        return
      }
      const { text } = await readTextFile(node.id)
      if (!looksLikeLrc(text)) {
        void modal.alert({ title: '无法识别歌词', message: '这不是有效的 LRC 歌词文件。' })
        return
      }
      const saved = await saveLyricsForTrack(track, text)
      if (!saved) {
        void modal.alert({ title: '保存失败', message: '无法把歌词写入「音乐」文件夹。' })
        return
      }
      await refreshLibrary()
    },
    [modal, refreshLibrary, saveLyricsForTrack, showSystemOpenDialog],
  )

  // 把从「文件」打开的临时歌词写入当前歌曲的同名 .lrc
  const handleBindTransientLyrics = useCallback(async () => {
    if (!currentLibraryTrack || !transientLyrics) {
      return
    }
    const saved = await saveLyricsForTrack(currentLibraryTrack, transientLyrics)
    if (!saved) {
      void modal.alert({ title: '保存失败', message: '无法把歌词写入「音乐」文件夹。' })
      return
    }
    setTransientLyrics(undefined)
    await refreshLibrary()
  }, [currentLibraryTrack, refreshLibrary, saveLyricsForTrack, transientLyrics])

  const handleOpenMusicsFolder = useCallback(() => {
    openApp('files', { documentId: MUSIC_FOLDER })
  }, [openApp])

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: '音乐',
        items: [
          {
            type: 'action',
            label: '打开音乐文件夹',
            onClick: handleOpenMusicsFolder,
          },
        ],
      },
    ]
  }, [handleOpenMusicsFolder])

  useAppMenuBar(APP_ID, menuBar)

  const currentIndex = tracks.findIndex((track) => track.id === currentId)

  // 歌词：分轨包内高精度对齐结果（aligned）与普通歌词按 lyricsSource 切换；
  // 普通优先选有行时间戳的来源：包内原始 .lrc → 同名 .lrc → 包内清洗纯文本；
  // 单一来源缺失时回退另一来源，最后兜底「文件」打开的临时歌词
  const alignedLyrics = stemLyrics?.aligned
  const standardLyrics =
    stemLyrics?.lrc ?? currentLibraryTrack?.lyricsLrc ?? stemLyrics?.raw
  const lyricsText =
    lyricsSource === 'aligned'
      ? alignedLyrics ?? standardLyrics ?? transientLyrics
      : standardLyrics ?? alignedLyrics ?? transientLyrics
  const parsedLyrics = useMemo(() => (lyricsText ? parseLrc(lyricsText) : undefined), [lyricsText])
  const showLyricsScreen =
    lyricsOpen && (currentLibraryTrack !== undefined || transientLyrics !== undefined)

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
        {editing ? (
          <span class="music__row-actions">
            <button
              type="button"
              class="music__row-action"
              title={track.lyricsLrc ? '替换歌词' : '添加歌词'}
              aria-label={`${track.lyricsLrc ? '替换' : '添加'}歌词 ${track.title}`}
              onClick={(event) => {
                event.stopPropagation()
                void handleLyricsPick(track)
              }}
            >
              ♪
            </button>
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
          </span>
        ) : (
          <span class="music__row-duration">{formatTrackDuration(track.durationSec)}</span>
        )}
      </div>
    ),
    [currentId, editing, handleDeleteTrack, handleLyricsPick, tracks],
  )

  return (
    <div ref={hostRef} class={`music${narrowLayout && layoutReady ? ' music--narrow' : ''}`}>
      {systemDialog}

      {showLyricsScreen ? (
        <>
          <header class="music__toolbar">
            <IosNavBackButton iconSize={14} label="曲库" onClick={() => setLyricsOpen(false)} />
            <span class="music__toolbar-title music__toolbar-title--center">
              {currentLibraryTrack?.title ?? '歌词文件'}
            </span>
            {transientLyrics && currentLibraryTrack ? (
              <IosButton size="compact" onClick={() => void handleBindTransientLyrics()}>
                绑定到当前歌曲
              </IosButton>
            ) : (
              <span class="music__toolbar-spacer" />
            )}
          </header>

          {alignedLyrics && standardLyrics ? (
            <SegmentedControl
              value={lyricsSource}
              onChange={(id) => setLyricsSource(id)}
              ariaLabel="歌词来源"
              items={[
                { id: 'aligned', label: '高精度' },
                { id: 'standard', label: '普通' },
              ]}
              className="music__lyrics-source-picker"
            />
          ) : null}

          {parsedLyrics && parsedLyrics.lines.length > 0 ? (
            <MusicLyricsOffsetBar offsetMs={lyricOffsetMs} onChange={handleLyricOffsetChange} />
          ) : null}

          <div class="music__main">
            {parsedLyrics && parsedLyrics.lines.length > 0 ? (
              <MusicLyricsView
                lines={parsedLyrics.lines}
                currentTimeMs={playerState.currentTime * 1000}
                onSeek={seekTo}
                karaoke
                offsetMs={lyricOffsetMs}
                durationMs={playerState.duration * 1000}
              />
            ) : (
              <div class="music__empty">
                <span class="music__empty-note" aria-hidden="true">
                  ♪
                </span>
                <p class="music__empty-title">没有歌词</p>
                <p class="music__empty-hint">
                  在「音乐」文件夹里放一个与歌曲同名的 .lrc 文件，或在音乐实验室里对齐过歌词（.stems.zip），即可自动识别为歌词。
                </p>
              </div>
            )}
          </div>

          <MusicPlayerBar />
        </>
      ) : visualizerOpen ? (
        <>
          <header class="music__toolbar">
            <IosNavBackButton iconSize={14} label="曲库" onClick={() => setVisualizerOpen(false)} />
            <span class="music__toolbar-title music__toolbar-title--center">可视化</span>
            <span class="music__toolbar-spacer" />
          </header>

          <div class="music__main">
            <MusicVisualizationView
              lines={parsedLyrics?.lines}
              currentTimeMs={playerState.currentTime * 1000}
              onSeek={seekTo}
              offsetMs={lyricOffsetMs}
              durationMs={playerState.duration * 1000}
              onLyricOffsetChange={handleLyricOffsetChange}
              trackId={playerState.current?.id}
              vfsRef={playerState.current?.vfsRef}
            />
          </div>

          <MusicPlayerBar />
        </>
      ) : (
        <>
          <header class="music__toolbar">
            {tracks.length > 0 ? (
              <IosButton size="compact" disabled={refreshing} onClick={() => setEditing((value) => !value)}>
                {editing ? '完成' : '编辑'}
              </IosButton>
            ) : (
              <span class="music__toolbar-spacer" />
            )}
            <span class="music__toolbar-title music__toolbar-title--center">我的音乐</span>
            <div class="music__toolbar-actions">
              {currentLibraryTrack ? (
                <IosButton
                  size="compact"
                  onClick={() => {
                    setVisualizerOpen(false)
                    setLyricsOpen(true)
                  }}
                >
                  歌词
                </IosButton>
              ) : null}
              <IosButton
                size="compact"
                onClick={() => {
                  setLyricsOpen(false)
                  setVisualizerOpen(true)
                }}
              >
                可视化
              </IosButton>
              <IosButton size="compact" onClick={handleOpenMusicsFolder}>
                音乐文件夹
              </IosButton>
            </div>
          </header>

          <div class="music__main">
            {tracks.length === 0 ? (
              <div class="music__empty">
                <span class="music__empty-note" aria-hidden="true">
                  ♪
                </span>
                <p class="music__empty-title">{refreshing ? '正在扫描音乐文件夹…' : '音乐文件夹还是空的'}</p>
                <p class="music__empty-hint">
                  把音频文件放进用户目录的「音乐」文件夹，就会自动出现在这里；
                  同名 .lrc 自动作为歌词。
                </p>
                <div class="music__empty-actions">
                  <IosButton size="compact" onClick={handleOpenMusicsFolder}>
                    打开音乐文件夹
                  </IosButton>
                </div>
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
              <IosButton size="compact" onClick={() => void handleCopyTransientToMusics()}>
                复制到音乐文件夹
              </IosButton>
            </div>
          ) : null}

          <MusicPlayerBar />
        </>
      )}
    </div>
  )
}
