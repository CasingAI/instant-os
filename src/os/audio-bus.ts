import { getEffectiveSystemVolume, subscribeSystemVolume } from './system-volume.ts'

/**
 * 系统音频总线（根治方案）。
 *
 * 在应用启动时替换 window.AudioContext：通过子类继承每个新建 context，
 * 用实例自有属性 shadow destination 为一个 masterGain（初值取系统主音量，
 * 订阅 store 实时平滑更新）。于是所有 node.connect(ctx.destination) 都自动
 * 经过系统主音量——stems、系统提示音、五子棋、TTS 及未来任何发声源均无需
 * 逐源乘音量。
 *
 * 采用「子类继承」而非 Proxy 包装：子类实例仍是真实的 AudioContext
 * （内部槽完整），所有方法调用 this 天然正确；而 Proxy 包装 platform object
 * 后，原生 WebIDL 方法会用内部槽校验 this，以 Proxy 为 this 调用会抛
 * `TypeError: Illegal invocation`（典型如 decodeAudioData）。
 *
 * HTMLMediaElement（new Audio / playObjectUrl）不走 Web Audio，无法被本总线覆盖，
 * 调用方需单独处理。iframe 内微应用是独立 realm，同样不受影响。
 */

let busActive = false

/**
 * 执行总线注入。返回是否成功；失败（如不支持继承 / 冒烟构造异常）时返回 false，
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

  const wrap = (Ctor: typeof AudioContext): typeof AudioContext | undefined => {
    let SubCtor: typeof AudioContext | undefined
    try {
      // 继承原生构造器：实例仍是真实 AudioContext（内部槽完整），
      // 所有方法调用 this 天然正确，规避 Proxy 包装的 Illegal invocation。
      class PatchedAudioContext extends Ctor {
        private masterGain: GainNode | undefined
        private unsubscribe: (() => void) | undefined

        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args)
          try {
            const masterGain = this.createGain()
            masterGain.gain.value = getEffectiveSystemVolume()
            masterGain.connect(super.destination)
            this.masterGain = masterGain
            this.unsubscribe = subscribeSystemVolume(() => {
              const gain = this.masterGain
              if (!gain) return
              if (this.state === 'closed') {
                this.unsubscribe?.()
                this.masterGain = undefined
                return
              }
              try {
                gain.gain.setTargetAtTime(getEffectiveSystemVolume(), this.currentTime, 0.01)
              } catch {
                // 节点已断开 / context 已关闭
                this.unsubscribe?.()
                this.masterGain = undefined
              }
            })
            // 用实例自有属性 shadow 原型上的 destination getter：
            // 之后 node.connect(ctx.destination) 自动经过系统主音量。
            Object.defineProperty(this, 'destination', {
              get: () => masterGain,
              configurable: true,
              enumerable: true,
            })
          } catch {
            // 初始化失败：不 shadow destination，该 context 保持真实输出
            this.masterGain = undefined
          }
        }
      }
      // 冒烟测试：确认继承构造在运行时可用；不可用则放弃劫持
      const smoke = Reflect.construct(PatchedAudioContext, [])
      void smoke.close()
      SubCtor = PatchedAudioContext as unknown as typeof AudioContext
    } catch {
      return undefined
    }

    const PatchedAudioContext = function (
      this: AudioContext,
      ...args: ConstructorParameters<typeof AudioContext>
    ): AudioContext {
      if (SubCtor) {
        try {
          return Reflect.construct(SubCtor, args, PatchedAudioContext)
        } catch {
          // 运行时构造失败：回退原生 context，应用不崩溃（该 context 不受总线控制）
        }
      }
      return Reflect.construct(Ctor, args)
    } as unknown as typeof AudioContext
    // 保持 new AudioContext() instanceof AudioContext（被替换后）为 true
    if (SubCtor) {
      PatchedAudioContext.prototype = SubCtor.prototype
    }
    return PatchedAudioContext
  }

  try {
    const patched = wrap(NativeAudioContext)
    if (patched) {
      window.AudioContext = patched
      if (NativeWebkitAudioContext) {
        const patchedWebkit = wrap(NativeWebkitAudioContext)
        if (patchedWebkit) {
          windowAny.webkitAudioContext = patchedWebkit
        }
      }
      busActive = true
    }
  } catch {
    busActive = false
  }

  return busActive
}

/** 总线是否已激活。各发声源据此决定是否需要自行乘主音量。 */
export function isSystemVolumeBusActive(): boolean {
  return busActive
}
