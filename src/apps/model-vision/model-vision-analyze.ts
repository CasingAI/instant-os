import { buildThinkingRequestExtras } from '../../ai/ai-thinking.ts'
import { finishAiEventLogSession, startAiEventLogSession } from '../../ai/ai-event-log.ts'
import { mergeOpenAiConfig } from '../../ai/openai-config.ts'
import { getOpenAiClient } from '../../ai/openai-client.ts'
import { recordOpenAiCompletionUsage } from '../../ai/openai-usage.ts'
import type {
  Instant3dAxisSide,
  Instant3dCatalogEntry,
  Instant3dPlacementKind,
} from '../../assets/3d/asset-catalog.ts'
import type {
  ModelVisionAnalysis,
  ModelVisionCapturedView,
  ModelVisionOrientation,
} from './model-vision-types.ts'

const AXIS_SIDES: readonly Instant3dAxisSide[] = ['+x', '-x', '+z', '-z']
const PLACEMENT_KINDS: readonly Instant3dPlacementKind[] = [
  'free',
  'tile',
  'linear',
  'corner',
  'junction',
  'wall',
]

const SYSTEM_PROMPT = `你是 Instant OS 的 3D 资源视觉标注助手。
用户会提供同一 GLTF 模型的多张截图，图中带有彩色坐标轴标注：
- 红轴 = +X（右）
- 绿轴 = +Y（上）
- 蓝轴 = +Z（前）
坐标系：X 右、Y 上、Z 前；地面在 XZ 平面。
视角约定：
- front：相机在 +Z，看到的是物体朝向 +Z 的那一侧
- side：相机在 +X，看到的是物体朝向 +X 的那一侧
- top：俯视，最适合判断道路/瓦片开口
- iso：斜视，看整体外形

目标读者是「没有视觉能力」的文本模型：它们只能靠你的文字决定如何 position / rotation.y 摆放。
因此描述必须可操作、可对照坐标轴，禁止空泛形容词堆砌。

必须综合全部视角再下结论；不要只根据单张图臆测。
每条轴方向结论都要能指出依据视角（例如「俯视图中……」「正视图中……」）。

分类要点：
【道路 / 路径 / 瓦片】
- forward = 默认延伸主轴；connects = 可拼接边
- 转角要写清弯从哪边到哪边；T 形要写清直道与支路；斑马线要写清条纹相对道路的走向
【车辆】
- face = 车头朝向
【家具 / 道具】
- face = 使用正面朝向（椅子：人坐着脸朝的方向；床：通常脚朝向，床头用 back；柜子：柜门朝向）
- back = 椅背 / 床头 / 柜背朝向（若有）
- 靠垫、把手、灯头等不对称细节必须写清落在哪一侧（+X/-X/+Z/-Z）

只输出一个 JSON 对象，不要 markdown，不要解释。字段：
{
  "visualDescription": "中文，5~10 句。必须包含：整体外形、主要颜色分区、不对称特征、默认朝向（对照坐标轴）、与地面关系。要写得让看不见图的人也能在脑中重建摆放。",
  "appearanceNotes": "材质、纹理、显著配色与细节，3~6 句，避免与 visualDescription 完全重复。",
  "axisLandmarks": "一句话列表式对照：关键部件 → 轴方向。例：椅背朝 -Z；坐姿面朝 +Z；蓝靠垫在 +X 侧扶手内侧。",
  "forward": "+z" | "-z" | "+x" | "-x" | null,
  "face": "+z" | "-z" | "+x" | "-x" | null,
  "back": "+z" | "-z" | "+x" | "-x" | null,
  "connects": ["+z","-z"] | null,
  "placementKind": "free" | "tile" | "linear" | "corner" | "junction" | "wall",
  "placementHint": "默认姿态下一句话：这个模型「正面/延伸」朝哪，接口在哪。",
  "sceneUseHint": "给场景生成用的操作建议，2~4 句：如何贴地、如何与其他物体对齐；若要把正面改朝某方向，rotation.y 大约转多少（90°=Math.PI/2）。",
  "confidence": "high" | "medium" | "low"
}

规则：
- forward：仅道路/管道/围栏等有延伸语义时填写，否则 null
- face / back：看不清就 null，并把 confidence 降为 medium/low
- connects：自由摆放物体必须 null
- 禁止编造截图里看不见的文字、品牌、内部结构
- 禁止把「正面应朝向使用者」这种相对房间的空话当成轴方向；轴方向必须是 +x/-x/+z/-z`

function parseAxisSide(value: unknown): Instant3dAxisSide | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase() as Instant3dAxisSide
  return AXIS_SIDES.includes(normalized) ? normalized : undefined
}

function parsePlacementKind(value: unknown): Instant3dPlacementKind | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase() as Instant3dPlacementKind
  return PLACEMENT_KINDS.includes(normalized) ? normalized : undefined
}

function parseConnects(value: unknown): Instant3dAxisSide[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sides = value
    .map(parseAxisSide)
    .filter((side): side is Instant3dAxisSide => side !== undefined)
  return sides.length > 0 ? sides : undefined
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('视觉模型未返回内容')
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new Error('无法解析视觉模型返回的 JSON')
  }
}

