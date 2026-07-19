/**
 * MiMo TTS 表现力试听：自然语言风格指令 + 文内标签（含唱歌）。
 * Demo 直连系统合成 API，可自选音色、流式边合成边播。
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  listSpeechVoices,
  MIMO_TTS_PCM_SAMPLE_RATE,
  resolveDefaultSpeechVoice,
  synthesizeSpeechStream,
} from '../../ai/speech-api.ts'
import { createStreamingPcmPlayer } from '../../ai/speech-pcm-player.ts'
import { isStreamAbortError } from '../../ai/stream-abort.ts'

type LogKind = 'info' | 'event' | 'result' | 'error'

type StylePreset = {
  id: string
  label: string
  group: string
  /** 自然语言风格（→ user message） */
  styleInstruction: string
  /** 合成文本，可含 (风格)(唱歌)（→ assistant message） */
  text: string
}

const STYLE_PRESETS: StylePreset[] = [
  // —— 基础 ——
  {
    id: 'plain',
    label: '默认口播',
    group: '基础',
    styleInstruction: '',
    text: '你好，欢迎使用语音实验室。今天天气不错，我们来试听一下合成效果。',
  },
  {
    id: 'news',
    label: '新闻播报',
    group: '基础',
    styleInstruction: '标准新闻播报腔：吐字清晰、节奏平稳、语气客观中立，句末不要上扬。',
    text: '据最新消息，本市明日将迎来大范围降雨，市民出行请携带雨具，注意交通安全。',
  },
  {
    id: 'ad',
    label: '广告推销',
    group: '基础',
    styleInstruction: '热情的电视购物口播，语速偏快，关键词加重，带着「再不买就亏了」的紧迫感。',
    text: '今天只要九十九！包邮到家！数量有限，先到先得，错过再等一年！',
  },
  {
    id: 'nav',
    label: '导航提示',
    group: '基础',
    styleInstruction: '车载导航女声：冷静清晰，短句为主，关键距离和转向要咬字清楚。',
    text: '前方五百米，请靠右行驶，然后从第二个出口离开匝道。',
  },

  // —— 语速节奏 ——
  {
    id: 'fast',
    label: '语速加快',
    group: '语速节奏',
    styleInstruction: '语速明显加快，吐字干脆利落，节奏紧凑，像赶时间汇报。',
    text: '注意，前方路况拥堵，请提前绕行。预计延误十五分钟，请合理安排行程。',
  },
  {
    id: 'slow',
    label: '语速放慢',
    group: '语速节奏',
    styleInstruction: '语速很慢，字与字之间留白充足，像在轻轻哄睡。',
    text: '没关系……慢慢来……先深呼吸……一切都会好起来的。',
  },
  {
    id: 'pause-heavy',
    label: '大停顿',
    group: '语速节奏',
    styleInstruction: '句子之间留很长停顿，像在斟酌每一个字，带一点压迫感。',
    text: '你知道吗……这件事……我考虑了很久。',
  },
  {
    id: 'rush-then-slow',
    label: '先急后缓',
    group: '语速节奏',
    styleInstruction: '',
    text:
      '(语速很快 紧张)快关门快关门！有人追过来了！(放慢 压低声音)……好了，应该甩掉了。先别出声。',
  },

  // —— 情绪 ——
  {
    id: 'happy',
    label: '开心',
    group: '情绪',
    styleInstruction: '',
    text: '(开心 语速稍快)哇，真的假的？太好了！我等这个消息好久了！',
  },
  {
    id: 'sad',
    label: '悲伤',
    group: '情绪',
    styleInstruction: '',
    text: '(悲伤 轻声)原来……到最后，还是要这样说再见啊。',
  },
  {
    id: 'angry',
    label: '愤怒',
    group: '情绪',
    styleInstruction: '',
    text: '(愤怒)你再说一遍？我已经给过你机会了！',
  },
  {
    id: 'fear',
    label: '恐惧',
    group: '情绪',
    styleInstruction: '',
    text: '(恐惧 声音发颤)那扇门……刚才明明关着的……为什么自己开了？',
  },
  {
    id: 'amazed',
    label: '惊讶',
    group: '情绪',
    styleInstruction: '',
    text: '(惊讶)等等，你说什么？他居然考上了？！',
  },
  {
    id: 'excited',
    label: '兴奋',
    group: '情绪',
    styleInstruction: '',
    text: '(兴奋 语速快)天啊天啊天啊！我们真的进决赛了！我现在手脚都在抖！',
  },
  {
    id: 'wronged',
    label: '委屈',
    group: '情绪',
    styleInstruction: '',
    text: '(委屈 带点鼻音)我又没做错什么……你为什么要这样说我……',
  },
  {
    id: 'calm',
    label: '平静',
    group: '情绪',
    styleInstruction: '',
    text: '(平静)事情已经发生了。我们先把能做的做完，其余的以后再说。',
  },
  {
    id: 'indifferent',
    label: '冷漠',
    group: '情绪',
    styleInstruction: '',
    text: '(冷漠 平淡)随你便。跟我没关系。',
  },
  {
    id: 'melancholy',
    label: '忧郁',
    group: '情绪',
    styleInstruction: '',
    text: '(忧郁)秋天总是这样。风一吹，就想起很多回不去的事。',
  },
  {
    id: 'helpless',
    label: '无奈',
    group: '情绪',
    styleInstruction: '',
    text: '(无奈 叹气)唉，又能怎样呢？该来的总会来。',
  },
  {
    id: 'guilty',
    label: '愧疚',
    group: '情绪',
    styleInstruction: '',
    text: '(愧疚 声音发虚)对不起……是我没保护好你。这件事，怪我。',
  },
  {
    id: 'jealous',
    label: '嫉妒',
    group: '情绪',
    styleInstruction: '',
    text: '(嫉妒 咬牙)哟，风光啊。站在台上的人，怎么就偏偏是你呢？',
  },
  {
    id: 'tired',
    label: '疲惫',
    group: '情绪',
    styleInstruction: '',
    text: '(疲惫 有气无力)别问了……我真的……一点力气都没有了。',
  },
  {
    id: 'smile-cry',
    label: '笑中带泪',
    group: '情绪',
    styleInstruction: '复杂情绪：嘴上在笑，声音却发紧，像强撑着不让自己哭出来。',
    text: '没事，我很好啊。你看，我不是在笑吗？……真的，没事。',
  },

  // —— 语气音色 ——
  {
    id: 'whisper',
    label: '耳语',
    group: '语气音色',
    styleInstruction: '用极轻的耳语说话，几乎贴着耳边，气息很轻，带一点神秘感。',
    text: '嘘……别出声。跟我来，别让任何人发现。',
  },
  {
    id: 'lazy',
    label: '慵懒',
    group: '语气音色',
    styleInstruction: '',
    text: '(慵懒)再让我睡五分钟……就五分钟，真的，最后一次……',
  },
  {
    id: 'gentle',
    label: '温柔',
    group: '语气音色',
    styleInstruction: '',
    text: '(温柔)别怕，我在。手伸过来，我带你走。',
  },
  {
    id: 'cold',
    label: '清冷',
    group: '语气音色',
    styleInstruction: '',
    text: '(清冷)请让开。我们之间，没有什么好谈的。',
  },
  {
    id: 'lively',
    label: '活泼',
    group: '语气音色',
    styleInstruction: '',
    text: '(活泼 语速稍快)走走走！今天天气这么好，不去浪费了！',
  },
  {
    id: 'serious',
    label: '严肃',
    group: '语气音色',
    styleInstruction: '',
    text: '(严肃)这件事没有商量余地。请立刻执行。',
  },
  {
    id: 'playful',
    label: '俏皮',
    group: '语气音色',
    styleInstruction: '',
    text: '(俏皮)猜猜我是谁？猜对了有奖励哦～',
  },
  {
    id: 'magnetic',
    label: '磁性低沉',
    group: '语气音色',
    styleInstruction: '',
    text: '(磁性)夜已经深了，城市却还在呼吸。今晚，我陪你听。',
  },
  {
    id: 'sweet',
    label: '甜嗓',
    group: '语气音色',
    styleInstruction: '',
    text: '(甜 撒娇)你能不能……再陪我一会儿嘛？就一小会儿。',
  },
  {
    id: 'hoarse',
    label: '沙哑',
    group: '语气音色',
    styleInstruction: '',
    text: '(沙哑)咳……嗓子有点哑。昨晚又熬夜了。',
  },
  {
    id: 'shout',
    label: '高声呼喊',
    group: '语气音色',
    styleInstruction: '',
    text: '(提高音量 大喊)姐姐！这鱼新鲜！今早刚捞上来的！嘿！那边别翻了，弄坏了要赔的！',
  },

  // —— 方言角色 ——
  {
    id: 'dongbei',
    label: '东北话',
    group: '方言角色',
    styleInstruction: '',
    text: '(东北话)哎呦我去，今儿这天真冷啊！那风刮脸上跟刀子似的！',
  },
  {
    id: 'sichuan',
    label: '四川话',
    group: '方言角色',
    styleInstruction: '',
    text: '(四川话)要得嘛！这个火锅安逸得很，多吃两口噻！',
  },
  {
    id: 'henan',
    label: '河南话',
    group: '方言角色',
    styleInstruction: '',
    text: '(河南话)中中中！这事儿包在我身上，你放心中！',
  },
  {
    id: 'cantonese',
    label: '粤语感',
    group: '方言角色',
    styleInstruction: '',
    text: '(粤语)哇，真係好正啊！试过一次就唔会忘记！',
  },
  {
    id: 'taiwan',
    label: '台湾腔',
    group: '方言角色',
    styleInstruction: '',
    text: '(台湾腔)真的假的啦？你好可爱哦，我超喜欢的耶～',
  },
  {
    id: 'wukong',
    label: '孙悟空',
    group: '方言角色',
    styleInstruction: '',
    text: '(孙悟空)嘿嘿，俺老孙来也！妖魔鬼怪，哪里逃！',
  },
  {
    id: 'lindaiyu',
    label: '林黛玉',
    group: '方言角色',
    styleInstruction: '',
    text: '(林黛玉)花谢花飞花满天，红消香断有谁怜……你既知道，又何必再问。',
  },
  {
    id: 'uncle',
    label: '大叔音',
    group: '方言角色',
    styleInstruction: '',
    text: '(大叔音)年轻人，路还长着呢。先把眼前这关过了再说。',
  },
  {
    id: 'shota',
    label: '少年音',
    group: '方言角色',
    styleInstruction: '',
    text: '(少年音)喂！等我一下啦！我还没准备好呢！',
  },
  {
    id: 'oneesan',
    label: '御姐音',
    group: '方言角色',
    styleInstruction: '',
    text: '(御姐音)过来。乖，听姐姐的话，好不好？',
  },

  // —— 语气切换（用圆括号风格，不用方括号音频标签）——
  {
    id: 'tags-interview',
    label: '面试紧张',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(紧张)呼……冷静，冷静。不过是一次面试……(语速加快)自我介绍我已经练了五十遍，应该没问题。(轻声)领带歪了吗？',
  },
  {
    id: 'tags-overtime',
    label: '加班虚脱',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(极度疲惫 有气无力)师傅……到了叫我一声……唉，我先眯一会儿。这加班加得，魂都快散了。',
  },
  {
    id: 'tags-whatif',
    label: '若有所思',
    group: '语气切换',
    styleInstruction: '',
    text:
      '如果当时……哪怕再坚持一秒，结局会不会不同？(强颜欢笑)呵，没有如果了。',
  },
  {
    id: 'tags-cold',
    label: '寒风喘息',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(因寒冷而急促呼吸)呼——呼——这大兴安岭的雪……咳，真能冻进骨头里……别停，继续走，快走。',
  },
  {
    id: 'tags-laugh',
    label: '边笑边说',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(忍俊不禁)你认真的吗？哈哈不行了，我真的……太好笑了！',
  },
  {
    id: 'tags-cry',
    label: '哽咽诉说',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(哽咽)我……我不是故意的……你能不能……再听我说一句……',
  },
  {
    id: 'tags-mix',
    label: '情绪切换',
    group: '语气切换',
    styleInstruction: '',
    text:
      '(播报腔)各位旅客请注意。(轻声)其实我想说的是——(激动)我们回家了！',
  },

  // —— 自然语言 / 导演 ——
  {
    id: 'director-radio',
    label: '深夜电台',
    group: '导演模式',
    styleInstruction: `【角色】一位沉稳的电台深夜主播，声音低沉有磁性，习惯用短句。
【场景】凌晨两点，对唯一还醒着的听众说话，窗外下着小雨。
【指导】语速偏慢；句末略微下沉；偶有极轻的气声；不要夸张，像朋友聊天。`,
    text: '还没睡吗？没关系。今晚的雨声刚好够当背景音。我给你念一段短短的故事。',
  },
  {
    id: 'director-noble',
    label: '冷傲贵族',
    group: '导演模式',
    styleInstruction: `【角色】百年世家现任家主，自幼被塑造成无感情的家族图腾，对他人有强烈的阶级疏离感。
【场景】祠堂阴影里，她看着拼死闯进来想带她私奔的人，要用最冰冷的规矩掐灭这份感情。
【指导】沉稳女声，松弛却极有压迫感；极慢；句间长停顿；整体平直硬实，个别字尾带极轻气声。`,
    text: '你不该来。这里不是你能踏入的地方。带着你的那点可笑的真心，离开。',
  },
  {
    id: 'director-teacher',
    label: '温和老师',
    group: '导演模式',
    styleInstruction: `【角色】高中班主任，温和但不纵容，说话带一点笑意。
【场景】晚自习后，单独留下一名没交作业的学生谈话。
【指导】语速中等偏慢；关键词轻轻加重；结尾上扬一点点，留出对方回答的空间。`,
    text: '坐下吧。我不是要骂你。我只是想知道，最近是不是遇到什么事了？',
  },
  {
    id: 'director-game',
    label: '游戏NPC',
    group: '导演模式',
    styleInstruction: `【角色】奇幻 RPG 里的旅店老板，见多识广，说话带点市井俏皮。
【场景】冒险者刚进门，外面正在下雨。
【指导】中等语速；元气；专有名词咬清楚；结尾像在推销床位。`,
    text: '哟，新面孔？外面雨这么大，先住一晚吧。楼上还有空房，含早饭。',
  },
  {
    id: 'nl-proud',
    label: '报喜兴奋',
    group: '导演模式',
    styleInstruction:
      '用轻快上扬的语气向领导报好消息，语速稍快，抑制不住的兴奋里带着一点得意，声音明亮有劲。',
    text: '领导！成绩出来了！我过了！不是刚好过，是优秀！您之前说悬，这不，悬成惊喜了！',
  },

  // —— 唱歌 ——
  {
    id: 'sing-freedom',
    label: '海阔天空',
    group: '唱歌',
    styleInstruction: 'Sing the song "海阔天空". Rock ballad, free and emotional.',
    text:
      '(唱歌)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒。放弃理想任何人都可以，怕只有你会哭得如此优雅。',
  },
  {
    id: 'sing-moon',
    label: '月亮代表我的心',
    group: '唱歌',
    styleInstruction: 'Sing the song "月亮代表我的心". Soft, lyrical, slightly nostalgic.',
    text: '(唱歌)你问我爱你有多深，我爱你有几分。我的情也真，我的爱也真，月亮代表我的心。',
  },
  {
    id: 'sing-friend',
    label: '朋友',
    group: '唱歌',
    styleInstruction: 'Sing the song "朋友". Warm, reflective ballad.',
    text:
      '(唱歌)这些年，一个人，风也过，雨也走，有过泪，有过错，还记得坚持什么。',
  },
  {
    id: 'sing-child',
    label: '儿歌',
    group: '唱歌',
    styleInstruction: 'Sing the song "两只老虎". Playful kids song, clear and bouncy.',
    text: '(唱歌)两只老虎，两只老虎，跑得快，跑得快。一只没有耳朵，一只没有尾巴，真奇怪，真奇怪。',
  },
  {
    id: 'sing-birthday',
    label: '生日快乐',
    group: '唱歌',
    styleInstruction: 'Sing the song "祝你生日快乐". Cheerful birthday song, clear melody.',
    text: '(唱歌)祝你生日快乐，祝你生日快乐，祝你生日快乐，祝你生日快乐。',
  },
  {
    id: 'sing-story',
    label: '说唱衔接',
    group: '唱歌',
    styleInstruction: 'Sing the song "我想有个家". Soft and wistful after spoken intro.',
    text:
      '(旁白 平静)夜深了，他忽然想起那首歌……(唱歌)我想有个家，一个不需要华丽的地方。如果有一天，我老无所依……',
  },
]

