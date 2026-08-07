import {
  deleteMusicTrack,
  getMusicTrack,
  getMusicTracksBytes,
  putMusicTrack,
} from '../../os/device-data-storage.ts'

export { deleteMusicTrack, getMusicTracksBytes }

export async function getMusicTrackBlob(id: string): Promise<Blob | undefined> {
  const record = await getMusicTrack(id)
  return record?.blob
}

/** 写入音频体；超数据空间配额返回 false。 */
export async function saveMusicTrackBlob(id: string, blob: Blob): Promise<boolean> {
  return putMusicTrack(id, blob)
}
