import { render } from 'preact'
import { scheduleEmojiOffsetAutoCalibration } from './fonts/auto-calibrate-emoji-offset.ts'
import { ensureAppleColorEmojiFonts } from './fonts/ensure-apple-color-emoji-fonts.ts'
import './global.css'
import { App } from './app.tsx'

void ensureAppleColorEmojiFonts().then(() => {
  render(<App />, document.getElementById('app')!)
  scheduleEmojiOffsetAutoCalibration()
})
