;(function () {
  var MAX_CONSOLE_ENTRIES = 120
  var MAX_ERROR_ENTRIES = 32
  var CRASH_OVERLAY_ID = 'instant-os-crash-overlay'
  var CRASH_DISMISS_EVENT = 'instant-os-crash-dismiss'

  function nowIso() {
    try {
      return new Date().toISOString()
    } catch (_e) {
      return ''
    }
  }

  function safeString(value) {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (value instanceof Error) {
      var stack = value.stack || ''
      return value.name + ': ' + value.message + (stack ? '\n' + stack : '')
    }
    try {
      return JSON.stringify(value, null, 2)
    } catch (_e) {
      try {
        return String(value)
      } catch (_e2) {
        return '[unserializable]'
      }
    }
  }

  function formatConsoleArgs(args) {
    var parts = []
    for (var i = 0; i < args.length; i++) {
      parts.push(safeString(args[i]))
    }
    return parts.join(' ')
  }

  var BOOT_WATCHDOG_MS = 15000
  var MAIN_MODULE_SRC = '/src/main.tsx'
  var MAIN_MODULE_ID = 'instant-os-main-module'

  var state = {
    activated: false,
    errors: [],
    consoleLogs: [],
    moduleExecuted: false,
    bootComplete: false,
  }

  var bootWatchdogTimer

  function supportsModuleScripts() {
    var probe = document.createElement('script')
    return 'noModule' in probe
  }

  function removeNode(node) {
    if (!node || !node.parentNode) {
      return
    }
    if (typeof node.remove === 'function') {
      node.remove()
      return
    }
    node.parentNode.removeChild(node)
  }

  function readQueryParam(name) {
    try {
      if (typeof URLSearchParams === 'function') {
        var parsed = new URLSearchParams(location.search || '').get(name)
        return parsed === null ? undefined : parsed
      }
    } catch (_e) {}

    var query = typeof location !== 'undefined' ? location.search || '' : ''
    var pattern = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)')
    var match = query.match(pattern)
    if (!match) {
      return undefined
    }
    if (match[2] === undefined) {
      return ''
    }
    try {
      return decodeURIComponent(match[2].replace(/\+/g, ' '))
    } catch (_e2) {
      return match[2]
    }
  }

  function clearBootWatchdog() {
    if (bootWatchdogTimer) {
      clearTimeout(bootWatchdogTimer)
      bootWatchdogTimer = undefined
    }
  }

  function markModuleExecuted() {
    state.moduleExecuted = true
  }

  function markBootComplete() {
    state.bootComplete = true
    clearBootWatchdog()
  }

  function startBootWatchdog() {
    clearBootWatchdog()
    bootWatchdogTimer = setTimeout(function () {
      if (state.bootComplete || state.activated) {
        return
      }

      if (!state.moduleExecuted) {
        activate(
          '主应用脚本未能执行。\n' +
            '当前浏览器可能过旧，或不支持 ES Module（需要 Safari 10.1+ / iOS 10.3+）。',
        )
        return
      }

      activate('应用脚本已加载，但启动流程未在 ' + BOOT_WATCHDOG_MS / 1000 + ' 秒内完成。')
    }, BOOT_WATCHDOG_MS)
  }

  function loadMainModule() {
    if (!supportsModuleScripts()) {
      activate(
        '当前浏览器不支持 ES Module，无法加载 Instant OS。\n' +
          '请使用 Safari 10.1+ / iOS 10.3+ 或更新的浏览器。',
      )
      return
    }

    var existing = document.getElementById(MAIN_MODULE_ID)
    if (existing) {
      return
    }

    var script = document.createElement('script')
    script.id = MAIN_MODULE_ID
    script.type = 'module'
    script.src = MAIN_MODULE_SRC
    script.addEventListener('error', function () {
      pushError('module.load', '主模块加载失败: ' + MAIN_MODULE_SRC)
      activate(
        '主模块加载失败：' +
          MAIN_MODULE_SRC +
          '\n请检查网络连接，或确认浏览器支持 ES Module。',
      )
    })
    document.body.appendChild(script)
    startBootWatchdog()
  }

  function pushError(source, detail) {
    state.errors.push({
      at: nowIso(),
      source: source,
      detail: detail,
    })
    if (state.errors.length > MAX_ERROR_ENTRIES) {
      state.errors.shift()
    }
  }

  function pushConsole(level, args) {
    state.consoleLogs.push({
      at: nowIso(),
      level: level,
      text: formatConsoleArgs(args),
    })
    if (state.consoleLogs.length > MAX_CONSOLE_ENTRIES) {
      state.consoleLogs.shift()
    }
  }

  function readWebGLRenderer() {
    try {
      var canvas = document.createElement('canvas')
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      if (!gl) {
        return ''
      }
      var ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (!ext) {
        return ''
      }
      return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').trim()
    } catch (_e) {
      return ''
    }
  }

  function formatOsName(nav) {
    if (nav.userAgentData && nav.userAgentData.platform) {
      return nav.userAgentData.platform
    }
    var ua = nav.userAgent || ''
    if (/Macintosh|Mac OS X/i.test(ua)) {
      return 'macOS'
    }
    if (/Windows/i.test(ua)) {
      return 'Windows'
    }
    if (/Android/i.test(ua)) {
      return 'Android'
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return 'iOS'
    }
    return nav.platform || '未知'
  }

  function inferCpuArchitecture(gpuRenderer, platform) {
    var appleChip = gpuRenderer.match(/Apple M[^,]+/i)
    if (appleChip) {
      return 'Apple Silicon · ' + appleChip[0]
    }
    if (/Intel/i.test(gpuRenderer)) {
      return 'Intel'
    }
    if (platform === 'MacIntel' && gpuRenderer === 'Apple GPU') {
      return '未能识别（Safari 会隐藏 GPU 型号）'
    }
    return '未能识别'
  }

  function enrichCpuArchitectureAsync(nav, elementId, env) {
    if (!nav.userAgentData || typeof nav.userAgentData.getHighEntropyValues !== 'function') {
      return
    }
    nav.userAgentData
      .getHighEntropyValues(['architecture', 'bitness'])
      .then(function (values) {
        var arch = values.architecture || ''
        if (!arch) {
          return
        }
        var label = arch
        if (values.bitness) {
          label += ' (' + values.bitness + '-bit)'
        }
        if (arch === 'arm') {
          label += ' · Apple Silicon'
        }
        env.cpuArchitecture = label
        var el = document.getElementById(elementId)
        if (el) {
          el.textContent = label
        }
      })
      .catch(function () {})
  }

  function collectEnvironment() {
    var nav = typeof navigator !== 'undefined' ? navigator : {}
    var platform = nav.platform || ''
    var gpuRenderer = readWebGLRenderer()
    return {
      userAgent: nav.userAgent || '',
      platform: platform,
      osName: formatOsName(nav),
      cpuArchitecture: inferCpuArchitecture(gpuRenderer, platform),
      gpuRenderer: gpuRenderer,
      language: nav.language || '',
      viewport:
        typeof window !== 'undefined'
          ? window.innerWidth + ' x ' + window.innerHeight
          : '',
      devicePixelRatio:
        typeof window !== 'undefined' ? String(window.devicePixelRatio || 1) : '',
      url: typeof location !== 'undefined' ? location.href : '',
      time: nowIso(),
    }
  }

  function removeCrashOverlay() {
    var overlay = document.getElementById(CRASH_OVERLAY_ID)
    if (overlay) {
      removeNode(overlay)
    }
  }

  function renderCrashScreen(primaryMessage) {
    if (typeof document === 'undefined') {
      return
    }

    removeCrashOverlay()

    var env = collectEnvironment()
    var styleId = 'instant-os-crash-screen-style'
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style')
      style.id = styleId
      style.textContent =
        '.instant-os-crash{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:auto;-webkit-overflow-scrolling:touch;background:#0a1628;color:#dce9ff;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:20px}' +
        '.instant-os-crash__panel{max-width:920px;margin:0 auto}' +
        '.instant-os-crash__title{font-size:28px;font-weight:700;letter-spacing:.02em;margin:0 0 8px;color:#fff}' +
        '.instant-os-crash__subtitle{margin:0 0 20px;color:#9ec0ff}' +
        '.instant-os-crash__section{margin:18px 0 0;padding:14px 16px;border:1px solid rgba(158,192,255,.35);border-radius:8px;background:rgba(0,0,0,.22)}' +
        '.instant-os-crash__section h2{margin:0 0 10px;font-size:14px;color:#9ec0ff;text-transform:uppercase;letter-spacing:.08em}' +
        '.instant-os-crash__primary{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;color:#fff}' +
        '.instant-os-crash__list{margin:0;padding:0;list-style:none}' +
        '.instant-os-crash__list li{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;padding:8px 0;border-top:1px solid rgba(158,192,255,.2)}' +
        '.instant-os-crash__list li:first-child{border-top:none;padding-top:0}' +
        '.instant-os-crash__meta{color:#7ea8e8;font-size:12px;margin-bottom:4px}' +
        '.instant-os-crash__actions{margin-top:22px}' +
        '.instant-os-crash__btn{-webkit-appearance:none;appearance:none;display:inline-block;margin:0 10px 10px 0;border:1px solid rgba(158,192,255,.55);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer}' +
        '.instant-os-crash__btn:active{background:rgba(255,255,255,.16)}' +
        '.instant-os-crash__face{margin:0 0 14px;font-size:42px;line-height:1}'
      document.head.appendChild(style)
    }

    var errorsHtml = ''
    for (var i = 0; i < state.errors.length; i++) {
      var entry = state.errors[i]
      errorsHtml +=
        '<li><div class="instant-os-crash__meta">' +
        entry.at +
        ' · ' +
        entry.source +
        '</div>' +
        escapeHtml(entry.detail) +
        '</li>'
    }

    var consoleHtml = ''
    for (var j = 0; j < state.consoleLogs.length; j++) {
      var log = state.consoleLogs[j]
      consoleHtml +=
        '<li><div class="instant-os-crash__meta">' +
        log.at +
        ' · ' +
        log.level +
        '</div>' +
        escapeHtml(log.text) +
        '</li>'
    }

    var overlay = document.createElement('div')
    overlay.id = CRASH_OVERLAY_ID
    overlay.innerHTML =
      '<div class="instant-os-crash" role="alert" aria-live="assertive">' +
      '<div class="instant-os-crash__panel">' +
      '<div class="instant-os-crash__face" aria-hidden="true">:(</div>' +
      '<h1 class="instant-os-crash__title">系统遇到异常</h1>' +
      '<p class="instant-os-crash__subtitle">已进入诊断界面。多数错误不会阻断系统，可查看详情后忽略并继续运行。</p>' +
      '<section class="instant-os-crash__section">' +
      '<h2>主要错误</h2>' +
      '<div class="instant-os-crash__primary">' +
      escapeHtml(primaryMessage || '未知错误') +
      '</div>' +
      '</section>' +
      '<section class="instant-os-crash__section">' +
      '<h2>错误事件 (' +
      state.errors.length +
      ')</h2>' +
      '<ul class="instant-os-crash__list">' +
      (errorsHtml || '<li>暂无捕获的错误事件</li>') +
      '</ul>' +
      '</section>' +
      '<section class="instant-os-crash__section">' +
      '<h2>控制台输出 (' +
      state.consoleLogs.length +
      ')</h2>' +
      '<ul class="instant-os-crash__list">' +
      (consoleHtml || '<li>暂无控制台输出</li>') +
      '</ul>' +
      '</section>' +
      '<section class="instant-os-crash__section">' +
      '<h2>运行环境</h2>' +
      '<ul class="instant-os-crash__list">' +
      '<li><div class="instant-os-crash__meta">URL</div>' +
      escapeHtml(env.url) +
      '</li>' +
      '<li><div class="instant-os-crash__meta">操作系统</div>' +
      escapeHtml(env.osName) +
      '</li>' +
      '<li><div class="instant-os-crash__meta">CPU 架构</div>' +
      '<span id="instant-os-crash-cpu-arch">' +
      escapeHtml(env.cpuArchitecture) +
      '</span>' +
      '</li>' +
      (env.gpuRenderer
        ? '<li><div class="instant-os-crash__meta">GPU 渲染器</div>' +
          escapeHtml(env.gpuRenderer) +
          '</li>'
        : '') +
      '<li><div class="instant-os-crash__meta">User Agent</div>' +
      escapeHtml(env.userAgent) +
      '</li>' +
      '<li><div class="instant-os-crash__meta">Viewport</div>' +
      escapeHtml(env.viewport) +
      ' @ ' +
      escapeHtml(env.devicePixelRatio) +
      'x</li>' +
      '<li><div class="instant-os-crash__meta">Language</div>' +
      escapeHtml(env.language) +
      '</li>' +
      '<li><div class="instant-os-crash__meta">Time</div>' +
      escapeHtml(env.time) +
      '</li>' +
      '</ul>' +
      '</section>' +
      '<div class="instant-os-crash__actions">' +
      '<button type="button" class="instant-os-crash__btn" id="instant-os-crash-dismiss">忽略此错误</button>' +
      '<button type="button" class="instant-os-crash__btn" id="instant-os-crash-reload">重新加载</button>' +
      '<button type="button" class="instant-os-crash__btn" id="instant-os-crash-copy">复制诊断信息</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    document.body.appendChild(overlay)

    var reloadBtn = overlay.querySelector('#instant-os-crash-reload')
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        location.reload()
      })
    }

    var copyBtn = overlay.querySelector('#instant-os-crash-copy')
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var payload = buildDiagnosticText(primaryMessage, env)
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payload).catch(function () {
            window.prompt('复制以下诊断信息：', payload)
          })
          return
        }
        window.prompt('复制以下诊断信息：', payload)
      })
    }

    var dismissBtn = overlay.querySelector('#instant-os-crash-dismiss')
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        dismiss()
      })
    }

    enrichCpuArchitectureAsync(
      typeof navigator !== 'undefined' ? navigator : {},
      'instant-os-crash-cpu-arch',
      env,
    )
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function buildDiagnosticText(primaryMessage, env) {
    var lines = [
      'Instant OS Crash Report',
      'Primary: ' + (primaryMessage || 'unknown'),
      '',
      'Environment:',
      'URL: ' + env.url,
      'OS: ' + env.osName,
      'CPU: ' + env.cpuArchitecture,
      'GPU: ' + (env.gpuRenderer || 'n/a'),
      'UA: ' + env.userAgent,
      'Viewport: ' + env.viewport,
      '',
      'Errors:',
    ]

    for (var i = 0; i < state.errors.length; i++) {
      var entry = state.errors[i]
      lines.push('[' + entry.at + '] ' + entry.source + ': ' + entry.detail)
    }

    lines.push('', 'Console:')
    for (var j = 0; j < state.consoleLogs.length; j++) {
      var log = state.consoleLogs[j]
      lines.push('[' + log.at + '] ' + log.level + ': ' + log.text)
    }

    return lines.join('\n')
  }

  function renderCrashScreenFallback(primaryMessage) {
    if (typeof document === 'undefined' || !document.body) {
      return
    }
    document.body.innerHTML =
      '<div style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:auto;background:#0a1628;color:#fff;font:14px/1.5 Menlo,monospace;padding:20px">' +
      '<h1 style="margin:0 0 12px;font-size:24px">系统遇到异常</h1>' +
      '<pre style="white-space:pre-wrap;word-wrap:break-word;margin:0">' +
      escapeHtml(primaryMessage || '未知错误') +
      '</pre>' +
      '<p style="margin:16px 0 0"><button type="button" onclick="location.reload()" style="font:inherit;padding:8px 12px">重新加载</button></p>' +
      '</div>'
  }

  function activate(primaryReason) {
    var message = safeString(primaryReason)
    if (state.activated) {
      try {
        renderCrashScreen(message)
      } catch (_e) {
        renderCrashScreenFallback(message)
      }
      return
    }
    state.activated = true
    pushError('activate', message)
    try {
      renderCrashScreen(message)
    } catch (_e) {
      renderCrashScreenFallback(message)
    }
  }

  function dismiss() {
    state.activated = false
    removeCrashOverlay()
    try {
      window.dispatchEvent(new CustomEvent(CRASH_DISMISS_EVENT))
    } catch (_e) {}
  }

  function installConsoleCapture() {
    ;['error', 'warn', 'log', 'info', 'debug'].forEach(function (level) {
      var original = console[level]
      if (typeof original !== 'function') return
      console[level] = function () {
        pushConsole(level, arguments)
        return original.apply(console, arguments)
      }
    })
  }

  function isFatalResourceError(target) {
    if (!target || target === window || target === document) {
      return false
    }
    var tag = target.tagName || ''
    if (tag === 'SCRIPT') {
      return true
    }
    if (tag === 'LINK' && target.rel === 'modulepreload') {
      return true
    }
    return false
  }

  function isBenignBrowserNoise(message) {
    if (!message || typeof message !== 'string') {
      return false
    }
    return message.indexOf('ResizeObserver loop') !== -1
  }

  function onWindowError(event) {
    var target = event.target
    if (target && target !== window && target !== document) {
      if (!isFatalResourceError(target)) {
        var resourceDetail =
          '资源加载失败: ' +
          (target.tagName || 'UNKNOWN') +
          (target.src || target.href ? ' ' + (target.src || target.href) : '')
        pushError('resource.error', resourceDetail)
        return
      }
    }

    var message = event.message || 'Script error'
    if (isBenignBrowserNoise(message)) {
      pushConsole('debug', ['[已忽略] ' + message])
      return
    }
    var detail = message
    if (event.filename) {
      detail += '\n@ ' + event.filename
      if (event.lineno) {
        detail += ':' + event.lineno + ':' + (event.colno || 0)
      }
    }
    if (event.error) {
      detail += '\n' + safeString(event.error)
    }
    pushError('window.error', detail)
    activate(detail)
  }

  function onUnhandledRejection(event) {
    var reason = event.reason
    var detail = safeString(reason)
    pushError('unhandledrejection', detail)
    activate(detail)
  }

  function readCrashTestMode() {
    var value = readQueryParam('instant_crash')
    if (value === undefined || value === null) {
      return undefined
    }
    if (value === '' || value === '1' || value === 'boot') {
      return 'boot'
    }
    if (value === 'reject' || value === 'font' || value === 'react') {
      return value
    }
    return 'boot'
  }

  function maybeRunEarlyCrashTest() {
    var mode = readCrashTestMode()
    if (!mode) {
      return
    }

    if (mode === 'reject') {
      setTimeout(function () {
        Promise.reject(new Error('[instant_crash] 模拟未处理的 Promise 拒绝'))
      }, 0)
      return
    }

    if (mode === 'font' || mode === 'react') {
      pushConsole('info', ['instant_crash 调试模式: ' + mode + '（等待应用层触发）'])
      return
    }

    setTimeout(function () {
      pushConsole('warn', ['instant_crash 调试模式: boot'])
      activate('[instant_crash] 模拟启动阶段崩溃（boot）')
    }, 0)
  }

  installConsoleCapture()
  window.addEventListener('error', onWindowError)
  if (typeof window.Promise !== 'undefined') {
    window.addEventListener('unhandledrejection', onUnhandledRejection)
  }
  maybeRunEarlyCrashTest()

  window.__INSTANT_OS_CRASH__ = {
    state: state,
    pushError: pushError,
    pushConsole: pushConsole,
    activate: activate,
    dismiss: dismiss,
    renderCrashScreen: renderCrashScreen,
    safeString: safeString,
    markModuleExecuted: markModuleExecuted,
    markBootComplete: markBootComplete,
    loadMainModule: loadMainModule,
  }

  var crashTestMode = readCrashTestMode()
  if (crashTestMode !== 'boot') {
    loadMainModule()
  }
})()