function analysisFromParsed(rawText: string, parsed: unknown): ModelVisionAnalysis {
  if (!parsed || typeof parsed !== 'object') {
    return {
      visualDescription: rawText.trim(),
      appearanceNotes: '',
      orientation: {},
      rawText,
    }
  }

  const record = parsed as Record<string, unknown>
  const visualDescription =
    typeof record.visualDescription === 'string' && record.visualDescription.trim()
      ? record.visualDescription.trim()
      : rawText.trim()
  const appearanceNotes =
    typeof record.appearanceNotes === 'string' ? record.appearanceNotes.trim() : ''
  const confidenceRaw =
    typeof record.confidence === 'string' ? record.confidence.trim().toLowerCase() : undefined
  const confidence =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : undefined

  const orientation: ModelVisionOrientation = {
    forward: parseAxisSide(record.forward),
    face: parseAxisSide(record.face),
    back: parseAxisSide(record.back),
    connects: parseConnects(record.connects),
    placementKind: parsePlacementKind(record.placementKind),
    placementHint:
      typeof record.placementHint === 'string' && record.placementHint.trim()
        ? record.placementHint.trim()
        : undefined,
    axisLandmarks:
      typeof record.axisLandmarks === 'string' && record.axisLandmarks.trim()
        ? record.axisLandmarks.trim()
        : undefined,
    sceneUseHint:
      typeof record.sceneUseHint === 'string' && record.sceneUseHint.trim()
        ? record.sceneUseHint.trim()
        : undefined,
    confidence,
  }

  return {
    visualDescription,
    appearanceNotes,
    orientation,
    rawText,
  }
}

function buildUserText(entry: Instant3dCatalogEntry, views: ModelVisionCapturedView[]): string {
  const size = entry.appearance.sizeMeters
  const viewLines = views.map((view, index) => `${index + 1}. ${view.id} — ${view.label}`).join('\n')
  return [
    `模型 ID：${entry.id}`,
    `目录名称：${entry.label}`,
    `资源路径：${entry.url}`,
    `素材包：${entry.source}`,
    `包围盒（米）：宽 ${size.width} × 高 ${size.height} × 深 ${size.depth}`,
    `当前目录关键词：${entry.keywords.join('、')}`,
    `当前目录描述（可能很模糊，请以截图为准）：${entry.appearance.description}`,
    '',
    '截图视角说明：',
    viewLines,
    '',
    '请根据截图输出更详细的 JSON。',
    '家具要写清 face/back 与不对称细节相对哪根轴；道路/瓦片要写清 forward 与 connects。',
    'axisLandmarks 与 sceneUseHint 必填，且必须对照坐标轴，不要写空泛房间建议。',
  ].join('\n')
}

export type AnalyzeModelVisionResult = ModelVisionAnalysis & {
  providerId: string
  model: string
}

export async function analyzeModelVision(
  entry: Instant3dCatalogEntry,
  views: ModelVisionCapturedView[],
): Promise<AnalyzeModelVisionResult> {
  if (views.length === 0) {
    throw new Error('缺少截图')
  }

  const config = mergeOpenAiConfig(undefined, 'vision')
  const client = getOpenAiClient(undefined, 'vision')
  const usageContext = {
    actor: 'model-vision',
    behavior: 'analyze-model',
    behaviorLabel: '识别 3D 模型',
  }

  // 截图页已输出压缩 JPEG；这里只引用，返回后由调用方清空数组
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: buildUserText(entry, views) }]

  for (const view of views) {
    userContent.push({
      type: 'text',
      text: `【视角 ${view.id}】${view.label}`,
    })
    userContent.push({
      type: 'image_url',
      image_url: { url: view.dataUrl },
    })
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userContent },
  ]

  const logSession = startAiEventLogSession(usageContext, {
    model: config.defaultModel,
    thinkingEnabled: config.thinkingEnabled,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${buildUserText(entry, views)}\n\n（附 ${views.length} 张模型截图）`,
      },
    ],
  })

  try {
    const response = await client.chat.completions.create({
      model: config.defaultModel,
      messages,
      max_completion_tokens: 4096,
      ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
    })

    // 丢掉图引用（调用方还会再清 views）
    for (let index = userContent.length - 1; index >= 1; index -= 1) {
      userContent.pop()
    }

    const rawText = response.choices[0]?.message?.content?.trim() ?? ''
    if (!rawText) {
      throw new Error('视觉模型未返回任何内容')
    }

    recordOpenAiCompletionUsage(response, usageContext, {
      model: config.defaultModel,
      thinkingEnabled: config.thinkingEnabled,
      session: logSession,
    })

    let parsed: unknown
    try {
      parsed = extractJsonObject(rawText)
    } catch {
      parsed = undefined
    }

    const analysis = analysisFromParsed(rawText, parsed)
    return {
      ...analysis,
      providerId: config.providerId,
      model: config.defaultModel,
    }
  } catch (error) {
    for (let index = userContent.length - 1; index >= 1; index -= 1) {
      userContent.pop()
    }
    const snapshot = logSession.snapshot()
    if (snapshot) {
      finishAiEventLogSession(logSession, usageContext, {
        response: snapshot.response,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : '视觉识别失败',
      })
    }
    throw error
  }
}
