import { createInstant3dApi } from './instant3d-runtime.js'

/** @type {Array<{ id: string, label: string, url: string }>} */
const catalog = window.__INSTANT3D_CATALOG__ ?? []

window.Instant3D = createInstant3dApi(catalog)
window.dispatchEvent(new Event('instant3d-ready'))
