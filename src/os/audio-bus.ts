import { getEffectiveSystemVolume, subscribeSystemVolume } from './system-volume.ts'

/**
 * 系统音频总线（根治方案）。
 *
 * 在应用启动时替换 window.AudioContext：每个新建 context 的 destination
 * 都被替换为一个 masterGain（初值取系统主音量，订阅 store 实时平滑更新）。
 * 于是所有 node.connect(ctx.destination) 都自动经过系统主音量——
 * stems、系统提示音、五子棋、TTS 及未来任何发声源均无需逐源乘音量。
 *
 * HTMLMediaElement（new Audio / playObjectUrl）不走 Web Audio，无法被本总线覆盖，
 * 调用方需单独处理。iframe 内微应用是独立 realm，同样不受影响。
 */

let busActive = false

/**
 * 执行总线注入。返回是否成功；失败（如不支持 Proxy / 构造异常）时返回 false，
 * 调用方可回退到逐源补丁模式。应在任何音频模块初始化前同步调用一次。
 */
export function patchSystemVolumeBus(): boolean {
  if (typeof window === 'undefined' || busActive) {
    return busActive
  }

  const windowAny = window as typeof window & {
    webkitAudioContext?: typeof AudioContext
  }

  const NativeAudioContext = window.AudioContext ?? windowAny.webkitAudioContext
  const NativeWebkitAudioContext = windowAny.webkitAudioContext
  if (!NativeAudioContext) {
    return false
  }

  const wrap = (Ctor: typeof AudioContext): typeof AudioContext => {
    const PatchedAudioContext = function (
      this: AudioContext,
      ...args: ConstructorParameters<typeof AudioContext>
    ): AudioContext {
      const ctx = Reflect.construct(Ctor, args)
      let masterGain: GainNode | undefined
      try {
        masterGain = ctx.createGain()
        masterGain.gain.value = getEffectiveSystemVolume()
        masterGain.connect(ctx.destination)
        const unsubscribe = subscribeSystemVolume(() => {
          const gain = masterGain
          if (!gain) return
          if (ctx.state === 'closed') {
            unsubscribe()
            masterGain = undefined
            return
          }
          try {
            gain.gain.setTargetAtTime(getEffectiveSystemVolume(), ctx.currentTime, 0.01)
          } catch {
            // 节点已断开/context 已关闭
            unsubscribe()
            masterGain = undefined
          }
        })
      } catch {
        masterGain = undefined
      }

      return new Proxy(ctx, {
        get(target, prop, receiver) {
          if (prop === 'destination') {
            if (masterGain) {
              return masterGain
            }
            // 构造阶段失败：回退到真实 destination（逐源补丁仍生效）
            return Reflect.get(target, prop, receiver)
          }
          return Reflect.get(target, prop, target)
        },
      })
    } as unknown as typeof AudioContext
    return PatchedAudioContext
  }

  try {
    const patched = wrap(NativeAudioContext)
    window.AudioContext = patched
    if (NativeWebkitAudioContext) {
      windowAny.webkitAudioContext = wrap(NativeWebkitAudioContext)
    }
    busActive = true
  } catch {
    busActive = false
  }

  return busActive
}

/** 总线是否已激活。各发声源据此决定是否需要自行乘主音量。 */
export function isSystemVolumeBusActive(): boolean {
  return busActive
}
