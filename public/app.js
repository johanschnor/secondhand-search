const LOGOS = {
  DBA: "dba.svg", Tradera: "tradera.svg", eBay: "ebay.svg", Vinted: "vinted.svg", Sellpy: "sellpy.svg",
  Grailed: "grailed.svg", Kleinanzeigen: "kleinanzeigen.svg", Momox: "momox.svg", Vestiaire: "vestiaire.svg",
  Marrkt: "marrkt.svg", "Second Football Shirts": "Secondfootballshirts.svg",
  "Supersælger": "supersaelger.svg",
};

const $ = (id) => document.getElementById(id);
const state = { platforms: [], off: new Set(), items: [], page: 1, query: "", counts: {}, exhausted: new Set(), rates: { DKK: 1 } };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Valutakurser hentes direkte fra din browser (ingen nøgle nødvendig)
async function loadRates() {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/DKK");
    const d = await r.json();
    if (d?.rates) state.rates = d.rates; // 1 DKK = rates[X] X
  } catch { /* vi viser bare originalpriser */ }
}
const toDKK = (price, cur = "DKK") => {
  if (!price) return 0;
  const rate = state.rates[cur];
  return cur === "DKK" || !rate ? price : price / rate;
};
const fmt = (n) => Math.round(n).toLocaleString("da-DK");

async function loadPlatforms() {
  state.platforms = await (await fetch("/api/platforms")).json();
  state.off = new Set(store.get("secondhand.off", []));
  renderChips();
}

function renderChips() {
  $("platforms").innerHTML = "";
  for (const p of state.platforms) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    const on = p.enabled && !state.off.has(p.name);
    b.setAttribute("aria-pressed", String(on));
    if (!p.enabled) {
      b.disabled = true;
      b.title = `Kræver egne API-nøgler i .env: ${p.requires.join(", ")}`;
    }
    const c = state.counts[p.name];
    let n = "";
    if (c === "…") n = `<span class="n">…</span>`;
    else if (c?.error) n = `<span class="n err" title="${c.error}">!</span>`;
    else if (c) n = `<span class="n">${c.count}</span>`;
    b.innerHTML = `${p.name}${n}`;
    b.onclick = () => {
      state.off.has(p.name) ? state.off.delete(p.name) : state.off.add(p.name);
      store.set("secondhand.off", [...state.off]);
      renderChips();
      renderResults();
    };
    $("platforms").append(b);
  }
}

// Kategorier/størrelser fra backendens CATEGORY_MAP og SIZE_MAP
async function loadCategories() {
  try {
    state.catalog = await (await fetch("/api/categories")).json();
  } catch {
    state.catalog = { categories: [], sizes: {} };
  }
  renderCategoryOptions();
}

function renderCategoryOptions() {
  const gender = { Men: "male", Female: "female" }[$("kon").value];
  const current = $("kategori").value;
  const cats = state.catalog.categories.filter((c) => !gender || c.genders.includes(gender));
  $("kategori").innerHTML = `<option value="">Auto</option>` +
    cats.map((c) => `<option value="${esc(c.name)}">${esc(c.label)}</option>`).join("");
  if (cats.some((c) => c.name === current)) $("kategori").value = current;
  renderSizeOptions();
}

function renderSizeOptions() {
  const cat = state.catalog.categories.find((c) => c.name === $("kategori").value);
  const sizes = cat ? state.catalog.sizes[cat.sizeType] || [] : [];
  const current = $("size").value;
  $("size").innerHTML = `<option value="">Alle</option>` +
    sizes.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  $("size").disabled = !sizes.length || cat?.sizeType === "onesize";
  if (sizes.includes(current)) $("size").value = current;
}

const searchFilters = () => {
  const f = { kon: $("kon").value, kategori: $("kategori").value, size: $("size").value };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
};

const activeSources = () => state.platforms.filter((p) => p.enabled && !state.off.has(p.name)).map((p) => p.name);

// Bland kilderne skiftevis, så ingen platform dominerer toppen
function interleave(items) {
  const bySource = new Map();
  for (const i of items) (bySource.get(i.source) || bySource.set(i.source, []).get(i.source)).push(i);
  const lists = [...bySource.values()];
  const out = [];
  for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length) out.push(l[k]);
  return out;
}

