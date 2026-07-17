/**
 * Instant OS 外链 Bridge 页入口（/bridge）。
 *
 * 【实验性 · 未完成】外链应用平台仍是未完成的实验特性，协议与授权流程可能继续变动，
 * 请勿当作稳定对外能力依赖。
 */
import { render } from 'preact'
import { ExternalBridgeApp } from './bridge/external-bridge-app.tsx'
import './bridge/external-bridge-app.css'
import './fonts/app-text-font-stack.css'

document.title = 'Instant OS Bridge'

const root = document.getElementById('app')
if (root) {
  render(<ExternalBridgeApp />, root)
}
