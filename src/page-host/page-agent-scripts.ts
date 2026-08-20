/**
 * 页内 Agent 脚本：结构化快照（带编号引用）+ Markdown 提取。
 *
 * 脚本必须自包含（经 VC_EVAL / evalInPage 下发），不能 import。
 * 多次 eval 共享同一 window，编号映射挂在 window.__vcAgent 上跨调用存活。
 */

export type PageAgentSnapshotResult = {
  title: string
  url: string
  tree: string
  refCount: number
  truncated: boolean
  generation: number
  error?: string
}

export type PageAgentMarkdownResult = {
  markdown: string
  ref?: string
  truncated: boolean
  error?: string
}

/** 快照可能较重，给 eval 稍长超时。 */
export const PAGE_AGENT_EVAL_TIMEOUT_MS = 45_000

/**
 * 页内快照脚本：遍历 DOM → 角色/名称 → 发编号 → 安装 __vcRef。
 * 返回可 JSON 序列化的 PageAgentSnapshotResult 字段。
 */
export const PAGE_AGENT_SNAPSHOT_SCRIPT = `(function () {
  var MAX_NODES = 400;
  var MAX_DEPTH = 20;
  var MAX_NAME = 80;
  var MAX_TEXT = 120;

  var INTERACTIVE = {
    link: 1, button: 1, textbox: 1, searchbox: 1, checkbox: 1, radio: 1,
    combobox: 1, listbox: 1, option: 1, switch: 1, slider: 1, spinbutton: 1,
    tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1,
    treeitem: 1, gridcell: 1, row: 1
  };
  var LANDMARK = {
    banner: 1, complementary: 1, contentinfo: 1, form: 1, main: 1,
    navigation: 1, region: 1, search: 1
  };
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, PATH: 1,
    META: 1, LINK: 1, HEAD: 1, BR: 1, WBR: 1
  };

  function trunc(s, n) {
    s = String(s || '').replace(/\\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' && String(el.type || '').toLowerCase() === 'hidden') return false;
    try {
      var st = window.getComputedStyle(el);
      if (!st || st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') {
        return false;
      }
    } catch (e) {
      return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      // 允许 position:fixed 等可能尚未布局的可交互元素继续
      if (!INTERACTIVE[computeRole(el)] && el.tagName !== 'OPTION') return false;
    }
    return true;
  }

  function explicitRole(el) {
    var r = el.getAttribute('role');
    if (!r) return '';
    return r.trim().split(/\\s+/)[0].toLowerCase();
  }

  function computeRole(el) {
    var er = explicitRole(el);
    if (er && er !== 'presentation' && er !== 'none') return er;
    var tag = el.tagName;
    if (tag === 'A') {
      return el.hasAttribute('href') ? 'link' : '';
    }
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT') {
      var t = String(el.type || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (t === 'hidden') return '';
      return 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'OPTION') return 'option';
    if (tag === 'IMG') return 'img';
    if (tag === 'NAV') return 'navigation';
    if (tag === 'MAIN') return 'main';
    if (tag === 'HEADER') return 'banner';
    if (tag === 'FOOTER') return 'contentinfo';
    if (tag === 'ASIDE') return 'complementary';
    if (tag === 'FORM') return 'form';
    if (tag === 'SECTION') {
      // section 有可访问名才算 region
      var n = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      return n ? 'region' : '';
    }
    if (tag === 'ARTICLE') return 'article';
    if (tag === 'TABLE') return 'table';
    if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') return '';
    if (tag === 'TR') return 'row';
    if (tag === 'TH') return 'columnheader';
    if (tag === 'TD') return 'cell';
    if (tag === 'UL' || tag === 'OL' || tag === 'MENU') return 'list';
    if (tag === 'LI') return 'listitem';
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      return 'heading';
    }
    if (tag === 'P') return 'paragraph';
    if (tag === 'LABEL') return 'label';
    if (tag === 'SUMMARY') return 'button';
    if (tag === 'DETAILS') return 'group';
    if (tag === 'DIALOG') return 'dialog';
    if (el.isContentEditable) return 'textbox';
    if (el.tabIndex >= 0 && tag !== 'A' && tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
      return 'generic';
    }
    return '';
  }

  function labelledByText(el) {
    var ids = el.getAttribute('aria-labelledby');
    if (!ids) return '';
    var parts = ids.split(/\\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var n = document.getElementById(parts[i]);
      if (n) out.push((n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim());
    }
    return out.filter(Boolean).join(' ');
  }

  function ownText(el) {
    var parts = [];
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        var t = (c.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(' ');
  }

  function computeName(el, role) {
    var name = el.getAttribute('aria-label') || '';
    if (!name) name = labelledByText(el);
    if (!name && (role === 'img' || el.tagName === 'IMG')) {
      name = el.getAttribute('alt') || '';
    }
    if (!name) name = el.getAttribute('title') || '';
    if (!name && (role === 'textbox' || role === 'searchbox' || role === 'combobox')) {
      name = el.getAttribute('placeholder') || '';
    }
    if (!name && el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) {
      name = el.getAttribute('value') || el.value || '';
    }
    if (!name && (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' ||
        role === 'heading' || role === 'label' || role === 'option' || role === 'listitem')) {
      name = ownText(el) || (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (!name && (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton')) {
      // 关联 label
      if (el.id) {
        try {
          var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (lab) name = (lab.innerText || lab.textContent || '').replace(/\\s+/g, ' ').trim();
        } catch (e) { /* CSS.escape 不可用时忽略 */ }
      }
    }
    if (!name && (role === 'checkbox' || role === 'radio')) {
      name = ownText(el);
    }
    return trunc(name, MAX_NAME);
  }

  function shouldRef(role) {
    return !!(INTERACTIVE[role] || LANDMARK[role] || role === 'heading' || role === 'article' || role === 'img');
  }

  function stateSuffix(el, role) {
    var bits = [];
    if (role === 'heading') {
      var lvl = el.getAttribute('aria-level');
      if (!lvl && /^H[1-6]$/.test(el.tagName)) lvl = el.tagName.charAt(1);
      if (lvl) bits.push('level=' + lvl);
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      var ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked != null) bits.push('checked=' + ariaChecked);
      else if (el.checked) bits.push('checked=true');
      else if (el.checked === false) bits.push('checked=false');
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') bits.push('disabled');
    if (el.readOnly || el.getAttribute('aria-readonly') === 'true') bits.push('readonly');
    if (el.getAttribute('aria-expanded') != null) bits.push('expanded=' + el.getAttribute('aria-expanded'));
    if (el.getAttribute('aria-pressed') != null) bits.push('pressed=' + el.getAttribute('aria-pressed'));
    if (el.getAttribute('aria-selected') != null) bits.push('selected=' + el.getAttribute('aria-selected'));
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      var v = el.value;
      if (typeof v === 'string' && v) bits.push('value="' + trunc(v, 40).replace(/"/g, '\\\\"') + '"');
    }
    if (role === 'link' && el.getAttribute('href')) {
      var href = el.getAttribute('href');
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        bits.push('url="' + trunc(href, 60).replace(/"/g, '\\\\"') + '"');
      }
    }
    return bits.length ? ' ' + bits.join(' ') : '';
  }

  var refs = Object.create(null);
  var counter = 0;
  var nodeCount = 0;
  var truncated = false;
  var lines = [];

  function assignRef(el) {
    counter += 1;
    var id = 'e' + counter;
    refs[id] = el;
    return id;
  }

  function walk(el, depth) {
    if (truncated) return;
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (!(el instanceof Element)) return;
    if (SKIP_TAGS[el.tagName]) return;
    if (!isVisible(el) && el.tagName !== 'OPTION') return;

    var role = computeRole(el);
    var emit = !!role;
    // 纯包装：无 role 的容器，子节点上提
    if (!emit) {
      var children = el.children;
      for (var i = 0; i < children.length; i++) walk(children[i], depth);
      // 若自身有显著文本且无元素子节点，输出 StaticText
      if (children.length === 0) {
        var t = ownText(el);
        if (t && depth > 0) {
          if (nodeCount >= MAX_NODES) { truncated = true; return; }
          nodeCount += 1;
          lines.push(Array(depth + 1).join('  ') + '- StaticText "' + trunc(t, MAX_TEXT) + '"');
        }
      }
      return;
    }

    if (nodeCount >= MAX_NODES) { truncated = true; return; }
    nodeCount += 1;

    var name = computeName(el, role);
    var ref = shouldRef(role) ? assignRef(el) : '';
    var indent = Array(depth + 1).join('  ');
    var line = indent + '- ' + role;
    if (name) line += ' "' + name.replace(/"/g, '\\\\"') + '"';
    line += stateSuffix(el, role);
    if (ref) line += ' [' + ref + ']';
    lines.push(line);

    // 对叶子型控件不再深入（避免把 button 内部图标文字再拆一层）
    if (role === 'textbox' || role === 'searchbox' || role === 'checkbox' || role === 'radio' ||
        role === 'img' || role === 'option' || role === 'slider' || role === 'spinbutton') {
      return;
    }
    // heading / button / link 仍可有子结构，但通常文本已在 name 里；仍遍历以捕获嵌套控件
    var kids = el.children;
    for (var j = 0; j < kids.length; j++) walk(kids[j], depth + 1);
  }

  var root = document.body || document.documentElement;
  var title = document.title || '';
  var url = location.href || '';
  lines.push('- RootWebArea "' + trunc(title || url, MAX_NAME).replace(/"/g, '\\\\"') + '"');
  if (root) walk(root, 1);

  // 安装 / 刷新页内运行时
  var prev = window.__vcAgent;
  var generation = (prev && typeof prev.generation === 'number' ? prev.generation : 0) + 1;
  window.__vcAgent = {
    generation: generation,
    refs: refs
  };
  window.__vcRef = function (id) {
    if (id == null || id === '') {
      throw new Error('__vcRef 需要编号字符串，例如 __vcRef(\\'e1\\')');
    }
    var key = String(id);
    var agent = window.__vcAgent;
    if (!agent || !agent.refs) {
      throw new Error('尚未 snapshot，请先调用 webview.snapshot 再使用 __vcRef');
    }
    var el = agent.refs[key];
    if (!el) {
      throw new Error('编号 ' + key + ' 不存在（或已过期），请重新 webview.snapshot');
    }
    if (!el.isConnected) {
      throw new Error('编号 ' + key + ' 已失效（节点已从页面移除），请重新 webview.snapshot');
    }
    return el;
  };

  lines.push('');
  lines.push('// 操作：在 eval 中用 __vcRef(\\'eN\\') 取节点，例如 __vcRef(\\'e1\\').click()');
  lines.push('// 读长文：webview.markdown({ unitId, tabId, ref: \\'eN\\' })；不传 ref 则整页');
  if (truncated) {
    lines.push('// 提示：树已截断（节点/深度上限），可用 markdown({ ref }) 或 eval 缩小范围');
  }

  return {
    title: title,
    url: url,
    tree: lines.join('\\n'),
    refCount: counter,
    truncated: truncated,
    generation: generation
  };
})()`

