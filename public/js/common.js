function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmtPrice(n) {
  return 'R' + Number(n).toLocaleString('en-ZA');
}

// Auto-generated placeholder "device card" used whenever a product has no photo yet.
// Real product photography (yours, or from a licensed supplier) should be added via
// the CSV imageUrl column or the admin panel — this is a clean stand-in, not a stock photo.
function deviceArt(brand, model) {
  return `
    <div class="placeholder-device">
      <div class="glyph"></div>
      <div class="lbl">${brand}<br>${model}</div>
    </div>
  `;
}

function productImage(p) {
  return p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${p.brand} ${p.model}">`
    : deviceArt(p.brand, p.model);
}