function visibleItems() {
  const min = parseFloat($("price-min").value);
  const max = parseFloat($("price-max").value);
  let items = state.items.filter((i) => !state.off.has(i.source));
  items = items.filter((i) => {
    const p = toDKK(i.price, i.currency);
    return (isNaN(min) || p >= min) && (isNaN(max) || p <= max);
  });
  const sort = $("sort").value;
  if (sort === "price_asc") return items.sort((a, b) => toDKK(a.price, a.currency) - toDKK(b.price, b.currency));
  if (sort === "price_desc") return items.sort((a, b) => toDKK(b.price, b.currency) - toDKK(a.price, a.currency));
  return interleave(items);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function card(i) {
  const dkk = toDKK(i.price, i.currency);
  const price = i.price > 0
    ? `${fmt(dkk)} DKK${i.currency && i.currency !== "DKK" ? `<span class="orig">${esc(i.price)} ${esc(i.currency)}</span>` : ""}`
    : "Se pris";
  const logo = LOGOS[i.source] ? `<img src="logos/${LOGOS[i.source]}" alt="${esc(i.source)}" />` : esc(i.source);
  const title = i.title && !/undefined/i.test(i.title) ? i.title : i.brand || "Vare";
  return `<a class="card" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
    <div class="card-img">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}</div>
    <div class="card-price">${price}</div>
    <div class="card-title">${esc(title)}</div>
    <div class="card-meta"><span>${esc(i.size || "")}</span><span class="card-source">${logo}</span></div>
  </a>`;
}

function renderResults() {
  const items = visibleItems();
  $("results").innerHTML = items.map(card).join("");
  const pending = Object.values(state.counts).filter((c) => c === "…").length;
  $("status").textContent = state.query
    ? `${items.length} resultater for "${state.query}"${pending ? ` · venter på ${pending} platform${pending > 1 ? "e" : ""}…` : ""}`
    : "";
  const canLoadMore = !pending && state.query && activeSources().some((s) => !state.exhausted.has(s));
  $("more").hidden = !canLoadMore;
}

// Én forespørgsel pr. platform, så resultaterne dukker op efterhånden som de kommer ind
async function search(page = 1) {
  const sources = activeSources().filter((s) => page === 1 || !state.exhausted.has(s));
  if (page === 1) {
    state.items = [];
    state.exhausted = new Set();
    state.counts = {};
  }
  state.page = page;
  const seen = new Set(state.items.map((i) => i.id || i.url));
  const runId = (search.run = (search.run || 0) + 1);

  for (const s of sources) state.counts[s] = "…";
  renderChips();
  renderResults();

  await Promise.all(sources.map(async (source) => {
    const prev = page > 1 ? state.counts[source] : null;
    try {
      const params = new URLSearchParams({ q: state.query, sources: source, page, limit: 24, ...searchFilters() });
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      if (runId !== search.run) return;
      const fresh = (data.items || []).filter((i) => !seen.has(i.id || i.url) && seen.add(i.id || i.url));
      if (!fresh.length) state.exhausted.add(source);
      state.items.push(...fresh);
      const info = data.sources?.[source] || { count: fresh.length };
      state.counts[source] = { ...info, count: (prev?.count || 0) + fresh.length };
    } catch (e) {
      if (runId !== search.run) return;
      state.counts[source] = { count: prev?.count || 0, error: e.message };
    }
    renderChips();
    renderResults();
  }));
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  state.query = q;
  history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
  search(1);
});
$("more").addEventListener("click", () => search(state.page + 1));
for (const id of ["price-min", "price-max", "sort"]) $(id).addEventListener("input", renderResults);
// Køn/kategori/størrelse ændrer selve platform-forespørgslen, så vi søger igen
const rerun = () => state.query && search(1);
$("kon").addEventListener("change", () => { renderCategoryOptions(); rerun(); });
$("kategori").addEventListener("change", () => { renderSizeOptions(); rerun(); });
$("size").addEventListener("change", rerun);

await Promise.all([loadPlatforms(), loadRates(), loadCategories()]);
const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  $("q").value = initial;
  state.query = initial;
  search(1);
}
