import { IosButton } from '../../ui/ios-button.tsx'
import { STEM_COLORS, STEM_IDS } from './stems-types.ts'
import { formatRecentTime } from './stems-recents.ts'
import type { RecentStemsProject } from './stems-recents.ts'

/** 空态分轨进度展示视图（结构与 stems-app 内 deriveSeparationProgress 返回值一致）。 */
export type StemsSeparationProgress = {
  phaseLabel: string
  chunkLabel?: string
  phasePercent?: number
  overallPercent?: number
  remainingMs?: number
}

export type StemsEmptyProps = {
  /** 分轨或载入进行中：投递槽切换为进度内容，托盘压暗 */
  busy: boolean
  /** 正在载入已保存的分轨结果 */
  loadingArchive: boolean
  /** 当前分轨进度（busy 且非 loadingArchive 时展示） */
  progress: StemsSeparationProgress
  /** WebGPU 可用性探测结果（null 表示探测中，不显示对应状态灯） */
  gpuAvailable: boolean | null
  /** 人声分离模型是否已缓存 */
  mdxCached: boolean | null
  /** 分轨模型是否已缓存 */
  modelCached: boolean | null
  recentProjects: RecentStemsProject[]
  onPickFile: () => void
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
}

/** 投递槽暗槽展示用：六条主乐器轨，排除 other2（合并轨）。 */
const DECK_STEMS = STEM_IDS.filter((id) => id !== 'other2')

/** 剩余时间（如 3:05）。 */
function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** 预估结束时刻（本地时钟，如 15:42）。 */
function formatEtaClock(remainingMs: number): string {
  const end = new Date(Date.now() + Math.max(0, remainingMs))
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
}

/** 音乐实验室空态：投递槽 + 最近打开托盘，两区互不抢高。 */
export function StemsEmpty({
  busy,
  loadingArchive,
  progress,
  gpuAvailable,
  mdxCached,
  modelCached,
  recentProjects,
  onPickFile,
  onOpenRecent,
  onRemoveRecent,
}: StemsEmptyProps) {
  const modelNotCached = mdxCached === false || modelCached === false
  const hasRecents = recentProjects.length > 0

  return (
    <div class={`stems__empty${hasRecents ? ' stems__empty--with-recents' : ''}`}>
      <div class="stems__hero-pane">
        <section class="stems__hero" aria-label="打开音乐文件开始分轨">
        {busy ? (
          loadingArchive ? (
            <p class="stems__hero-loading">检测到已保存的分轨结果，正在载入…</p>
          ) : (
            <div class="stems__progress">
              <p class="stems__progress-phase">{progress.phaseLabel}</p>
              <div
                class="stems__progress-bar-wrap"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.overallPercent}
              >
                <div
                  class={`stems__progress-bar${progress.overallPercent === undefined ? ' stems__progress-bar--indeterminate' : ''}`}
                  style={
                    progress.overallPercent !== undefined
                      ? { width: `${progress.overallPercent}%` }
                      : undefined
                  }
                />
              </div>
              <div class="stems__progress-meta">
                <span>
                  {progress.overallPercent !== undefined
                    ? `总进度 ${progress.overallPercent}%`
                    : '准备中…'}
                  {progress.chunkLabel ? ` · ${progress.chunkLabel}` : ''}
                </span>
                <span>
                  {progress.remainingMs !== undefined
                    ? `约 ${formatDurationMs(progress.remainingMs)} 后 · ${formatEtaClock(progress.remainingMs)} 结束`
                    : progress.phasePercent !== undefined
                      ? '正在估算剩余时间…'
                      : '模型加载中…'}
                </span>
              </div>
            </div>
          )
        ) : (
          <>
            <div class="stems__hero-deck" aria-hidden="true">
              {DECK_STEMS.map((id) => (
                <span
                  key={id}
                  class="stems__hero-deck-track"
                  style={{ '--stem-color': STEM_COLORS[id] }}
                />
              ))}
            </div>
            <p class="stems__hero-title">打开一首歌，开始分轨</p>
            <p class="stems__hero-hint">
              或把文件拖到窗口任意位置；打开后可分离人声、鼓、贝斯、吉他、钢琴和其他声部。
            </p>
            <div class="stems__hero-actions">
              <IosButton tone="primary" onClick={onPickFile}>
                打开音乐文件
              </IosButton>
            </div>
            <div class="stems__hero-status">
              {gpuAvailable === true && (
                <span class="stems__status-chip stems__status-chip--ok">GPU 加速</span>
              )}
              {gpuAvailable === false && (
                <span class="stems__status-chip stems__status-chip--warn">WASM（较慢）</span>
              )}
              {modelNotCached && (
                <span
                  class="stems__status-chip stems__status-chip--idle"
                  title="分轨所需模型尚未完全缓存：人声分离模型约 67MB，分轨模型约 285MB。首次分轨需下载，可在 设置 → 存储 → 模型缓存 中提前缓存。"
                >
                  首次分轨需下载模型
                </span>
              )}
            </div>
          </>
        )}
        </section>
      </div>

      {hasRecents && (
        <div class={`stems__recents${busy ? ' stems__recents--dimmed' : ''}`}>
          <p class="stems__recents-title">最近打开</p>
          <div class="stems__recents-list">
            {recentProjects.map((item) => (
              <div class="stems__recents-item" key={item.path}>
                <button
                  type="button"
                  class="stems__recents-open"
                  onClick={() => onOpenRecent(item.path)}
                  title={item.path}
                  disabled={busy}
                >
                  <span class="stems__recents-name">{item.name}</span>
                  <span class="stems__recents-meta">
                    {item.path.slice(0, item.path.lastIndexOf('/'))} ·{' '}
                    {formatRecentTime(item.openedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  class="stems__recents-remove"
                  aria-label="从最近打开移除"
                  title="从最近打开移除"
                  onClick={() => onRemoveRecent(item.path)}
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
