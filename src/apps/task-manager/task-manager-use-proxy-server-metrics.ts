import { useEffect, useState } from 'preact/hooks'
import {
  getProxyServerByteTotalsSince,
  getProxyServerThroughputSnapshot,
  listRecentProxyServerRequests,
  subscribeProxyServerMetrics,
  type ProxyServerRequestRecord,
} from '../../os/proxy-server-metrics.ts'
import {
  isProxyServerConnected,
  subscribeProxyServerSettings,
} from '../../os/proxy-server-settings-storage.ts'
import {
  appendMetricSeriesPoint,
  type MetricSeriesPoint,
} from './task-manager-metric-series.ts'
import { SPEED_SERIES_MAX_POINTS, type SpeedSampleIntervalSec } from './task-manager-speed-series.ts'

export type TaskManagerProxyServerMetrics = {
  /** 下行吞吐序列（B/s） */
  downloadSeries: MetricSeriesPoint[]
  /** 上行吞吐序列（B/s） */
  uploadSeries: MetricSeriesPoint[]
  latestDownloadBytesPerSec: number
  latestUploadBytesPerSec: number
  proxyServerConnected: boolean
  recentRequests: ProxyServerRequestRecord[]
}

/**
 * 性能监视器打开期间按采样间隔记录代理服务器吞吐。
 * 仅统计经 proxiedFetch 的流量。
 */
export function useTaskManagerProxyServerMetrics(
  sampleIntervalSec: SpeedSampleIntervalSec,
): TaskManagerProxyServerMetrics {
  const [downloadSeries, setDownloadSeries] = useState<MetricSeriesPoint[]>([])
  const [uploadSeries, setUploadSeries] = useState<MetricSeriesPoint[]>([])
  const [latestDownloadBytesPerSec, setLatestDownload] = useState(0)
  const [latestUploadBytesPerSec, setLatestUpload] = useState(0)
  const [proxyServerConnected, setProxyServerConnected] = useState(() =>
    isProxyServerConnected(),
  )
  const [recentRequests, setRecentRequests] = useState<ProxyServerRequestRecord[]>(() =>
    listRecentProxyServerRequests(12),
  )

  useEffect(() => {
    setDownloadSeries([])
    setUploadSeries([])
    setLatestDownload(0)
    setLatestUpload(0)

    let lastSampleAt = Date.now()

    const refreshLive = () => {
      setProxyServerConnected(isProxyServerConnected())
      setRecentRequests(listRecentProxyServerRequests(12))
      const snap = getProxyServerThroughputSnapshot()
      setLatestDownload(snap.downloadBytesPerSec)
      setLatestUpload(snap.uploadBytesPerSec)
    }

    const sample = () => {
      const now = Date.now()
      const elapsedSec = Math.max((now - lastSampleAt) / 1000, 0.001)
      const delta = getProxyServerByteTotalsSince(lastSampleAt)
      lastSampleAt = now

      const downloadRate = delta.downloadBytes / elapsedSec
      const uploadRate = delta.uploadBytes / elapsedSec

      setLatestDownload(downloadRate)
      setLatestUpload(uploadRate)
      setDownloadSeries((current) =>
        appendMetricSeriesPoint(current, { at: now, value: downloadRate }, SPEED_SERIES_MAX_POINTS),
      )
      setUploadSeries((current) =>
        appendMetricSeriesPoint(current, { at: now, value: uploadRate }, SPEED_SERIES_MAX_POINTS),
      )
      setProxyServerConnected(isProxyServerConnected())
      setRecentRequests(listRecentProxyServerRequests(12))
    }

    refreshLive()
    sample()
    const timer = window.setInterval(sample, sampleIntervalSec * 1000)
    const unsubMetrics = subscribeProxyServerMetrics(refreshLive)
    const unsubSettings = subscribeProxyServerSettings(refreshLive)
    return () => {
      window.clearInterval(timer)
      unsubMetrics()
      unsubSettings()
    }
  }, [sampleIntervalSec])

  return {
    downloadSeries,
    uploadSeries,
    latestDownloadBytesPerSec,
    latestUploadBytesPerSec,
    proxyServerConnected,
    recentRequests,
  }
}
