/* ==========================================================================
   TheTechMart storefront script, shared by every public page.
   Exposes window.TTM with small helpers. Page-specific code lives in each view.
   Data comes from window.__BOOT__ (embedded by the server, so pages draw with no
   extra request). If it is missing, pages fall back to the JSON API.
   ========================================================================== */
(function () {
  'use strict';
  var WA_DEFAULT = '27716623565';
  var boot = window.__BOOT__ || null;
  var cfg = (boot && boot.cfg) || { whatsapp: WA_DEFAULT, whatsappDisplay: '071 662 3565', email: 'thetechmart2020@gmail.com', storeName: 'TheTechMart' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Thousands separated by a space (R8 400), done by hand so every browser prints the same.
  function money(n) { return 'R' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function waLink(msg) {
    return 'https://wa.me/' + (cfg.whatsapp || WA_DEFAULT) + '?text=' + encodeURIComponent(msg);
  }

  // ---- analytics: fire-and-forget, never blocks the page ----
  function track(type, extra) {
    try {
      var body = JSON.stringify(Object.assign({ type: type, path: location.pathname }, extra || {}));
      if (navigator.sendBeacon) { navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' })); return; }
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
    } catch (e) { /* analytics must never break the page */ }
  }

  async function api(url, opts) {
    opts = opts || {};
    var isForm = opts.body instanceof FormData;
    var res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, 3600);
  }

  // ---- facts shown on cards (only what the business confirmed) ----
  // Grade A-B for used devices in Like new / Good condition. "New" stays "New".
  // Fair / damaged devices show their real condition instead of a grade (no false claim).
  function gradeBadge(p) {
    var c = String(p.condition || '').toLowerCase();
    if (/fair|damag|parts|faulty/.test(c)) return { text: p.condition, cls: '' };
    if (c === 'new') return { text: 'New', cls: 'badge-grade' };
    return { text: 'Grade A-B', cls: 'badge-grade' };
  }
  function warrantyBadge(p) { return p.deal ? '21-day warranty (special offer)' : '3-month warranty'; }
  function isSold(p) { return !!p.sold || Number(p.stock) < 1; }
  function stockLine(p) {
    var n = Number(p.stock);
    if (n < 1) return { cls: 'out', text: 'Sold out' };
    if (n <= 2) return { cls: 'low', text: 'Only ' + n + ' left' };   // shown only when true
    return { cls: 'in', text: 'In stock' };
  }

  // ---- icons (inline SVG, no extra requests) ----
  var I = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/></svg>',
    console: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="9" rx="4.5"/><path d="M8 11v3M6.5 12.5h3M16 11.5h.01M18 13.5h.01"/></svg>',
    tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3" width="15" height="18" rx="2.5"/><path d="M11 18h2"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
    plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/></svg>',
    shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    truck: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2zM13 10h4l3 3v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/></svg>',
    tag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>',
    tick: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  var CATS = [
    { name: 'Phones', icon: 'phone' }, { name: 'Laptops', icon: 'laptop' }, { name: 'Consoles', icon: 'console' },
    { name: 'Tablets', icon: 'tablet' }, { name: 'Audio', icon: 'audio' }, { name: 'Accessories', icon: 'plug' }
  ];
  function catIcon(name) { var c = CATS.find(function (x) { return x.name === name; }); return I[c ? c.icon : 'phone']; }

  // Placeholder shown when a product has no photo yet (swap in real photos via CSV imageUrl / admin).
  function media(p, eager) {
    if (p.imageUrl) {
      return '<img src="' + esc(p.imageUrl) + '" alt="' + esc(p.brand + ' ' + p.model) + '" width="400" height="400" decoding="async"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + '>';
    }
    return '<div class="ph" role="img" aria-label="' + esc(p.brand + ' ' + p.model) + '">' + catIcon(p.category) + '</div>';
  }

  function deviceName(p) { return p.brand + ' ' + p.model + (p.storage ? ' ' + p.storage : ''); }

  // ---- the product card, identical everywhere ----
  function card(p, opts) {
    opts = opts || {};
    var g = gradeBadge(p), sold = isSold(p), st = stockLine(p);
    var href = '/product?id=' + encodeURIComponent(p.id);
    var wa = waLink('Hi TheTechMart, I am interested in the ' + deviceName(p) + ' (' + money(p.price) + '). Is it still available?');
    return '<article class="card">' +
      '<a class="card-media" href="' + href + '" tabindex="-1" aria-hidden="true">' + media(p) +
        (p.deal && opts.flag !== false ? '<span class="card-flag badge badge-deal">October deal</span>' : '') + '</a>' +
      '<div class="card-body">' +
        '<a class="card-title" href="' + href + '">' + esc(p.brand + ' ' + p.model) + '</a>' +
        '<div class="card-sub">' + esc([p.storage, p.color].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="badges"><span class="badge ' + g.cls + '">' + esc(g.text) + '</span><span class="badge badge-warranty">' + esc(warrantyBadge(p)) + '</span></div>' +
        '<div class="stock ' + st.cls + '">' + st.text + '</div>' +
        '<div class="card-price">' + money(p.price) + '</div>' +
        '<div class="card-actions">' +
          (sold
            ? '<a class="btn btn-ghost" data-wa data-product="' + esc(p.id) + '" href="' + wa + '" target="_blank" rel="noopener">Ask on WhatsApp</a>'
            : '<a class="btn btn-primary" data-buy data-product="' + esc(p.id) + '" href="/checkout?id=' + encodeURIComponent(p.id) + '">Buy now</a>' +
              '<a class="btn btn-ghost" href="' + href + '#offer">Make an offer</a>') +
        '</div>' +
      '</div></article>';
  }
  function skeletons(n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="skel skel-card" aria-hidden="true"></div>'; return s; }

  // ---- shared behaviour: menu, tracked clicks, default WhatsApp links ----
  function init() {
    var mb = document.getElementById('menu-btn'), mn = document.getElementById('mobile-nav');
    if (mb && mn) mb.addEventListener('click', function () {
      var open = mn.classList.toggle('open'); mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Default prefilled WhatsApp message on links that do not set their own.
    document.querySelectorAll('a[data-wa]').forEach(function (a) {
      if (!a.dataset.custom && a.href.indexOf('text=') < 0) a.href = waLink('Hi TheTechMart, I would like some help with a device.');
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('a,button'); if (!t) return;
      var pid = t.dataset && t.dataset.product;
      if (t.hasAttribute('data-wa')) track('whatsapp_click', pid ? { productId: pid } : {});
      else if (t.hasAttribute('data-buy')) track('buy_now_click', pid ? { productId: pid } : {});
      else if (t.hasAttribute('data-pricelist')) track('pricelist_download');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.TTM = { boot: boot, cfg: cfg, esc: esc, money: money, waLink: waLink, track: track, api: api, toast: toast, I: I, CATS: CATS,
    gradeBadge: gradeBadge, warrantyBadge: warrantyBadge, isSold: isSold, stockLine: stockLine, media: media, card: card,
    skeletons: skeletons, deviceName: deviceName };
})();
