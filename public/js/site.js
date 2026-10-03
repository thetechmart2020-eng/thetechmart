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
  // Referral: a link like /?ref=THANDI-4F2 is remembered for 30 days and sent with offers, orders and
  // meetup requests, and added to WhatsApp messages. It only tags the lead; admin decides what is paid.
  var REF_KEY = 'ttm_ref', REF_DAYS = 30;
  function refCode() {
    try {
      var m = location.search.match(/[?&]ref=([A-Za-z0-9-]{3,20})/);
      if (m) localStorage.setItem(REF_KEY, JSON.stringify({ c: m[1].toUpperCase(), t: Date.now() }));
      var s = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
      if (s && s.c && Date.now() - s.t < REF_DAYS * 864e5) return s.c;
    } catch (e) {}
    return '';
  }
  var REF = refCode();
  function waLink(msg) {
    return 'https://wa.me/' + (cfg.whatsapp || WA_DEFAULT) + '?text=' + encodeURIComponent(msg + (REF ? '\n\n(Referral: ' + REF + ')' : ''));
  }


  // ---- form validation: same rules as lib/validate.js on the server (the server checks again) ----
  var PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
  var SLOTS = { morning: 'Morning (09:00 to 12:00)', afternoon: 'Afternoon (12:00 to 15:00)', late: 'Late afternoon (15:00 to 17:00)' };
  var MSG = {
    name: 'Please enter your name.',
    phone: 'Please enter a valid South African number, like 082 123 4567 or +27 82 123 4567.',
    email: 'Please enter a valid email address, like name@example.com.',
    postal: 'Please enter a 4-digit postal code, like 2196.'
  };
  var fv = {
    PROVINCES: PROVINCES, SLOTS: SLOTS, MSG: MSG,
    // Text from people: no control characters or angle brackets, single spaces.
    clean: function (v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); },
    phone: function (v) { var d = String(v || '').replace(/[\s\-().]/g, ''); return /^0\d{9}$/.test(d) || /^\+27\d{9}$/.test(d); },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()) && String(v).length <= 254; },
    postal: function (v) { return /^\d{4}$/.test(String(v || '').trim()); },
    // Today in South African time as YYYY-MM-DD, and a date n days later.
    today: function () { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); },
    addDays: function (iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    minMeetup: function () { return fv.addDays(fv.today(), 2); },      // meetups need 2 days' notice
    maxMeetup: function () { return fv.addDays(fv.today(), 60); },
    isSunday: function (iso) { return new Date(iso + 'T00:00:00Z').getUTCDay() === 0; },
    isWeekend: function (iso) { var d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 || d === 6; },
    meetupDate: function (v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return 'Please choose a meetup date.';
      if (v < fv.minMeetup()) return "Meetups need 2 days' notice. Please pick a later date.";
      if (!fv.isWeekend(v)) return 'Meetups are on Saturdays and Sundays only. Please pick a weekend date.';
      if (v > fv.maxMeetup()) return 'Please pick a date within the next 60 days.';
      return '';
    },
    // Shows or clears the message under a field. `el` is the input (or any element inside its .field).
    setErr: function (el, msg) {
      if (!el) return;
      var box = el.closest('.field') || el.parentNode, p = box.querySelector(':scope > .field-err');
      if (!msg) { if (p) p.remove(); el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); box.classList.remove('has-err'); return; }
      if (!p) { p = document.createElement('p'); p.className = 'field-err'; p.setAttribute('role', 'alert'); box.appendChild(p); }
      p.id = 'err-' + (el.id || el.name || Math.random().toString(36).slice(2)); p.textContent = msg;
      el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', p.id); box.classList.add('has-err');
    },
    clearAll: function (form) { form.querySelectorAll('.field-err').forEach(function (p) { p.remove(); }); form.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby'); }); form.querySelectorAll('.has-err').forEach(function (e) { e.classList.remove('has-err'); }); },
    // rules: [{ name, el (optional), check: function (value, data) -> message or '' }]. Returns true when everything is fine;
    // otherwise shows each message next to its field and jumps to the first one.
    run: function (form, rules) {
      fv.clearAll(form);
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
      var first = null;
      rules.forEach(function (r) {
        var el = r.el || form.elements[r.name]; if (el && el.length && !el.tagName) el = el[0];
        if (!el || (el.closest && el.closest('[hidden]'))) return;
        var m = r.check(data[r.name] == null ? '' : data[r.name], data);
        if (m) { fv.setErr(el, m); if (!first) first = el; }
      });
      if (first) fv.focus(first);
      return !first;
    },
    focus: function (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); } catch (e) {} },
    // Server-side messages (keyed by field name) shown next to the matching inputs.
    apply: function (form, fields) {
      var first = null;
      Object.keys(fields || {}).forEach(function (k) { var el = form.elements[k]; if (el && el.length && !el.tagName) el = el[0]; if (el) { fv.setErr(el, fields[k]); if (!first) first = el; } });
      if (first) fv.focus(first);
      return !!first;
    },
    // Re-checks a field when the person leaves it, once it has been shown as wrong or filled in.
    live: function (form, rules) {
      rules.forEach(function (r) {
        var el = r.el || form.elements[r.name]; if (!el || el.length) return;
        var again = function () { var d = {}; new FormData(form).forEach(function (v, k) { d[k] = typeof v === 'string' ? v.trim() : v; }); fv.setErr(el, r.check(d[r.name] == null ? '' : d[r.name], d)); };
        el.addEventListener('blur', function () { if (el.value.trim() || el.hasAttribute('aria-invalid')) again(); });
        el.addEventListener('input', function () { if (el.hasAttribute('aria-invalid')) again(); });
      });
    },
    // Stops a form being sent twice: buttons are disabled until `done()` is called.
    lock: function (form) {
      var b = form.querySelectorAll('button[type=submit]'); b.forEach(function (x) { x.disabled = true; x.setAttribute('aria-busy', 'true'); });
      return function () { b.forEach(function (x) { x.disabled = false; x.removeAttribute('aria-busy'); }); };
    }
  };

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
    if (REF && opts.body && !isForm && typeof opts.body === 'object' && opts.body.ref === undefined) opts.body.ref = REF;
    if (REF && isForm && !opts.body.has('ref')) opts.body.append('ref', REF);
    var res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(data.error || 'Something went wrong. Please try again.'); e.fields = data.fields || null; throw e; }
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
  // Normal-price devices: 3-month warranty. Negotiated (special-price) devices, flagged by lib/deals.js: 21-day warranty.
  function warrantyBadge(p) { return p.deal ? '21-day warranty (negotiated device)' : '3-month warranty'; }
  var DELIVERY_FEE = (cfg && cfg.deliveryFee != null) ? cfg.deliveryFee : 100;
  var MEETUP_FEE = (cfg && cfg.meetupFee != null) ? cfg.meetupFee : 200;
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
  // kind: 'card' uses the small version, 'main' the full-size one. First/main images load eagerly, the rest lazily.
  function media(p, eager, kind) {
    var src = kind === 'main' ? p.imageUrl : (p.thumbUrl || p.imageUrl);
    if (src) {
      var size = kind === 'main' ? 1200 : 480;
      return '<img src="' + esc(src) + '" alt="' + esc(p.brand + ' ' + p.model) + '" width="' + size + '" height="' + size + '" decoding="async"' + (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') + '>';
    }
    return '<div class="card-ph" role="img" aria-label="' + esc(p.brand + ' ' + p.model + ': photo coming soon') + '">Photo coming soon</div>';
  }

  function deviceName(p) { return p.brand + ' ' + p.model + (p.storage ? ' ' + p.storage : ''); }

  // ---- the product card, identical everywhere ----
  function card(p, opts) {
    opts = opts || {};
    var g = gradeBadge(p), sold = isSold(p), st = stockLine(p);
    var href = '/product?id=' + encodeURIComponent(p.id);
    var wa = waLink('Hi TheTechMart, I am interested in the ' + deviceName(p) + ' (' + money(p.price) + '). Is it still available?');
    return '<article class="card">' +
      '<a class="card-media" href="' + href + '" tabindex="-1" aria-hidden="true">' + media(p, opts.eager) +
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

  // ---- analytics consent: Microsoft Clarity loads ONLY after the visitor taps Accept ----
  // Everything typed into a form is masked so Clarity never records names, phones or addresses.
  var CLARITY_ID = 'ys5sg0ftxq', CONSENT_KEY = 'ttm_consent';
  function getConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {} }
  function maskInputs(root) {
    (root.querySelectorAll ? root.querySelectorAll('input,textarea,select') : []).forEach(function (el) { el.setAttribute('data-clarity-mask', 'True'); });
    if (root.matches && root.matches('input,textarea,select')) root.setAttribute('data-clarity-mask', 'True');
  }
  function loadClarity() {
    if (window.__clarityOn) return; window.__clarityOn = true;
    maskInputs(document);
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) maskInputs(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }
  function consentBanner() {
    var b = document.createElement('div'); b.className = 'consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Analytics');
    b.innerHTML = '<p>We use Microsoft Clarity to see how visitors use the site, so we can fix what is confusing. What you type in forms is never recorded. <a href="/privacy">Privacy</a></p>' +
      '<div class="consent-btns"><button type="button" class="btn btn-ghost" data-c="no">Decline</button><button type="button" class="btn btn-primary" data-c="yes">Accept</button></div>';
    b.addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-c'); if (!v) return;
      setConsent(v); b.remove(); if (v === 'yes') loadClarity();
    });
    document.body.appendChild(b);
  }
  function consentInit() { var c = getConsent(); if (c === 'yes') loadClarity(); else if (c !== 'no') consentBanner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', consentInit); else consentInit();

  window.TTM = { boot: boot, cfg: cfg, esc: esc, money: money, waLink: waLink, track: track, api: api, toast: toast, I: I, CATS: CATS,
    gradeBadge: gradeBadge, warrantyBadge: warrantyBadge, isSold: isSold, stockLine: stockLine, media: media, card: card,
    skeletons: skeletons, deviceName: deviceName, deliveryFee: DELIVERY_FEE, meetupFee: MEETUP_FEE, fv: fv };
})();
