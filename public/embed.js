/*!
 * 2Fronts Setter — Website-Widget.
 * Eine Zeile auf der Website des Coaches genügt:
 *
 *   <script src="https://2fronts.de/embed.js" data-concierge="DEIN-SLUG" async></script>
 *
 * Optionale Attribute:
 *   data-color="#ea580c"   Farbe der Chat-Blase (Standard: 2Fronts-Orange)
 *   data-auto-open="8"     Öffnet den Chat nach N Sekunden von selbst —
 *                          höchstens einmal pro Browser-Sitzung.
 *
 * Kein Build, keine Abhängigkeiten. Alle Klassen/IDs sind mit "tf-embed-"
 * geprefixt und alle Styles leben in einem eigenen <style>-Block, damit
 * nichts in die Seite des Coaches hineinregiert.
 */
(function () {
  'use strict'

  // Our own <script> tag carries the config. document.currentScript is null
  // for scripts injected via some tag managers, so fall back to a selector.
  var script =
    document.currentScript || document.querySelector('script[data-concierge]')
  if (!script) return

  var slug = (script.getAttribute('data-concierge') || '').trim()
  if (!slug) {
    console.warn('[2Fronts] embed.js: data-concierge (Slug) fehlt im <script>-Tag.')
    return
  }

  // The chat iframe loads from wherever this script was loaded from, so the
  // widget works unchanged on any coach domain (and on preview deployments).
  var origin
  try {
    origin = new URL(script.src, window.location.href).origin
  } catch (e) {
    origin = window.location.origin
  }

  var color = script.getAttribute('data-color') || '#ea580c'
  var autoOpenSeconds = parseFloat(script.getAttribute('data-auto-open') || '')

  var Z = 2147483000
  var SESSION_KEY = 'tf-embed-auto-opened:' + slug
  var pageLang = (document.documentElement.lang || navigator.language || 'de').toLowerCase()
  var isEnglish = pageLang.indexOf('en') === 0
  var LABEL_OPEN = isEnglish ? 'Open chat' : 'Chat öffnen'
  var LABEL_CLOSE = isEnglish ? 'Close chat' : 'Chat schließen'
  var LABEL_CHAT = 'Chat' // identical in German and English, no ternary needed

  // IDs are scoped per slug (not a fixed 'tf-embed-bubble' etc.) so a coach
  // with two or more concierges can paste more than one snippet into the same
  // site-wide "custom code" field without the DOM ids or CSS selectors of one
  // widget colliding with the other's.
  function scopedId(name) {
    return 'tf-embed-' + name + '-' + slug
  }

  function mount() {
    // Never mount the SAME slug twice (e.g. the snippet pasted into header
    // AND footer) — but a DIFFERENT slug must still mount normally, so the
    // guard is keyed on slug via a shared registry, not a fixed element id.
    var registry = (window.__tfEmbedMounted = window.__tfEmbedMounted || {})
    if (registry[slug]) return
    registry[slug] = true

    var bubbleId = scopedId('bubble')
    var panelId = scopedId('panel')
    var frameId = scopedId('frame')
    var closeId = scopedId('close')

    // ---- Scoped styles -----------------------------------------------------
    var style = document.createElement('style')
    style.id = scopedId('style')
    style.textContent =
      '#' + bubbleId + '{position:fixed;right:20px;bottom:20px;width:60px;height:60px;' +
      'display:flex;align-items:center;justify-content:center;padding:0;margin:0;border:none;' +
      'border-radius:50%;background:' + color + ';color:#fff;cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.18),0 2px 4px rgba(0,0,0,.12);' +
      'z-index:' + Z + ';transition:transform .15s ease,box-shadow .15s ease;line-height:0;}' +
      '#' + bubbleId + ':hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.14);}' +
      '#' + bubbleId + ':focus-visible{outline:3px solid ' + color + ';outline-offset:3px;}' +
      '#' + bubbleId + ' svg{width:28px;height:28px;display:block;}' +
      '#' + panelId + '{position:fixed;right:20px;bottom:96px;width:min(400px,calc(100vw - 40px));' +
      'height:min(600px,calc(100vh - 120px));background:#fff;border-radius:16px;overflow:hidden;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.24),0 4px 12px rgba(0,0,0,.12);' +
      'z-index:' + (Z + 1) + ';display:none;}' +
      '#' + panelId + '.tf-embed-open{display:block;}' +
      '#' + frameId + '{width:100%;height:100%;border:0;display:block;}' +
      '#' + closeId + '{position:absolute;top:8px;right:8px;width:36px;height:36px;padding:0;border:none;' +
      'border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:36px;' +
      'text-align:center;cursor:pointer;z-index:1;}' +
      '#' + closeId + ':hover{background:rgba(0,0,0,.65);}' +
      '#' + closeId + ':focus-visible{outline:3px solid ' + color + ';outline-offset:2px;}' +
      '@media (max-width:639px){#' + panelId + '{right:0;bottom:0;width:100vw;height:100dvh;' +
      'max-height:100vh;border-radius:0;}}' +
      '@media (prefers-reduced-motion:reduce){#' + bubbleId + '{transition:none;}' +
      '#' + bubbleId + ':hover{transform:none;}}'

    // ---- Bubble ------------------------------------------------------------
    var bubble = document.createElement('button')
    bubble.id = bubbleId
    bubble.type = 'button'
    bubble.setAttribute('aria-label', LABEL_OPEN)
    bubble.setAttribute('aria-expanded', 'false')
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'

    // ---- Panel (iframe is created lazily on first open) ---------------------
    var panel = document.createElement('div')
    panel.id = panelId
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', LABEL_CHAT)

    var close = document.createElement('button')
    close.id = closeId
    close.type = 'button'
    close.setAttribute('aria-label', LABEL_CLOSE)
    close.innerHTML = '×'
    panel.appendChild(close)

    var frame = null
    var isOpen = false

    function ensureFrame() {
      if (frame) return
      frame = document.createElement('iframe')
      frame.id = frameId
      frame.title = LABEL_CHAT
      frame.setAttribute('allow', 'clipboard-write')
      frame.src = origin + '/c/' + encodeURIComponent(slug) + '?embed=1'
      panel.appendChild(frame)
    }

    function markOpened() {
      try {
        sessionStorage.setItem(SESSION_KEY, '1')
      } catch (e) {
        /* storage blocked — auto-open just may fire again next page */
      }
    }

    function open(fromAutoOpen) {
      if (isOpen) return
      ensureFrame()
      panel.classList.add('tf-embed-open')
      bubble.setAttribute('aria-label', LABEL_CLOSE)
      bubble.setAttribute('aria-expanded', 'true')
      isOpen = true
      markOpened()
      // Only move focus when the visitor opened the chat themselves —
      // auto-open must never steal focus from the host page.
      if (!fromAutoOpen) close.focus()
    }

    function shut() {
      if (!isOpen) return
      panel.classList.remove('tf-embed-open')
      bubble.setAttribute('aria-label', LABEL_OPEN)
      bubble.setAttribute('aria-expanded', 'false')
      isOpen = false
      bubble.focus()
    }

    bubble.addEventListener('click', function () {
      if (isOpen) shut()
      else open()
    })
    close.addEventListener('click', shut)
    document.addEventListener('keydown', function (e) {
      if (isOpen && (e.key === 'Escape' || e.key === 'Esc')) shut()
    })
    // The chat itself runs in a cross-origin iframe, so its own keydown
    // events never reach this document — the page forwards Escape via
    // postMessage instead (see ConciergePublicPage's embed-mode effect).
    // Both checks matter: e.origin must be OUR app (not some other script on
    // the host page forging the message), and e.source must be THIS widget's
    // own iframe (not another concierge's, when two are mounted on one page).
    window.addEventListener('message', function (e) {
      var data = e.data
      if (
        e.origin === origin &&
        frame &&
        e.source === frame.contentWindow &&
        data &&
        data.source === 'tf-embed' &&
        data.type === 'escape'
      ) {
        shut()
      }
    })

    document.head.appendChild(style)
    document.body.appendChild(bubble)
    document.body.appendChild(panel)

    // ---- Optional auto-open, once per session --------------------------------
    if (autoOpenSeconds > 0) {
      var alreadyOpened = false
      try {
        alreadyOpened = sessionStorage.getItem(SESSION_KEY) === '1'
      } catch (e) {
        /* storage blocked — treat as not opened */
      }
      if (!alreadyOpened) {
        setTimeout(function () {
          if (!isOpen) open(true)
        }, autoOpenSeconds * 1000)
      }
    }
  }

  // An async script in <head> can run before <body> exists.
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
})()