/**
 * 构造页内 Markdown 提取脚本。ref 可选；不传则从 document.body 提取。
 */
export function buildPageMarkdownScript(ref?: string): string {
  const refLiteral = ref === undefined || ref === '' ? 'null' : JSON.stringify(ref)
  return `(function (targetRef) {
  var MAX_MD = 48000;
  var ATTR = 'data-vc-ref';

  function getRoot(ref) {
    if (ref == null || ref === '') {
      return document.body || document.documentElement;
    }
    var agent = window.__vcAgent;
    if (!agent || !agent.refs) {
      throw new Error('尚未 snapshot，无法按编号提取；请先 webview.snapshot，或不传 ref 提取整页');
    }
    var el = agent.refs[String(ref)];
    if (!el) {
      throw new Error('编号 ' + ref + ' 不存在（或已过期），请重新 webview.snapshot');
    }
    if (!el.isConnected) {
      throw new Error('编号 ' + ref + ' 已失效（节点已从页面移除），请重新 webview.snapshot');
    }
    return el;
  }

  function stamp(root) {
    var stamped = [];
    var agent = window.__vcAgent;
    if (!agent || !agent.refs) return stamped;
    var keys = Object.keys(agent.refs);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var el = agent.refs[id];
      if (el && el.isConnected && (el === root || root.contains(el))) {
        el.setAttribute(ATTR, id);
        stamped.push(el);
      }
    }
    return stamped;
  }

  function unstamp(stamped) {
    for (var i = 0; i < stamped.length; i++) {
      try { stamped[i].removeAttribute(ATTR); } catch (e) { /* ignore */ }
    }
  }

  function escapeMd(s) {
    return String(s || '').replace(/([\\\\\`*_{}\\\\[\\\\]()#+\\-!|>])/g, '\\\\$1');
  }

  function cellText(el) {
    return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function convert(node, listDepth) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return (node.textContent || '').replace(/\\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    var el = node;
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG') {
      return '';
    }
    try {
      var st = window.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return '';
    } catch (e) { /* ignore */ }

    var ref = el.getAttribute(ATTR);
    var refSuffix = ref ? ' [' + ref + ']' : '';

    function children(sep) {
      var out = [];
      for (var c = el.firstChild; c; c = c.nextSibling) {
        var part = convert(c, listDepth);
        if (part) out.push(part);
      }
      return out.join(sep == null ? '' : sep);
    }

    if (tag === 'H1') return '\\n# ' + children('').trim() + '\\n\\n';
    if (tag === 'H2') return '\\n## ' + children('').trim() + '\\n\\n';
    if (tag === 'H3') return '\\n### ' + children('').trim() + '\\n\\n';
    if (tag === 'H4') return '\\n#### ' + children('').trim() + '\\n\\n';
    if (tag === 'H5') return '\\n##### ' + children('').trim() + '\\n\\n';
    if (tag === 'H6') return '\\n###### ' + children('').trim() + '\\n\\n';
    if (tag === 'P') return '\\n\\n' + children('').trim() + '\\n\\n';
    if (tag === 'BR') return '\\n';
    if (tag === 'HR') return '\\n\\n---\\n\\n';
    if (tag === 'STRONG' || tag === 'B') return '**' + children('').trim() + '**';
    if (tag === 'EM' || tag === 'I') return '*' + children('').trim() + '*';
    if (tag === 'CODE' && el.parentElement && el.parentElement.tagName !== 'PRE') {
      return '\`' + (el.textContent || '').replace(/\`/g, '\\\\\`') + '\`';
    }
    if (tag === 'PRE') {
      var code = el.textContent || '';
      return '\\n\\n\`\`\`\\n' + code.replace(/\\n$/, '') + '\\n\`\`\`\\n\\n';
    }
    if (tag === 'BLOCKQUOTE') {
      var bq = children('').trim().split(/\\n/).map(function (l) { return '> ' + l; }).join('\\n');
      return '\\n\\n' + bq + '\\n\\n';
    }
    if (tag === 'A') {
      var href = el.getAttribute('href') || '';
      var text = children('').trim() || href;
      if (!href || href.indexOf('javascript:') === 0) {
        return text + refSuffix;
      }
      return '[' + text + '](' + href + ')' + refSuffix;
    }
    if (tag === 'IMG') {
      var alt = el.getAttribute('alt') || '';
      var src = el.getAttribute('src') || '';
      return '![' + alt + '](' + src + ')' + refSuffix;
    }
    if (tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || ''))) {
      var btext = children('').trim() || el.getAttribute('value') || el.getAttribute('aria-label') || 'button';
      return '「按钮:' + btext + '」' + refSuffix;
    }
    if (tag === 'UL' || tag === 'OL') {
      var items = [];
      var idx = 0;
      for (var li = el.firstElementChild; li; li = li.nextElementSibling) {
        if (li.tagName !== 'LI') continue;
        idx += 1;
        var body = convert(li, listDepth + 1).trim();
        var bullet = tag === 'OL' ? idx + '. ' : '- ';
        var pad = Array(listDepth + 1).join('  ');
        items.push(pad + bullet + body);
      }
      return '\\n' + items.join('\\n') + '\\n';
    }
    if (tag === 'LI') {
      return children('').trim();
    }
    if (tag === 'TABLE') {
      var rows = el.querySelectorAll('tr');
      if (!rows.length) return children('');
      var mdRows = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll('th,td');
        var cols = [];
        for (var c = 0; c < cells.length; c++) cols.push(cellText(cells[c]).replace(/\\|/g, '\\\\|'));
        mdRows.push('| ' + cols.join(' | ') + ' |');
        if (r === 0) {
          mdRows.push('| ' + cols.map(function () { return '---'; }).join(' | ') + ' |');
        }
      }
      return '\\n\\n' + mdRows.join('\\n') + '\\n\\n';
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      var role = tag.toLowerCase();
      var val = el.value != null ? String(el.value) : '';
      var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || role;
      return '「' + label + (val ? '=' + val : '') + '」' + refSuffix;
    }

    // 默认：透传子内容；块级标签前后加空行
    var inner = children('');
    var block = /^(DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|FIGURE|FIGCAPTION|DETAILS|SUMMARY|DIALOG)$/.test(tag);
    if (block) {
      var t = inner.trim();
      return t ? '\\n\\n' + t + '\\n\\n' : '';
    }
    return inner;
  }

  var root = getRoot(targetRef);
  var stamped = stamp(root);
  var md = '';
  try {
    md = convert(root, 0);
  } finally {
    unstamp(stamped);
  }
  md = md.replace(/\\n{3,}/g, '\\n\\n').trim();
  var truncated = false;
  if (md.length > MAX_MD) {
    md = md.slice(0, MAX_MD) + '\\n\\n…(已截断)';
    truncated = true;
  }
  var result = { markdown: md, truncated: truncated };
  if (targetRef != null && targetRef !== '') result.ref = String(targetRef);
  return result;
})(${refLiteral})`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function capturePageAgentSnapshot(
  evalInPage: (code: string, options?: { timeout?: number }) => Promise<unknown>,
): Promise<PageAgentSnapshotResult> {
  try {
    const value = await evalInPage(PAGE_AGENT_SNAPSHOT_SCRIPT, {
      timeout: PAGE_AGENT_EVAL_TIMEOUT_MS,
    })
    if (!isRecord(value)) {
      return {
        title: '',
        url: '',
        tree: '',
        refCount: 0,
        truncated: false,
        generation: 0,
        error: '快照返回格式异常',
      }
    }
    return {
      title: typeof value.title === 'string' ? value.title : '',
      url: typeof value.url === 'string' ? value.url : '',
      tree: typeof value.tree === 'string' ? value.tree : '',
      refCount: typeof value.refCount === 'number' ? value.refCount : 0,
      truncated: Boolean(value.truncated),
      generation: typeof value.generation === 'number' ? value.generation : 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      title: '',
      url: '',
      tree: '',
      refCount: 0,
      truncated: false,
      generation: 0,
      error: message,
    }
  }
}

export async function capturePageAgentMarkdown(
  evalInPage: (code: string, options?: { timeout?: number }) => Promise<unknown>,
  ref?: string,
): Promise<PageAgentMarkdownResult> {
  try {
    const value = await evalInPage(buildPageMarkdownScript(ref), {
      timeout: PAGE_AGENT_EVAL_TIMEOUT_MS,
    })
    if (!isRecord(value)) {
      return { markdown: '', ref, truncated: false, error: 'Markdown 返回格式异常' }
    }
    return {
      markdown: typeof value.markdown === 'string' ? value.markdown : '',
      ref: typeof value.ref === 'string' ? value.ref : ref,
      truncated: Boolean(value.truncated),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { markdown: '', ref, truncated: false, error: message }
  }
}
