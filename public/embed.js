/*!
 * 2Fronts Setter — Website-Widget.
 * Eine Zeile auf der Website des Coaches genügt:
 *
 *   <script src="https://2fronts.de/embed.js" data-concierge="DEIN-SLUG" async></script>
 *
 * Optionale Attribute:
 *   data-color="#ea580c"   Akzentfarbe: Roboter-Icon, Rahmen-Tönung, Fokusring
 *                          (Standard: 2Fronts-Orange). Der Launcher selbst bleibt
 *                          eine ruhige helle Blase, damit er nicht ins Design haut.
 *   data-invite="off"      Schaltet die dezente Einladung ab. Standard: an — der
 *                          Roboter sitzt ruhig da und blendet EINMAL pro Sitzung
 *                          kurz eine kleine Sprechblase ein ("Erstgespräch
 *                          buchen?"), die von selbst wieder verschwindet. Kein
 *                          Aufpoppen des ganzen Chats.
 *   data-invite-delay="4"  Sekunden bis die Einladung erscheint (Standard: 4).
 *   data-position="left"   Setzt das Widget unten LINKS statt rechts — für
 *                          Seiten, deren rechte Ecke schon belegt ist (anderer
 *                          Chat, WhatsApp-Button, Cookie-Badge).
 *   data-offset-bottom="90" Hebt das Widget um N Pixel an, wenn unten bereits
 *                          etwas sitzt, das bleiben soll. Standard: 0.
 *   data-auto-open="8"     Öffnet den GANZEN Chat nach N Sekunden von selbst —
 *                          höchstens einmal pro Browser-Sitzung. Aufdringlicher
 *                          als data-invite; schließt die Einladung dann aus.
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

  // data-color is the ACCENT now (robot icon, border tint, focus ring), not the
  // whole bubble fill — the launcher is a calm light disc so it reads as "a quiet
  // helper at rest", not a loud coloured blob demanding attention.
  var color = script.getAttribute('data-color') || '#ea580c'
  var autoOpenSeconds = parseFloat(script.getAttribute('data-auto-open') || '')

  // The dezente Einladung is on by default; data-invite="off" silences it.
  var inviteEnabled =
    (script.getAttribute('data-invite') || '').trim().toLowerCase() !== 'off'
  var inviteDelaySeconds = parseFloat(script.getAttribute('data-invite-delay') || '')
  if (!(inviteDelaySeconds > 0)) inviteDelaySeconds = 4

  // Corner controls, for host pages whose bottom-right is already taken by
  // another widget: data-position="left" mirrors everything to bottom-left,
  // data-offset-bottom="N" lifts the whole ensemble N pixels.
  var side = (script.getAttribute('data-position') || '').trim().toLowerCase() === 'left' ? 'left' : 'right'
  var offsetBottom = parseFloat(script.getAttribute('data-offset-bottom') || '')
  if (!(offsetBottom >= 0)) offsetBottom = 0

  var Z = 2147483000
  var SESSION_KEY = 'tf-embed-auto-opened:' + slug
  var INVITE_KEY = 'tf-embed-invited:' + slug
  var pageLang = (document.documentElement.lang || navigator.language || 'de').toLowerCase()
  var isEnglish = pageLang.indexOf('en') === 0
  var LABEL_OPEN = isEnglish ? 'Open chat' : 'Chat öffnen'
  var LABEL_CLOSE = isEnglish ? 'Close chat' : 'Chat schließen'
  var LABEL_CHAT = 'Chat' // identical in German and English, no ternary needed
  var INVITE_MAIN = isEnglish ? 'Book a first call?' : 'Erstgespräch buchen?'
  var INVITE_SUB = isEnglish ? '~1 min, right here' : '~1 Min, direkt hier'

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
    var inviteId = scopedId('invite')

    // ---- Scoped styles -----------------------------------------------------
    var style = document.createElement('style')
    style.id = scopedId('style')
    style.textContent =
      // Launcher: a calm light disc with the robot at rest — accent (data-color)
      // drives the icon + a hairline tint, not a loud coloured fill.
      '#' + bubbleId + '{position:fixed;' + side + ':20px;bottom:' + (20 + offsetBottom) + 'px;width:60px;height:60px;' +
      'display:flex;align-items:center;justify-content:center;padding:0;margin:0;' +
      'border:1px solid rgba(0,0,0,.10);border-radius:50%;background:#FFFDF7;color:' + color + ';cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.12),0 2px 4px rgba(0,0,0,.08);' +
      'z-index:' + Z + ';transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;line-height:0;}' +
      '#' + bubbleId + ':hover{transform:translateY(-2px);border-color:rgba(0,0,0,.18);' +
      'box-shadow:0 8px 20px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.10);}' +
      '#' + bubbleId + ':focus-visible{outline:3px solid ' + color + ';outline-offset:3px;}' +
      '#' + bubbleId + ' svg{width:30px;height:30px;display:block;}' +
      // Dezente Einladung: absolutely placed beside the bubble (opposite the
      // widget's corner), zero footprint at rest, slides in on .in and back out.
      '#' + inviteId + '{position:fixed;' + side + ':92px;bottom:' + (30 + offsetBottom) + 'px;z-index:' + Z + ';display:flex;align-items:center;' +
      'max-width:250px;margin:0;padding:0;border:1px solid rgba(0,0,0,.10);border-radius:12px;background:#FFFDF7;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.12);color:#1B1712;text-align:left;cursor:pointer;' +
      "font:500 13.5px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      'opacity:0;transform:translateX(' + (side === 'left' ? '12px' : '-12px') + ');pointer-events:none;' +
      'transition:opacity .34s ease,transform .44s cubic-bezier(.2,.7,.2,1);}' +
      '#' + inviteId + '.tf-embed-invite-in{opacity:1;transform:none;pointer-events:auto;}' +
      '#' + inviteId + ' .tf-embed-invite-txt{padding:10px 14px;}' +
      '#' + inviteId + ' .tf-embed-invite-sub{display:block;color:#6B655B;font-weight:400;font-size:12px;margin-top:2px;}' +
      '#' + inviteId + ':hover{border-color:rgba(0,0,0,.18);}' +
      '#' + inviteId + ':focus-visible{outline:3px solid ' + color + ';outline-offset:2px;}' +
      // Speech-tail chevron pointing at the bubble: ">" when the widget sits
      // right (bubble right of invite), "<" when it sits left.
      (side === 'left'
        ? '#' + inviteId + '::after{content:"";position:absolute;left:-6px;bottom:18px;width:11px;height:11px;' +
          'background:#FFFDF7;border-left:1px solid rgba(0,0,0,.10);border-top:1px solid rgba(0,0,0,.10);transform:rotate(-45deg);}'
        : '#' + inviteId + '::after{content:"";position:absolute;right:-6px;bottom:18px;width:11px;height:11px;' +
          'background:#FFFDF7;border-right:1px solid rgba(0,0,0,.10);border-bottom:1px solid rgba(0,0,0,.10);transform:rotate(-45deg);}') +
      '#' + panelId + '{position:fixed;' + side + ':20px;bottom:' + (96 + offsetBottom) + 'px;width:min(400px,calc(100vw - 40px));' +
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
      // Small screens: keep it to just the robot, the invite would crowd content.
      '@media (max-width:639px){#' + panelId + '{right:0;bottom:0;width:100vw;height:100dvh;' +
      'max-height:100vh;border-radius:0;}#' + inviteId + '{display:none;}}' +
      '@media (prefers-reduced-motion:reduce){#' + bubbleId + '{transition:none;}' +
      '#' + bubbleId + ':hover{transform:none;}#' + inviteId + '{transition:opacity .2s ease;transform:none;}}'

    // ---- Bubble (robot at rest) --------------------------------------------
    var bubble = document.createElement('button')
    bubble.id = bubbleId
    bubble.type = 'button'
    bubble.setAttribute('aria-label', LABEL_OPEN)
    bubble.setAttribute('aria-expanded', 'false')
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3.5v2.2"/><circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none"/>' +
      '<rect x="4.5" y="6" width="15" height="12" rx="3.2"/>' +
      '<circle cx="9.2" cy="12" r="1.05" fill="currentColor" stroke="none"/>' +
      '<circle cx="14.8" cy="12" r="1.05" fill="currentColor" stroke="none"/>' +
      '<path d="M2.6 11v3M21.4 11v3"/></svg>'

    // ---- Einladung (transient, non-intrusive) ------------------------------
    var invite = document.createElement('button')
    invite.id = inviteId
    invite.type = 'button'
    invite.setAttribute('aria-label', INVITE_MAIN + ' ' + INVITE_SUB)
    invite.innerHTML =
      '<span class="tf-embed-invite-txt">' + INVITE_MAIN +
      '<span class="tf-embed-invite-sub">' + INVITE_SUB + '</span></span>'

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

    // ---- Dezente Einladung state ------------------------------------------
    var inviteShowT = null
    var inviteHideT = null

    function markInvited() {
      try {
        sessionStorage.setItem(INVITE_KEY, '1')
      } catch (e) {
        /* storage blocked — the invite may just show again next page */
      }
    }
    function invitedAlready() {
      try {
        return sessionStorage.getItem(INVITE_KEY) === '1'
      } catch (e) {
        return false
      }
    }
    function hideInvite() {
      if (inviteHideT) {
        clearTimeout(inviteHideT)
        inviteHideT = null
      }
      invite.classList.remove('tf-embed-invite-in')
    }
    function showInvite() {
      // Never nudge over an already-open chat, and only once per session.
      if (isOpen || invitedAlready()) return
      markInvited()
      invite.classList.add('tf-embed-invite-in')
      // Slides back out on its own — it must never linger and demand attention.
      inviteHideT = setTimeout(hideInvite, 5000)
    }

    function open(fromAutoOpen) {
      if (isOpen) return
      // Opening the chat retires the nudge for good this session.
      if (inviteShowT) {
        clearTimeout(inviteShowT)
        inviteShowT = null
      }
      hideInvite()
      markInvited()
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
    // The nudge is itself a shortcut into the chat.
    invite.addEventListener('click', function () {
      open()
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
    document.body.appendChild(invite)
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
    } else if (inviteEnabled && !invitedAlready()) {
      // The gentle default: no auto-open force-popping the chat — just the
      // transient nudge, once per session, after a short beat.
      inviteShowT = setTimeout(showInvite, inviteDelaySeconds * 1000)
    }
  }

  // An async script in <head> can run before <body> exists.
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
})()
