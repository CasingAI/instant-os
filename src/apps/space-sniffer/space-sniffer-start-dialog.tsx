import { useCallback, useEffect, useState } from 'preact/hooks'
import { IosButton } from '../../ui/ios-button.tsx'
import { IosTextField } from '../../ui/ios-text-field.tsx'
import { filesListVolumes, type FilesApiVolume } from '../files/files-api.ts'
import { FILES_MOUNTS_CHANGED_EVENT } from '../files/files-mount-store.ts'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import { DATA_SPACE_FILE_LOCATIONS } from '../files/files-storage.ts'
import { isMountLocationId } from '../files/files-types.ts'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'

/** 仅展示可做占用分析的卷：用户/开发者数据 + 本机挂载；排除 /system、/models 等投影卷 */
function isAnalyzableVolume(volume: FilesApiVolume): boolean {
  const parsed = parseFilesAbsolutePath(volume.path)
  if (!parsed) return false
  if (isMountLocationId(parsed.locationId)) return true
  return (DATA_SPACE_FILE_LOCATIONS as readonly string[]).includes(parsed.locationId)
}

type SpaceSnifferStartDialogProps = {
  initialPath?: string
  onStart: (path: string) => void
  onCancel?: () => void
}

export function SpaceSnifferStartDialog({
  initialPath,
  onStart,
  onCancel,
}: SpaceSnifferStartDialogProps) {
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const [volumes, setVolumes] = useState<FilesApiVolume[]>([])
  const [pathInput, setPathInput] = useState(initialPath ?? '')
  const [selectedVolumePath, setSelectedVolumePath] = useState<string | undefined>(initialPath)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const reloadVolumes = useCallback(async () => {
    setLoading(true)
    try {
      const next = await filesListVolumes()
      setVolumes(next.filter(isAnalyzableVolume))
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法列出卷')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadVolumes()
    const handle = () => {
      void reloadVolumes()
    }
    window.addEventListener(FILES_MOUNTS_CHANGED_EVENT, handle)
    return () => window.removeEventListener(FILES_MOUNTS_CHANGED_EVENT, handle)
  }, [reloadVolumes])

  useEffect(() => {
    if (initialPath) {
      setPathInput(initialPath)
      setSelectedVolumePath(initialPath)
    }
  }, [initialPath])

  const handlePickFolder = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择要扫描的文件夹',
      selectionMode: 'folder',
    })
    if (!path) return
    setPathInput(path)
    setSelectedVolumePath(undefined)
    setError(undefined)
  }, [showSystemOpenDialog])

  const handleStart = useCallback(() => {
    const path = pathInput.trim()
    if (!path) {
      setError('请选择卷或输入文件夹路径')
      return
    }
    if (!path.startsWith('/')) {
      setError('路径必须以 / 开头')
      return
    }
    setError(undefined)
    onStart(path.replace(/\/+$/, '') || '/')
  }, [onStart, pathInput])

  return (
    <div class="space-sniffer__start">
      <div class="space-sniffer__start-card">
        <h1 class="space-sniffer__start-title">选择要扫描的空间</h1>
        <p class="space-sniffer__start-subtitle">
          选择可分析占用的卷，或指定文件夹路径。扫描过程中即可浏览与下钻。
        </p>

        <div class="space-sniffer__start-section">
          <h2 class="space-sniffer__start-section-title">卷</h2>
          {loading ? (
            <p class="space-sniffer__start-hint">正在加载卷列表…</p>
          ) : volumes.length === 0 ? (
            <p class="space-sniffer__start-hint">暂无可用卷</p>
          ) : (
            <div class="space-sniffer__volume-list" role="listbox" aria-label="可用卷">
              {volumes.map((volume) => {
                const selected = selectedVolumePath === volume.path
                return (
                  <button
                    type="button"
                    key={volume.path}
                    role="option"
                    aria-selected={selected}
                    class={`space-sniffer__volume${selected ? ' space-sniffer__volume--selected' : ''}`}
                    onClick={() => {
                      setSelectedVolumePath(volume.path)
                      setPathInput(volume.path)
                      setError(undefined)
                    }}
                    onDblClick={() => onStart(volume.path)}
                  >
                    <span class="space-sniffer__volume-label">{volume.label}</span>
                    <span class="space-sniffer__volume-path">{volume.path}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div class="space-sniffer__start-section">
          <h2 class="space-sniffer__start-section-title">路径</h2>
          <div class="space-sniffer__path-row">
            <IosTextField
              value={pathInput}
              placeholder="/user 或 /user/Downloads"
              spellcheck={false}
              onInput={(event) => {
                setPathInput((event.target as HTMLInputElement).value)
                setSelectedVolumePath(undefined)
                setError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleStart()
                }
              }}
            />
            <IosButton size="compact" onClick={handlePickFolder}>
              选择文件夹…
            </IosButton>
          </div>
        </div>

        {error ? <p class="space-sniffer__error">{error}</p> : undefined}

        <div class="space-sniffer__start-actions">
          {onCancel ? (
            <IosButton onClick={onCancel}>取消</IosButton>
          ) : undefined}
          <IosButton tone="primary" onClick={handleStart}>
            开始扫描
          </IosButton>
        </div>
      </div>
      {openDialog}
    </div>
  )
}
