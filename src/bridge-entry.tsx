import { render } from 'preact'
import { ExternalBridgeApp } from './bridge/external-bridge-app.tsx'
import './bridge/external-bridge-app.css'
import './fonts/app-text-font-stack.css'

document.title = 'Instant OS Bridge'

const root = document.getElementById('app')
if (root) {
  render(<ExternalBridgeApp />, root)
}
