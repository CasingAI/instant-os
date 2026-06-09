;(function () {
  var MAX_CONSOLE_ENTRIES = 120
  var MAX_ERROR_ENTRIES = 32

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

  var state = {
    activated: false,
    errors: [],
    consoleLogs: [],
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

  function collectEnvironment() {
    var nav = typeof navigator !== 'undefined' ? navigator : {}
    return {
      userAgent: nav.userAgent || '',
      platform: nav.platform || '',
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

  function renderCrashScreen(primaryMessage) {
    var root = document.getElementById('app') || document.body
    if (!root) return

    var env = collectEnvironment()
    var styleId = 'instant-os-crash-screen-style'
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style')
      style.id = styleId
      style.textContent =
        '.instant-os-crash{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#0a1628;color:#dce9ff;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}' +
        '.instant-os-crash__panel{max-width:920px;margin:0 auto}' +
        '.instant-os-crash__title{font-size:28px;font-weight:700;letter-spacing:.02em;margin:0 0 8px;color:#fff}' +
        '.instant-os-crash__subtitle{margin:0 0 20px;color:#9ec0ff}' +
        '.instant-os-crash__section{margin:18px 0 0;padding:14px 16px;border:1px solid rgba(158,192,255,.35);border-radius:8px;background:rgba(0,0,0,.22)}' +
        '.instant-os-crash__section h2{margin:0 0 10px;font-size:14px;color:#9ec0ff;text-transform:uppercase;letter-spacing:.08em}' +
        '.instant-os-crash__primary{white-space:pre-wrap;word-break:break-word;color:#fff}' +
        '.instant-os-crash__list{margin:0;padding:0;list-style:none}' +
        '.instant-os-crash__list li{white-space:pre-wrap;word-break:break-word;padding:8px 0;border-top:1px solid rgba(158,192,255,.2)}' +
        '.instant-os-crash__list li:first-child{border-top:none;padding-top:0}' +
        '.instant-os-crash__meta{color:#7ea8e8;font-size:12px;margin-bottom:4px}' +
        '.instant-os-crash__actions{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}' +
        '.instant-os-crash__btn{appearance:none;border:1px solid rgba(158,192,255,.55);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer}' +
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

    root.innerHTML =
      '<div class="instant-os-crash" role="alert" aria-live="assertive">' +
      '<div class="instant-os-crash__panel">' +
      '<div class="instant-os-crash__face" aria-hidden="true">:(</div>' +
      '<h1 class="instant-os-crash__title">Instant OS 启动失败</h1>' +
      '<p class="instant-os-crash__subtitle">系统遇到未恢复错误，已进入诊断界面。</p>' +
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
      '<li><div class="instant-os-crash__meta">User Agent</div>' +
      escapeHtml(env.userAgent) +
      '</li>' +
      '<li><div class="instant-os-crash__meta">Platform</div>' +
      escapeHtml(env.platform) +
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
      '<button type="button" class="instant-os-crash__btn" id="instant-os-crash-reload">重新加载</button>' +
      '<button type="button" class="instant-os-crash__btn" id="instant-os-crash-copy">复制诊断信息</button>' +
      '</div>' +
      '</div>' +
      '</div>'

    var reloadBtn = document.getElementById('instant-os-crash-reload')
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        location.reload()
      })
    }

    var copyBtn = document.getElementById('instant-os-crash-copy')
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
      'UA: ' + env.userAgent,
      'Platform: ' + env.platform,
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

  function activate(primaryReason) {
    if (state.activated) {
      renderCrashScreen(safeString(primaryReason))
      return
    }
    state.activated = true
    var message = safeString(primaryReason)
    pushError('activate', message)
    renderCrashScreen(message)
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
    try {
      var params = new URLSearchParams(location.search || '')
      var value = params.get('instant_crash')
      if (value === null) {
        return undefined
      }
      if (value === '' || value === '1' || value === 'boot') {
        return 'boot'
      }
      if (value === 'reject' || value === 'font' || value === 'react') {
        return value
      }
      return 'boot'
    } catch (_e) {
      return undefined
    }
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
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  maybeRunEarlyCrashTest()

  window.__INSTANT_OS_CRASH__ = {
    state: state,
    pushError: pushError,
    pushConsole: pushConsole,
    activate: activate,
    renderCrashScreen: renderCrashScreen,
    safeString: safeString,
  }
})()
