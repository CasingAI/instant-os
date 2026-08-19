import { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'preact/hooks'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import { collectDeviceInfo, type DeviceInfoSpec } from '../../os/collect-device-info.ts'
import { fetchCfNetworkState, buildCfNetworkSpecs, type CfNetworkFetchState } from '../../os/collect-cloudflare-trace.ts'
import './system-info.css'

type SpecSection = {
  id: string
  title: string
  items: DeviceInfoSpec[]
}

type CfFetchState = CfNetworkFetchState

const NARROW_BREAKPOINT = 440

function buildSections(
  specs: DeviceInfoSpec[],
  userAgent: string,
  cfState: CfFetchState,
): SpecSection[] {
  const software: DeviceInfoSpec[] = []
  const hardware: DeviceInfoSpec[] = []
  const display: DeviceInfoSpec[] = []
  const network: DeviceInfoSpec[] = []
  const input: DeviceInfoSpec[] = []
  const power: DeviceInfoSpec[] = []
  const storage: DeviceInfoSpec[] = []

  for (const spec of specs) {
    switch (spec.label) {
      case '操作系统':
      case '浏览器':
      case '语言':
      case '时区':
      case 'JS 内存':
        software.push(spec)
        break
      case '处理器':
      case 'CPU 架构':
      case '内存':
      case '显卡':
        hardware.push(spec)
        break
      case '显示器':
      case '色深':
        display.push(spec)
        break
      case '连接状态':
        network.push(spec)
        break
      case '触控':
        input.push(spec)
        break
      case '电池':
        power.push(spec)
        break
      case '总体配额':
      case 'LocalStorage':
      case 'SessionStorage':
      case 'IndexedDB':
      case 'Cookie':
      case 'Cache Storage':
        storage.push(spec)
        break
      default:
        software.push(spec)
    }
  }

  if (userAgent) {
    software.push({ label: 'User Agent', value: userAgent })
  }

  network.push(...buildCfNetworkSpecs(cfState))

  const sections: SpecSection[] = []
  if (software.length > 0) sections.push({ id: 'software', title: '软件', items: software })
  if (hardware.length > 0) sections.push({ id: 'hardware', title: '硬件', items: hardware })
  if (display.length > 0) sections.push({ id: 'display', title: '显示器', items: display })
  if (power.length > 0) sections.push({ id: 'power', title: '电源', items: power })
  if (storage.length > 0) sections.push({ id: 'storage', title: '存储', items: storage })
  if (network.length > 0) sections.push({ id: 'network', title: '网络', items: network })
  if (input.length > 0) sections.push({ id: 'input', title: '输入', items: input })

  return sections
}

export function SystemInfoApp() {
  const appId = 'system-info'
  const hostRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [cfState, setCfState] = useState<CfFetchState>({ status: 'loading' })

  useAppMenuBar(appId, [])

  useEffect(() => {
    let cancelled = false
    setCfState({ status: 'loading' })

    fetchCfNetworkState().then((next) => {
      if (cancelled) return
      setCfState(next)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const [specs, setSpecs] = useState<DeviceInfoSpec[]>([])

  useEffect(() => {
    let cancelled = false
    collectDeviceInfo().then((next) => {
      if (cancelled) return
      setSpecs(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const userAgent = useMemo(() => navigator.userAgent ?? '', [])
  const sections = useMemo(
    () => buildSections(specs, userAgent, cfState),
    [specs, userAgent, cfState],
  )
  const [activeSectionId, setActiveSectionId] = useState(() => sections[0]?.id ?? 'software')

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]

  const measureWidth = useCallback(() => {
    if (!hostRef.current) return
    setNarrow(hostRef.current.clientWidth <= NARROW_BREAKPOINT)
  }, [])

  useLayoutEffect(() => {
    measureWidth()
    const observer = new ResizeObserver(measureWidth)
    if (hostRef.current) {
      observer.observe(hostRef.current)
    }
    return () => observer.disconnect()
  }, [measureWidth])

  return (
    <div ref={hostRef} class={`system-info${narrow ? ' system-info--narrow' : ''}`}>
      <nav class="system-info__sidebar" aria-label="系统信息类别">
        <ul class="system-info__nav">
          {sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                class={`system-info__nav-item${activeSectionId === section.id ? ' system-info__nav-item--active' : ''}`}
                aria-current={activeSectionId === section.id ? 'true' : undefined}
                onClick={() => setActiveSectionId(section.id)}
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div class="system-info__detail">
        {activeSection && (
          <>
            <h2 class="system-info__detail-title">{activeSection.title}</h2>
            <dl class="system-info__rows">
              {activeSection.items.map((spec, index) => (
                <div key={`${spec.label}-${index}`} class="system-info__row">
                  <dt class="system-info__row-label">{spec.label}</dt>
                  <dd
                    class={`system-info__row-value${spec.label === 'User Agent' ? ' system-info__row-value--mono' : ''}${spec.value === '获取中...' ? ' system-info__row-value--loading' : ''}`}
                  >
                    {spec.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </div>
  )
}
