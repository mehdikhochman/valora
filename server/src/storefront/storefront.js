// Storefront behaviour. Inlined into the page by the server and allowed by CSP hash.
// The whole catalogue arrives with the page (#catalogue), so every click is local:
// filters, search, the scent finder, product sheets and the bag never wait on the network.
// The network is used only to place an order and to send anonymous counters.
(() => {
  const DATA = JSON.parse(document.getElementById('catalogue').textContent);
  const { settings, labels } = DATA;
  const perfumes = DATA.perfumes;
  const BAG_KEY = 'vallora-bag-v1';
  const SEEN_KEY = 'vallora-seen-v1';
  const CUSTOMER_KEY = 'vallora-customer-v1';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const byId = new Map(perfumes.map((p) => [p.id, p]));
  const bySlug = new Map(perfumes.map((p) => [p.slug, p]));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: works for this visit */ } },
  };

  // Hue of each olfactive family, used for dots, tiles and default bottle colours.
  const FAMILY_HUES = { amber: 28, woody: 20, floral: 345, fresh: 190, citrus: 45, gourmand: 32, leather: 12, aromatic: 110, musky: 30, chypre: 75 };
  const FAMILY_LINES = {
    amber: 'Résines, vanille et épices : une chaleur enveloppante.',
    woody: 'Santal, cèdre et vétiver : l’élégance sèche du bois.',
    floral: 'Rose, jasmin, tubéreuse : un bouquet lumineux.',
    fresh: 'Notes marines et aromatiques : une respiration.',
    citrus: 'Bergamote, citron, néroli : l’éclat du matin.',
    gourmand: 'Caramel, praliné, café : une douceur addictive.',
    leather: 'Cuir, tabac et bouleau : un caractère affirmé.',
    aromatic: 'Lavande, sauge, menthe : une fraîcheur herbacée.',
    musky: 'Muscs blancs et poudre : une seconde peau.',
    chypre: 'Bergamote, mousse et patchouli : un classique racé.',
  };
  // Families that sit next to each other on the fragrance wheel; the finder gives them partial credit.
  const NEIGHBOURS = {
    amber: ['gourmand', 'woody', 'leather'], woody: ['amber', 'leather', 'aromatic', 'chypre'], floral: ['musky', 'chypre', 'fresh'],
    fresh: ['citrus', 'aromatic', 'floral'], citrus: ['fresh', 'aromatic', 'chypre'], gourmand: ['amber', 'musky'],
    leather: ['woody', 'amber'], aromatic: ['fresh', 'woody', 'citrus'], musky: ['floral', 'gourmand'], chypre: ['woody', 'floral', 'citrus'],
  };

  // ---------- Anonymous counters (no cookie, no id) ----------
  const queue = [];
  const track = (e, p = 0) => { queue.push({ e, p }); if (queue.length >= 20) flush(); };
  function flush() {
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0, 50) });
    if (!navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/events', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  setInterval(flush, 15000);
  try { if (!sessionStorage.getItem('v')) { sessionStorage.setItem('v', '1'); track('visit'); } } catch { /* no session storage */ }

  // ---------- Money ----------
  // Same rules as the server (lib/format.js): "25 000 F CFA", "120,50 €".
  const SYMBOLS = { XOF: 'F CFA', XAF: 'F CFA', EUR: '€', USD: '$', GBP: '£', MAD: 'MAD', LBP: 'LBP' };
  const digits = ['XOF', 'XAF', 'LBP'].includes(settings.currency) ? 0 : 2;
  const money = (cents) => {
    if (cents == null) return 'Prix sur demande';
    const [whole, fraction] = (Math.abs(cents) / 100).toFixed(digits).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${cents < 0 ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''} ${SYMBOLS[settings.currency] ?? settings.currency}`;
  };
  const fromPrice = (p) => {
    if (p.price == null) return '<span class="price">Prix sur demande</span>';
    const prefix = p.sizes.length > 1 && p.maxPrice !== p.price ? '<small>dès</small>' : '';
    const was = p.was && p.was > p.price ? `<s>${money(p.was)}</s>` : '';
    return `<span class="price">${prefix}${money(p.price)}${was}</span>`;
  };
  const sizePrice = (p, label) => (p.sizes.find((s) => s.l === label)?.p ?? p.price);
  const concLabel = (p) => labels.concentrations[p.conc] ?? '';
  const famLabel = (f) => labels.families[f] ?? f;
  const hueOf = (p) => p.hue ?? FAMILY_HUES[p.fam] ?? 24;
  const notesOf = (p) => [...p.top, ...p.heart, ...p.base];

  // ---------- Generative bottles ----------
  // Shops rarely have studio photos of every bottle on day one. Each perfume gets its own drawn
  // flacon instead: shape and cap come from a hash of its name, the juice from its colour.
  // A real photo uploaded in the admin always replaces it.
  let svgSeq = 0;
  const hash = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const BODIES = [
    { d: 'M62 112h76a10 10 0 0 1 10 10v150a12 12 0 0 1-12 12H64a12 12 0 0 1-12-12V122a10 10 0 0 1 10-10z', neck: 112 },
    { d: 'M44 132h112a14 14 0 0 1 14 14v124a14 14 0 0 1-14 14H44a14 14 0 0 1-14-14V146a14 14 0 0 1 14-14z', neck: 132 },
    { d: 'M100 120c46 0 70 40 70 86 0 52-30 78-70 78s-70-26-70-78c0-46 24-86 70-86z', neck: 122 },
    { d: 'M70 118h60l26 26v114l-26 26H70l-26-26V144z', neck: 118 },
    { d: 'M86 112h28c4 22 40 40 40 92 0 50-24 80-54 80s-54-30-54-80c0-52 36-70 40-92z', neck: 112 },
    { d: 'M78 150h44a8 8 0 0 1 8 8v118a8 8 0 0 1-8 8H78a8 8 0 0 1-8-8V158a8 8 0 0 1 8-8z', neck: 150 },
  ];
  const CAPS = [
    (n) => `<rect x="88" y="${n - 14}" width="24" height="16" rx="2"/><circle cx="100" cy="${n - 40}" r="26"/>`,
    (n) => `<rect x="88" y="${n - 14}" width="24" height="16" rx="2"/><rect x="74" y="${n - 74}" width="52" height="62" rx="5"/>`,
    (n) => `<rect x="88" y="${n - 14}" width="24" height="16" rx="2"/><path d="M100 ${n - 84}l30 26-8 44H78l-8-44z"/>`,
    (n) => `<rect x="88" y="${n - 14}" width="24" height="16" rx="2"/><rect x="58" y="${n - 40}" width="84" height="28" rx="4"/>`,
  ];
  const DROPPER = (n) => `<rect x="90" y="${n - 12}" width="20" height="14" rx="2"/><path d="M92 ${n - 12}V${n - 60}a8 8 0 0 1 16 0V${n - 12}z"/>`;

  function bottle(p, label = true) {
    const id = `b${++svgSeq}`;
    const h = hash(p.slug || p.name);
    const oil = p.conc === 'oil';
    const body = oil ? BODIES[5] : BODIES[h % 5];
    const cap = oil ? DROPPER(body.neck) : CAPS[(h >>> 4) % CAPS.length](body.neck);
    const hue = hueOf(p);
    const fill = 0.8 + ((h >>> 8) % 10) / 100;
    const brand = (p.house || settings.brand || '').toUpperCase().slice(0, 18);
    const name = String(p.name).slice(0, 22);
    const nameSize = name.length > 14 ? 11 : 14;
    const labelY = body.neck + (284 - body.neck) * 0.48;
    return `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flacon ${esc(p.name)}">
<defs>
<linearGradient id="${id}j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 34% 80%)"/><stop offset="1" stop-color="hsl(${hue} 30% 62%)"/></linearGradient>
<radialGradient id="${id}r" cx=".3" cy=".25" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".18" stop-color="#fff" stop-opacity=".02"/><stop offset=".8" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9906d"/><stop offset=".45" stop-color="#e3cbb4"/><stop offset="1" stop-color="#a27a5a"/></linearGradient>
<clipPath id="${id}k"><path d="${body.d}"/></clipPath>
</defs>
<ellipse cx="100" cy="288" rx="62" ry="5" fill="#1c1714" opacity=".07"/>
<path d="${body.d}" fill="rgba(255,255,255,.55)"/>
<g clip-path="url(#${id}k)"><rect x="0" y="${284 - (284 - body.neck) * fill}" width="200" height="300" fill="url(#${id}j)"/>
<rect x="0" y="${284 - (284 - body.neck) * fill}" width="200" height="1.5" fill="#fff" opacity=".6"/>
<rect x="0" y="0" width="200" height="300" fill="url(#${id}g)"/><rect x="0" y="0" width="200" height="300" fill="url(#${id}r)"/></g>
<path d="${body.d}" fill="none" stroke="rgba(28,23,20,.22)" stroke-width="1"/>
<path d="M58 ${body.neck + 22}v120" stroke="#fff" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round" clip-path="url(#${id}k)"/>
<g fill="url(#${id}c)">${cap}</g>
${label ? `<g text-anchor="middle"><rect x="64" y="${labelY - 20}" width="72" height="40" fill="#fbf9f6" opacity=".92"/>
<text x="100" y="${labelY - 5}" font-size="6" letter-spacing="2" fill="#8c827b" font-family="Jost,sans-serif">${esc(brand)}</text>
<text x="100" y="${labelY + 11}" font-family="Cormorant,serif" font-size="${nameSize}" fill="#1c1714">${esc(name)}</text></g>` : ''}
</svg>`;
  }

  const imgTag = (img, sizes, extra = '') => (img
    ? `<img src="${img.l}" srcset="${img.s} 480w, ${img.l} 1200w" sizes="${sizes}" width="${img.w}" height="${img.h}" alt="" ${extra}>`
    : '');
  // A small picture for lists: the cut-out photo, else the drawn bottle.
  const mini = (p) => (p.cut ? `<img src="${p.cut.s}" alt="">` : bottle(p, false));

  // ---------- Cards ----------
  const cardCache = new Map();
  function card(p, where = 'grid') {
    const key = `${where}:${p.id}`;
    if (cardCache.has(key)) return cardCache.get(key);
    const el = document.createElement('article');
    el.className = 'card';
    el.style.setProperty('--h', hueOf(p));
    const sizes = '(min-width:1180px) 25vw, (min-width:760px) 33vw, 50vw';
    let art;
    if (p.cut) art = `<span class="art">${imgTag(p.cut, sizes, 'loading="lazy"')}</span>`;
    else if (p.photos[0]) art = imgTag(p.photos[0], sizes, 'class="cover" loading="lazy"') + (p.photos[1] ? imgTag(p.photos[1], sizes, 'class="cover alt" loading="lazy"') : '');
    else art = `<span class="art">${bottle(p)}</span>`;
    const badge = p.avail === 'sold_out' ? '<span class="badge sold">Épuisé</span>'
      : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : p.isNew ? '<span class="badge">Nouveau</span>' : '';
    el.innerHTML = `<div class="card-art" aria-hidden="true">${badge}${art}</div>
      <div class="card-meta">
        <h3><button type="button">${esc(p.name)}</button></h3>
        <p class="card-sub">${esc(concLabel(p))} · ${esc(famLabel(p.fam))}</p>
        <div class="card-foot">${fromPrice(p)}${p.avail === 'sold_out' ? '' : `<button class="add" type="button" aria-label="Ajouter ${esc(p.name)} à ma sélection"><svg class="i"><use href="#i-plus"/></svg></button>`}</div>
      </div>`;
    el.querySelector('h3 button').addEventListener('click', () => openPerfume(p));
    el.querySelector('.add')?.addEventListener('click', (e) => {
      if (p.sizes.length > 1) return openPerfume(p);
      addToBag(p, p.sizes[0]?.l ?? '', 1);
      const btn = e.currentTarget;
      btn.classList.add('done');
      btn.innerHTML = '<svg class="i"><use href="#i-check"/></svg>';
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = '<svg class="i"><use href="#i-plus"/></svg>'; }, 1500);
    });
    cardCache.set(key, el);
    return el;
  }

  // ---------- Header ----------
  const bar = $('#bar');
  const setBarH = () => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
  setBarH();
  addEventListener('resize', setBarH, { passive: true });
  const onScroll = () => {
    bar.classList.toggle('solid', scrollY > 40);
    $('#fab').classList.toggle('on', scrollY > innerHeight * 0.6);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const familiesUsed = Object.keys(labels.families).filter((f) => perfumes.some((p) => p.fam === f));

  // ---------- Filters + sort ----------
  const state = { cat: '', fam: new Set(), conc: new Set(), aud: new Set(), house: new Set(), int: new Set(), maxPrice: null, sort: 'featured', inStock: false };
  const prices = perfumes.map((p) => p.price).filter((v) => v != null);
  const PRICE_MAX = prices.length ? Math.max(...prices) : 0;
  const PRICE_STEP = Math.max(100, Math.round(PRICE_MAX / 40 / 100) * 100);
  const INTENSITY = [['1', 'Discret', [1, 2]], ['3', 'Présent', [3]], ['5', 'Affirmé', [4, 5]]];
  const intensityKey = (p) => INTENSITY.find(([, , values]) => values.includes(p.int))[0];

  const GROUPS = [
    ['aud', 'Pour qui', Object.entries(labels.audiences), (p) => p.aud],
    ['fam', 'Famille olfactive', Object.entries(labels.families), (p) => p.fam],
    ['conc', 'Concentration', Object.entries(labels.concentrations), (p) => p.conc],
    ['int', 'Sillage', INTENSITY.map(([k, l]) => [k, l]), intensityKey],
    ['house', 'Maison', [...new Set(perfumes.map((p) => p.house).filter(Boolean))].map((h) => [h, h]), (p) => p.house],
  ].map(([key, title, options, value]) => [key, title, options.filter(([v]) => perfumes.some((p) => value(p) === v)), value])
    .filter(([, , options]) => options.length > 1);
  const valueOf = Object.fromEntries(GROUPS.map(([key, , , value]) => [key, value]));

  function matches(p, ignore) {
    if (state.cat && p.cat !== state.cat && !(state.cat === 'new' && p.isNew)) return false;
    if (state.inStock && p.avail === 'sold_out') return false;
    if (state.maxPrice != null && ignore !== 'price' && (p.price == null || p.price > state.maxPrice)) return false;
    return GROUPS.every(([key]) => key === ignore || !state[key].size || state[key].has(valueOf[key](p)));
  }
  const SORTS = {
    newest: (a, b) => b.added.localeCompare(a.added),
    az: (a, b) => a.name.localeCompare(b.name, 'fr'),
    'price-asc': (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    'price-desc': (a, b) => (b.price ?? -1) - (a.price ?? -1),
  };
  const visible = () => {
    const list = perfumes.filter((p) => matches(p));
    return SORTS[state.sort] ? [...list].sort(SORTS[state.sort]) : list;
  };
  const filterCount = () => GROUPS.reduce((n, [key]) => n + state[key].size, 0) + (state.maxPrice != null ? 1 : 0) + (state.inStock ? 1 : 0);

  const grid = $('#grid');
  function render() {
    const list = visible();
    grid.replaceChildren(...list.map((p) => card(p)));
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'no-results';
      empty.innerHTML = '<p>Aucun parfum ne correspond à ces critères.</p><button class="btn btn-line" type="button">Tout afficher</button>';
      empty.querySelector('button').addEventListener('click', () => { resetFilters(); render(); });
      grid.append(empty);
    }
    const n = filterCount();
    $('#filterN').textContent = n ? `(${n})` : '';
    $('#resultCount').textContent = plural(list.length, 'parfum', 'parfums');
    $('#applyF').textContent = `Voir ${plural(list.length, 'parfum', 'parfums')}`;
    const heading = $('#shop-h');
    const category = DATA.categories.find((c) => c.slug === state.cat);
    heading.textContent = state.cat === 'new' ? 'Nouveautés' : category?.name ?? heading.dataset.default;
    $$('#cats .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === state.cat)));
    renderActiveFilters();
    if (filterDialog.open) renderFilterBody();
  }

  function renderActiveFilters() {
    const tags = [];
    for (const [key, , options] of GROUPS) {
      for (const v of state[key]) tags.push([key, v, options.find(([o]) => o === v)?.[1] ?? v]);
    }
    if (state.maxPrice != null) tags.push(['price', '', `Jusqu’à ${money(state.maxPrice)}`]);
    if (state.inStock) tags.push(['stock', '', 'Disponibles']);
    $('#activeFilters').innerHTML = tags.map(([k, v, l]) => `<button type="button" data-k="${k}" data-v="${esc(v)}">${esc(l)}<svg class="i"><use href="#i-close"/></svg></button>`).join('');
  }
  $('#activeFilters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k === 'price') state.maxPrice = null;
    else if (b.dataset.k === 'stock') state.inStock = false;
    else state[b.dataset.k].delete(b.dataset.v);
    render();
  });

  const cats = [['', 'Tout', perfumes.length]];
  if (perfumes.some((p) => p.isNew)) cats.push(['new', 'Nouveautés', perfumes.filter((p) => p.isNew).length]);
  for (const c of DATA.categories) cats.push([c.slug, c.name, perfumes.filter((p) => p.cat === c.slug).length]);
  $('#cats').innerHTML = cats.map(([v, l]) => `<button class="chip" type="button" data-cat="${esc(v)}" aria-pressed="false">${esc(l)}</button>`).join('');

  const filterDialog = $('#filterD');
  function renderFilterBody() {
    const chips = GROUPS.map(([key, title, options, value]) => `<div class="filter-group"><span class="label">${esc(title)}</span><div class="chips">${options.map(([v, l]) => {
      const n = perfumes.filter((p) => matches(p, key) && value(p) === v).length;
      const dot = key === 'fam' ? `<i class="dot" style="background:hsl(${FAMILY_HUES[v]} 32% 58%)"></i>` : '';
      return `<button class="chip" type="button" data-g="${key}" data-v="${esc(v)}" aria-pressed="${state[key].has(v)}">${dot}${esc(l)} <span class="n">${n}</span></button>`;
    }).join('')}</div></div>`).join('');
    const price = PRICE_MAX ? `<div class="filter-group"><span class="label">Budget maximum</span><div class="range">
      <input type="range" id="priceRange" min="${PRICE_STEP}" max="${Math.ceil(PRICE_MAX / PRICE_STEP) * PRICE_STEP}" step="${PRICE_STEP}" value="${state.maxPrice ?? Math.ceil(PRICE_MAX / PRICE_STEP) * PRICE_STEP}" aria-label="Budget maximum">
      <output id="priceOut">${state.maxPrice == null ? 'Tous les prix' : `Jusqu’à ${money(state.maxPrice)}`}</output></div></div>` : '';
    const stock = `<div class="filter-group"><span class="label">Disponibilité</span><div class="chips"><button class="chip" type="button" id="stockChip" aria-pressed="${state.inStock}">Disponibles uniquement</button></div></div>`;
    // On phones the sort menu lives here, since the toolbar only has room for the categories.
    const sorts = [...$('#sort').options].map((o) => `<button class="chip" type="button" data-sort="${o.value}" aria-pressed="${state.sort === o.value}">${esc(o.textContent)}</button>`).join('');
    const sort = `<div class="filter-group show-sm"><span class="label">Trier par</span><div class="chips">${sorts}</div></div>`;
    $('#filterBody').innerHTML = sort + chips + price + stock;
  }
  $('#filterBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (b) {
      const set = state[b.dataset.g];
      set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
      render();
    }
    if (e.target.closest('#stockChip')) { state.inStock = !state.inStock; render(); }
    const sort = e.target.closest('[data-sort]');
    if (sort) { state.sort = sort.dataset.sort; $('#sort').value = state.sort; render(); }
  });
  $('#filterBody').addEventListener('input', (e) => {
    if (e.target.id !== 'priceRange') return;
    const value = Number(e.target.value);
    state.maxPrice = value >= PRICE_MAX ? null : value;
    $('#priceOut').textContent = state.maxPrice == null ? 'Tous les prix' : `Jusqu’à ${money(state.maxPrice)}`;
    clearTimeout(e.target.t);
    e.target.t = setTimeout(render, 120);
  });
  function resetFilters() {
    for (const [key] of GROUPS) state[key].clear();
    state.maxPrice = null;
    state.inStock = false;
    state.cat = '';
  }
  $('#clearF').addEventListener('click', () => { resetFilters(); render(); });
  $('#applyF').addEventListener('click', () => { filterDialog.close(); goToShop(); });
  $('#filterBtn').addEventListener('click', () => { renderFilterBody(); openDialog(filterDialog); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

  const goToShop = () => $('#collection').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-cat]');
    if (!a) return;
    e.preventDefault();
    if (a.closest('#cats')) { state.cat = a.dataset.cat; render(); return; }
    resetFilters();
    state.cat = a.dataset.cat;
    render();
    closeAll();
    goToShop();
  });

  // ---------- Dialogs ----------
  const dialogs = $$('dialog');
  function openDialog(d) {
    if (d.open) return;
    d.showModal();
    document.body.classList.add('locked');
  }
  dialogs.forEach((d) => {
    d.addEventListener('close', () => { if (!dialogs.some((x) => x.open)) document.body.classList.remove('locked'); });
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close(); // click on the backdrop
      if (e.target.closest('[data-close]')) d.close();
    });
  });
  const closeAll = () => dialogs.forEach((d) => d.open && d.close());
  $('#menuBtn').addEventListener('click', () => openDialog($('#menuD')));
  $$('[data-close-nav]').forEach((a) => a.addEventListener('click', () => $('#menuD').close()));
  $('#menuList').innerHTML = cats.map(([v, l, n]) => `<li><a href="#collection" data-cat="${esc(v)}">${esc(l === 'Tout' ? 'Toute la collection' : l)}<span class="n">${n}</span></a></li>`).join('');

  const toastEl = $('#toast');
  function toast(text) {
    toastEl.innerHTML = `<svg class="i"><use href="#i-check"/></svg>${esc(text)}`;
    toastEl.classList.add('on');
    clearTimeout(toastEl.t);
    toastEl.t = setTimeout(() => toastEl.classList.remove('on'), 2400);
  }

  // ---------- Similarity ----------
  // Each perfume is a vector of its notes, family and audience. Cosine similarity between these
  // vectors ranks "you may also like" without any server or tracking.
  const normal = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const features = new Map(perfumes.map((p) => {
    const f = new Map();
    notesOf(p).forEach((n) => f.set(`n:${normal(n)}`, 1));
    f.set(`f:${p.fam}`, 2);
    (NEIGHBOURS[p.fam] ?? []).forEach((x) => f.set(`f:${x}`, 0.6));
    f.set(`a:${p.aud}`, 0.8);
    f.set(`m:${p.mom}`, 0.4);
    return [p.id, f];
  }));
  function cosine(a, b) {
    let dot = 0; let na = 0; let nb = 0;
    for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k); }
    for (const v of b.values()) nb += v * v;
    return dot / (Math.sqrt(na * nb) || 1);
  }
  const similarTo = (p, n = 3) => perfumes.filter((o) => o.id !== p.id && o.avail !== 'sold_out')
    .map((o) => [o, cosine(features.get(p.id), features.get(o.id))]).sort((a, b) => b[1] - a[1]).slice(0, n).map(([o]) => o);

  // ---------- Product sheet ----------
  const sheet = $('#sheet');
  let current = null;
  let pushedUrl = false;
  const AVAIL = {
    in_stock: ['', 'En stock · expédié sous 24 h'], low_stock: ['low', 'Plus que quelques flacons'],
    preorder: ['pre', 'Sur commande · délai confirmé sur WhatsApp'], sold_out: ['out', 'Épuisé · demandez son retour sur WhatsApp'],
  };
  const MOMENTS = { day: ['i-sun', 'Le jour'], night: ['i-moon', 'Le soir'], any: ['i-spark', 'Jour et soir'] };
  const INT_LABEL = ['', 'Intime', 'Discret', 'Présent', 'Généreux', 'Affirmé'];

  function openPerfume(p, { push = true } = {}) {
    current = { p, size: p.sizes.find((s) => s.p != null)?.l ?? p.sizes[0]?.l ?? '', qty: 1, view: 0 };
    renderSheet();
    openDialog(sheet);
    $('#sheetIn').scrollTop = 0;
    if (push && location.pathname !== `/parfum/${p.slug}`) {
      history.pushState({ perfume: p.slug }, '', `/parfum/${p.slug}`);
      pushedUrl = true;
    }
    document.title = `${p.name} · ${settings.brand}`;
    track('view', p.id);
    const seen = store.get(SEEN_KEY, []).filter((id) => id !== p.id);
    store.set(SEEN_KEY, [p.id, ...seen].slice(0, 8));
  }

  function sheetArt(p) {
    const views = [];
    if (p.cut) views.push({ html: `<div class="stage"><img class="cut" src="${p.cut.l}" alt="${esc(p.name)}"></div>`, thumb: `<img src="${p.cut.s}" alt="">` });
    else if (!p.photos.length) views.push({ html: `<div class="stage">${bottle(p)}</div>`, thumb: bottle(p, false) });
    p.photos.forEach((ph) => views.push({ html: imgTag(ph, '(min-width:900px) 55vw, 100vw', `class="photo" alt="${esc(p.name)}"`), thumb: `<img src="${ph.s}" alt="">` }));
    if (!p.cut && p.photos.length) views.push({ html: `<div class="stage">${bottle(p)}</div>`, thumb: bottle(p, false) });
    const view = views[Math.min(current.view, views.length - 1)];
    const thumbs = views.length > 1 ? `<div class="thumbs">${views.map((v, i) => `<button type="button" data-view="${i}" aria-label="Vue ${i + 1}" aria-pressed="${i === current.view}">${v.thumb}</button>`).join('')}</div>` : '';
    return view.html + thumbs;
  }

  function renderSheet() {
    const { p } = current;
    const [stockClass, stockText] = AVAIL[p.avail] ?? AVAIL.in_stock;
    const [momentIcon, momentText] = MOMENTS[p.mom] ?? MOMENTS.any;
    const unit = sizePrice(p, current.size);
    const soldOut = p.avail === 'sold_out';
    const tiers = [['Tête', p.top], ['Cœur', p.heart], ['Fond', p.base]].filter(([, n]) => n.length);
    const similar = similarTo(p);
    $('#sheetIn').style.setProperty('--h', hueOf(p));
    $('#sheetIn').innerHTML = `
      <button class="icon-btn sheet-close" type="button" data-close aria-label="Fermer"><svg class="i"><use href="#i-close"/></svg></button>
      <div class="sheet-art" style="--h:${hueOf(p)}">${sheetArt(p)}</div>
      <div class="sheet-info">
        <div>
          <p class="kicker">${esc(p.house || settings.brand)} · ${esc(concLabel(p))}</p>
          <h2 id="sheet-h" tabindex="-1" autofocus>${esc(p.name)}</h2>
          ${p.line ? `<p class="sheet-tag">${esc(p.line)}</p>` : ''}
        </div>
        <dl class="facts">
          <div><dt>Famille</dt><dd><i class="dot" style="background:hsl(${FAMILY_HUES[p.fam]} 32% 58%)"></i>${esc(famLabel(p.fam))}</dd></div>
          <div><dt>Sillage</dt><dd><span class="meter" aria-label="${INT_LABEL[p.int]}">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= p.int ? 'on' : ''}"></i>`).join('')}</span></dd></div>
          <div><dt>Moment</dt><dd><svg class="i" style="width:15px;height:15px"><use href="#${momentIcon}"/></svg>${momentText}</dd></div>
        </dl>
        ${p.sizes.length > 1 ? `<div><span class="label">Format</span><div class="sizes" role="radiogroup" aria-label="Format">${p.sizes.map((s) => `<button class="size" type="button" role="radio" data-size="${esc(s.l)}" aria-checked="${s.l === current.size}"><b>${esc(s.l)}</b><span>${money(s.p)}</span></button>`).join('')}</div></div>` : ''}
        <div class="sheet-buy">
          <div style="display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap">
            <p class="big-price">${money(unit == null ? null : unit * current.qty)}${p.was && p.was > (unit ?? 0) ? `<s>${money(p.was)}</s>` : ''}</p>
            <p class="stock ${stockClass}">${stockText}</p>
          </div>
          ${soldOut ? `<a class="btn btn-wa btn-block" href="${waLink(`${settings.greeting} ${p.name} est épuisé. Pouvez-vous me prévenir de son retour ?`)}" target="_blank" rel="noopener" data-wa="restock"><svg class="i" style="fill:#5fdc8f;stroke:none"><use href="#i-wa"/></svg>Être prévenu de son retour</a>`
    : `<div class="buy"><div class="qty"><button type="button" data-q="-1" aria-label="Retirer un"><svg class="i"><use href="#i-minus"/></svg></button><output aria-live="polite">${current.qty}</output><button type="button" data-q="1" aria-label="Ajouter un"><svg class="i"><use href="#i-plus"/></svg></button></div>
            <button class="btn btn-dark" type="button" id="addBtn">Ajouter à ma sélection</button></div>
            <button class="btn btn-line btn-block" type="button" id="buyNow">Commander maintenant sur WhatsApp</button>`}
        </div>
        ${p.desc ? `<p class="sheet-desc">${esc(p.desc)}</p>` : ''}
        ${tiers.length ? `<div><span class="label">Pyramide olfactive</span><dl class="pyramid">${tiers.map(([t, n]) => `<div class="tier"><dt>${t}</dt><dd>${esc(n.join(', '))}</dd></div>`).join('')}</dl></div>` : ''}
        <div class="sheet-links">
          <a href="${waLink(`${settings.greeting} j’ai une question sur ${p.name} : ${location.origin}/parfum/${p.slug}`)}" target="_blank" rel="noopener" data-wa="question"><svg class="i"><use href="#i-chat"/></svg>Une question ? Écrire à une conseillère</a>
          <button type="button" id="shareBtn"><svg class="i"><use href="#i-share"/></svg>Partager</button>
          ${p.ig ? `<a href="${esc(p.ig)}" target="_blank" rel="noopener">Voir sur Instagram</a>` : ''}
        </div>
        ${similar.length ? `<div><span class="label">Dans le même esprit</span><div class="similar">${similar.map((o) => `<button type="button" data-open="${o.id}" style="--h:${hueOf(o)}"><span class="thumb">${mini(o)}</span><b>${esc(o.name)}</b><small class="muted">${esc(famLabel(o.fam))}</small></button>`).join('')}</div></div>` : ''}
      </div>`;
  }

  $('#sheetIn').addEventListener('click', (e) => {
    const t = e.target;
    const size = t.closest('[data-size]');
    if (size) { current.size = size.dataset.size; renderSheet(); return; }
    const q = t.closest('[data-q]');
    if (q) { current.qty = Math.min(20, Math.max(1, current.qty + Number(q.dataset.q))); renderSheet(); return; }
    const view = t.closest('[data-view]');
    if (view) { current.view = Number(view.dataset.view); renderSheet(); return; }
    const other = t.closest('[data-open]');
    if (other) { openPerfume(byId.get(Number(other.dataset.open)), { push: false }); history.replaceState({ perfume: current.p.slug }, '', `/parfum/${current.p.slug}`); return; }
    if (t.closest('#addBtn')) {
      addToBag(current.p, current.size, current.qty);
      sheet.close();
      toast(`${current.p.name} ajouté à votre sélection`);
      return;
    }
    if (t.closest('#buyNow')) {
      addToBag(current.p, current.size, current.qty, { silent: true });
      sheet.close();
      openBag('checkout');
      return;
    }
    if (t.closest('#shareBtn')) share(current.p);
  });

  async function share(p) {
    const url = `${location.origin}/parfum/${p.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: p.name, text: p.line || `${p.name} · ${settings.brand}`, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié'); }
    } catch { /* the visitor closed the share sheet */ }
  }

  sheet.addEventListener('close', () => {
    document.title = settings.title;
    if (location.pathname.startsWith('/parfum/')) {
      if (pushedUrl) { pushedUrl = false; history.back(); } else history.replaceState({}, '', '/');
    }
  });
  addEventListener('popstate', () => {
    const slug = location.pathname.startsWith('/parfum/') ? decodeURIComponent(location.pathname.slice(8)) : '';
    if (slug && bySlug.has(slug)) { pushedUrl = false; openPerfume(bySlug.get(slug), { push: false }); return; }
    pushedUrl = false;
    if (sheet.open) sheet.close();
  });

  // ---------- Bag ----------
  let bag = store.get(BAG_KEY, []).filter((line) => byId.has(line.id));
  const saveBag = () => store.set(BAG_KEY, bag);
  const bagCount = () => bag.reduce((n, line) => n + line.qty, 0);
  const lineTotal = (line) => { const unit = sizePrice(byId.get(line.id), line.size); return unit == null ? null : unit * line.qty; };
  const subtotal = () => (bag.some((l) => lineTotal(l) == null) ? null : bag.reduce((s, l) => s + lineTotal(l), 0));
  let method = 'delivery';
  function deliveryFee(sub) {
    if (method === 'pickup') return 0;
    if (settings.freeFromCents != null && sub != null && sub >= settings.freeFromCents) return 0;
    return settings.deliveryCents;
  }

  function updateCount(pop) {
    const n = bagCount();
    const el = $('#bagCount');
    el.textContent = n || '';
    el.classList.toggle('on', n > 0);
    if (pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    $('#bagBtn').setAttribute('aria-label', n ? `Ma sélection, ${plural(n, 'article', 'articles')}` : 'Ma sélection');
  }

  function addToBag(p, size, qty, { silent = false } = {}) {
    const line = bag.find((l) => l.id === p.id && l.size === size);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else bag.push({ id: p.id, size, qty });
    saveBag();
    updateCount(true);
    track('add', p.id);
    if (!silent && !sheet.open) toast(`${p.name} ajouté à votre sélection`);
  }

  const bagD = $('#bagD');
  let bagView = 'bag';
  function openBag(view = 'bag') {
    bagView = bag.length ? view : 'bag';
    renderBag();
    openDialog(bagD);
  }
  $('#bagBtn').addEventListener('click', () => openBag());

  function totalsHtml() {
    const sub = subtotal();
    const fee = deliveryFee(sub);
    const total = sub != null && fee != null ? sub + fee : null;
    const feeText = method === 'pickup' ? 'Retrait offert' : fee === 0 ? 'Offerte' : fee == null ? 'Confirmée sur WhatsApp' : money(fee);
    return `<div class="totals"><div><span>Sous-total</span><span>${money(sub)}</span></div>
      <div><span>Livraison</span><span>${feeText}</span></div>
      <div class="grand"><span>Total</span><span>${total == null ? (sub == null ? 'Sur devis' : `${money(sub)} + livraison`) : money(total)}</span></div></div>`;
  }

  function freeDeliveryHtml() {
    const sub = subtotal();
    if (settings.freeFromCents == null || sub == null || method === 'pickup') return '';
    const left = settings.freeFromCents - sub;
    const ratio = Math.min(1, sub / settings.freeFromCents);
    return `<div class="free">${left > 0 ? `Plus que <b>${money(left)}</b> pour la livraison offerte` : 'La livraison vous est offerte'}<div class="bar-track"><i style="transform:scaleX(${ratio})"></i></div></div>`;
  }

  function renderBag() {
    const body = $('#bagBody');
    const foot = $('#bagFoot');
    $('#bag-h').textContent = bagView === 'checkout' ? 'Livraison' : bagView === 'done' ? 'Merci' : 'Ma sélection';
    if (bagView === 'done') return; // rendered by showDone()
    if (!bag.length) {
      body.innerHTML = `<div class="empty"><svg class="i"><use href="#i-bag"/></svg><p>Votre sélection est vide.<br>Laissez-vous guider par nos signatures.</p><a class="btn btn-dark" href="#collection" data-close>Découvrir la collection</a></div>`;
      foot.innerHTML = '';
      return;
    }
    if (bagView === 'checkout') return renderCheckout();
    body.innerHTML = freeDeliveryHtml() + bag.map((line, i) => {
      const p = byId.get(line.id);
      return `<div class="line-item" style="--h:${hueOf(p)}"><span class="thumb">${mini(p)}</span>
        <div><b>${esc(p.name)}</b><small>${esc([concLabel(p), line.size].filter(Boolean).join(' · '))}</small>
          <div class="qty"><button type="button" data-line="${i}" data-d="-1" aria-label="Retirer un"><svg class="i"><use href="#i-minus"/></svg></button><output>${line.qty}</output><button type="button" data-line="${i}" data-d="1" aria-label="Ajouter un"><svg class="i"><use href="#i-plus"/></svg></button></div></div>
        <div class="line-price"><span>${money(lineTotal(line))}</span><button class="remove" type="button" data-remove="${i}">Retirer</button></div></div>`;
    }).join('');
    const closed = !settings.ordersOpen;
    foot.innerHTML = `${totalsHtml()}<div style="display:grid;gap:10px;margin-top:16px">
      ${closed ? `<p class="alert">${esc(settings.closedMessage)}</p>` : ''}
      <button class="btn btn-dark btn-block" type="button" id="toCheckout" ${closed ? 'disabled' : ''}>Commander sur WhatsApp</button>
      <p class="form-note" style="text-align:center">${esc(settings.payment)}</p></div>`;
  }

  $('#bagBody').addEventListener('click', (e) => {
    const step = e.target.closest('[data-d]');
    if (step) {
      const line = bag[Number(step.dataset.line)];
      line.qty = Math.min(20, line.qty + Number(step.dataset.d));
      if (line.qty < 1) bag.splice(Number(step.dataset.line), 1);
      saveBag(); updateCount(); renderBag();
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) { bag.splice(Number(remove.dataset.remove), 1); saveBag(); updateCount(); renderBag(); return; }
    if (e.target.closest('#backToBag')) { bagView = 'bag'; renderBag(); }
    if (e.target.closest('[data-close]')) bagD.close();
  });
  $('#bagFoot').addEventListener('click', (e) => {
    if (e.target.closest('#toCheckout')) { bagView = 'checkout'; renderBag(); $('#c-name')?.focus(); }
  });

  // ---------- Checkout: the order is recorded, then sent on WhatsApp ----------
  let idempotencyKey = null;
  let location_ = null;
  function renderCheckout() {
    const body = $('#bagBody');
    body.replaceChildren($('#checkoutTpl').content.cloneNode(true));
    const saved = store.get(CUSTOMER_KEY, {});
    for (const [k, v] of Object.entries(saved)) { const input = body.querySelector(`[name="${k}"]`); if (input && k !== 'website') input.value = v; }
    if (settings.pickup) {
      $('#methodField').hidden = false;
      $$('#methodField [data-method]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.method === method)));
      $('#addressField').hidden = method === 'pickup';
    } else method = 'delivery';
    $('#bagFoot').innerHTML = `${totalsHtml()}<div style="display:grid;gap:10px;margin-top:16px">
      <button class="btn btn-wa btn-block" type="submit" form="checkout" id="sendOrder"><svg class="i" style="fill:#5fdc8f;stroke:none"><use href="#i-wa"/></svg>Envoyer ma commande</button>
      <p class="form-note" style="text-align:center">Vous relirez le message dans WhatsApp avant de l’envoyer.</p></div>`;
    $('#checkout').addEventListener('submit', submitOrder);
    $('#checkout').addEventListener('input', () => { $('#formError').innerHTML = ''; });
    $('#methodField').addEventListener('click', (e) => {
      const b = e.target.closest('[data-method]');
      if (!b) return;
      method = b.dataset.method;
      renderCheckout();
    });
    $('#locate').addEventListener('click', shareLocation);
    if (location_) $('#locate span').textContent = 'Position ajoutée ✓';
  }

  function shareLocation() {
    const label = $('#locate span');
    if (!navigator.geolocation) { label.textContent = 'Position indisponible : l’adresse suffit.'; return; }
    label.textContent = 'Localisation…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { location_ = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }; label.textContent = 'Position ajoutée ✓'; },
      () => { label.textContent = 'Position refusée : l’adresse suffit.'; },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function formValues(form) {
    const data = Object.fromEntries(new FormData(form));
    return {
      name: (data.name ?? '').trim(), phone: (data.phone ?? '').trim(), city: (data.city ?? '').trim(),
      address: (data.address ?? '').trim(), note: (data.note ?? '').trim(), website: data.website ?? '',
    };
  }

  const PHONE = /^\+?[0-9 ().-]{7,22}$/;
  function validate(form, values) {
    if (!PHONE.test(values.phone)) { $('#c-phone').focus(); return 'Indiquez un numéro de téléphone valide.'; }
    for (const input of form.querySelectorAll('input[required]')) {
      if (!input.checkValidity()) { input.focus(); return `Vérifiez le champ « ${input.labels[0].textContent} ».`; }
    }
    if (method === 'delivery' && values.address.length < 3) { $('#c-address').focus(); return 'Indiquez une adresse ou un point de repère.'; }
    return '';
  }

  async function submitOrder(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = formValues(form);
    const problem = validate(form, values);
    if (problem) { $('#formError').innerHTML = `<p class="alert">${esc(problem)}</p>`; return; }
    store.set(CUSTOMER_KEY, { name: values.name, phone: values.phone, city: values.city, address: values.address });
    const button = $('#sendOrder');
    button.disabled = true;
    button.lastChild.textContent = 'Préparation…';
    idempotencyKey ??= (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 40).padEnd(16, '0');
    const payload = {
      idempotencyKey,
      website: values.website,
      customer: { name: values.name, phone: values.phone, city: values.city, address: values.address, note: values.note, delivery: method },
      location: location_,
      items: bag.map((l) => ({ perfumeId: l.id, quantity: l.qty, ...(l.size ? { option: l.size } : {}) })),
    };
    try {
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (response.status >= 400 && response.status < 500) {
        $('#formError').innerHTML = `<p class="alert">${esc(result.message || 'La commande n’a pas pu être préparée.')}</p>`;
        button.disabled = false;
        button.lastChild.textContent = 'Envoyer ma commande';
        return;
      }
      if (!response.ok) throw new Error('server');
      track('checkout');
      showDone(result.number, result.whatsappUrl, result.message);
    } catch {
      // The shop's server is unreachable (network, outage). The order still reaches the shop:
      // the same message is written here and sent on WhatsApp, without an order number.
      const message = offlineMessage(values);
      showDone('', settings.whatsapp ? waLink(message) : null, message);
    }
  }

  function offlineMessage(v) {
    const sub = subtotal();
    const fee = deliveryFee(sub);
    return [
      settings.greeting, 'Je souhaite commander :', '',
      ...bag.map((l) => { const p = byId.get(l.id); return `• ${l.qty} × ${p.name}${l.size ? ` · ${l.size}` : ''} — ${money(lineTotal(l))}`; }),
      '', `Sous-total : ${money(sub)}`, method === 'pickup' ? 'Retrait en boutique' : `Livraison : ${fee === 0 ? 'offerte' : fee == null ? 'à confirmer' : money(fee)}`,
      `*Total : ${sub != null && fee != null ? money(sub + fee) : 'à confirmer'}*`, '',
      `Nom : ${v.name}`, `Téléphone : ${v.phone}`, method === 'pickup' ? `Ville : ${v.city}` : `Adresse : ${v.address}, ${v.city}`,
      ...(location_ ? [`Position : https://maps.google.com/?q=${location_.lat},${location_.lng}`] : []),
      ...(v.note ? [`Note : ${v.note}`] : []),
    ].join('\n');
  }

  function showDone(number, url, message) {
    bagView = 'done';
    $('#bag-h').textContent = 'Dernière étape';
    $('#bagBody').innerHTML = `<div class="done">
      <span class="seal"><svg class="i"><use href="#i-check"/></svg></span>
      ${number ? `<span class="num">Commande ${esc(number)}</span>` : ''}
      <h3>Envoyez-la sur WhatsApp</h3>
      <p>${esc(settings.confirmation)}</p>
      <details style="width:100%"><summary class="muted" style="cursor:pointer;font-size:.84rem">Voir le message</summary><pre class="preview">${esc(message ?? '')}</pre></details>
    </div>`;
    $('#bagFoot').innerHTML = url
      ? `<a class="btn btn-wa btn-block" href="${esc(url)}" target="_blank" rel="noopener" id="sendWa" data-wa="order"><svg class="i" style="fill:#5fdc8f;stroke:none"><use href="#i-wa"/></svg>Ouvrir WhatsApp et envoyer</a>
         <button class="btn btn-line btn-block" type="button" id="copyMsg" style="margin-top:10px">Copier le message</button>`
      : '<p class="form-note" style="text-align:center">Nous vous appelons très vite pour confirmer votre commande.</p>';
    $('#sendWa')?.addEventListener('click', finishOrder);
    $('#copyMsg')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(message); toast('Message copié'); } catch { /* clipboard blocked */ } });
    if (!url) finishOrder();
  }

  // The bag is emptied once the order has been handed to WhatsApp.
  function finishOrder() {
    bag = [];
    saveBag();
    updateCount();
    idempotencyKey = null;
    location_ = null;
    bagD.addEventListener('close', () => { bagView = 'bag'; }, { once: true });
  }

  function waLink(text) {
    return settings.whatsapp ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(text)}` : '#commander';
  }
  document.addEventListener('click', (e) => {
    const wa = e.target.closest('[data-wa]');
    if (wa) track('whatsapp', wa.dataset.wa === 'question' && current ? current.p.id : 0);
  });

  // ---------- Search (accent-insensitive, typo-tolerant) ----------
  const fields = (p) => [[p.name, 6], [p.house, 3], [notesOf(p).join(' '), 4], [famLabel(p.fam), 3], [concLabel(p), 2], [labels.audiences[p.aud], 2], [p.line, 1], [p.desc, 1]];
  const index = perfumes.map((p) => ({ p, fields: fields(p).map(([text, weight]) => [normal(text ?? '').split(/[^a-z0-9]+/).filter(Boolean), weight]) }));

  // Optimal string alignment distance, stopped early once it passes `max`.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        row.push(v);
        best = Math.min(best, v);
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = row;
    }
    return prev[b.length];
  }
  function tokenScore(q, word) {
    if (word.startsWith(q)) return q.length === word.length ? 1 : 0.85;
    if (q.length >= 4) {
      const d = distance(q, word.slice(0, q.length + 1), q.length >= 7 ? 2 : 1);
      if (d <= (q.length >= 7 ? 2 : 1)) return 0.6;
    }
    return 0;
  }
  function searchPerfumes(query) {
    const terms = normal(query).split(/[^a-z0-9]+/).filter(Boolean);
    if (!terms.length) return [];
    return index.map(({ p, fields: fs }) => {
      let total = 0;
      for (const term of terms) {
        let best = 0;
        for (const [words, weight] of fs) for (const w of words) best = Math.max(best, tokenScore(term, w) * weight);
        if (!best) return [p, 0];
        total += best;
      }
      return [p, total];
    }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }
  function highlight(text, query) {
    const terms = normal(query).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    const safe = esc(text);
    if (!terms.length) return safe;
    const n = normal(text);
    const marks = [];
    for (const t of terms) { let i = n.indexOf(t); while (i !== -1) { marks.push([i, i + t.length]); i = n.indexOf(t, i + t.length); } }
    if (!marks.length) return safe;
    marks.sort((a, b) => a[0] - b[0]);
    let out = ''; let at = 0;
    for (const [s, e] of marks) { if (s < at) continue; out += esc(text.slice(at, s)) + `<mark>${esc(text.slice(s, e))}</mark>`; at = e; }
    return out + esc(text.slice(at));
  }

  const searchD = $('#searchD');
  const q = $('#q');
  const resultRow = (p, query = '') => `<li><button type="button" data-open="${p.id}" style="--h:${hueOf(p)}"><span class="thumb">${mini(p)}</span>
    <span><b>${highlight(p.name, query)}</b><small>${esc(famLabel(p.fam))} · ${highlight(notesOf(p).slice(0, 4).join(', '), query)}</small></span><span class="r-price">${money(p.price)}</span></button></li>`;
  function renderSearch() {
    const term = q.value.trim();
    const body = $('#searchBody');
    if (!term) {
      const seen = store.get(SEEN_KEY, []).map((id) => byId.get(id)).filter(Boolean).slice(0, 4);
      const popular = ['Vanille', 'Oud', 'Rose', 'Ambre', 'Musc', 'Frais', 'Boisé', 'Pour elle', 'Pour lui']
        .filter((s) => searchPerfumes(s).length).slice(0, 8);
      body.innerHTML = `${popular.length ? `<p class="search-label">Envies</p><div class="suggest">${popular.map((s) => `<button class="chip" type="button" data-term="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
        ${seen.length ? `<p class="search-label">Consultés récemment</p><ul class="results">${seen.map((p) => resultRow(p)).join('')}</ul>` : ''}`;
      return;
    }
    const hits = searchPerfumes(term);
    body.innerHTML = hits.length
      ? `<p class="search-label">${plural(hits.length, 'résultat', 'résultats')}</p><ul class="results">${hits.slice(0, 12).map((p) => resultRow(p, term)).join('')}</ul>`
      : `<div class="empty"><p>Aucun parfum pour « ${esc(term)} ».<br>Essayez une note : vanille, bois, fleur…</p><a class="btn btn-line" href="${waLink(`${settings.greeting} je cherche un parfum : ${term}`)}" target="_blank" rel="noopener" data-wa="search">Demander à une conseillère</a></div>`;
  }
  let searchTimer;
  q.addEventListener('input', () => {
    renderSearch();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (q.value.trim().length >= 3) track('search'); }, 1200);
  });
  $('#searchBody').addEventListener('click', (e) => {
    const term = e.target.closest('[data-term]');
    if (term) { q.value = term.dataset.term; renderSearch(); q.focus(); return; }
    const hit = e.target.closest('[data-open]');
    if (hit) { searchD.close(); openPerfume(byId.get(Number(hit.dataset.open))); }
  });
  function openSearch(term = '') {
    q.value = term;
    renderSearch();
    openDialog(searchD);
    q.focus();
  }
  $('#searchBtn').addEventListener('click', () => openSearch());
  addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); closeAll(); openSearch(); }
  });

  // ---------- Scent finder ----------
  const QUESTIONS = [
    { key: 'aud', title: 'Pour qui ?', hint: 'Un parfum pour vous, ou à offrir.', options: [['women', 'Pour elle', 'Féminin, lumineux'], ['men', 'Pour lui', 'Masculin, racé'], ['any', 'Peu importe', 'Les parfums n’ont pas de genre']] },
    { key: 'mom', title: 'À quel moment ?', hint: 'Le parfum suit votre journée.', options: [['day', 'Le jour', 'Bureau, soleil, légèreté'], ['night', 'Le soir', 'Dîner, sortie, séduction'], ['any', 'Toujours', 'Une signature de tous les instants']] },
    { key: 'fam', title: 'Quelles émotions vous attirent ?', hint: 'Choisissez jusqu’à trois familles.', multi: 3, options: familiesUsed.map((f) => [f, famLabel(f), FAMILY_LINES[f]]) },
    { key: 'int', title: 'Quel sillage ?', hint: 'La trace que vous laissez derrière vous.', options: [['2', 'Discret', 'Proche de la peau'], ['3', 'Présent', 'Remarqué sans s’imposer'], ['5', 'Affirmé', 'Inoubliable']] },
  ];
  const answers = { aud: '', mom: '', fam: [], int: '' };
  let quizStep = 0;

  function scorePerfume(p) {
    const audience = answers.aud === 'any' || p.aud === answers.aud ? 1 : p.aud === 'unisex' ? 0.75 : 0.1;
    const moment = answers.mom === 'any' || p.mom === 'any' || p.mom === answers.mom ? 1 : 0.35;
    const family = !answers.fam.length ? 0.7 : answers.fam.includes(p.fam) ? 1 : answers.fam.some((f) => NEIGHBOURS[f]?.includes(p.fam)) ? 0.55 : 0.1;
    const intensity = 1 - Math.abs(p.int - Number(answers.int || 3)) / 4;
    const available = p.avail === 'sold_out' ? 0.6 : 1;
    return (0.42 * family + 0.22 * audience + 0.2 * intensity + 0.16 * moment) * available;
  }

  function renderQuiz() {
    const box = $('#quiz');
    const progress = `<div class="quiz-progress" aria-hidden="true">${QUESTIONS.map((_, i) => `<i class="${i < quizStep || quizStep === QUESTIONS.length ? 'on' : ''}"></i>`).join('')}</div>`;
    if (quizStep === QUESTIONS.length) {
      const ranked = perfumes.map((p) => [p, scorePerfume(p)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      box.innerHTML = `${progress}<div class="quiz-step"><p class="kicker">Votre sélection</p><h3>Ils vous ressemblent</h3><p class="hint">Calculé à partir de vos réponses et de la composition de chaque parfum.</p>
        <div class="matches">${ranked.map(([p, s]) => `<button class="match" type="button" data-open="${p.id}" style="--h:${hueOf(p)}"><span class="thumb">${mini(p)}</span><span><b>${esc(p.name)}</b><small>${esc(famLabel(p.fam))} · ${esc(notesOf(p).slice(0, 3).join(', '))}</small></span><span class="score"><strong>${Math.round(s * 100)}%</strong>affinité</span></button>`).join('')}</div>
        <div class="quiz-nav"><button class="link" type="button" id="quizRestart">Recommencer</button><a class="btn btn-line" href="${waLink(`${settings.greeting} le test m’a conseillé ${ranked.map(([p]) => p.name).join(', ')}. Pouvez-vous m’orienter ?`)}" target="_blank" rel="noopener" data-wa="quiz">Affiner avec une conseillère</a></div></div>`;
      return;
    }
    const question = QUESTIONS[quizStep];
    const chosen = (v) => (question.multi ? answers.fam.includes(v) : answers[question.key] === v);
    const ready = question.multi ? answers.fam.length > 0 : Boolean(answers[question.key]);
    box.innerHTML = `${progress}<div class="quiz-step"><p class="kicker">Question ${quizStep + 1} sur ${QUESTIONS.length}</p><h3>${question.title}</h3><p class="hint">${question.hint}</p>
      <div class="options" role="group" aria-label="${esc(question.title)}">${question.options.map(([v, l, d]) => `<button class="opt" type="button" data-answer="${esc(v)}" aria-pressed="${chosen(v)}"${question.key === 'fam' ? ` style="--h:${FAMILY_HUES[v]}"` : ''}><b>${esc(l)}</b><span>${esc(d)}</span></button>`).join('')}</div>
      <div class="quiz-nav">${quizStep ? '<button class="link" type="button" id="quizBack">Retour</button>' : '<span></span>'}${question.multi ? `<button class="btn btn-dark" type="button" id="quizNext" ${ready ? '' : 'disabled'}>Continuer</button>` : ''}</div></div>`;
  }
  $('#quiz').addEventListener('click', (e) => {
    const answer = e.target.closest('[data-answer]');
    const question = QUESTIONS[quizStep];
    if (answer && question) {
      const v = answer.dataset.answer;
      if (question.multi) {
        answers.fam = answers.fam.includes(v) ? answers.fam.filter((f) => f !== v) : [...answers.fam, v].slice(-question.multi);
      } else {
        answers[question.key] = v;
        quizStep += 1;
        if (quizStep === QUESTIONS.length) track('quiz');
      }
      renderQuiz();
      return;
    }
    if (e.target.closest('#quizNext')) { quizStep += 1; renderQuiz(); return; }
    if (e.target.closest('#quizBack')) { quizStep -= 1; renderQuiz(); return; }
    if (e.target.closest('#quizRestart')) { quizStep = 0; Object.assign(answers, { aud: '', mom: '', fam: [], int: '' }); renderQuiz(); return; }
    const open = e.target.closest('[data-open]');
    if (open) openPerfume(byId.get(Number(open.dataset.open)));
  });
  if (perfumes.length) renderQuiz(); else $('#finder').hidden = true;

  // ---------- Reveal on scroll ----------
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
  } else document.documentElement.classList.add('no-io');

  // ---------- App: offline cache and "install" ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#installBtn').classList.add('on'); });
  $('#installBtn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $('#installBtn').classList.remove('on');
  });

  // ---------- Start ----------
  render();
  updateCount();
  const params = new URLSearchParams(location.search);
  const startSlug = document.body.dataset.start;
  if (startSlug && bySlug.has(startSlug)) openPerfume(bySlug.get(startSlug), { push: false });
  else if (params.get('q')) openSearch(params.get('q'));
  else if (params.get('panier') !== null) openBag();
})();