const PRESET_GROUPS = [
  ...new Set(STYLE_PRESETS.map((item) => item.group)),
]

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function SpeechStyleLabPanel({
  modelLabel,
  pushLog,
}: {
  modelLabel: string
  pushLog: (kind: LogKind, text: string) => void
}) {
  const voices = listSpeechVoices()
  const [voice, setVoice] = useState(() => resolveDefaultSpeechVoice())
  const [styleInstruction, setStyleInstruction] = useState(
    STYLE_PRESETS[0]?.styleInstruction ?? '',
  )
  const [text, setText] = useState(STYLE_PRESETS[0]?.text ?? '')
  const [activePresetId, setActivePresetId] = useState<string | undefined>(
    STYLE_PRESETS[0]?.id,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [meta, setMeta] = useState<string | undefined>()
  const abortRef = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = undefined
    }
  }, [])

  const applyPreset = useCallback((preset: StylePreset) => {
    setActivePresetId(preset.id)
    setStyleInstruction(preset.styleInstruction)
    setText(preset.text)
    setError(undefined)
    setMeta(undefined)
    pushLog('event', `已载入预设：${preset.group} · ${preset.label}`)
  }, [pushLog])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = undefined
    setBusy(false)
    pushLog('event', '已停止合成播放')
  }, [pushLog])

  const handlePlay = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('请输入要合成的文本')
      return
    }

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setBusy(true)
    setError(undefined)
    setMeta(undefined)

    const style = styleInstruction.trim()
    pushLog(
      'info',
      `表现力试听 voice=${voice} styleChars=${style.length} textChars=${trimmed.length}`,
    )

    const player = createStreamingPcmPlayer({
      sampleRate: MIMO_TTS_PCM_SAMPLE_RATE,
      signal: abort.signal,
    })

    try {
      const result = await synthesizeSpeechStream({
        text: trimmed,
        styleInstruction: style || undefined,
        voice,
        signal: abort.signal,
        usageContext: {
          actor: 'speech',
          behavior: 'style-lab',
          behaviorLabel: '表现力试听',
        },
        onPcmChunk: (pcm) => {
          player.enqueue(pcm)
        },
      })

      player.markEnd()
      await player.waitUntilEnded()
      if (abort.signal.aborted) return

      setMeta(
        `模型 ${result.model} · voice=${voice} · ${(result.pcm.byteLength / 1024).toFixed(1)} KB PCM`,
      )
      pushLog(
        'result',
        `表现力合成完成 model=${result.model} bytes=${result.pcm.byteLength}`,
      )
    } catch (err) {
      player.stop()
      if (isStreamAbortError(err, abort.signal) || abort.signal.aborted) {
        return
      }
      const message = formatError(err)
      setError(message)
      pushLog('error', `表现力合成失败：${message}`)
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = undefined
        setBusy(false)
      }
    }
  }, [pushLog, styleInstruction, text, voice])

  return (
    <>
      <section class="speech-app__panel speech-app__config">
        <div class="speech-app__panel-title">表现力试听（MiMo 风格 / 标签）</div>
        <p class="speech-app__style-lab-hint">
          风格指令走自然语言（user）；官网代码示例多为英文（如 Bright, bouncy…），中英均可。合成文本可用 (开心)/(Happy)/(唱歌) 等圆括号标签。唱歌请在文首加 (唱歌)。不要用 [停顿] 这类方括号标签。
        </p>
        <div class="speech-app__config-grid">
          <label class="speech-app__field">
            <span>首选模型</span>
            <input class="speech-app__readonly" type="text" value={modelLabel} readOnly />
          </label>
          <label class="speech-app__field">
            <span>音色</span>
            <select
              value={voice}
              disabled={busy}
              onChange={(e) => setVoice((e.target as HTMLSelectElement).value)}
            >
              {voices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label class="speech-app__field speech-app__field--wide">
            <span>自然语言风格指令（可选，建议英文）</span>
            <textarea
              rows={3}
              value={styleInstruction}
              disabled={busy}
              placeholder="例如：Bright, warm, slightly faster pace. 或写【角色】【场景】【指导】导演模式"
              onInput={(e) => {
                setActivePresetId(undefined)
                setStyleInstruction((e.target as HTMLTextAreaElement).value)
              }}
            />
          </label>
          <label class="speech-app__field speech-app__field--wide">
            <span>合成文本（可含标签）</span>
            <textarea
              rows={5}
              value={text}
              disabled={busy}
              placeholder="(开心)你好呀！或 (唱歌)歌词…"
              onInput={(e) => {
                setActivePresetId(undefined)
                setText((e.target as HTMLTextAreaElement).value)
              }}
            />
          </label>
        </div>
      </section>

      <section class="speech-app__panel speech-app__style-presets">
        <div class="speech-app__panel-title">快捷预设</div>
        {PRESET_GROUPS.map((group) => (
          <div key={group} class="speech-app__preset-group">
            <span class="speech-app__preset-group-label">{group}</span>
            <div class="speech-app__preset-chips">
              {STYLE_PRESETS.filter((item) => item.group === group).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  class={`speech-app__preset-chip${activePresetId === preset.id ? ' speech-app__preset-chip--active' : ''}`}
                  disabled={busy}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section class="speech-app__panel speech-app__controls">
        <button
          type="button"
          class="speech-app__mic"
          disabled={busy || !text.trim()}
          onClick={handlePlay}
        >
          {busy ? '合成播放中…' : '试听'}
        </button>
        <button
          type="button"
          class="speech-app__btn"
          disabled={!busy}
          onClick={handleStop}
        >
          停止
        </button>
        <span
          class={`speech-app__status${busy ? ' speech-app__status--busy' : ''}`}
        >
          <span class="speech-app__status-dot" aria-hidden="true" />
          {busy ? '流式合成中' : '空闲'}
        </span>
      </section>

      {error && <p class="speech-app__error">{error}</p>}
      {meta && !error && <p class="speech-app__lastevent">{meta}</p>}
    </>
  )
}
