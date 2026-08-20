import { useEffect, useState } from 'preact/hooks'
import {
  listWebViewUnits,
  onWebViewRegistryChanged,
} from './webview-registry.ts'
import { WebViewUnitRuntime } from './webview-unit-runtime.tsx'
import './webview.css'

/**
 * 全局离屏池：每个 live WebView unit 常驻一个 Runtime（持有 iframe）。
 * Window 壳仅提供 viewport portal 目标，关窗不卸载 Runtime。
 */
export function WebViewOffscreenPool() {
  const [unitIds, setUnitIds] = useState<string[]>(() =>
    listWebViewUnits().map((unit) => unit.unitId),
  )

  useEffect(
    () =>
      onWebViewRegistryChanged(() => {
        setUnitIds(listWebViewUnits().map((unit) => unit.unitId))
      }),
    [],
  )

  return (
    <div class="webview-offscreen-pool" aria-hidden="true">
      {unitIds.map((unitId) => (
        <WebViewUnitRuntime key={unitId} unitId={unitId} />
      ))}
    </div>
  )
}
