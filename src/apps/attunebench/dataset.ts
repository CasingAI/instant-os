/** AttuneBench 数据集运行时加载与缓存（Cache API） */

import { parseConversationData, type ConversationData } from './types.ts'

/**
 * 各子集文件清单（官方仓库 Test Samples 目录实测提取）。
 * 文件名 conversation_N.json 的 N 不连续，无法推导，必须内联。
 * scripts/vendor-attunebench.sh 与此清单同步维护。
 */
export const SUBSETS = [
  {
    id: 'Sample200',
    label: 'Sample200',
    count: 200,
    default: false,
    ids: [
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46, 47, 48, 49, 51, 52, 53, 54, 55,
      56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
      80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 92, 94, 96, 97, 98, 99, 100, 101, 102, 103, 104,
      105, 107, 108, 109, 110, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125,
      126, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144,
      145, 146, 147, 148, 149, 150, 153, 154, 155, 159, 160, 161, 162, 164, 165, 166, 167, 168,
      169, 170, 172, 173, 174, 175, 176, 177, 178, 179, 181, 182, 184, 185, 186, 187, 189, 190,
      192, 194, 195, 196, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 209, 213, 215, 218,
      219, 220, 221, 223, 227, 232, 233, 235, 237, 240, 241, 242, 243, 245, 246, 247, 248,
    ],
  },
  {
    id: 'Subsample100',
    label: 'Subsample100',
    count: 100,
    default: false,
    ids: [
      9, 10, 13, 14, 15, 19, 21, 24, 25, 27, 28, 29, 30, 32, 36, 37, 38, 42, 43, 48, 49, 53, 54,
      55, 58, 60, 64, 71, 72, 73, 76, 77, 81, 83, 85, 87, 88, 92, 96, 97, 99, 103, 104, 106, 108,
      113, 114, 115, 117, 118, 119, 120, 124, 126, 129, 131, 132, 134, 135, 136, 137, 141, 142,
      144, 146, 147, 148, 150, 153, 155, 160, 162, 164, 165, 167, 169, 170, 173, 176, 178, 179,
      182, 185, 186, 187, 196, 199, 200, 201, 202, 205, 207, 209, 213, 215, 223, 237, 242, 243,
      247,
    ],
  },
  {
    id: 'Subsample50',
    label: 'Subsample50',
    count: 50,
    default: false,
    ids: [
      5, 9, 10, 12, 13, 16, 24, 25, 29, 30, 34, 36, 39, 40, 46, 49, 53, 55, 59, 60, 63, 65, 69,
      70, 75, 80, 81, 105, 108, 117, 130, 139, 142, 155, 166, 178, 182, 185, 187, 198, 200, 203,
      207, 218, 219, 220, 223, 232, 233, 241,
    ],
  },
  {
    id: 'Subsample25',
    label: 'Subsample25',
    count: 25,
    default: false,
    ids: [10, 12, 13, 16, 105, 108, 117, 130, 139, 142, 155, 166, 178, 182, 185, 187, 198, 200, 203, 207, 218, 219, 220, 223, 232],
  },
  {
    id: 'Subsample20',
    label: 'Subsample20',
    count: 20,
    default: true,
    ids: [13, 36, 41, 51, 68, 69, 102, 105, 108, 117, 119, 125, 141, 146, 154, 160, 167, 169, 173, 246],
  },
] as const

export type SubsetId = (typeof SUBSETS)[number]['id']

const CACHE_NAME = 'instant-os-attunebench-dataset'
const BASE_URL = 'https://raw.githubusercontent.com/Thoughtful-Lab/attunebench/main/Test%20Samples'

function fileUrl(subset: SubsetId, id: number): string {
  return `${BASE_URL}/${subset}/conversation_${id}.json`
}

/** 读取单个对话文件：优先 Cache API 命中，未命中则下载并写入缓存 */
async function loadConversationFile(url: string): Promise<ConversationData | null> {
  const cache = await caches.open(CACHE_NAME)
  const hit = await cache.match(url)
  if (hit) {
    const parsed = parseConversationData(await hit.json())
    return parsed
  }

  const response = await fetch(url)
  if (!response.ok) return null
  // 先克隆一份写入缓存，再解析本体（response 只能消费一次）
  await cache.put(url, response.clone())
  const parsed = parseConversationData(await response.json())
  return parsed
}

export type DatasetStatus = 'idle' | 'loading' | 'done' | 'error'

/** 加载某个子集全部对话；带进度回调。有文件失败时抛错并附缺失详情（不静默） */
export async function loadSubset(
  subsetId: SubsetId,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ConversationData[]> {
  const subset = SUBSETS.find((item) => item.id === subsetId)
  if (!subset) throw new Error(`未知数据集：${subsetId}`)

  const results: ConversationData[] = []
  const failures: string[] = []
  const total = subset.ids.length

  for (const id of subset.ids) {
    const file = `conversation_${id}.json`
    try {
      const conv = await loadConversationFile(fileUrl(subsetId, id))
      if (conv) {
        results.push(conv)
      } else {
        failures.push(file)
      }
    } catch {
      failures.push(file)
    }
    onProgress?.(results.length + failures.length, total)
  }

  if (failures.length > 0) {
    const shown = failures.slice(0, 5).join('、')
    const more = failures.length > 5 ? ` 等 ${failures.length} 个` : ''
    throw new Error(
      `${subset.label} 数据加载不完整：缺失 ${failures.length}/${total} 个文件（${shown}${more}）。` +
        '可重试下载；已成功的文件会从缓存复用。',
    )
  }
  return results
}
