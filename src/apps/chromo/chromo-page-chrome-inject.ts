/**
 * 页内自包含注入：右键上报 + 查找高亮。多次 eval 幂等。
 */
export const CHROMO_PAGE_CHROME_INJECT_SCRIPT = `(function () {
  var existing = window.__chromoPageChrome;
  if (existing && existing.__version === 2) {
    return { ok: true, already: true };
  }
  if (existing && typeof existing.__teardown === 'function') {
    try { existing.__teardown(); } catch (e0) {}
  }

  var STYLE_ID = '__chromo-page-chrome-style';
  var MAX_MARKS = 500;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'mark[data-chromo-find]{background:#f4ea37;color:inherit;padding:0;}' +
      'mark[data-chromo-find][data-chromo-find-current]{background:#ff9632;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function viewerPoint(event) {
    var x = event.clientX;
    var y = event.clientY;
    var w = window;
    try {
      while (w !== w.top) {
        var frame = w.frameElement;
        if (!frame) break;
        var rect = frame.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        w = w.parent;
      }
    } catch (err) {}
    return { x: x, y: y };
  }

  function closestElement(node) {
    while (node && node.nodeType !== 1) {
      node = node.parentNode;
    }
    return node;
  }

  function absUrl(value) {
    if (!value) return undefined;
    var raw = String(value).trim();
    if (!raw || raw === 'none') return undefined;
    try { return new URL(raw, document.baseURI).href; } catch (err) { return raw; }
  }

  function srcsetFirst(value) {
    if (!value) return undefined;
    var piece = String(value).split(',')[0].trim().split(/\\s+/)[0];
    return absUrl(piece);
  }

  function imageUrlFrom(el) {
    if (!el || el.nodeType !== 1) return undefined;
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'IMAGE' || tag === 'SOURCE' || tag === 'VIDEO') {
      var url = absUrl(el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href'));
      if (!url) url = srcsetFirst(el.getAttribute('srcset') || el.getAttribute('data-srcset'));
      if (url) return url;
      if (tag === 'VIDEO') return absUrl(el.getAttribute('poster'));
    }
    if (tag === 'PICTURE' || tag === 'A' || tag === 'SVG' || tag === 'CANVAS') {
      var inner = el.querySelector && el.querySelector('img, image, source');
      if (inner) {
        var nested = imageUrlFrom(inner);
        if (nested) return nested;
      }
    }
    try {
      var bg = window.getComputedStyle(el).backgroundImage;
      var match = bg && bg !== 'none' ? /url\\((['"]?)([^"')]+)\\1\\)/.exec(bg) : null;
      if (match) return absUrl(match[2]);
    } catch (err2) {}
    return undefined;
  }

  function resolveUrls(element) {
    var linkUrl;
    var imageUrl;
    if (!element || !element.closest) {
      return { linkUrl: linkUrl, imageUrl: imageUrl };
    }
    var link = element.closest('a[href]');
    if (link) {
      try { linkUrl = link.href; } catch (e1) { linkUrl = absUrl(link.getAttribute('href')); }
    }
    var media = element.closest('img, image, picture, svg, canvas, video, [role="img"]');
    imageUrl = imageUrlFrom(media || element);
    if (!imageUrl && link) {
      imageUrl = imageUrlFrom(link);
    }
    if (!imageUrl) {
      var probe = element;
      for (var i = 0; i < 4 && probe; i++) {
        imageUrl = imageUrlFrom(probe);
        if (imageUrl) break;
        probe = probe.parentElement;
      }
    }
    return { linkUrl: linkUrl, imageUrl: imageUrl };
  }

  function postContext(payload) {
    var message = ['VC_CONTEXTMENU', payload];
    try { window.parent.postMessage(message, '*'); } catch (e1) {}
    try {
      if (window.top && window.top !== window.parent) {
        window.top.postMessage(message, '*');
      }
    } catch (e2) {}
  }

  var swallowUntil = 0;
  function swallowFollowingClick(event) {
    if (Date.now() > swallowUntil) return;
    var type = event.type;
    var button = event.button;
    if (type === 'click' || type === 'auxclick' || button === 2 || (type === 'mouseup' && button !== 0)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    swallowUntil = Date.now() + 700;
    var point = viewerPoint(event);
    var urls = resolveUrls(closestElement(event.target));
    var selection = '';
    try { selection = String(window.getSelection() || ''); } catch (err) {}
    postContext({
      x: point.x,
      y: point.y,
      linkUrl: urls.linkUrl,
      imageUrl: urls.imageUrl,
      selection: selection
    });
  }

  function unwrapMarks(root) {
    var marks = root.querySelectorAll('mark[data-chromo-find]');
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  function collectTextNodes(root) {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (!parent || parent.nodeType !== 1) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest && parent.closest('mark[data-chromo-find]')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var current;
    while ((current = walker.nextNode())) nodes.push(current);
    return nodes;
  }

  function wrapMatches(query) {
    var root = document.body || document.documentElement;
    if (!root) return 0;
    unwrapMarks(root);
    var q = String(query || '');
    if (!q) return 0;
    var lowerQ = q.toLowerCase();
    var nodes = collectTextNodes(root);
    var count = 0;
    for (var n = 0; n < nodes.length; n++) {
      if (count >= MAX_MARKS) break;
      var node = nodes[n];
      var text = node.nodeValue || '';
      var lower = text.toLowerCase();
      if (lower.indexOf(lowerQ) === -1) continue;
      var frag = document.createDocumentFragment();
      var idx = 0;
      var pos;
      while ((pos = lower.indexOf(lowerQ, idx)) !== -1) {
        if (count >= MAX_MARKS) break;
        if (pos > idx) frag.appendChild(document.createTextNode(text.slice(idx, pos)));
        var mark = document.createElement('mark');
        mark.setAttribute('data-chromo-find', '1');
        mark.textContent = text.slice(pos, pos + q.length);
        frag.appendChild(mark);
        count += 1;
        idx = pos + q.length;
        if (!q.length) break;
      }
      if (idx < text.length) frag.appendChild(document.createTextNode(text.slice(idx)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    }
    return count;
  }

  var findIndex = -1;

  function marks() {
    return document.querySelectorAll('mark[data-chromo-find]');
  }

  function highlightCurrent() {
    var list = marks();
    for (var i = 0; i < list.length; i++) {
      if (i === findIndex) list[i].setAttribute('data-chromo-find-current', '1');
      else list[i].removeAttribute('data-chromo-find-current');
    }
    if (findIndex >= 0 && list[findIndex] && list[findIndex].scrollIntoView) {
      try { list[findIndex].scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (err) {
        list[findIndex].scrollIntoView();
      }
    }
  }

  function findSearch(query) {
    ensureStyle();
    var count = wrapMatches(query);
    findIndex = count > 0 ? 0 : -1;
    highlightCurrent();
    return { count: count, index: findIndex };
  }

  function findStep(direction) {
    var list = marks();
    var count = list.length;
    if (count === 0) return { count: 0, index: -1 };
    if (findIndex < 0) findIndex = 0;
    else if (direction === 'prev') findIndex = (findIndex - 1 + count) % count;
    else findIndex = (findIndex + 1) % count;
    highlightCurrent();
    return { count: count, index: findIndex };
  }

  function findClear() {
    var root = document.body || document.documentElement;
    if (root) unwrapMarks(root);
    findIndex = -1;
    return { count: 0, index: -1 };
  }

  function teardown() {
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('click', swallowFollowingClick, true);
    document.removeEventListener('auxclick', swallowFollowingClick, true);
    document.removeEventListener('mouseup', swallowFollowingClick, true);
  }

  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('click', swallowFollowingClick, true);
  document.addEventListener('auxclick', swallowFollowingClick, true);
  document.addEventListener('mouseup', swallowFollowingClick, true);
  window.__chromoPageChrome = {
    __version: 2,
    __installed: true,
    __teardown: teardown,
    findSearch: findSearch,
    findStep: findStep,
    findClear: findClear
  };
  return { ok: true };
})()`
